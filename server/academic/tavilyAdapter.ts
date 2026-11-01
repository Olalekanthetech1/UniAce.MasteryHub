import { createHash } from 'node:crypto';
import type { WebEvidence } from './types.js';

interface TavilySearchResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  raw_content?: unknown;
  score?: unknown;
}

function classifyAuthority(hostname: string): WebEvidence['authorityClass'] {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const scholarlyHosts = [
    'arxiv.org',
    'semanticscholar.org',
    'openalex.org',
    'crossref.org',
    'doi.org',
    'pubmed.ncbi.nlm.nih.gov'
  ];
  if (scholarlyHosts.some((domain) => host === domain || host.endsWith('.' + domain))) {
    return 'scholarly_index';
  }
  if (
    host.endsWith('.edu') ||
    host.includes('.edu.') ||
    host.endsWith('.ac.uk') ||
    host.endsWith('.gov') ||
    host.endsWith('.gov.uk')
  ) {
    return 'institutional_domain';
  }
  return host ? 'general_web' : 'unknown';
}

function normalizeResult(result: TavilySearchResult, searchDepth: 'basic' | 'advanced'): WebEvidence | null {
  if (typeof result.title !== 'string' || !result.title.trim() || typeof result.url !== 'string') {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(result.url);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    return null;
  }

  const contentValue = typeof result.raw_content === 'string' && result.raw_content.trim()
    ? result.raw_content
    : typeof result.content === 'string' && result.content.trim()
      ? result.content
      : null;
  const content = contentValue ? contentValue.slice(0, 16000) : null;
  const score = typeof result.score === 'number' && Number.isFinite(result.score)
    ? result.score
    : null;
  const canonicalUrl = parsedUrl.toString();

  return {
    id: createHash('sha256').update(canonicalUrl).digest('hex'),
    title: result.title.trim(),
    url: canonicalUrl,
    domain: parsedUrl.hostname.toLowerCase(),
    content,
    score,
    source: 'tavily',
    searchDepth,
    authorityClass: classifyAuthority(parsedUrl.hostname),
    verificationStatus: 'unverified'
  };
}

export async function searchTavily(
  query: string,
  apiKey: string,
  options: { searchDepth: 'basic' | 'advanced'; maxResults: number }
): Promise<{ sources: WebEvidence[]; latencyMs: number }> {
  if (!apiKey.trim()) {
    throw new Error('Tavily API key is not configured.');
  }
  const startedAt = Date.now();
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: query.slice(0, 400),
      search_depth: options.searchDepth,
      topic: 'general',
      max_results: Math.max(1, Math.min(20, options.maxResults)),
      include_answer: false,
      include_raw_content: true
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const responseText = (await response.text()).slice(0, 500);
    throw new Error('Tavily API returned HTTP ' + response.status + ': ' + responseText);
  }

  const payload = await response.json() as { results?: TavilySearchResult[] };
  if (!payload || !Array.isArray(payload.results)) {
    throw new Error('Tavily returned an invalid response: results array is missing.');
  }

  const sources = payload.results
    .map((result) => normalizeResult(result, options.searchDepth))
    .filter((result): result is WebEvidence => result !== null);

  return { sources, latencyMs: Date.now() - startedAt };
}
