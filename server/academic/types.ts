import { z } from 'zod';

export const AcademicPaperSchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  abstract: z.string(),
  year: z.number().nullable().optional(),
  venue: z.string().nullable().optional(),
  doi: z.string().nullable().optional(),
  url: z.string(),
  pdfUrl: z.string().nullable().optional(),
  citationCount: z.number().default(0),
  source: z.enum(['arxiv', 'semantic_scholar', 'openalex']),
  relevanceScore: z.number().default(0),
  syllabusTags: z.array(z.string()).default([]),
});

export type AcademicPaper = z.infer<typeof AcademicPaperSchema>;

export const SearchAcademicPapersInputSchema = z.object({
  query: z.string().min(2, 'Query must be at least 2 characters'),
  fieldOfStudy: z.string().optional(),
  limit: z.number().min(1).max(20).default(5),
  minYear: z.number().optional(),
  courseCode: z.string().optional(),
});

export type SearchAcademicPapersInput = z.infer<typeof SearchAcademicPapersInputSchema>;

export const GetCitationInputSchema = z.object({
  identifier: z.string().min(1, 'Identifier (DOI, arXiv ID, or title) is required'),
  format: z.enum(['apa', 'bibtex', 'both']).default('both'),
});

export type GetCitationInput = z.infer<typeof GetCitationInputSchema>;

export const CanonicalDefinitionsInputSchema = z.object({
  subject: z.string().min(2),
  topic: z.string().min(2),
  courseCode: z.string().optional(),
});

export type CanonicalDefinitionsInput = z.infer<typeof CanonicalDefinitionsInputSchema>;

export interface CanonicalDefinition {
  topic: string;
  subject: string;
  canonicalDefinition: string;
  sourceTextbooks: string[];
  keyEquations: string[];
  courseAlignment: {
    curriculumBenchmark: string;
    courseCode: string;
  };
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
  abstract: string;
  pdfUrl: string | null;
  url: string;
}

export interface AcademicProviderHealth {
  provider: 'arxiv' | 'semantic_scholar' | 'openalex';
  status: 'healthy' | 'degraded' | 'offline';
  latencyMs: number;
  lastChecked: string;
  errorMessage?: string;
}

export interface AcademicConfig {
  enabled: boolean;
  cacheTtlHours: number;
  semanticScholarApiKey?: string;
  openAlexEmail?: string;
  researchDepth: 'adaptive';
  adaptiveMaxQueries: number;
  minimumUsefulSources: number;
  tavilyApiKeyConfigured: boolean;
  semanticScholarApiKeyConfigured: boolean;
  arxivMaxResults: number;
  defaultCourseAlignment: string; // e.g. "Global University Benchmark Syllabus (Adaptive)"
  providersEnabled: {
    arxiv: boolean;
    semanticScholar: boolean;
    openAlex: boolean;
    tavily: boolean;
  };
}

export interface AcademicWebSourceSearchResponse {
  query: string;
  researchDepth: 'adaptive';
  status: 'results_found' | 'no_results';
  escalated: boolean;
  stages: Array<{
    searchDepth: 'basic' | 'advanced';
    resultCount: number;
    usefulSourceCount: number;
    creditsUsed: number | null;
    responseTimeSeconds: number | null;
  }>;
  sources: Array<{
    title: string;
    url: string;
    content: string;
    rawContent?: string;
    score: number;
    publishedDate?: string | null;
    sourceClass: 'institutional_domain_candidate' | 'publisher_or_repository_candidate' | 'general_web_candidate';
    verificationStatus: 'unverified';
  }>;
  creditsUsed: number | null;
  disclaimer: string;
}

export interface AcademicSearchResponse {
  query: string;
  totalResults: number;
  papers: AcademicPaper[];
  canonicalDefinitions?: CanonicalDefinition[];
  latencyMs: number;
  providerBreakdown: Record<string, { count: number; latencyMs: number; status: 'ok' | 'error' }>;
  cached: boolean;
  timestamp: string;
}
