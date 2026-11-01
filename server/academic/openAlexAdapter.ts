import { AcademicPaper, CanonicalDefinition } from './types.js';

function reconstructAbstract(invertedIndex?: Record<string, number[]>): string {
  if (!invertedIndex || Object.keys(invertedIndex).length === 0) {
    return '';
  }

  const wordMap: Array<{ pos: number; word: string }> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      wordMap.push({ pos, word });
    }
  }

  wordMap.sort((a, b) => a.pos - b.pos);
  return wordMap.map((w) => w.word).join(' ');
}

export async function fetchFromOpenAlex(
  query: string,
  limit: number = 5,
  politeEmail?: string
): Promise<{ papers: AcademicPaper[]; latencyMs: number }> {
  const startTime = Date.now();
  const params = new URLSearchParams({ search: query, 'per-page': String(limit) });
  if (politeEmail) params.set('mailto', politeEmail);
  const url = `https://api.openalex.org/works?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'UniAce-AcademicGrounding-Bot/1.0',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`OpenAlex API status ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as {
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

  if (data.results && Array.isArray(data.results)) {
    for (const item of data.results) {
      if (!item.title) continue;

      const authors = item.authorships
        ? item.authorships.map((a) => a.author?.display_name || '').filter(Boolean)
        : [];

      const abstract = reconstructAbstract(item.abstract_inverted_index);
      const cleanDoi = item.doi ? item.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : null;
      const pdfUrl = item.primary_location?.pdf_url || null;
      const url = item.primary_location?.landing_page_url || (item.doi ? item.doi : item.id);

      const conceptTags = item.concepts ? item.concepts.slice(0, 3).map((c) => c.display_name || '').filter(Boolean) : [];

      papers.push({
        id: `openalex_${item.id.replace(/^https?:\/\/openalex\.org\//, '')}`,
        title: item.title,
        authors,
        abstract,
        year: item.publication_year || null,
        venue: item.primary_location?.source?.display_name || null,
        doi: cleanDoi,
        url,
        pdfUrl,
        citationCount: typeof item.cited_by_count === 'number' ? item.cited_by_count : null,
        source: 'openalex',
        relevanceScore: 0,
        syllabusTags: conceptTags,
      });
    }
  }

  const latencyMs = Date.now() - startTime;
  return { papers, latencyMs };
}

export async function fetchOpenAlexConceptDefinitions(
  subject: string,
  topic: string,
): Promise<CanonicalDefinition | null> {
  const searchTerm = `${subject} ${topic}`.trim();
  const url = `https://api.openalex.org/concepts?search=${encodeURIComponent(
    searchTerm
  )}&per-page=3`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'UniAce-AcademicGrounding-Bot/1.0 (mailto:uniace.support@gmail.com)',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      results?: Array<{
        id: string;
        display_name: string;
        description?: string;
        related_concepts?: Array<{ display_name: string }>;
        ancestors?: Array<{ display_name: string }>;
      }>;
    };

    if (!data.results || data.results.length === 0) return null;

    const primaryConcept = data.results[0];
    const canonicalDef = primaryConcept.description?.trim();
    if (!canonicalDef || !primaryConcept.id) return null;

    const relatedConcepts = primaryConcept.related_concepts
      ? primaryConcept.related_concepts.slice(0, 3).map((concept) => concept.display_name).filter(Boolean)
      : [];

    return {
      topic: primaryConcept.display_name,
      subject,
      canonicalDefinition: canonicalDef,
      sourceProvider: 'openalex',
      sourceUrl: primaryConcept.id,
      relatedConcepts,
    };
  } catch (error) {
    console.error('OpenAlex Concept Fetch Error:', error);
    return null;
  }
}
