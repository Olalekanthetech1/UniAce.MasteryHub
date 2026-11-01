import type { AcademicPaper, EvidenceAssessment, WebEvidence } from './types.js';

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'among', 'and', 'are', 'based', 'being', 'between',
  'can', 'course', 'for', 'from', 'into', 'its', 'more', 'of', 'on', 'or',
  'over', 'the', 'their', 'this', 'through', 'under', 'using', 'what', 'when',
  'where', 'which', 'with'
]);

export function tokenizeResearchTerms(value: string): string[] {
  const words = value.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return [...new Set(words.filter((word) => !STOP_WORDS.has(word)))];
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
  assessment: EvidenceAssessment
): string {
  const contextTerms = tokenizeResearchTerms(
    [query, fieldOfStudy || '', syllabusText || ''].join(' ')
  );
  const matched = new Set(assessment.matchedQueryTerms);
  const missingTerms = contextTerms.filter((term) => !matched.has(term));
  const additions = missingTerms.slice(0, 6);
  const expanded = [query, fieldOfStudy || '', additions.join(' ')].filter(Boolean).join(' ').trim();
  return expanded.slice(0, 390);
}
