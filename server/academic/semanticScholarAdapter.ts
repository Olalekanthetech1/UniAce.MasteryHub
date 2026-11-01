import { AcademicPaper } from './types.js';

export async function fetchFromSemanticScholar(
  query: string,
  limit: number = 5,
  apiKey?: string
): Promise<{ papers: AcademicPaper[]; latencyMs: number }> {
  const startTime = Date.now();
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
    query
  )}&limit=${limit}&fields=title,authors,abstract,year,venue,citationCount,externalIds,url,openAccessPdf`;

  const headers: Record<string, string> = {
    'User-Agent': 'UniAce-AcademicResearch/1.0',
  };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Semantic Scholar API status ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    data?: Array<{
      paperId: string;
      title: string;
      authors?: Array<{ name: string }>;
      abstract?: string;
      year?: number;
      venue?: string;
      citationCount?: number;
      externalIds?: { DOI?: string; ArXiv?: string };
      url?: string;
      openAccessPdf?: { url: string };
    }>;
  };

  const papers: AcademicPaper[] = [];

  if (data.data && Array.isArray(data.data)) {
    for (const paper of data.data) {
      if (!paper.title) continue;

      const authors = paper.authors ? paper.authors.map((a) => a.name).filter((name): name is string => typeof name === 'string' && name.trim().length > 0) : [];
      const doi = paper.externalIds?.DOI || null;
      const pdfUrl = paper.openAccessPdf?.url || (paper.externalIds?.ArXiv ? `https://arxiv.org/pdf/${paper.externalIds.ArXiv}.pdf` : null);

      papers.push({
        id: `s2_${paper.paperId}`,
        title: paper.title,
        authors,
        abstract: paper.abstract || '',
        year: paper.year ?? null,
        ...(paper.venue ? { venue: paper.venue } : {}),
        doi,
        url: paper.url || (doi ? `https://doi.org/${doi}` : `https://www.semanticscholar.org/paper/${paper.paperId}`),
        pdfUrl,
        citationCount: paper.citationCount ?? null,
        source: 'semantic_scholar',
        relevanceScore: 0,
        syllabusTags: [],
      });
    }
  }

  const latencyMs = Date.now() - startTime;
  return { papers, latencyMs };
}

export async function lookupPaperSemanticScholar(
  identifier: string,
  apiKey?: string
): Promise<AcademicPaper | null> {
  let paperId = identifier.trim();

  // Handle DOI prefix if present
  if (paperId.startsWith('10.')) {
    paperId = `DOI:${paperId}`;
  } else if (paperId.includes('arxiv.org')) {
    const match = paperId.match(/arxiv\.org\/abs\/([^\s\/]+)/i);
    if (match) paperId = `ARXIV:${match[1]}`;
  }

  const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(
    paperId
  )}?fields=title,authors,abstract,year,venue,citationCount,externalIds,url,openAccessPdf`;

  const headers: Record<string, string> = {
    'User-Agent': 'UniAce-AcademicGrounding-Bot/1.0 (uniace.support@gmail.com)',
  };
  if (apiKey) headers['x-api-key'] = apiKey;

  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;

    const paper = (await response.json()) as {
      paperId: string;
      title: string;
      authors?: Array<{ name: string }>;
      abstract?: string;
      year?: number;
      venue?: string;
      citationCount?: number;
      externalIds?: { DOI?: string; ArXiv?: string };
      url?: string;
      openAccessPdf?: { url: string };
    };

    if (!paper || !paper.title) return null;

    return {
      id: `s2_${paper.paperId}`,
      title: paper.title,
      authors: paper.authors ? paper.authors.map((a) => a.name).filter((name): name is string => typeof name === 'string' && name.trim().length > 0) : [],
      abstract: paper.abstract || '',
      year: paper.year || null,
      ...(paper.venue ? { venue: paper.venue } : {}),
      doi: paper.externalIds?.DOI || null,
      url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
      pdfUrl: paper.openAccessPdf?.url || null,
      citationCount: paper.citationCount || 0,
      source: 'semantic_scholar',
      relevanceScore: 0,
      syllabusTags: [],
    };
  } catch (error) {
    console.error('Semantic Scholar Lookup Error:', error);
    return null;
  }
}
