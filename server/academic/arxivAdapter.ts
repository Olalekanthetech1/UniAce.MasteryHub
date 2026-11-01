import { AcademicPaper } from './types.js';

function extractTagValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim().replace(/\s+/g, ' ') : '';
}

function extractAllTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim().replace(/\s+/g, ' '));
  }
  return results;
}

export async function fetchFromArxiv(query: string, limit: number = 5): Promise<{ papers: AcademicPaper[]; latencyMs: number }> {
  const startTime = Date.now();
  const cleanQuery = query.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(cleanQuery)}&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'UniAce-AcademicResearch/1.0',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`arXiv API responded with status ${response.status}: ${response.statusText}`);
  }

  const xmlText = await response.text();
  const entryMatches = xmlText.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  const papers: AcademicPaper[] = [];

  for (const entryXml of entryMatches) {
    const rawId = extractTagValue(entryXml, 'id');
    const arxivIdMatch = rawId.match(/arxiv\.org\/abs\/([^\s\/]+)$/i) || rawId.match(/([0-9]{4}\.[0-9]{4,5})/);
    const arxivId = arxivIdMatch ? arxivIdMatch[1] : rawId.replace(/^https?:\/\//, '');

    const title = extractTagValue(entryXml, 'title').replace(/^\[.*?\]\s*/, '');
    const summary = extractTagValue(entryXml, 'summary');
    const published = extractTagValue(entryXml, 'published');
    const publishedDate = published ? new Date(published) : null;
    const publishedYear = publishedDate && Number.isFinite(publishedDate.getTime()) ? publishedDate.getFullYear() : null;

    // Extract authors
    const authorBlocks = entryXml.match(/<author[\s\S]*?<\/author>/gi) || [];
    const authors: string[] = [];
    for (const authorXml of authorBlocks) {
      const name = extractTagValue(authorXml, 'name');
      if (name) authors.push(name);
    }

    // Extract PDF link
    const pdfMatch = entryXml.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/i) || entryXml.match(/<link[^>]+href="([^"]+pdf)"/i);
    const pdfUrl = pdfMatch ? pdfMatch[1] : null;

    // Extract DOI if present
    const doiMatch = entryXml.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/i) || entryXml.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
    const doi = doiMatch ? (typeof doiMatch[1] === 'string' ? doiMatch[1].trim() : doiMatch[0]) : null;

    if (title && summary) {
      papers.push({
        id: `arxiv_${arxivId}`,
        title,
        authors,
        abstract: summary,
        year: publishedYear,
        venue: 'arXiv Preprint Repository',
        doi,
        url: `https://arxiv.org/abs/${arxivId}`,
        pdfUrl,
        citationCount: null,
        source: 'arxiv',
        relevanceScore: 0,
        syllabusTags: [],
      });
    }
  }

  const latencyMs = Date.now() - startTime;
  return { papers, latencyMs };
}
