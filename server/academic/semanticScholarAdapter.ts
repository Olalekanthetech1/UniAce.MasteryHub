import type { AcademicPaper } from './types.js';

interface SemanticScholarPaper {
  paperId: string;
  title?: string;
  authors?: Array<{ name?: string }>;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  citationCount?: number | null;
  externalIds?: { DOI?: string; ArXiv?: string };
  url?: string;
  openAccessPdf?: { url?: string | null };
}

function mapPaper(paper: SemanticScholarPaper): AcademicPaper | null {
  if (!paper.paperId || !paper.title?.trim()) return null;
  const authors = (paper.authors || [])
    .map((author) => author.name?.trim() || '')
    .filter(Boolean);
  const year = typeof paper.year === 'number' && Number.isInteger(paper.year) ? paper.year : null;
  const citationCount = typeof paper.citationCount === 'number' && Number.isFinite(paper.citationCount)
    ? paper.citationCount
    : null;
  const doi = paper.externalIds?.DOI || null;

  return {
    id: 's2_' + paper.paperId,
    title: paper.title.trim(),
    authors,
    abstract: paper.abstract?.trim() || null,
    year,
    venue: paper.venue?.trim() || null,
    doi,
    url: paper.url || (doi ? 'https://doi.org/' + doi : 'https://www.semanticscholar.org/paper/' + paper.paperId),
    pdfUrl: paper.openAccessPdf?.url || (
      paper.externalIds?.ArXiv ? 'https://arxiv.org/pdf/' + paper.externalIds.ArXiv + '.pdf' : null
    ),
    citationCount,
    source: 'semantic_scholar',
    publicationType: 'indexed_record',
    relevanceScore: 0,
    syllabusTags: []
  };
}

function headers(apiKey?: string): Record<string, string> {
  const result: Record<string, string> = { 'User-Agent': 'UniAce-AcademicResearch/1.0' };
  if (apiKey) result['x-api-key'] = apiKey;
  return result;
}

export async function fetchFromSemanticScholar(
  query: string,
  limit: number = 5,
  apiKey?: string
): Promise<{ papers: AcademicPaper[]; latencyMs: number }> {
  const startedAt = Date.now();
  const url = 'https://api.semanticscholar.org/graph/v1/paper/search?query=' +
    encodeURIComponent(query) + '&limit=' + Math.max(1, Math.min(20, limit)) +
    '&fields=title,authors,abstract,year,venue,citationCount,externalIds,url,openAccessPdf';
  const response = await fetch(url, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    throw new Error('Semantic Scholar API returned HTTP ' + response.status + ': ' + response.statusText);
  }
  const payload = await response.json() as { data?: SemanticScholarPaper[] };
  const papers = Array.isArray(payload.data)
    ? payload.data.map(mapPaper).filter((paper): paper is AcademicPaper => paper !== null)
    : [];
  return { papers, latencyMs: Date.now() - startedAt };
}

export async function lookupPaperSemanticScholar(
  identifier: string,
  apiKey?: string
): Promise<AcademicPaper | null> {
  let paperId = identifier.trim();
  if (paperId.startsWith('10.')) {
    paperId = 'DOI:' + paperId;
  } else if (paperId.includes('arxiv.org')) {
    const match = paperId.match(/arxiv\.org\/abs\/([^\s/]+)/i);
    if (match) paperId = 'ARXIV:' + match[1];
  }

  const url = 'https://api.semanticscholar.org/graph/v1/paper/' +
    encodeURIComponent(paperId) +
    '?fields=title,authors,abstract,year,venue,citationCount,externalIds,url,openAccessPdf';

  const response = await fetch(url, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error('Semantic Scholar lookup returned HTTP ' + response.status + ': ' + response.statusText);
  }

  const paper = mapPaper(await response.json() as SemanticScholarPaper);
  return paper;
}
