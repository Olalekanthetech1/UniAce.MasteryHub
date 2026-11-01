import type { AcademicPaper } from './types.js';

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTagValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  return match ? decodeXml(match[1]) : '';
}

export async function fetchFromArxiv(
  query: string,
  limit: number = 5
): Promise<{ papers: AcademicPaper[]; latencyMs: number }> {
  const startTime = Date.now();
  const cleanQuery = query.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
  if (!cleanQuery) return { papers: [], latencyMs: Date.now() - startTime };

  const url = 'https://export.arxiv.org/api/query?search_query=all:' +
    encodeURIComponent(cleanQuery) + '&start=0&max_results=' +
    Math.max(1, Math.min(20, limit)) + '&sortBy=relevance&sortOrder=descending';

  const response = await fetch(url, {
    headers: { 'User-Agent': 'UniAce-AcademicResearch/1.0' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    throw new Error('arXiv API returned HTTP ' + response.status + ': ' + response.statusText);
  }

  const xmlText = await response.text();
  const entryMatches = xmlText.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  const papers: AcademicPaper[] = [];

  for (const entryXml of entryMatches) {
    const rawId = extractTagValue(entryXml, 'id');
    const idMatch = rawId.match(/arxiv\.org\/abs\/([^\s/]+)/i) || rawId.match(/([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)/);
    if (!idMatch) continue;

    const arxivId = idMatch[1];
    const title = extractTagValue(entryXml, 'title').replace(/^\[.*?\]\s*/, '');
    if (!title) continue;

    const summary = extractTagValue(entryXml, 'summary');
    const published = extractTagValue(entryXml, 'published');
    const yearValue = published ? new Date(published).getFullYear() : NaN;
    const year = Number.isInteger(yearValue) && yearValue >= 1900 ? yearValue : null;

    const authorBlocks = entryXml.match(/<author[\s\S]*?<\/author>/gi) || [];
    const authors = authorBlocks
      .map((authorXml) => extractTagValue(authorXml, 'name'))
      .filter((name) => Boolean(name));

    const pdfMatch = entryXml.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/i) ||
      entryXml.match(/<link[^>]+href="([^"]+pdf)"/i);
    const pdfUrl = pdfMatch ? pdfMatch[1] : 'https://arxiv.org/pdf/' + arxivId + '.pdf';
    const doiMatch = entryXml.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/i) ||
      entryXml.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
    const doi = doiMatch
      ? (typeof doiMatch[1] === 'string' ? decodeXml(doiMatch[1]) : doiMatch[0])
      : null;

    papers.push({
      id: 'arxiv_' + arxivId,
      title,
      authors,
      abstract: summary || null,
      year,
      venue: null,
      doi,
      url: 'https://arxiv.org/abs/' + arxivId,
      pdfUrl,
      citationCount: null,
      source: 'arxiv',
      publicationType: 'preprint',
      relevanceScore: 0,
      syllabusTags: []
    });
  }

  return { papers, latencyMs: Date.now() - startTime };
}
