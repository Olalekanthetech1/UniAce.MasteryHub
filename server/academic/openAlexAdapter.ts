import type { AcademicPaper, CanonicalDefinition } from './types.js';

function reconstructAbstract(invertedIndex?: Record<string, number[]>): string | null {
  if (!invertedIndex || Object.keys(invertedIndex).length === 0) return null;
  const wordMap: Array<{ pos: number; word: string }> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      if (Number.isInteger(pos) && pos >= 0) wordMap.push({ pos, word });
    }
  }
  wordMap.sort((a, b) => a.pos - b.pos);
  const text = wordMap.map((item) => item.word).join(' ').trim();
  return text || null;
}

export async function fetchFromOpenAlex(
  query: string,
  limit: number = 5,
  politeEmail?: string
): Promise<{ papers: AcademicPaper[]; latencyMs: number }> {
  const startedAt = Date.now();
  const mailto = politeEmail ? '&mailto=' + encodeURIComponent(politeEmail) : '';
  const url = 'https://api.openalex.org/works?search=' +
    encodeURIComponent(query) + '&per-page=' + Math.max(1, Math.min(20, limit)) + mailto;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'UniAce-AcademicResearch/1.0' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    throw new Error('OpenAlex API returned HTTP ' + response.status + ': ' + response.statusText);
  }

  const payload = await response.json() as {
    results?: Array<{
      id: string;
      title?: string;
      authorships?: Array<{ author?: { display_name?: string } }>;
      abstract_inverted_index?: Record<string, number[]>;
      publication_year?: number;
      doi?: string;
      cited_by_count?: number;
      primary_location?: {
        source?: { display_name?: string };
        landing_page_url?: string;
        pdf_url?: string;
      };
      concepts?: Array<{ display_name?: string }>;
    }>;
  };

  const papers: AcademicPaper[] = [];
  for (const item of payload.results || []) {
    if (!item.id || !item.title?.trim()) continue;
    const authors = (item.authorships || [])
      .map((authorship) => authorship.author?.display_name?.trim() || '')
      .filter(Boolean);
    const year = typeof item.publication_year === 'number' && Number.isInteger(item.publication_year)
      ? item.publication_year
      : null;
    const citationCount = typeof item.cited_by_count === 'number' && Number.isFinite(item.cited_by_count)
      ? item.cited_by_count
      : null;
    const cleanDoi = item.doi
      ? item.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      : null;
    const urlValue = item.primary_location?.landing_page_url || (cleanDoi ? 'https://doi.org/' + cleanDoi : item.id);
    let validUrl: string;
    try {
      const parsedUrl = new URL(urlValue);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) continue;
      validUrl = parsedUrl.toString();
    } catch {
      continue;
    }

    papers.push({
      id: 'openalex_' + item.id.replace(/^https?:\/\/openalex\.org\//, ''),
      title: item.title.trim(),
      authors,
      abstract: reconstructAbstract(item.abstract_inverted_index),
      year,
      venue: item.primary_location?.source?.display_name || null,
      doi: cleanDoi,
      url: validUrl,
      pdfUrl: item.primary_location?.pdf_url || null,
      citationCount,
      source: 'openalex',
      publicationType: 'indexed_record',
      relevanceScore: 0,
      syllabusTags: (item.concepts || [])
        .map((concept) => concept.display_name?.trim() || '')
        .filter(Boolean)
        .slice(0, 3)
    });
  }
  return { papers, latencyMs: Date.now() - startedAt };
}

export async function fetchOpenAlexConceptDefinitions(
  subject: string,
  topic: string
): Promise<CanonicalDefinition | null> {
  const searchTerm = (subject + ' ' + topic).trim();
  const response = await fetch(
    'https://api.openalex.org/concepts?search=' + encodeURIComponent(searchTerm) + '&per-page=5',
    {
      headers: { 'User-Agent': 'UniAce-AcademicResearch/1.0' },
      signal: AbortSignal.timeout(10000)
    }
  );
  if (!response.ok) {
    throw new Error('OpenAlex concept lookup returned HTTP ' + response.status + ': ' + response.statusText);
  }

  const payload = await response.json() as {
    results?: Array<{
      id?: string;
      display_name?: string;
      description?: string;
      wikidata?: string;
    }>;
  };
  const match = (payload.results || []).find((result) =>
    typeof result.description === 'string' && result.description.trim() &&
    typeof result.id === 'string' && typeof result.display_name === 'string'
  );
  if (!match || !match.id || !match.display_name || !match.description) return null;

  return {
    subject,
    topic: match.display_name,
    canonicalDefinition: match.description,
    sourceProvider: 'openalex',
    sourceId: match.id,
    sourceUrl: match.id
  };
}
