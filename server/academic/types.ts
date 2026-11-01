import { z } from 'zod';

export type AcademicProviderId = 'tavily' | 'arxiv' | 'semantic_scholar' | 'openalex';
export type ResearchDepth = 'adaptive' | 'basic' | 'advanced';
export type ProviderRunStatus = 'ok' | 'error' | 'disabled' | 'not_configured';

export interface AcademicPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string;
  pdfUrl: string | null;
  citationCount: number | null;
  source: Exclude<AcademicProviderId, 'tavily'>;
  publicationType: 'preprint' | 'indexed_record';
  relevanceScore: number;
  syllabusTags: string[];
}

export interface WebEvidence {
  id: string;
  title: string;
  url: string;
  domain: string;
  content: string | null;
  score: number | null;
  source: 'tavily';
  searchDepth: 'basic' | 'advanced';
  authorityClass: 'scholarly_index' | 'institutional_domain' | 'general_web' | 'unknown';
  verificationStatus: 'unverified';
}

export interface EvidenceAssessment {
  status: 'candidate_evidence_found' | 'insufficient_candidate_evidence' | 'no_evidence';
  evidenceCount: number;
  relevantEvidenceCount: number;
  academicRecordCount: number;
  webContentCount: number;
  queryTermCoverage: number;
  matchedQueryTerms: string[];
  authoritySignals: number;
  minimumEvidenceCount: number;
  expansionReasons: string[];
  verificationRequired: true;
  contradictionAssessment: 'not_performed';
}

export const AcademicPaperSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string()),
  abstract: z.string().nullable(),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  doi: z.string().nullable(),
  url: z.string().url(),
  pdfUrl: z.string().url().nullable(),
  citationCount: z.number().nonnegative().nullable(),
  source: z.enum(['arxiv', 'semantic_scholar', 'openalex']),
  publicationType: z.enum(['preprint', 'indexed_record']),
  relevanceScore: z.number(),
  syllabusTags: z.array(z.string())
});

export const SearchAcademicPapersInputSchema = z.object({
  query: z.string().trim().min(2, 'Query must be at least 2 characters').max(400),
  fieldOfStudy: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(20).default(5),
  minYear: z.number().int().min(1800).max(2200).optional(),
  courseCode: z.string().trim().max(40).optional(),
  syllabusText: z.string().max(12000).optional()
});

export type SearchAcademicPapersInput = z.infer<typeof SearchAcademicPapersInputSchema>;

export const GetCitationInputSchema = z.object({
  identifier: z.string().trim().min(1, 'Identifier (DOI, arXiv ID, or title) is required').max(500),
  format: z.enum(['apa', 'bibtex', 'both']).default('both')
});

export type GetCitationInput = z.infer<typeof GetCitationInputSchema>;

export interface CanonicalDefinition {
  subject: string;
  topic: string;
  canonicalDefinition: string;
  sourceProvider: 'openalex';
  sourceId: string;
  sourceUrl: string;
}

export interface CitationResult {
  identifier: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  apa: string;
  bibtex: string;
  abstract: string | null;
  pdfUrl: string | null;
  url: string;
}

export interface AcademicProviderHealth {
  provider: AcademicProviderId;
  status: 'healthy' | 'degraded' | 'offline' | 'disabled' | 'not_configured';
  latencyMs: number;
  lastChecked: string;
  errorMessage?: string;
}

export interface ProviderExecution {
  count: number;
  latencyMs: number | null;
  status: ProviderRunStatus;
  errorMessage?: string;
  searchDepth?: 'basic' | 'advanced';
}

export interface AcademicConfig {
  enabled: boolean;
  cacheTtlHours: number;
  semanticScholarApiKey?: string;
  tavilyApiKey?: string;
  openAlexEmail?: string;
  arxivMaxResults: number;
  researchDepth: ResearchDepth;
  maxExpansionRounds: number;
  minimumEvidenceCount: number;
  maxWebResults: number;
  providersEnabled: {
    arxiv: boolean;
    semanticScholar: boolean;
    openAlex: boolean;
    tavily: boolean;
  };
}

export type AcademicConfigView = Omit<AcademicConfig, 'semanticScholarApiKey' | 'tavilyApiKey'> & {
  semanticScholarApiKeyConfigured: boolean;
  tavilyApiKeyConfigured: boolean;
};

export interface AcademicSearchResponse {
  runId: string;
  query: string;
  researchDepth: ResearchDepth;
  researchStatus: 'evidence_found' | 'insufficient_evidence' | 'no_results';
  totalResults: number;
  papers: AcademicPaper[];
  webSources: WebEvidence[];
  evidenceAssessment: EvidenceAssessment;
  researchPasses: Array<{
    pass: number;
    searchDepth: 'basic' | 'advanced' | 'scholarly_only';
    query: string;
    reason: string;
  }>;
  limitations: string[];
  latencyMs: number;
  providerBreakdown: Record<AcademicProviderId, ProviderExecution>;
  cached: boolean;
  timestamp: string;
}
