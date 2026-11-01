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
} from './academic/types.js';
import { fetchFromArxiv } from './academic/arxivAdapter.js';
import { fetchFromSemanticScholar, lookupPaperSemanticScholar } from './academic/semanticScholarAdapter.js';
import { fetchFromOpenAlex, fetchOpenAlexConceptDefinitions } from './academic/openAlexAdapter.js';
import { getPostgresPool } from './postgresPool.js';
import { createHash } from 'node:crypto';
import { getSystemConfigDoc, setSystemConfigDoc } from './systemConfigStore.js';
import { z } from 'zod';

const ACADEMIC_CONFIG_KEY = 'academic_research_config';
const AcademicConfigSchema = z.object({
  enabled: z.boolean(),
  cacheTtlHours: z.number().min(0).max(720),
  arxivMaxResults: z.number().int().min(1).max(20),
  researchDepth: z.literal('adaptive'),
  providersEnabled: z.object({
    arxiv: z.boolean(),
    semanticScholar: z.boolean(),
    openAlex: z.boolean(),
  }),
});
const AcademicConfigUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  cacheTtlHours: z.number().min(0).max(720).optional(),
  arxivMaxResults: z.number().int().min(1).max(20).optional(),
  researchDepth: z.literal('adaptive').optional(),
  providersEnabled: z.object({
    arxiv: z.boolean().optional(),
    semanticScholar: z.boolean().optional(),
    openAlex: z.boolean().optional(),
  }).optional(),
}).strict();

const DEFAULT_ACADEMIC_CONFIG: AcademicConfig = {
  enabled: true,
  cacheTtlHours: 24,
  arxivMaxResults: 5,
  researchDepth: 'adaptive',
  providersEnabled: {
    arxiv: true,
    semanticScholar: true,
    openAlex: true,
  },
};

let activeConfig: AcademicConfig = { ...DEFAULT_ACADEMIC_CONFIG };
let configInitialized = false;
let configInitialization: Promise<AcademicConfig> | null = null;

function copyAcademicConfig(): AcademicConfig {
  return {
    ...activeConfig,
    providersEnabled: { ...activeConfig.providersEnabled },
  };
}

export function getAcademicConfig(): AcademicConfig {
  return copyAcademicConfig();
}

export async function initializeAcademicConfig(): Promise<AcademicConfig> {
  if (configInitialized) return getAcademicConfig();
  if (configInitialization) return configInitialization;

  configInitialization = (async () => {
    const stored = await getSystemConfigDoc(ACADEMIC_CONFIG_KEY, true);
    const candidate = {
      ...DEFAULT_ACADEMIC_CONFIG,
      ...(stored || {}),
      providersEnabled: {
        ...DEFAULT_ACADEMIC_CONFIG.providersEnabled,
        ...(stored?.providersEnabled || {}),
      },
    };
    const parsed = AcademicConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error('Persisted academic research configuration is invalid; configuration was not silently replaced.');
    }

    activeConfig = parsed.data;
    if (!stored) {
      await setSystemConfigDoc(ACADEMIC_CONFIG_KEY, activeConfig, false);
    }
    configInitialized = true;
    return getAcademicConfig();
  })();

  try {
    return await configInitialization;
  } catch (error) {
    configInitialization = null;
    throw error;
  }
}

export async function updateAcademicConfig(newConfig: Partial<AcademicConfig>): Promise<AcademicConfig> {
  await initializeAcademicConfig();
  const patch = AcademicConfigUpdateSchema.parse(newConfig);
  const nextConfig = AcademicConfigSchema.parse({
    ...activeConfig,
    ...patch,
    providersEnabled: {
      ...activeConfig.providersEnabled,
      ...(patch.providersEnabled || {}),
    },
  });

  // Persist first; do not report a configuration update until Neon confirms the write.
  await setSystemConfigDoc(ACADEMIC_CONFIG_KEY, nextConfig, false);
  activeConfig = nextConfig;
  return getAcademicConfig();
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
  const citationBonus = typeof paper.citationCount === 'number'
    ? Math.log(1 + paper.citationCount) * 0.4
    : 0;

  // Missing publication years do not receive an assumed age or recency score.
  const currentYear = new Date().getFullYear();
  const age = typeof paper.year === 'number' ? Math.max(0, currentYear - paper.year) : null;
  const recencyBonus = age === null ? 0 : Math.exp(-0.05 * age) * 2.0;

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
  const startTime = Date.now();
  const parsed = SearchAcademicPapersInputSchema.parse(input);
  const { query, fieldOfStudy, limit, courseCode } = parsed;

  await initializeAcademicConfig();
  if (!activeConfig.enabled) throw new Error('Academic research is disabled in the persisted engine configuration.');

  const normalizedQuery = `${query} ${fieldOfStudy || ''}`.trim().toLowerCase();
  const cacheKey = createHash('sha256').update(JSON.stringify({
    query: normalizedQuery,
    courseCode: courseCode || null,
    minYear: parsed.minYear ?? null,
    limit,
    providersEnabled: activeConfig.providersEnabled,
  })).digest('hex');

  // Check Cache
  const cached = await getCachedSearch(cacheKey);
  if (cached) return cached;

  const providerBreakdown: Record<string, { count: number; latencyMs: number; status: 'ok' | 'error' }> = {};
  const allPapers: AcademicPaper[] = [];

  // Parallel Adapter Execution
  const tasks: Promise<void>[] = [];

  if (activeConfig.providersEnabled.arxiv) {
    tasks.push(
      fetchFromArxiv(normalizedQuery, limit)
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
      fetchFromSemanticScholar(normalizedQuery, limit, process.env.SEMANTIC_SCHOLAR_API_KEY)
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
      fetchFromOpenAlex(normalizedQuery, limit, process.env.OPENALEX_EMAIL)
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

  await Promise.allSettled(tasks);

  // Distinguish a successful zero-result search from a total provider outage.
  const successfulProviders = Object.values(providerBreakdown).filter((entry) => entry.status === 'ok').length;
  if (successfulProviders === 0) {
    throw new Error('All enabled academic research providers failed; no search result can be verified.');
  }

  // Deduplication by DOI and Title similarity
  const uniquePapers: AcademicPaper[] = [];
  const seenDois = new Set<string>();

  for (const paper of allPapers) {
    if (paper.doi && seenDois.has(paper.doi.toLowerCase())) {
      continue;
    }

    const isDuplicateTitle = uniquePapers.some(
      (existing) => computeTitleSimilarity(existing.title, paper.title) > 0.85
    );

    if (isDuplicateTitle) continue;

    if (paper.doi) seenDois.add(paper.doi.toLowerCase());

    // Keep only tags supplied by the source adapter. A course code or benchmark
    // is not evidence that a paper belongs to an official course syllabus.
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
  await initializeAcademicConfig();
  const { identifier } = input;
  let paper: AcademicPaper | null = null;

  // Try direct lookup via Semantic Scholar
  paper = await lookupPaperSemanticScholar(identifier, process.env.SEMANTIC_SCHOLAR_API_KEY);

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

  const authors = paper.authors.filter((author) => author.trim().length > 0);
  const primaryAuthor = authors[0] || '';
  const authorLastName = primaryAuthor.split(' ').pop() || '';
  const etAl = authors.length > 1 ? ' et al.' : '';
  const authorPart = primaryAuthor ? `${primaryAuthor}${etAl}` : '';
  const yearPart = typeof paper.year === 'number' ? ` (${paper.year}).` : '';
  const doiStr = paper.doi ? ` https://doi.org/${paper.doi}` : ` ${paper.url}`;
  const venuePart = paper.venue ? ` ${paper.venue}.` : '';
  const apa = `${authorPart}${yearPart} ${paper.title}.${venuePart}${doiStr}`.replace(/\s+/g, ' ').trim();

  const titleKey = paper.title.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, '');
  const bibtexKey = `${authorLastName.toLowerCase()}${paper.year || ''}${titleKey}` || paper.id.replace(/[^a-zA-Z0-9]/g, '').slice(-24);
  const bibtexFields = [
    ...(authors.length ? [`  author = {${authors.join(' and ')}}`] : []),
    `  title = {${paper.title}}`,
    ...(paper.venue ? [`  journal = {${paper.venue}}`] : []),
    ...(typeof paper.year === 'number' ? [`  year = {${paper.year}}`] : []),
    ...(paper.doi ? [`  doi = {${paper.doi}}`] : []),
    `  url = {${paper.url}}`,
  ];
  const bibtex = `@article{${bibtexKey},\n${bibtexFields.join(',\n')}\n}`;

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
  topic: string
): Promise<CanonicalDefinition | null> {
  await initializeAcademicConfig();
  return fetchOpenAlexConceptDefinitions(subject, topic);
}

// --- HEALTH CHECK FUNCTION ---
export async function checkAcademicProvidersHealth(): Promise<AcademicProviderHealth[]> {
  await initializeAcademicConfig();
  const providers: Array<'arxiv' | 'semantic_scholar' | 'openalex'> = ['arxiv', 'semantic_scholar', 'openalex'];
  const results: AcademicProviderHealth[] = [];

  for (const provider of providers) {
    const start = Date.now();
    try {
      if (provider === 'arxiv') {
        await fetchFromArxiv('physics', 1);
      } else if (provider === 'semantic_scholar') {
        await fetchFromSemanticScholar('mathematics', 1, process.env.SEMANTIC_SCHOLAR_API_KEY);
      } else if (provider === 'openalex') {
        await fetchFromOpenAlex('computer science', 1, process.env.OPENALEX_EMAIL);
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
