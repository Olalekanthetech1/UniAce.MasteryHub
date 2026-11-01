export interface TavilyAcademicSource {
  title: string;
  url: string;
  content: string;
  rawContent?: string;
  score: number | null;
  publishedDate?: string | null;
  sourceClass: 'institutional_domain_candidate' | 'publisher_or_repository_candidate' | 'general_web_candidate';
  verificationStatus: 'unverified';
}

export interface TavilySearchResponse {
  query: string;
  results: TavilyAcademicSource[];
  creditsUsed: number | null;
  responseTimeSeconds: number | null;
  requestId?: string;
}

export interface TavilySearchInput {
  query: string;
  searchDepth: 'basic' | 'advanced';
  maxResults: number;
}

function classifySourceDomain(url: string): TavilyAcademicSource['sourceClass'] {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if (
    hostname.endsWith('.edu') ||
    hostname.endsWith('.edu.ng') ||
    hostname.endsWith('.ac.uk') ||
    hostname.endsWith('.ac.ng') ||
    hostname.endsWith('.edu.au') ||
    hostname.endsWith('.edu.za')
  ) {
    return 'institutional_domain_candidate';
  }
  if (
    hostname.includes('arxiv.org') ||
    hostname.includes('semanticscholar.org') ||
    hostname.includes('openalex.org') ||
    hostname.includes('doi.org') ||
    hostname.includes('sciencedirect.com') ||
    hostname.includes('springer.com') ||
    hostname.includes('wiley.com') ||
    hostname.includes('tandfonline.com')
  ) {
    return 'publisher_or_repository_candidate';
  }
  return 'general_web_candidate';
}

export async function searchTavilyAcademicSources(
  input: TavilySearchInput,
  apiKey: string
): Promise<TavilySearchResponse> {
  const query = input.query.trim();
  if (query.length < 4) throw new Error('Research query must contain at least four characters.');
  if (!apiKey.trim()) throw new Error('Tavily is not configured. Add a Tavily API key in Academic Research settings.');
  if (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 20) {
    throw new Error('Tavily maxResults must be an integer between 1 and 20.');
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      topic: 'general',
      search_depth: input.searchDepth,
      max_results: input.maxResults,
      include_answer: false,
      include_raw_content: 'markdown',
      include_published_date: true,
      include_usage: true,
      safe_search: true,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Tavily Search API returned HTTP ${response.status}: ${response.statusText}`);
  }

  const payload = await response.json() as {
    query?: unknown;
    results?: unknown;
    usage?: { credits?: unknown };
    response_time?: unknown;
    request_id?: unknown;
  };
  if (!Array.isArray(payload.results)) {
    throw new Error('Tavily returned an invalid response: results array is missing.');
  }

  const results: TavilyAcademicSource[] = [];
  for (const item of payload.results) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.title !== 'string' || typeof raw.url !== 'string' || typeof raw.content !== 'string') continue;
    let url: URL;
    try {
      url = new URL(raw.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    results.push({
      title: raw.title,
      url: url.toString(),
      content: raw.content,
      ...(typeof raw.raw_content === 'string' ? { rawContent: raw.raw_content } : {}),
      score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : null,
      ...(typeof raw.published_date === 'string' || raw.published_date === null
        ? { publishedDate: raw.published_date as string | null }
        : {}),
      sourceClass: classifySourceDomain(url.toString()),
      verificationStatus: 'unverified',
    });
  }

  return {
    query,
    results,
    creditsUsed: typeof payload.usage?.credits === 'number' && Number.isFinite(payload.usage.credits)
      ? payload.usage.credits
      : null,
    responseTimeSeconds: typeof payload.response_time === 'number' && Number.isFinite(payload.response_time)
      ? payload.response_time
      : typeof payload.response_time === 'string' && Number.isFinite(Number(payload.response_time))
        ? Number(payload.response_time)
        : null,
    ...(typeof payload.request_id === 'string' ? { requestId: payload.request_id } : {}),
  };
}
