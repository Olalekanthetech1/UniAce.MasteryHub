import {
  AcademicPaper,
  AcademicSearchResponse,
  SearchAcademicPapersInput,
  SearchAcademicPapersInputSchema,
  GetCitationInput,
  CitationResult,
  CanonicalDefinition,
  AcademicConfig,
  AcademicConfigView,
  AcademicProviderHealth,
  AcademicProviderId,
  ProviderExecution
} from './academic/types.js';
import { fetchFromArxiv } from './academic/arxivAdapter.js';
import { fetchFromSemanticScholar, lookupPaperSemanticScholar } from './academic/semanticScholarAdapter.js';
import { fetchFromOpenAlex, fetchOpenAlexConceptDefinitions } from './academic/openAlexAdapter.js';
import { searchTavily } from './academic/tavilyAdapter.js';
import { assessResearchEvidence, buildAdaptiveExpansionQuery } from './academic/adaptiveEvidence.js';
import { getPostgresPool } from './postgresPool.js';
import { getSystemSettingsDoc, setSystemSettingsDoc } from './systemConfigStore.js';
import { decryptAcademicCredential, encryptAcademicCredential } from './academic/credentialVault.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

const ACADEMIC_RESEARCH_CONFIG_DOC = 'academic_research';

const EncryptedCredentialSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm'),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  ciphertext: z.string().min(1)
}).strict();

const StoredAcademicConfigSchema = z.object({
  schemaVersion: z.literal(2),
  enabled: z.boolean(),
  cacheTtlHours: z.number().int().min(1).max(720),
  arxivMaxResults: z.number().int().min(1).max(20),
  openAlexEmail: z.string().email().nullable(),
  researchDepth: z.enum(['adaptive', 'basic', 'advanced']),
  maxExpansionRounds: z.number().int().min(0).max(2),
  minimumEvidenceCount: z.number().int().min(1).max(20),
  maxWebResults: z.number().int().min(1).max(20),
  providersEnabled: z.object({
    arxiv: z.boolean(),
    semanticScholar: z.boolean(),
    openAlex: z.boolean(),
    tavily: z.boolean()
  }).strict(),
  credentials: z.object({
    semanticScholarApiKey: EncryptedCredentialSchema.optional(),
    tavilyApiKey: EncryptedCredentialSchema.optional()
  }).strict()
}).strict();

const LegacyStoredAcademicConfigSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  cacheTtlHours: z.number().int().min(1).max(720),
  arxivMaxResults: z.number().int().min(1).max(20),
  openAlexEmail: z.string().email().nullable(),
  providersEnabled: z.object({
    arxiv: z.boolean(),
    semanticScholar: z.boolean(),
    openAlex: z.boolean()
  }).strict(),
  credentials: z.object({
    semanticScholarApiKey: EncryptedCredentialSchema.optional()
  }).strict().default({})
}).strict();

type StoredAcademicConfig = z.infer<typeof StoredAcademicConfigSchema>;

const AcademicConfigUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  cacheTtlHours: z.number().int().min(1).max(720).optional(),
  arxivMaxResults: z.number().int().min(1).max(20).optional(),
  openAlexEmail: z.string().trim().email().or(z.literal('')).optional(),
  researchDepth: z.enum(['adaptive', 'basic', 'advanced']).optional(),
  maxExpansionRounds: z.number().int().min(0).max(2).optional(),
  minimumEvidenceCount: z.number().int().min(1).max(20).optional(),
  maxWebResults: z.number().int().min(1).max(20).optional(),
  providersEnabled: z.object({
    arxiv: z.boolean().optional(),
    semanticScholar: z.boolean().optional(),
    openAlex: z.boolean().optional(),
    tavily: z.boolean().optional()
  }).strict().optional(),
  semanticScholarApiKey: z.string().trim().min(1).max(4096).optional(),
  tavilyApiKey: z.string().trim().min(1).max(4096).optional(),
  clearSemanticScholarApiKey: z.boolean().optional(),
  clearTavilyApiKey: z.boolean().optional()
}).strict();

const DEFAULT_STORED_ACADEMIC_CONFIG: StoredAcademicConfig = {
  schemaVersion: 2,
  enabled: true,
  cacheTtlHours: 24,
  arxivMaxResults: 5,
  openAlexEmail: null,
  researchDepth: 'adaptive',
  maxExpansionRounds: 1,
  minimumEvidenceCount: 5,
  maxWebResults: 5,
  providersEnabled: {
    arxiv: true,
    semanticScholar: true,
    openAlex: true,
    tavily: false
  },
  credentials: {}
};

function migrateLegacyAcademicConfig(
  legacy: z.infer<typeof LegacyStoredAcademicConfigSchema>
): StoredAcademicConfig {
  return {
    schemaVersion: 2,
    enabled: legacy.enabled,
    cacheTtlHours: legacy.cacheTtlHours,
    arxivMaxResults: legacy.arxivMaxResults,
    openAlexEmail: legacy.openAlexEmail,
    researchDepth: 'adaptive',
    maxExpansionRounds: 1,
    minimumEvidenceCount: 5,
    maxWebResults: 5,
    providersEnabled: { ...legacy.providersEnabled, tavily: false },
    credentials: { ...legacy.credentials }
  };
}

async function readStoredAcademicConfig(): Promise<StoredAcademicConfig> {
  const persisted = await getSystemSettingsDoc(ACADEMIC_RESEARCH_CONFIG_DOC, true);
  if (!persisted) {
    await setSystemSettingsDoc(ACADEMIC_RESEARCH_CONFIG_DOC, DEFAULT_STORED_ACADEMIC_CONFIG, false);
    return DEFAULT_STORED_ACADEMIC_CONFIG;
  }

  const current = StoredAcademicConfigSchema.safeParse(persisted);
  if (current.success) return current.data;

  const legacy = LegacyStoredAcademicConfigSchema.safeParse(persisted);
  if (legacy.success) {
    const migrated = migrateLegacyAcademicConfig(legacy.data);
    await setSystemSettingsDoc(ACADEMIC_RESEARCH_CONFIG_DOC, migrated, false);
    return migrated;
  }

  const invalidFields = current.error.issues.map((issue) => issue.path.join('.')).filter(Boolean).join(', ');
  throw new Error(
    'Persisted academic research configuration is invalid. Invalid fields: ' +
    (invalidFields || 'document shape') + '. No defaults were substituted.'
  );
}

function toPublicAcademicConfig(stored: StoredAcademicConfig): AcademicConfigView {
  return {
    enabled: stored.enabled,
    cacheTtlHours: stored.cacheTtlHours,
    openAlexEmail: stored.openAlexEmail || undefined,
    arxivMaxResults: stored.arxivMaxResults,
    researchDepth: stored.researchDepth,
    maxExpansionRounds: stored.maxExpansionRounds,
    minimumEvidenceCount: stored.minimumEvidenceCount,
    maxWebResults: stored.maxWebResults,
    providersEnabled: { ...stored.providersEnabled },
    semanticScholarApiKeyConfigured: Boolean(stored.credentials.semanticScholarApiKey),
    tavilyApiKeyConfigured: Boolean(stored.credentials.tavilyApiKey)
  };
}

async function loadRuntimeAcademicConfig(): Promise<AcademicConfig> {
  const stored = await readStoredAcademicConfig();
  return {
    enabled: stored.enabled,
    cacheTtlHours: stored.cacheTtlHours,
    semanticScholarApiKey: stored.credentials.semanticScholarApiKey
      ? decryptAcademicCredential(stored.credentials.semanticScholarApiKey)
      : undefined,
    tavilyApiKey: stored.credentials.tavilyApiKey
      ? decryptAcademicCredential(stored.credentials.tavilyApiKey)
      : undefined,
    openAlexEmail: stored.openAlexEmail || undefined,
    arxivMaxResults: stored.arxivMaxResults,
    researchDepth: stored.researchDepth,
    maxExpansionRounds: stored.maxExpansionRounds,
    minimumEvidenceCount: stored.minimumEvidenceCount,
    maxWebResults: stored.maxWebResults,
    providersEnabled: { ...stored.providersEnabled }
  };
}

export async function getAcademicConfig(): Promise<AcademicConfigView> {
  return toPublicAcademicConfig(await readStoredAcademicConfig());
}

export async function updateAcademicConfig(newConfig: unknown): Promise<AcademicConfigView> {
  const parsed = AcademicConfigUpdateSchema.safeParse(newConfig);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => (issue.path.join('.') || 'config') + ': ' + issue.message)
      .join('; ');
    throw new Error('Invalid academic research configuration: ' + details);
  }

  const updates = parsed.data;
  if (updates.semanticScholarApiKey && updates.clearSemanticScholarApiKey) {
    throw new Error('A Semantic Scholar API key cannot be replaced and cleared in the same update.');
  }
  if (updates.tavilyApiKey && updates.clearTavilyApiKey) {
    throw new Error('A Tavily API key cannot be replaced and cleared in the same update.');
  }

  const current = await readStoredAcademicConfig();
  const next: StoredAcademicConfig = {
    ...current,
    enabled: updates.enabled ?? current.enabled,
    cacheTtlHours: updates.cacheTtlHours ?? current.cacheTtlHours,
    arxivMaxResults: updates.arxivMaxResults ?? current.arxivMaxResults,
    openAlexEmail: updates.openAlexEmail === undefined ? current.openAlexEmail : (updates.openAlexEmail || null),
    researchDepth: updates.researchDepth ?? current.researchDepth,
    maxExpansionRounds: updates.maxExpansionRounds ?? current.maxExpansionRounds,
    minimumEvidenceCount: updates.minimumEvidenceCount ?? current.minimumEvidenceCount,
    maxWebResults: updates.maxWebResults ?? current.maxWebResults,
    providersEnabled: { ...current.providersEnabled, ...(updates.providersEnabled || {}) },
    credentials: { ...current.credentials }
  };

  if (updates.clearSemanticScholarApiKey) {
    delete next.credentials.semanticScholarApiKey;
  } else if (updates.semanticScholarApiKey) {
    next.credentials.semanticScholarApiKey = encryptAcademicCredential(updates.semanticScholarApiKey);
  }

  if (updates.clearTavilyApiKey) {
    delete next.credentials.tavilyApiKey;
    next.providersEnabled.tavily = false;
  } else if (updates.tavilyApiKey) {
    next.credentials.tavilyApiKey = encryptAcademicCredential(updates.tavilyApiKey);
    next.providersEnabled.tavily = true;
  }

  if (next.providersEnabled.tavily && !next.credentials.tavilyApiKey) {
    throw new Error('Tavily cannot be enabled until a Tavily API key has been stored.');
  }
  if (!Object.values(next.providersEnabled).some(Boolean)) {
    throw new Error('At least one academic research provider must remain enabled.');
  }

  await setSystemSettingsDoc(ACADEMIC_RESEARCH_CONFIG_DOC, next, false);
  return toPublicAcademicConfig(next);
}

function computeLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = a[j - 1] === b[i - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function computeTitleSimilarity(first: string, second: string): number {
  const a = first.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = second.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - computeLevenshteinDistance(a, b) / Math.max(a.length, b.length);
}

function calculateRelevanceScore(paper: AcademicPaper, queryTerms: string[]): number {
  const title = paper.title.toLowerCase();
  const abstract = (paper.abstract || '').toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (title.includes(term)) score += 3;
    else if (abstract.includes(term)) score += 1;
  }
  if (paper.citationCount !== null) score += Math.log(1 + paper.citationCount) * 0.35;
  if (paper.year !== null) {
    const age = Math.max(0, new Date().getFullYear() - paper.year);
    score += Math.exp(-0.05 * age);
  }
  return Number(score.toFixed(2));
}

async function getCachedSearch(cacheKey: string, cacheTtlHours: number): Promise<AcademicSearchResponse | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  try {
    const result = await pool.query('SELECT data FROM system_config WHERE key = $1 LIMIT 1', [
      'academic_cache_' + cacheKey
    ]);
    const data = result.rows[0]?.data as (AcademicSearchResponse & { cachedAt?: string }) | undefined;
    if (!data || !data.cachedAt || !Array.isArray(data.papers) || !Array.isArray(data.webSources) ||
        !data.evidenceAssessment || !Array.isArray(data.researchPasses)) return null;
    const cachedAt = new Date(data.cachedAt).getTime();
    if (!Number.isFinite(cachedAt)) return null;
    const ageHours = (Date.now() - cachedAt) / (60 * 60 * 1000);
    if (ageHours < 0 || ageHours >= cacheTtlHours) return null;
    return { ...data, cached: true };
  } catch (error) {
    console.warn('[AcademicResearch] Cache read failed; performing live research.', error);
    return null;
  }
}

async function setCachedSearch(cacheKey: string, response: AcademicSearchResponse): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;
  try {
    const payload = { ...response, cachedAt: new Date().toISOString() };
    await pool.query(
      'INSERT INTO system_config (key, data, updated_at) VALUES ($1, $2::jsonb, NOW()) ' +
      'ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
      ['academic_cache_' + cacheKey, JSON.stringify(payload)]
    );
  } catch (error) {
    console.warn('[AcademicResearch] Cache write failed; live research result remains available.', error);
  }
}

async function logAcademicTelemetry(query: string, response: AcademicSearchResponse): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;
  try {
    await pool.query(
      "INSERT INTO system_logs (id, level, category, message, metadata, created_at) " +
      "VALUES ($1, 'info', 'academic_research', $2, $3::jsonb, NOW())",
      [
        'acad_' + randomUUID(),
        'Academic research: ' + query.slice(0, 100) + ' (' + response.totalResults + ' records)',
        JSON.stringify({
          runId: response.runId,
          query,
          resultCount: response.totalResults,
          paperCount: response.papers.length,
          webSourceCount: response.webSources.length,
          researchDepth: response.researchDepth,
          researchStatus: response.researchStatus,
          evidenceAssessment: response.evidenceAssessment,
          providerBreakdown: response.providerBreakdown,
          latencyMs: response.latencyMs,
          cached: response.cached,
          timestamp: response.timestamp
        })
      ]
    );
  } catch (error) {
    console.warn('[AcademicResearch] Audit log write failed.', error);
  }
}

function emptyProviderBreakdown(): Record<AcademicProviderId, ProviderExecution> {
  return {
    arxiv: { count: 0, latencyMs: null, status: 'disabled' },
    semantic_scholar: { count: 0, latencyMs: null, status: 'disabled' },
    openalex: { count: 0, latencyMs: null, status: 'disabled' },
    tavily: { count: 0, latencyMs: null, status: 'disabled' }
  };
}

async function runProvider<T>(
  provider: AcademicProviderId,
  operation: () => Promise<{ items: T[]; latencyMs: number; searchDepth?: 'basic' | 'advanced' }>,
  onItems: (items: T[]) => void,
  breakdown: Record<AcademicProviderId, ProviderExecution>
): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    onItems(result.items);
    breakdown[provider] = {
      count: result.items.length,
      latencyMs: result.latencyMs,
      status: 'ok',
      ...(result.searchDepth ? { searchDepth: result.searchDepth } : {})
    };
  } catch (error) {
    breakdown[provider] = {
      count: 0,
      latencyMs: Date.now() - startedAt,
      status: 'error',
      errorMessage: (error as Error).message
    };
  }
}

function mergeWebSources(existing: WebEvidence[], incoming: WebEvidence[]): WebEvidence[] {
  const byId = new Map<string, WebEvidence>();
  for (const source of [...existing, ...incoming]) {
    const current = byId.get(source.id);
    if (!current || ((source.content?.length || 0) > (current.content?.length || 0))) {
      byId.set(source.id, source);
    }
  }
  return [...byId.values()];
}

export async function searchAcademicPapers(input: SearchAcademicPapersInput): Promise<AcademicSearchResponse> {
  const startedAt = Date.now();
  const parsed = SearchAcademicPapersInputSchema.parse(input);
  const { query, fieldOfStudy, limit, minYear, courseCode, syllabusText } = parsed;
  const config = await loadRuntimeAcademicConfig();
  if (!config.enabled) {
    throw new Error('Academic research is disabled in the persisted administrator configuration.');
  }

  const normalizedQuery = [query, fieldOfStudy || ''].filter(Boolean).join(' ').trim();
  const cacheKey = createHash('sha256').update(JSON.stringify({
    query: normalizedQuery.toLowerCase(),
    limit,
    minYear: minYear ?? null,
    courseCode: courseCode || null,
    syllabusHash: syllabusText ? createHash('sha256').update(syllabusText).digest('hex') : null,
    researchDepth: config.researchDepth,
    maxExpansionRounds: config.maxExpansionRounds,
    minimumEvidenceCount: config.minimumEvidenceCount,
    maxWebResults: config.maxWebResults,
    providersEnabled: config.providersEnabled
  })).digest('hex');

  const cached = await getCachedSearch(cacheKey, config.cacheTtlHours);
  if (cached) {
    const cachedResponse: AcademicSearchResponse = {
      ...cached,
      runId: randomUUID(),
      cached: true,
      timestamp: new Date().toISOString()
    };
    await logAcademicTelemetry(query, cachedResponse);
    return cachedResponse;
  }

  const providerBreakdown = emptyProviderBreakdown();
  const papers: AcademicPaper[] = [];
  let webSources: WebEvidence[] = [];
  const limitations: string[] = [];
  const researchPasses: AcademicSearchResponse['researchPasses'] = [];
  const scholarlyLimit = Math.min(limit, config.arxivMaxResults);
  const baseTasks: Promise<void>[] = [];

  if (config.providersEnabled.arxiv) {
    baseTasks.push(runProvider('arxiv', async () => {
      const result = await fetchFromArxiv(normalizedQuery, scholarlyLimit);
      return { items: result.papers, latencyMs: result.latencyMs };
    }, (items) => papers.push(...items), providerBreakdown));
  }

  if (config.providersEnabled.semanticScholar) {
    baseTasks.push(runProvider('semantic_scholar', async () => {
      const result = await fetchFromSemanticScholar(normalizedQuery, limit, config.semanticScholarApiKey);
      return { items: result.papers, latencyMs: result.latencyMs };
    }, (items) => papers.push(...items), providerBreakdown));
  }

  if (config.providersEnabled.openAlex) {
    baseTasks.push(runProvider('openalex', async () => {
      const result = await fetchFromOpenAlex(normalizedQuery, limit, config.openAlexEmail);
      return { items: result.papers, latencyMs: result.latencyMs };
    }, (items) => papers.push(...items), providerBreakdown));
  }

  const tavilyEnabled = config.providersEnabled.tavily;
  if (tavilyEnabled && config.tavilyApiKey) {
    const firstDepth = config.researchDepth === 'advanced' ? 'advanced' : 'basic';
    baseTasks.push(runProvider('tavily', async () => {
      const result = await searchTavily(normalizedQuery, config.tavilyApiKey as string, {
        searchDepth: firstDepth,
        maxResults: config.maxWebResults
      });
      return { items: result.sources, latencyMs: result.latencyMs, searchDepth: firstDepth };
    }, (items) => { webSources = mergeWebSources(webSources, items); }, providerBreakdown));
    researchPasses.push({
      pass: 1,
      searchDepth: firstDepth,
      query: normalizedQuery,
      reason: config.researchDepth === 'adaptive'
        ? 'Adaptive mode starts with a bounded basic search before deciding whether deeper retrieval is justified.'
        : 'Administrator-selected research depth.'
    });
  } else {
    if (tavilyEnabled && !config.tavilyApiKey) {
      providerBreakdown.tavily = {
        count: 0, latencyMs: null, status: 'not_configured',
        errorMessage: 'Tavily is enabled but no encrypted API key is stored.'
      };
      limitations.push('Tavily is enabled but has no stored API key; web discovery and Tavily expansion were not run.');
    } else {
      limitations.push('Tavily web discovery is disabled in the administrator configuration.');
    }
    researchPasses.push({
      pass: 1,
      searchDepth: 'scholarly_only',
      query: normalizedQuery,
      reason: 'Only enabled scholarly registries were queried.'
    });
  }

  await Promise.all(baseTasks);

  if (minYear !== undefined) {
    const before = papers.length;
    for (let index = papers.length - 1; index >= 0; index--) {
      if (papers[index].year === null || papers[index].year < minYear) papers.splice(index, 1);
    }
    if (before > papers.length) {
      limitations.push(
        'The minimum publication-year filter excluded ' + (before - papers.length) +
        ' records with an older or unavailable publication year.'
      );
    }
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
  for (const paper of papers) paper.relevanceScore = calculateRelevanceScore(paper, queryTerms);

  const uniquePapers: AcademicPaper[] = [];
  const seenDois = new Set<string>();
  for (const paper of papers) {
    const normalizedDoi = paper.doi?.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    if (normalizedDoi && seenDois.has(normalizedDoi)) continue;
    if (uniquePapers.some((existing) => computeTitleSimilarity(existing.title, paper.title) > 0.9)) continue;
    if (normalizedDoi) seenDois.add(normalizedDoi);
    uniquePapers.push(paper);
  }
  uniquePapers.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const finalPapers = uniquePapers.slice(0, limit);
  webSources = mergeWebSources([], webSources).slice(0, config.maxWebResults);

  let assessment = assessResearchEvidence(
    normalizedQuery + ' ' + (syllabusText || ''),
    finalPapers,
    webSources,
    config.minimumEvidenceCount
  );

  if (config.researchDepth === 'adaptive' && assessment.status !== 'candidate_evidence_found' &&
      config.maxExpansionRounds > 0) {
    if (!tavilyEnabled || !config.tavilyApiKey) {
      limitations.push('Adaptive expansion could not run because Tavily is not both enabled and configured.');
    } else {
      let expansionQuery = buildAdaptiveExpansionQuery(query, fieldOfStudy, syllabusText, assessment);
      for (let round = 1; round <= config.maxExpansionRounds; round++) {
        const expansionStarted = Date.now();
        const passNumber = researchPasses.length + 1;
        try {
          const expanded = await searchTavily(expansionQuery, config.tavilyApiKey, {
            searchDepth: 'advanced',
            maxResults: config.maxWebResults
          });
          webSources = mergeWebSources(webSources, expanded.sources)
            .slice(0, config.maxWebResults * (round + 1));
          providerBreakdown.tavily = {
            count: webSources.length,
            latencyMs: (providerBreakdown.tavily.latencyMs || 0) + expanded.latencyMs,
            status: 'ok',
            searchDepth: 'advanced'
          };
          researchPasses.push({
            pass: passNumber,
            searchDepth: 'advanced',
            query: expansionQuery,
            reason: assessment.expansionReasons.join(' ')
          });
          assessment = assessResearchEvidence(
            normalizedQuery + ' ' + (syllabusText || ''),
            finalPapers,
            webSources,
            config.minimumEvidenceCount
          );
          if (assessment.status === 'candidate_evidence_found') break;
          expansionQuery = buildAdaptiveExpansionQuery(query, fieldOfStudy, syllabusText, assessment);
        } catch (error) {
          providerBreakdown.tavily = {
            count: webSources.length,
            latencyMs: (providerBreakdown.tavily.latencyMs || 0) + Date.now() - expansionStarted,
            status: 'error',
            errorMessage: (error as Error).message,
            searchDepth: 'advanced'
          };
          limitations.push('Adaptive expansion failed: ' + (error as Error).message);
          break;
        }
      }
    }
  }

  if (webSources.some((source) => source.verificationStatus === 'unverified')) {
    limitations.push('Web discoveries are unverified leads. Their contents and claims require administrator source review before course use.');
  }
  if (finalPapers.some((paper) => paper.source === 'arxiv')) {
    limitations.push('arXiv records are preprints; their presence does not establish peer review or journal publication.');
  }
  limitations.push('Evidence assessment measures query-term coverage and metadata availability; it does not independently verify source authority or perform contradiction analysis.');
  limitations.push('Official institutional syllabi, credit units, lecturer names and course requirements are not inferred from research results.');

  const anyProviderSucceeded = Object.values(providerBreakdown).some((entry) => entry.status === 'ok');
  if (!anyProviderSucceeded && finalPapers.length === 0 && webSources.length === 0) {
    const failures = Object.entries(providerBreakdown)
      .filter(([, entry]) => entry.status === 'error' || entry.status === 'not_configured')
      .map(([provider, entry]) => provider + ': ' + (entry.errorMessage || entry.status))
      .join('; ');
    throw new Error('All enabled academic providers failed or were unavailable. ' + failures);
  }

  const researchStatus = finalPapers.length === 0 && webSources.length === 0
    ? 'no_results'
    : assessment.status === 'candidate_evidence_found' ? 'evidence_found' : 'insufficient_evidence';

  if (researchStatus === 'no_results') {
    limitations.push('Providers completed without matching records. No research content was fabricated to fill the gap.');
  } else if (researchStatus === 'insufficient_evidence') {
    limitations.push('Available evidence did not meet the configured minimum. This run is not a complete research foundation for course generation.');
  }

  const response: AcademicSearchResponse = {
    runId: randomUUID(),
    query,
    researchDepth: config.researchDepth,
    researchStatus,
    totalResults: finalPapers.length + webSources.length,
    papers: finalPapers,
    webSources,
    evidenceAssessment: assessment,
    researchPasses,
    limitations: [...new Set(limitations)],
    latencyMs: Date.now() - startedAt,
    providerBreakdown,
    cached: false,
    timestamp: new Date().toISOString()
  };

  if (researchStatus !== 'no_results') await setCachedSearch(cacheKey, response);
  await logAcademicTelemetry(query, response);
  return response;
}

export async function getCitationAndAbstract(input: GetCitationInput): Promise<CitationResult> {
  const { identifier } = input;
  const config = await loadRuntimeAcademicConfig();
  let paper: AcademicPaper | null = null;

  if (config.providersEnabled.semanticScholar) {
    paper = await lookupPaperSemanticScholar(identifier, config.semanticScholarApiKey);
  }
  if (!paper) {
    const searchResponse = await searchAcademicPapers({ query: identifier, limit: 1 });
    paper = searchResponse.papers[0] || null;
  }
  if (!paper) {
    throw new Error('No matching paper was returned by the configured live scholarly registries.');
  }

  const year = paper.year === null ? 'n.d.' : String(paper.year);
  const doiUrl = paper.doi ? 'https://doi.org/' + paper.doi : paper.url;
  const authorText = paper.authors.length > 0 ? paper.authors.join(', ') : paper.title;
  const apa = paper.authors.length > 0
    ? authorText + ' (' + year + '). ' + paper.title + '.' +
      (paper.venue ? ' ' + paper.venue + '.' : '') + ' ' + doiUrl
    : paper.title + ' (' + year + ').' +
      (paper.venue ? ' ' + paper.venue + '.' : '') + ' ' + doiUrl;

  const firstAuthor = paper.authors[0] || paper.title;
  const key = firstAuthor.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) +
    (paper.year === null ? '' : String(paper.year)) +
    paper.id.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
  const bibFields = [
    paper.authors.length > 0 ? '  author = {' + paper.authors.join(' and ') + '}' : null,
    '  title = {' + paper.title.replace(/[{}]/g, '') + '}',
    paper.year === null ? null : '  year = {' + paper.year + '}',
    paper.venue ? '  journal = {' + paper.venue.replace(/[{}]/g, '') + '}' : null,
    paper.doi ? '  doi = {' + paper.doi + '}' : null,
    '  url = {' + paper.url + '}'
  ].filter((field): field is string => Boolean(field));
  const bibtexType = paper.venue ? 'article' : 'misc';
  const bibtex = '@' + bibtexType + '{' + key + ',\n' + bibFields.join(',\n') + '\n}';

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
    url: paper.url
  };
}

export async function extractCanonicalDefinitions(
  subject: string,
  topic: string
): Promise<CanonicalDefinition | null> {
  return fetchOpenAlexConceptDefinitions(subject, topic);
}

export async function checkAcademicProvidersHealth(): Promise<AcademicProviderHealth[]> {
  const config = await loadRuntimeAcademicConfig();
  const providers: AcademicProviderId[] = ['arxiv', 'semantic_scholar', 'openalex', 'tavily'];
  const health: AcademicProviderHealth[] = [];

  for (const provider of providers) {
    const startedAt = Date.now();
    const enabled = provider === 'arxiv'
      ? config.providersEnabled.arxiv
      : provider === 'semantic_scholar'
        ? config.providersEnabled.semanticScholar
        : provider === 'openalex'
          ? config.providersEnabled.openAlex
          : config.providersEnabled.tavily;

    if (!enabled) {
      health.push({ provider, status: 'disabled', latencyMs: 0, lastChecked: new Date().toISOString() });
      continue;
    }
    if (provider === 'tavily' && !config.tavilyApiKey) {
      health.push({
        provider, status: 'not_configured', latencyMs: 0,
        lastChecked: new Date().toISOString(),
        errorMessage: 'Tavily API key is not stored.'
      });
      continue;
    }

    try {
      if (provider === 'arxiv') await fetchFromArxiv('fluid mechanics', 1);
      else if (provider === 'semantic_scholar') {
        await fetchFromSemanticScholar('fluid mechanics', 1, config.semanticScholarApiKey);
      } else if (provider === 'openalex') {
        await fetchFromOpenAlex('fluid mechanics', 1, config.openAlexEmail);
      } else {
        await searchTavily('fluid mechanics', config.tavilyApiKey as string, {
          searchDepth: 'basic', maxResults: 1
        });
      }
      health.push({
        provider, status: 'healthy', latencyMs: Date.now() - startedAt,
        lastChecked: new Date().toISOString()
      });
    } catch (error) {
      health.push({
        provider, status: 'offline', latencyMs: Date.now() - startedAt,
        lastChecked: new Date().toISOString(),
        errorMessage: (error as Error).message
      });
    }
  }
  return health;
}
