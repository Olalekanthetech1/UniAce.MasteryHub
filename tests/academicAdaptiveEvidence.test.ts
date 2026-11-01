import test from 'node:test';
import assert from 'node:assert/strict';
import type { AcademicPaper, WebEvidence } from '../server/academic/types.js';
import {
  assessResearchEvidence,
  buildAdaptiveExpansionQuery,
  tokenizeResearchTerms
} from '../server/academic/adaptiveEvidence.js';

function makePaper(index: number, title: string, abstract: string): AcademicPaper {
  return {
    id: 'test-paper-' + index,
    title,
    authors: [],
    abstract,
    year: null,
    venue: null,
    doi: null,
    url: 'https://example.org/paper/' + index,
    pdfUrl: null,
    citationCount: null,
    source: 'openalex',
    publicationType: 'indexed_record',
    relevanceScore: 0,
    syllabusTags: []
  };
}

function makeWebSource(index: number, title: string, content: string): WebEvidence {
  return {
    id: 'test-web-' + index,
    title,
    url: 'https://example.org/source/' + index,
    domain: 'example.org',
    content,
    score: null,
    source: 'tavily',
    searchDepth: 'basic',
    authorityClass: 'general_web',
    verificationStatus: 'unverified'
  };
}

test('tokenizes unique query terms and excludes connective stop words', () => {
  assert.deepEqual(
    tokenizeResearchTerms('Fluid mechanics and fluid flow under pressure'),
    ['fluid', 'mechanics', 'flow', 'pressure']
  );
});

test('reports no evidence distinctly when provider results are empty', () => {
  const assessment = assessResearchEvidence('fluid mechanics', [], [], 3);
  assert.equal(assessment.status, 'no_evidence');
  assert.equal(assessment.evidenceCount, 0);
  assert.equal(assessment.queryTermCoverage, 0);
  assert.equal(assessment.verificationRequired, true);
  assert.ok(assessment.expansionReasons.length > 0);
});

test('reports candidate evidence only when count and query coverage meet requirements', () => {
  const papers = [
    makePaper(1, 'Fluid mechanics foundations', 'Fluid mechanics studies fluids at rest and in motion.'),
    makePaper(2, 'Fluid flow and pressure', 'Fluid flow describes pressure and velocity fields.'),
    makePaper(3, 'Mechanics of fluids', 'Continuum models describe fluid mechanics and flow.'),
    makePaper(4, 'Pressure in fluid systems', 'Pressure gradients influence fluid flow.'),
    makePaper(5, 'Fluid properties', 'Density and viscosity are important fluid properties.')
  ];
  const assessment = assessResearchEvidence('fluid mechanics pressure', papers, [], 5);
  assert.equal(assessment.status, 'candidate_evidence_found');
  assert.equal(assessment.evidenceCount, 5);
  assert.ok(assessment.queryTermCoverage >= 0.5);
  assert.equal(assessment.verificationRequired, true);
  assert.equal(assessment.contradictionAssessment, 'not_performed');
});

test('unverified web sources are counted as candidate evidence but never upgraded to verified', () => {
  const source = makeWebSource(1, 'Fluid mechanics overview', 'Fluid mechanics describes fluid flow and pressure.');
  const assessment = assessResearchEvidence('fluid mechanics', [], [source], 1);
  assert.equal(assessment.status, 'candidate_evidence_found');
  assert.equal(source.verificationStatus, 'unverified');
  assert.equal(assessment.authoritySignals, 0);
  assert.equal(assessment.verificationRequired, true);
});

test('adaptive query expansion includes original query and stays within its length budget', () => {
  const assessment = assessResearchEvidence('fluid mechanics pressure viscosity', [], [], 5);
  const expanded = buildAdaptiveExpansionQuery(
    'fluid mechanics',
    'Materials Science',
    'pressure viscosity density',
    assessment
  );
  assert.ok(expanded.startsWith('fluid mechanics'));
  assert.ok(expanded.length <= 390);
});
