import type { AcademicPaper, EvidenceAssessment, WebEvidence } from './types.js';

const STOP_WORDS = new Set([
  'about', 'academic', 'after', 'also', 'among', 'and', 'are', 'based', 'being',
  'between', 'can', 'chapter', 'comprehensive', 'concepts', 'course', 'curriculum',
  'department', 'for', 'foundational', 'foundations', 'from', 'fundamentals',
  'general', 'into', 'introduction', 'introductory', 'its', 'lecture', 'lesson',
  'level', 'literature', 'module', 'modules', 'more', 'of', 'on', 'or', 'outline',
  'over', 'overview', 'part', 'principles', 'section', 'semester', 'standard',
  'study', 'syllabus', 'the', 'their', 'theory', 'this', 'through', 'topic',
  'topics', 'under', 'unit', 'units', 'university', 'using', 'what', 'when',
  'where', 'which', 'with'
]);

const COURSE_CODE_TOKEN_REGEX = /^[a-z]{2,4}[0-9]{2,4}[a-z]?$/i;

export function tokenizeResearchTerms(value: string): string[] {
  const words = value.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return [
    ...new Set(
      words.filter(
        (word) =>
          !STOP_WORDS.has(word) &&
          !COURSE_CODE_TOKEN_REGEX.test(word) &&
          !/^[0-9]+$/.test(word)
      )
    )
  ];
}

export function assessResearchEvidence(
  query: string,
  papers: AcademicPaper[],
  webSources: WebEvidence[],
  minimumEvidenceCount: number
): EvidenceAssessment {
  const queryTerms = tokenizeResearchTerms(query);
  const documents = [
    ...papers.map((paper) => ({
      text: (paper.title + ' ' + (paper.abstract || '')).toLowerCase(),
      authority: true
    })),
    ...webSources.filter((source) => Boolean(source.content)).map((source) => ({
      text: (source.title + ' ' + (source.content || '')).toLowerCase(),
      authority: source.authorityClass === 'scholarly_index' || source.authorityClass === 'institutional_domain'
    }))
  ];

  const matchedTerms = queryTerms.filter((term) =>
    documents.some((document) => document.text.includes(term))
  );
  const relevantEvidenceCount = documents.filter((document) =>
    queryTerms.length === 0
      ? document.text.trim().length > 0
      : queryTerms.some((term) => document.text.includes(term))
  ).length;
  const evidenceCount = papers.length + webSources.filter((source) => Boolean(source.content)).length;
  const queryTermCoverage = queryTerms.length === 0
    ? 0
    : Number((matchedTerms.length / queryTerms.length).toFixed(3));
  const authoritySignals = documents.filter((document) => document.authority).length;

  const expansionReasons: string[] = [];
  if (evidenceCount < minimumEvidenceCount) {
    expansionReasons.push('Evidence count is below the configured minimum.');
  }
  if (queryTermCoverage < 0.5) {
    expansionReasons.push('Retrieved content covers less than half of the query terms.');
  }
  if (relevantEvidenceCount < minimumEvidenceCount) {
    expansionReasons.push('Too few retrieved records contain query-relevant text.');
  }

  const sufficient = evidenceCount >= minimumEvidenceCount &&
    relevantEvidenceCount >= minimumEvidenceCount &&
    queryTermCoverage >= 0.5;

  return {
    status: evidenceCount === 0
      ? 'no_evidence'
      : sufficient ? 'candidate_evidence_found' : 'insufficient_candidate_evidence',
    evidenceCount,
    relevantEvidenceCount,
    academicRecordCount: papers.length,
    webContentCount: webSources.filter((source) => Boolean(source.content)).length,
    queryTermCoverage,
    matchedQueryTerms: matchedTerms,
    authoritySignals,
    minimumEvidenceCount,
    expansionReasons,
    verificationRequired: true,
    contradictionAssessment: 'not_performed'
  };
}

export function buildAdaptiveExpansionQuery(
  query: string,
  fieldOfStudy: string | undefined,
  syllabusText: string | undefined,
  assessment: EvidenceAssessment,
  round: number = 1
): string {
  const coreQueryTerms = tokenizeResearchTerms(query).slice(0, 6);
  const contextTerms = tokenizeResearchTerms(
    [query, fieldOfStudy || '', syllabusText || ''].join(' ')
  );
  const matched = new Set(assessment.matchedQueryTerms);
  const missingTerms = contextTerms.filter((term) => !matched.has(term));
  const offset = Math.max(0, (round - 1) * 4);
  const additions = missingTerms.slice(offset, offset + 6);
  const baseAnchor = coreQueryTerms.length > 0 ? coreQueryTerms.join(' ') : query.trim();
  const expanded = [baseAnchor, fieldOfStudy || '', additions.join(' ')].filter(Boolean).join(' ').trim();
  return expanded.slice(0, 390);
}

/**
 * Builds a concise, high-recall scholarly query for OpenAlex, Semantic Scholar, and arXiv
 * during adaptive expansion passes. Scholarly APIs perform best with 3–8 focused domain terms
 * targeting the core subject plus uncovered syllabus concepts.
 */
export function buildFocusedScholarlyExpansionQuery(
  query: string,
  fieldOfStudy: string | undefined,
  syllabusText: string | undefined,
  assessment: EvidenceAssessment,
  round: number = 1
): string {
  const coreTerms = tokenizeResearchTerms(query).slice(0, 4);
  const fieldTerms = tokenizeResearchTerms(fieldOfStudy || '').slice(0, 2);
  const syllabusTerms = tokenizeResearchTerms(syllabusText || '');
  const allCandidateTerms = [...new Set([...coreTerms, ...fieldTerms, ...syllabusTerms])];
  const matched = new Set(assessment.matchedQueryTerms);
  const missingTerms = allCandidateTerms.filter((term) => !matched.has(term));

  const windowSize = 4;
  const offset = Math.max(0, (round - 1) * windowSize);
  const roundMissing = missingTerms.slice(offset, offset + windowSize);

  const combined = roundMissing.length > 0
    ? [...new Set([...coreTerms.slice(0, 3), ...roundMissing])]
    : round >= 2 && coreTerms.length > 2
      ? [...new Set([...coreTerms.slice(0, 2), ...fieldTerms])]
      : [...new Set([...coreTerms, ...fieldTerms])];

  const finalQuery = combined.slice(0, 7).join(' ').trim();
  return (finalQuery || query.trim()).slice(0, 240);
}

