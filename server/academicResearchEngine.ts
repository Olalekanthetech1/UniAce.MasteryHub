import {
  AcademicPaper,
  AcademicSearchResponse,
  SearchAcademicPapersInput,
  SearchAcademicPapersInputSchema,
  GetCitationInput,
  CitationResult,
  CanonicalDefinition,
  AcademicConfig,
  AcademicProviderHealth,
  AcademicWebSourceSearchResponse,
} from './academic/types.js';
import { fetchFromArxiv } from './academic/arxivAdapter.js';
import { fetchFromSemanticScholar, lookupPaperSemanticScholar } from './academic/semanticScholarAdapter.js';
import { fetchFromOpenAlex, fetchOpenAlexConceptDefinitions } from './academic/openAlexAdapter.js';
import { getPostgresPool } from './postgresPool.js';
import { createHash } from 'crypto';
import {
  DEFAULT_ACADEMIC_RESEARCH_SETTINGS,
  loadAcademicResearchConfig,
  saveAcademicResearchConfig,
  AcademicResearchConfigRecord,
} from './academic/academicConfigStore.js';
import { searchTavilyAcademicSources } from './academic/tavilyAdapter.js';

type ActiveAcademicConfig = AcademicResearchConfigRecord['settings'] & {
  semanticScholarApiKey?: string;
  tavilyApiKey?: string;
};

let activeConfig: ActiveAcademicConfig = {
  ...DEFAULT_ACADEMIC_RESEARCH_SETTINGS,
  providersEnabled: { ...DEFAULT_ACADEMIC_RESEARCH_SETTINGS.providersEnabled },
};
let configLoadedAt = 0;
let configLoadPromise: Promise<void> | null = null;
const CONFIG_REFRESH_MS = 60_000;

async function ensureAcademicConfig(forceRefresh = false): Promise<void> {
  if (!forceRefresh && configLoadedAt && Date.now() - configLoadedAt < CONFIG_REFRESH_MS) return;
  if (configLoadPromise) {
    await configLoadPromise;
    return;
  }
  configLoadPromise = (async () => {
    const record = await loadAcademicResearchConfig(forceRefresh);
    activeConfig = {
      ...record.settings,
      semanticScholarApiKey: record.secrets.semanticScholarApiKey,
      tavilyApiKey: record.secrets.tavilyApiKey,
    };
    configLoadedAt = Date.now();
  })();
  try {
    await configLoadPromise;
  } finally {
    configLoadPromise = null;
  }
}

export async function getAcademicConfig(): Promise<AcademicConfig> {
  await ensureAcademicConfig();
  return {
    enabled: activeConfig.enabled,
    cacheTtlHours: activeConfig.cacheTtlHours,
    openAlexEmail: activeConfig.openAlexEmail,
    arxivMaxResults: activeConfig.arxivMaxResults,
    defaultCourseAlignment: activeConfig.defaultCourseAlignment,
    providersEnabled: { ...activeConfig.providersEnabled },
    researchDepth: 'adaptive',
    adaptiveMaxQueries: activeConfig.adaptiveMaxQueries,
    minimumUsefulSources: activeConfig.minimumUsefulSources,
    tavilyApiKeyConfigured: Boolean(activeConfig.tavilyApiKey),
    semanticScholarApiKeyConfigured: Boolean(activeConfig.semanticScholarApiKey),
  };
}

export async function updateAcademicConfig(
  newConfig: Partial<AcademicConfig> & { tavilyApiKey?: string; semanticScholarApiKey?: string }
): Promise<AcademicConfig> {
  await ensureAcademicConfig();
  const record = await saveAcademicResearchConfig(newConfig);
  activeConfig = {
    ...record.settings,
    semanticScholarApiKey: record.secrets.semanticScholarApiKey,
    tavilyApiKey: record.secrets.tavilyApiKey,
  };
  configLoadedAt = Date.now();
  return getAcademicConfig();
}

export async function searchAcademicWebSources(input: {
  query: string;
  maxResults?: number;
}): Promise<AcademicWebSourceSearchResponse> {
  await ensureAcademicConfig();
  if (!activeConfig.enabled) throw new Error('Academic research is disabled in system settings.');
  if (!activeConfig.providersEnabled.tavily) throw new Error('Tavily search is disabled. Enable it in Academic Research settings.');
  if (!activeConfig.tavilyApiKey) throw new Error('Tavily is enabled but no API key is configured.');
  const query = input.query.trim();
  if (query.length < 4) throw new Error('Research query must contain at least four characters.');

  const maxResults = Math.min(20, Math.max(1, Math.floor(input.maxResults ?? 10)));
  const stages: AcademicWebSourceSearchResponse['stages'] = [];
  const first = await searchTavilyAcademicSources({
    query,
    searchDepth: 'basic',
    maxResults,
  }, activeConfig.tavilyApiKey);
  stages.push({
    searchDepth: 'basic',
    resultCount: first.results.length,
    usefulSourceCount: first.results.filter(source => source.score !== null && source.score >= activeConfig.minimumRelevanceScore).length,
    creditsUsed: first.creditsUsed,
    responseTimeSeconds: first.responseTimeSeconds,
  });

  let sources = [...first.results];
  let escalated = false;
  if (
    activeConfig.researchDepth === 'adaptive' &&
    activeConfig.adaptiveMaxQueries > 1 &&
    stages[0].usefulSourceCount < activeConfig.minimumUsefulSources
  ) {
    escalated = true;
    const advanced = await searchTavilyAcademicSources({
      query,
      searchDepth: 'advanced',
      maxResults,
    }, activeConfig.tavilyApiKey);
    stages.push({
      searchDepth: 'advanced',
      resultCount: advanced.results.length,
      usefulSourceCount: advanced.results.filter(source => source.score !== null && source.score >= activeConfig.minimumRelevanceScore).length,
      creditsUsed: advanced.creditsUsed,
      responseTimeSeconds: advanced.responseTimeSeconds,
    });
    const byUrl = new Map<string, typeof sources[number]>();
    for (const source of [...sources, ...advanced.results]) {
      const key = source.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
      const previous = byUrl.get(key);
      if (!previous || source.score > previous.score) byUrl.set(key, source);
    }
    sources = Array.from(byUrl.values()).sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  const measuredCredits = stages.every(stage => stage.creditsUsed !== null)
    ? stages.reduce((total, stage) => total + (stage.creditsUsed || 0), 0)
    : null;
  return {
    query,
    researchDepth: 'adaptive',
    status: sources.length > 0 ? 'results_found' : 'no_results',
    escalated,
    stages,
    sources,
    creditsUsed: measuredCredits,
    disclaimer: 'Search results are source candidates, not verified institutional syllabi or approved curriculum evidence. Review the original sources and establish their authority before using them as curriculum requirements.',
  };
}

// Levenshtein distance for fuzzy title deduplication
function computeLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  const lenA = a.length;
  const lenB = b.length;

  for (let i = 0; i <= lenB; i++) matrix[i] = [i];
  for (let j = 0; j <= lenA; j++) matrix[0][j] = j;

  for (let i = 1; i <= lenB; i++) {
    for (let j = 1; j <= lenA; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[lenB][lenA];
}

function computeTitleSimilarity(str1: string, str2: string): number {
  const clean1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!clean1 || !clean2) return 0;
  if (clean1 === clean2) return 1.0;

  const dist = computeLevenshteinDistance(clean1, clean2);
  const maxLen = Math.max(clean1.length, clean2.length);
  return 1 - dist / maxLen;
}

// Weighted Relevance Score Calculation: Text similarity + Logarithmic citation weight + Exponential recency decay
function calculateRelevanceScore(paper: AcademicPaper, queryTerms: string[]): number {
  let textScore = 0;
  const fullText = `${paper.title} ${paper.abstract}`.toLowerCase();

  for (const term of queryTerms) {
    if (paper.title.toLowerCase().includes(term)) textScore += 3.0;
    else if (fullText.includes(term)) textScore += 1.0;
  }

  // Logarithmic citation weight
  const citationBonus = paper.citationCount != null ? Math.log(1 + paper.citationCount) * 0.4 : 0;

  // Exponential recency decay
  const currentYear = new Date().getFullYear();
  const age = paper.year != null ? Math.max(0, currentYear - paper.year) : null;
  const recencyBonus = age !== null ? Math.exp(-0.05 * age) * 2.0 : 0;

  // DOI verified paper bonus
  const doiBonus = paper.doi ? 0.5 : 0;

  return Number((textScore + citationBonus + recencyBonus + doiBonus).toFixed(2));
}

// Check Neon PostgreSQL Cache (`system_config` key `academic_cache_${cacheKey}`)
async function getCachedSearch(cacheKey: string): Promise<AcademicSearchResponse | null> {
  const pool = getPostgresPool();
  if (!pool) return null;

  try {
    const res = await pool.query(`SELECT data FROM system_config WHERE key = $1 LIMIT 1`, [`academic_cache_${cacheKey}`]);
    if (res.rows.length > 0 && res.rows[0].data) {
      const data = res.rows[0].data as AcademicSearchResponse & { cachedAt: string };
      const cachedTime = new Date(data.cachedAt).getTime();
      const ageHours = (Date.now() - cachedTime) / (1000 * 60 * 60);

      if (ageHours < activeConfig.cacheTtlHours) {
        return {
          ...data,
          cached: true,
        };
      }
    }
  } catch (err) {
    console.warn('Academic Cache Read Warning:', err);
  }
  return null;
}

// Write to Neon PostgreSQL Cache
async function setCachedSearch(cacheKey: string, data: AcademicSearchResponse): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;

  try {
    const payload = {
      ...data,
      cachedAt: new Date().toISOString(),
    };
    await pool.query(
      `INSERT INTO system_config (key, data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [`academic_cache_${cacheKey}`, JSON.stringify(payload)]
    );
  } catch (err) {
    console.warn('Academic Cache Write Warning:', err);
  }
}

// Log Query Telemetry to Neon PostgreSQL (`system_logs` category `'academic_research'`)
async function logAcademicTelemetry(
  query: string,
  response: AcademicSearchResponse
): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;

  try {
    const id = `acad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await pool.query(
      `INSERT INTO system_logs (id, level, category, message, metadata, created_at)
       VALUES ($1, 'info', 'academic_research', $2, $3::jsonb, NOW())`,
      [
        id,
        `Academic search: ${query.slice(0, 100)} (${response.totalResults} results)`,
        JSON.stringify({
          query,
          resultCount: response.totalResults,
          latencyMs: response.latencyMs,
          cached: response.cached,
          providerBreakdown: response.providerBreakdown,
          timestamp: new Date().toISOString(),
        }),
      ]
    );
  } catch (err) {
    console.warn('Academic Telemetry Log Warning:', err);
  }
}

// --- MASTER SEARCH FUNCTION ---
export async function searchAcademicPapers(
  input: SearchAcademicPapersInput
): Promise<AcademicSearchResponse> {
  await ensureAcademicConfig();
  const startTime = Date.now();
  const parsed = SearchAcademicPapersInputSchema.parse(input);
  const { query, fieldOfStudy, limit, minYear, courseCode } = parsed;
  if (!activeConfig.enabled) throw new Error('Academic research is disabled in system settings.');

  const normalizedQuery = `${query} ${fieldOfStudy || ''}`.trim().toLowerCase();
  const cacheKey = createHash('sha256').update(JSON.stringify({ normalizedQuery, limit, minYear, courseCode })).digest('hex');

  // Check Cache
  const cached = await getCachedSearch(cacheKey);
  if (cached) return cached;

  const providerBreakdown: Record<string, { count: number; latencyMs: number; status: 'ok' | 'error' }> = {};
  const allPapers: AcademicPaper[] = [];

  // Parallel Adapter Execution
  const tasks: Promise<void>[] = [];

  if (activeConfig.providersEnabled.arxiv) {
    tasks.push(
      fetchFromArxiv(normalizedQuery, Math.min(limit, activeConfig.arxivMaxResults))
        .then(({ papers, latencyMs }) => {
          providerBreakdown.arxiv = { count: papers.length, latencyMs, status: 'ok' };
          allPapers.push(...papers);
        })
        .catch((err) => {
          providerBreakdown.arxiv = { count: 0, latencyMs: 0, status: 'error' };
          console.error('arXiv Fetch Error:', err.message);
        })
    );
  }

  if (activeConfig.providersEnabled.semanticScholar) {
    tasks.push(
      fetchFromSemanticScholar(normalizedQuery, limit, activeConfig.semanticScholarApiKey)
        .then(({ papers, latencyMs }) => {
          providerBreakdown.semantic_scholar = { count: papers.length, latencyMs, status: 'ok' };
          allPapers.push(...papers);
        })
        .catch((err) => {
          providerBreakdown.semantic_scholar = { count: 0, latencyMs: 0, status: 'error' };
          console.error('Semantic Scholar Fetch Error:', err.message);
        })
    );
  }

  if (activeConfig.providersEnabled.openAlex) {
    tasks.push(
      fetchFromOpenAlex(normalizedQuery, limit, activeConfig.openAlexEmail)
        .then(({ papers, latencyMs }) => {
          providerBreakdown.openalex = { count: papers.length, latencyMs, status: 'ok' };
          allPapers.push(...papers);
        })
        .catch((err) => {
          providerBreakdown.openalex = { count: 0, latencyMs: 0, status: 'error' };
          console.error('OpenAlex Fetch Error:', err.message);
        })
    );
  }

  if (tasks.length === 0) {
    throw new Error('No academic search providers are enabled. Enable at least one live provider in Academic Research settings.');
  }
  await Promise.allSettled(tasks);

  const successfulProviders = Object.values(providerBreakdown).filter(provider => provider.status === 'ok').length;
  if (allPapers.length === 0 && successfulProviders === 0) {
    throw new Error('All enabled academic search providers failed. No results were fabricated or substituted.');
  }

  // Deduplication by DOI and Title similarity
  const uniquePapers: AcademicPaper[] = [];
  const seenDois = new Set<string>();

  for (const paper of allPapers) {
    if (minYear !== undefined && (paper.year == null || paper.year < minYear)) continue;
    if (paper.doi && seenDois.has(paper.doi.toLowerCase())) {
      continue;
    }

    const isDuplicateTitle = uniquePapers.some(
      (existing) => computeTitleSimilarity(existing.title, paper.title) > 0.85
    );

    if (isDuplicateTitle) continue;

    if (paper.doi) seenDois.add(paper.doi.toLowerCase());

    // Tag Course Code Alignment
    // Only attach a course tag when the caller supplied an actual course code.
    // Do not manufacture course identifiers or imply institutional alignment.
    paper.syllabusTags = courseCode ? [courseCode] : [];

    uniquePapers.push(paper);
  }

  // Score and Rank
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  for (const paper of uniquePapers) {
    paper.relevanceScore = calculateRelevanceScore(paper, queryTerms);
  }

  uniquePapers.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const finalPapers = uniquePapers.slice(0, limit);

  const totalLatencyMs = Date.now() - startTime;

  const resultResponse: AcademicSearchResponse = {
    query,
    totalResults: finalPapers.length,
    papers: finalPapers,
    latencyMs: totalLatencyMs,
    providerBreakdown,
    cached: false,
    timestamp: new Date().toISOString(),
  };

  // Cache & Log
  await setCachedSearch(cacheKey, resultResponse);
  await logAcademicTelemetry(query, resultResponse);

  return resultResponse;
}

// --- CITATION GENERATOR ---
export async function getCitationAndAbstract(input: GetCitationInput): Promise<CitationResult> {
  await ensureAcademicConfig();
  const { identifier } = input;
  let paper: AcademicPaper | null = null;

  // Try direct lookup via Semantic Scholar
  paper = await lookupPaperSemanticScholar(identifier, activeConfig.semanticScholarApiKey);

  // If not found, run live search
  if (!paper) {
    const searchRes = await searchAcademicPapers({ query: identifier, limit: 1 });
    if (searchRes.papers.length > 0) {
      paper = searchRes.papers[0];
    }
  }

  if (!paper) {
    throw new Error(`Academic paper with identifier '${identifier}' could not be located in live registries.`);
  }

  const primaryAuthor = paper.authors[0] || '';
  const authorLastName = primaryAuthor ? primaryAuthor.split(' ').pop() || primaryAuthor : 'entry';
  const etAl = paper.authors.length > 1 ? ' et al.' : '';
  const yearStr = paper.year != null ? `(${paper.year})` : '(n.d.)';
  const sourcePart = paper.venue ? ` ${paper.venue}.` : '';
  const doiStr = paper.doi ? ` https://doi.org/${paper.doi}` : paper.url ? ` ${paper.url}` : '';

  const apa = paper.authors.length
    ? `${primaryAuthor}${etAl} ${yearStr}. ${paper.title}.${sourcePart}${doiStr}`
    : `${paper.title}. ${yearStr}.${sourcePart}${doiStr}`;

  const bibtexKey = `${authorLastName.toLowerCase()}${paper.year ?? 'nd'}${paper.title.slice(0, 8).toLowerCase().replace(/[^a-z]/g, '')}`;
  const bibtexFields = [
    ...(paper.authors.length ? [`  author = {${paper.authors.join(' and ')}},`] : []),
    `  title = {${paper.title}},`,
    ...(paper.venue ? [`  howpublished = {${paper.venue}},`] : []),
    ...(paper.year != null ? [`  year = {${paper.year}},`] : []),
    ...(paper.doi ? [`  doi = {${paper.doi}},`] : []),
    ...(paper.url ? [`  url = {${paper.url}},`] : []),
  ];
  const bibtex = `@misc{${bibtexKey},\n${bibtexFields.join('\n')}\n}`;

  return {
    identifier,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    doi: paper.doi,
    apa,
    bibtex,
    abstract: paper.abstract,
    pdfUrl: paper.pdfUrl,
    url: paper.url,
  };
}

// --- CANONICAL DEFINITIONS ---
export async function extractCanonicalDefinitions(
  subject: string,
  topic: string,
  courseCode?: string
): Promise<CanonicalDefinition> {
  const concept = await fetchOpenAlexConceptDefinitions(subject, topic, courseCode);

  if (concept) return concept;

  throw new Error(`No source-backed canonical definition was returned for topic "${topic}" in subject "${subject}". No synthetic definition or textbook references will be supplied.`);
}

// --- HEALTH CHECK FUNCTION ---
export async function checkAcademicProvidersHealth(): Promise<AcademicProviderHealth[]> {
  await ensureAcademicConfig();
  const providers: Array<'arxiv' | 'semantic_scholar' | 'openalex'> = ['arxiv', 'semantic_scholar', 'openalex'];
  const results: AcademicProviderHealth[] = [];

  for (const provider of providers) {
    const start = Date.now();
    try {
      if (provider === 'arxiv') {
        await fetchFromArxiv('physics', 1);
      } else if (provider === 'semantic_scholar') {
        await fetchFromSemanticScholar('mathematics', 1, activeConfig.semanticScholarApiKey);
      } else if (provider === 'openalex') {
        await fetchFromOpenAlex('computer science', 1, activeConfig.openAlexEmail);
      }

      results.push({
        provider,
        status: 'healthy',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
      });
    } catch (err) {
      results.push({
        provider,
        status: 'degraded',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        errorMessage: (err as Error).message,
      });
    }
  }

  return results;
}
