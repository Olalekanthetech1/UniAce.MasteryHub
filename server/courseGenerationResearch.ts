import { searchAcademicPapers } from './academicResearchEngine';

export const MAX_COURSE_SOURCE_CHARS = 50000;

export interface CourseGenerationResearchResult {
  context: string;
  metadata: {
    status: 'evidence_found' | 'insufficient_evidence' | 'no_results' | 'unavailable';
    runId: string | null;
    researchDepth: string | null;
    retrievedAt: string;
    papersCount: number;
    webSourcesCount: number;
    evidenceAssessment: unknown;
    providerBreakdown: unknown;
    limitations: string[];
    errorMessage?: string;
  };
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

  const query = [
    input.courseName,
    input.courseCode,
    input.department,
    input.level,
    'university course curriculum foundational theory and academic literature'
  ].filter(value => typeof value === 'string' && value.trim()).join(' ');

  try {
    const result = await searchAcademicPapers({
      query,
      fieldOfStudy: input.department,
      courseCode: input.courseCode,
      syllabusText: adminSourceText || undefined,
      limit: 10
    });

    const sections: string[] = [
      'RESEARCH RUN STATUS: ' + result.researchStatus,
      'RESEARCH DEPTH: ' + result.researchDepth,
      'Retrieved source count: ' + result.totalResults,
      'Evidence assessment requires human source review: ' + String(result.evidenceAssessment?.verificationRequired === true),
      'Contradiction analysis: ' + String(result.evidenceAssessment?.contradictionAssessment || 'not performed')
    ];

    for (const paper of result.papers || []) {
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

    for (const source of result.webSources || []) {
      sections.push([
        '[WEB DISCOVERY — UNVERIFIED LEAD; human source review required]',
        'Title: ' + source.title,
        'Domain: ' + source.domain,
        'URL: ' + source.url,
        'Authority classification: ' + source.authorityClass,
        'Retrieved content: ' + (source.content || 'The provider did not return page content.')
      ].join('\n'));
    }

    if ((!result.papers || result.papers.length === 0) &&
        (!result.webSources || result.webSources.length === 0)) {
      sections.push('No source records were returned. Do not invent references, institutional syllabi, textbooks, or external evidence.');
    }
    if (Array.isArray(result.limitations) && result.limitations.length > 0) {
      sections.push('RESEARCH LIMITATIONS:\n- ' + result.limitations.join('\n- '));
    }

    return {
      context: sections.join('\n\n'),
      metadata: {
        status: result.researchStatus,
        runId: result.runId,
        researchDepth: result.researchDepth,
        retrievedAt: result.timestamp,
        papersCount: Array.isArray(result.papers) ? result.papers.length : 0,
        webSourcesCount: Array.isArray(result.webSources) ? result.webSources.length : 0,
        evidenceAssessment: result.evidenceAssessment,
        providerBreakdown: result.providerBreakdown,
        limitations: Array.isArray(result.limitations) ? result.limitations : []
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      context: 'LIVE ACADEMIC RESEARCH RETRIEVAL WAS UNAVAILABLE. Reason: ' + message +
        '. Use only the admin-supplied outline/source material and established knowledge; do not claim that live research was performed or invent references.',
      metadata: {
        status: 'unavailable',
        runId: null,
        researchDepth: null,
        retrievedAt: new Date().toISOString(),
        papersCount: 0,
        webSourcesCount: 0,
        evidenceAssessment: null,
        providerBreakdown: null,
        limitations: ['Live academic research retrieval did not complete. ' + message],
        errorMessage: message
      }
    };
  }
}
