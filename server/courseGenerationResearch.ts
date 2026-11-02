import { searchAcademicPapers, extractCanonicalDefinitions } from './academicResearchEngine.js';
import { tokenizeResearchTerms } from './academic/adaptiveEvidence.js';
import type { AcademicPaper, AcademicSearchResponse, CanonicalDefinition, WebEvidence } from './academic/types.js';

export type ResearchPass = AcademicSearchResponse['researchPasses'][number];

export const MAX_COURSE_SOURCE_CHARS = 50000;

export interface CourseResearchSourceReference {
  recordType: 'scholarly_record' | 'web_discovery';
  provider: 'arxiv' | 'semantic_scholar' | 'openalex' | 'tavily';
  title: string;
  url: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  publicationType?: 'preprint' | 'indexed_record';
  authorityClass?: 'scholarly_index' | 'institutional_domain' | 'general_web' | 'unknown';
  verificationStatus: 'unverified';
}

export interface CourseGenerationResearchResult {
  context: string;
  papers: AcademicPaper[];
  webSources: WebEvidence[];
  metadata: {
    status: 'evidence_found' | 'insufficient_evidence' | 'no_results' | 'disabled' | 'unavailable';
    sourceReferences: CourseResearchSourceReference[];
    runId: string | null;
    researchDepth: string | null;
    researchPasses: ResearchPass[];
    retrievedAt: string;
    papersCount: number;
    webSourcesCount: number;
    evidenceAssessment: unknown;
    providerBreakdown: unknown;
    limitations: string[];
    errorMessage?: string;
  };
}

function buildSourceReferences(
  papers: AcademicPaper[],
  webSources: WebEvidence[]
): CourseResearchSourceReference[] {
  const seenUrls = new Set<string>();
  const refs: CourseResearchSourceReference[] = [];

  for (const paper of papers) {
    if (!paper.url || seenUrls.has(paper.url)) continue;
    seenUrls.add(paper.url);
    refs.push({
      recordType: 'scholarly_record',
      provider: paper.source,
      title: paper.title,
      url: paper.url,
      authors: paper.authors,
      year: paper.year,
      venue: paper.venue,
      doi: paper.doi,
      publicationType: paper.publicationType,
      verificationStatus: 'unverified'
    });
  }

  for (const source of webSources) {
    if (!source.url || seenUrls.has(source.url)) continue;
    seenUrls.add(source.url);
    refs.push({
      recordType: 'web_discovery',
      provider: 'tavily',
      title: source.title,
      url: source.url,
      authorityClass: source.authorityClass,
      verificationStatus: 'unverified'
    });
  }

  return refs;
}

function formatResearchContextBlock(params: {
  status: string;
  researchDepth: string | null;
  researchPasses: ResearchPass[];
  papers: AcademicPaper[];
  webSources: WebEvidence[];
  canonicalDefinition?: CanonicalDefinition | null;
  verificationRequired?: boolean;
  contradictionAssessment?: string;
  limitations: string[];
  topicScopeLabel?: string;
}): string {
  const sections: string[] = [
    ...(params.topicScopeLabel ? ['RESEARCH SCOPE: ' + params.topicScopeLabel] : []),
    'RESEARCH RUN STATUS: ' + params.status,
    'RESEARCH DEPTH: ' + (params.researchDepth || 'adaptive'),
    'Retrieved source count: ' + (params.papers.length + params.webSources.length),
    'Adaptive passes executed: ' + params.researchPasses.length,
    'Evidence assessment requires human source review: ' + String(params.verificationRequired ?? true),
    'Contradiction analysis: ' + String(params.contradictionAssessment || 'not performed')
  ];

  if (params.researchPasses.length > 0) {
    sections.push(
      'ADAPTIVE RESEARCH PASSES:\n' +
      params.researchPasses
        .map(p => `- Pass ${p.pass} [${p.searchDepth}]: query="${p.query}" (${p.reason})`)
        .join('\n')
    );
  }

  if (params.canonicalDefinition) {
    const def = params.canonicalDefinition;
    sections.push(
      [
        '[OPENALEX CANONICAL CONCEPT TAXONOMY]',
        `Subject: ${def.subject} | Topic: ${def.topic}`,
        `Source ID: ${def.sourceId} | Source URL: ${def.sourceUrl}`,
        `Canonical Definition & Scope: ${def.canonicalDefinition}`
      ].join('\n')
    );
  }

  for (const paper of params.papers) {
    sections.push([
      '[SCHOLARLY INDEX RECORD — source: ' + paper.source + '; type: ' + paper.publicationType + ']',
      'Title: ' + paper.title,
      'Authors: ' + (paper.authors || []).join(', '),
      'Year: ' + (paper.year ?? 'not provided'),
      'Venue: ' + (paper.venue || 'not provided'),
      'DOI: ' + (paper.doi || 'not provided'),
      'URL: ' + paper.url,
      'Abstract: ' + (paper.abstract || 'No abstract supplied by the provider.')
    ].join('\n'));
  }

  for (const source of params.webSources) {
    sections.push([
      '[WEB DISCOVERY — UNVERIFIED LEAD; human source review required]',
      'Title: ' + source.title,
      'Domain: ' + source.domain,
      'URL: ' + source.url,
      'Authority classification: ' + source.authorityClass,
      'Retrieved content: ' + (source.content || 'The provider did not return page content.')
    ].join('\n'));
  }

  if (params.papers.length === 0 && params.webSources.length === 0 && !params.canonicalDefinition) {
    sections.push('No source records were returned. Do not invent references, institutional syllabi, textbooks, or external evidence.');
  }
  if (params.limitations.length > 0) {
    sections.push('RESEARCH LIMITATIONS:\n- ' + params.limitations.join('\n- '));
  }

  return sections.join('\n\n');
}

/**
 * Retrieve live source-attributed material for course generation.
 * Research is supplementary: it never replaces an admin-supplied outline
 * and unavailable providers are explicitly represented rather than fabricated.
 */
export async function retrieveCourseGenerationResearch(input: {
  courseName: string;
  courseCode?: string;
  department?: string;
  level: string;
  outline?: string;
  sourceText?: string;
}): Promise<CourseGenerationResearchResult> {
  const adminSourceText = [input.outline, input.sourceText]
    .filter(value => typeof value === 'string' && value.trim())
    .join('\n\n');
  if (adminSourceText.length > MAX_COURSE_SOURCE_CHARS) {
    throw new Error(
      'The combined syllabus outline and extracted source material exceeds ' +
      MAX_COURSE_SOURCE_CHARS.toLocaleString() +
      ' characters. No source text was truncated; split or reduce the document before generation.'
    );
  }

  const outlineTerms = tokenizeResearchTerms(adminSourceText).slice(0, 5);
  const query = [
    input.courseName.trim(),
    outlineTerms.join(' ')
  ]
    .filter(value => typeof value === 'string' && value.trim())
    .join(' ')
    .slice(0, 240);

  try {
    const [result, canonicalDefinition] = await Promise.all([
      searchAcademicPapers({
        query: query || input.courseName.trim(),
        fieldOfStudy: input.department,
        courseCode: input.courseCode,
        syllabusText: adminSourceText || undefined,
        limit: 12
      }),
      extractCanonicalDefinitions(input.courseName, input.department || input.courseName).catch(() => null)
    ]);

    const papers = Array.isArray(result.papers) ? result.papers : [];
    const webSources = Array.isArray(result.webSources) ? result.webSources : [];
    const researchPasses = Array.isArray(result.researchPasses) ? result.researchPasses : [];
    const limitations = Array.isArray(result.limitations) ? result.limitations : [];

    const sourceReferences = buildSourceReferences(papers, webSources);
    if (
      canonicalDefinition?.sourceUrl &&
      !sourceReferences.some(ref => ref.url === canonicalDefinition.sourceUrl)
    ) {
      sourceReferences.push({
        recordType: 'scholarly_record',
        provider: 'openalex',
        title: `OpenAlex Concept: ${canonicalDefinition.topic} (${canonicalDefinition.subject})`,
        url: canonicalDefinition.sourceUrl,
        publicationType: 'indexed_record',
        verificationStatus: 'unverified'
      });
    }

    const context = formatResearchContextBlock({
      status: result.researchStatus,
      researchDepth: result.researchDepth,
      researchPasses,
      papers,
      webSources,
      canonicalDefinition,
      verificationRequired: result.evidenceAssessment?.verificationRequired === true,
      contradictionAssessment: result.evidenceAssessment?.contradictionAssessment,
      limitations
    });

    return {
      context,
      papers,
      webSources,
      metadata: {
        status: result.researchStatus,
        sourceReferences,
        runId: result.runId,
        researchDepth: result.researchDepth,
        researchPasses,
        retrievedAt: result.timestamp,
        papersCount: papers.length,
        webSourcesCount: webSources.length,
        evidenceAssessment: result.evidenceAssessment,
        providerBreakdown: result.providerBreakdown,
        limitations
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isExplicitlyDisabled = /disabled in the persisted administrator configuration/i.test(message);
    const status = isExplicitlyDisabled ? 'disabled' : 'unavailable';

    return {
      context: isExplicitlyDisabled
        ? 'LIVE ACADEMIC RESEARCH IS DISABLED BY ADMINISTRATOR CONFIGURATION. Use only the admin-supplied outline/source material; do not claim that live research was performed or invent references.'
        : 'LIVE ACADEMIC RESEARCH RETRIEVAL FAILED. Reason: ' + message +
          '. Do not claim that live research was performed or invent references.',
      papers: [],
      webSources: [],
      metadata: {
        status,
        sourceReferences: [],
        runId: null,
        researchDepth: null,
        researchPasses: [],
        retrievedAt: new Date().toISOString(),
        papersCount: 0,
        webSourcesCount: 0,
        evidenceAssessment: null,
        providerBreakdown: null,
        limitations: [
          isExplicitlyDisabled
            ? 'Academic research was skipped because it is disabled in administrator settings.'
            : 'Live academic research retrieval failed: ' + message
        ],
        errorMessage: message
      }
    };
  }
}

/**
 * Enforces the ZeroMock & Dynamic Resolution Policy for course generation:
 * - If live academic research failed (`status === 'unavailable'`) and no verified admin
 *   outline/sourceText was provided, fail transparently instead of generating ungrounded content.
 * - If academic research is disabled (`status === 'disabled'`) and no admin outline/sourceText
 *   was provided, fail transparently instructing the admin to either enable live academic research
 *   providers or supply a verified syllabus/source document.
 */
export function assertVerifiedCourseResearchOrSourceMaterial(
  research: CourseGenerationResearchResult,
  options: { outline?: string; sourceText?: string; stageLabel?: string }
): void {
  const hasAdminSource = Boolean(
    (typeof options.outline === 'string' && options.outline.trim().length > 0) ||
    (typeof options.sourceText === 'string' && options.sourceText.trim().length > 0)
  );
  const stage = options.stageLabel || 'Course generation';

  if (research.metadata.status === 'unavailable' && !hasAdminSource) {
    throw new Error(
      `${stage} aborted under ZeroMock policy: Live academic research retrieval failed (${research.metadata.errorMessage || 'all enabled providers failed'}) and no administrator syllabus outline or source document was provided.`
    );
  }

  if (research.metadata.status === 'disabled' && !hasAdminSource) {
    throw new Error(
      `${stage} aborted under ZeroMock policy: Academic research is disabled in administrator settings and no syllabus outline or source document was provided. Enable at least one live scholarly provider or provide verified source material.`
    );
  }
}

/**
 * Resolves module- and lesson-specific academic evidence dynamically:
 * 1. Scores and filters the course-level evidence pool against the specific module and lesson topic terms.
 * 2. Queries OpenAlex for canonical concept definitions specific to the lesson/module topic.
 * 3. If the course-level evidence pool has fewer than 2 topic-relevant records (and academic research is enabled),
 *    runs a targeted adaptive scholarly search for the module/lesson topic (backed by the PostgreSQL research cache).
 */
export async function retrieveTopicSpecificCourseResearch(input: {
  courseName: string;
  courseCode?: string;
  department?: string;
  moduleTitle: string;
  topicTitles: string[];
  courseResearch: CourseGenerationResearchResult;
}): Promise<{
  context: string;
  newSourceReferences: CourseResearchSourceReference[];
}> {
  const topicText = [input.moduleTitle, ...input.topicTitles].join(' ');
  const topicTerms = tokenizeResearchTerms(topicText);

  const scorePaperForTopic = (paper: AcademicPaper): number => {
    if (topicTerms.length === 0) return paper.relevanceScore || 0;
    const haystack = `${paper.title} ${paper.abstract || ''}`.toLowerCase();
    let matches = 0;
    for (const term of topicTerms) {
      if (haystack.includes(term)) matches++;
    }
    return matches;
  };

  const scoreWebForTopic = (source: WebEvidence): number => {
    if (topicTerms.length === 0) return 1;
    const haystack = `${source.title} ${source.content || ''}`.toLowerCase();
    let matches = 0;
    for (const term of topicTerms) {
      if (haystack.includes(term)) matches++;
    }
    return matches;
  };

  let matchedPapers = (input.courseResearch.papers || [])
    .map(paper => ({ paper, topicMatches: scorePaperForTopic(paper) }))
    .filter(item => item.topicMatches > 0)
    .sort((a, b) => b.topicMatches - a.topicMatches || b.paper.relevanceScore - a.paper.relevanceScore)
    .map(item => item.paper);

  let matchedWebSources = (input.courseResearch.webSources || [])
    .map(source => ({ source, topicMatches: scoreWebForTopic(source) }))
    .filter(item => item.topicMatches > 0)
    .sort((a, b) => b.topicMatches - a.topicMatches)
    .map(item => item.source);

  let extraPasses: ResearchPass[] = [];
  let extraLimitations: string[] = [];
  let canonicalDefinition: CanonicalDefinition | null = null;

  const canQueryLiveProviders =
    input.courseResearch.metadata.status !== 'disabled' &&
    input.courseResearch.metadata.status !== 'unavailable';

  if (canQueryLiveProviders) {
    const primaryTopic = input.topicTitles[0] || input.moduleTitle;
    const needsTargetedExpansion = matchedPapers.length + matchedWebSources.length < 2;
    const focusedTopicQuery = [
      input.courseName.trim(),
      input.moduleTitle.trim(),
      topicTerms.slice(0, 4).join(' ')
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 220);

    const [targetedSearch, conceptDef] = await Promise.all([
      needsTargetedExpansion && focusedTopicQuery.length >= 3
        ? searchAcademicPapers({
            query: focusedTopicQuery,
            fieldOfStudy: input.department,
            courseCode: input.courseCode,
            syllabusText: topicText,
            limit: 6
          }).catch(err => {
            extraLimitations.push(
              `Module-level targeted research query for "${input.moduleTitle}" did not complete: ${(err as Error).message}`
            );
            return null;
          })
        : Promise.resolve(null),
      extractCanonicalDefinitions(input.courseName, primaryTopic).catch(() => null)
    ]);

    canonicalDefinition = conceptDef;

    if (targetedSearch) {
      const seenPaperUrls = new Set(matchedPapers.map(p => p.url));
      for (const paper of targetedSearch.papers || []) {
        if (!seenPaperUrls.has(paper.url)) {
          seenPaperUrls.add(paper.url);
          matchedPapers.push(paper);
        }
      }
      const seenWebUrls = new Set(matchedWebSources.map(w => w.url));
      for (const source of targetedSearch.webSources || []) {
        if (!seenWebUrls.has(source.url)) {
          seenWebUrls.add(source.url);
          matchedWebSources.push(source);
        }
      }
      extraPasses = targetedSearch.researchPasses || [];
      extraLimitations.push(...(targetedSearch.limitations || []));
    }
  }

  // If topic-specific filtering matched nothing even after targeted lookup, include top course-level papers for general disciplinary context
  const effectivePapers = matchedPapers.length > 0
    ? matchedPapers.slice(0, 8)
    : (input.courseResearch.papers || []).slice(0, 4);
  const effectiveWebSources = matchedWebSources.length > 0
    ? matchedWebSources.slice(0, 4)
    : (input.courseResearch.webSources || []).slice(0, 2);

  const newSourceReferences = buildSourceReferences(effectivePapers, effectiveWebSources);
  if (
    canonicalDefinition?.sourceUrl &&
    !newSourceReferences.some(ref => ref.url === canonicalDefinition!.sourceUrl)
  ) {
    newSourceReferences.push({
      recordType: 'scholarly_record',
      provider: 'openalex',
      title: `OpenAlex Concept: ${canonicalDefinition.topic} (${canonicalDefinition.subject})`,
      url: canonicalDefinition.sourceUrl,
      publicationType: 'indexed_record',
      verificationStatus: 'unverified'
    });
  }

  const combinedPasses = [
    ...(input.courseResearch.metadata.researchPasses || []),
    ...extraPasses
  ];
  const combinedLimitations = [
    ...new Set([
      ...(input.courseResearch.metadata.limitations || []),
      ...extraLimitations
    ])
  ];

  const context = formatResearchContextBlock({
    topicScopeLabel: `Module "${input.moduleTitle}" — Topics: ${input.topicTitles.join('; ')}`,
    status:
      effectivePapers.length + effectiveWebSources.length > 0
        ? 'evidence_found'
        : input.courseResearch.metadata.status,
    researchDepth: input.courseResearch.metadata.researchDepth,
    researchPasses: combinedPasses,
    papers: effectivePapers,
    webSources: effectiveWebSources,
    canonicalDefinition,
    verificationRequired: true,
    contradictionAssessment: 'not_performed',
    limitations: combinedLimitations
  });

  return {
    context,
    newSourceReferences
  };
}

