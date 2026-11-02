import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CourseProvenanceSchema,
  InstructionalContentSchema,
  deriveCurriculumParameters
} from '../src/shared/courseSchemas';
import {
  buildDomainBriefPrompt,
  buildLessonPrompt,
  buildModuleQuizPrompt
} from '../server/curriculumEngine';

const practice = (hints: string[]) => ({
  prompt: 'Explain how this principle applies to the stated problem.',
  hints,
  expectedApproach: 'Identify the governing principle and state its assumptions.',
  expectedAnswer: 'The conclusion follows from the stated principle and assumptions.',
  explanation: 'The reasoning is consistent with the supplied lesson material.',
  diagnosticSignals: []
});

const instructionalContent = () => ({
  frameworkVersion: 'understand-explore-apply-verify-master-v1',
  disciplineEngine: 'STEM_MATHEMATICAL',
  learningObjectives: ['Explain the governing principle and apply it correctly.'],
  prerequisites: [],
  conceptIntroduction: 'A clear intuitive introduction to the concept and why it matters.',
  deepExplanation: 'A sufficiently detailed explanation of the mechanisms, relationships, assumptions and boundaries of the concept.',
  formalDevelopment: 'A discipline-appropriate derivation or analytical explanation with explicit assumptions.',
  workedExamples: [{
    title: 'Worked example',
    exampleType: 'numerical',
    problem: 'Determine the requested quantity from the supplied values.',
    reasoningSteps: ['Identify the governing relationship.', 'Substitute values and interpret the result.'],
    solution: 'The solution follows from the governing relationship.',
    verification: 'Check the units and whether the result is physically reasonable.'
  }],
  applications: [],
  applicationRationale: 'No additional application is required for this focused lesson.',
  misconceptions: [],
  misconceptionRationale: 'No additional misconception was identified for this focused test fixture.',
  guidedPractice: [practice(['First, identify the governing principle.'])],
  independentPractice: [practice([])],
  knowledgeChecks: [{
    prompt: 'Explain why the governing principle applies here.',
    responseMode: 'explain',
    expectedReasoning: 'The stated assumptions match the conditions required by the principle.',
    answerOrRubric: 'The explanation identifies the principle and its relevant assumptions.',
    misconceptionSignals: [],
    difficulty: 2
  }, {
    prompt: 'What would change if one assumption were removed?',
    responseMode: 'compare',
    expectedReasoning: 'The conclusion must be reconsidered when a governing assumption changes.',
    answerOrRubric: 'The response identifies the affected relationship.',
    misconceptionSignals: [],
    difficulty: 3
  }],
  mastery: {
    targetLevel: 3,
    criteria: ['Explain the principle and apply it under stated assumptions.'],
    retentionPrompts: ['State the principle from memory and explain its limits.']
  }
});

const domainBrief = {
  primaryDomain: 'Fluid Mechanics',
  subDisciplines: ['Fluid statics', 'Fluid dynamics', 'Hydraulics'],
  pedagogyType: 'STEM_MATHEMATICAL' as const,
  courseLevelFramework: '200 Level university standard',
  canonicalCourseReferences: [],
  foundationalAxioms: ['Physical laws must be applied with their assumptions stated.'],
  coreCourseTopics: [
    'Fluid properties',
    'Pressure',
    'Hydrostatics',
    'Fluid kinematics',
    'Fluid dynamics',
    'Conservation laws'
  ]
};

test('independent practice accepts an empty hint array while guided practice still requires hints', () => {
  assert.equal(InstructionalContentSchema.safeParse(instructionalContent()).success, true);

  const missingGuidedHint = instructionalContent();
  missingGuidedHint.guidedPractice = [practice([])];
  assert.equal(InstructionalContentSchema.safeParse(missingGuidedHint).success, false);

  const hintedIndependentPractice = instructionalContent();
  hintedIndependentPractice.independentPractice = [practice(['This should remain hidden.'])];
  assert.equal(InstructionalContentSchema.safeParse(hintedIndependentPractice).success, false);
});

test('deep-dive depth changes curriculum workload parameters', () => {
  const standard = deriveCurriculumParameters('200 Level', 'First Semester', 3, 'standard');
  const deepDive = deriveCurriculumParameters('200 Level', 'First Semester', 3, 'deep-dive');
  assert.ok(deepDive.minModules > standard.minModules);
  assert.ok(deepDive.maxModules > standard.maxModules);
});

test('domain prompt includes complete supplied source text and retrieved research context', () => {
  const sourceText = 'OFFICIAL SOURCE MATERIAL '.repeat(140);
  const researchContext = 'SCHOLARLY RECORD: A source-attributed paper about fluid statics.';
  const prompt = buildDomainBriefPrompt({
    courseId: 'GET205',
    courseName: 'Fundamentals of Fluid Mechanics',
    courseCode: 'GET205',
    department: 'Materials Science and Engineering',
    level: '200',
    sourceText,
    researchContext
  });
  assert.ok(prompt.includes(sourceText));
  assert.ok(prompt.includes(researchContext));
});

test('course generation can start without a supplied syllabus and does not fabricate evidence', () => {
  const prompt = buildDomainBriefPrompt({
    courseId: 'GET205',
    courseName: 'Fundamentals of Fluid Mechanics',
    courseCode: 'GET205',
    department: 'Materials Science and Engineering',
    level: '200'
  });
  assert.match(prompt, /No retrieved academic evidence was supplied/);
  assert.match(prompt, /Do not invent sources, citations, textbook editions, institutional syllabi/);
});

test('lesson prompt calibrates deep-dive depth and selects relevant complete source excerpts', () => {
  const sourceText = [
    'HYDROSTATIC PRESSURE: Pressure in a fluid at rest varies with depth and depends on fluid density and gravitational acceleration.',
    '',
    'UNRELATED THERMODYNAMICS: A separate paragraph about an unrelated topic.'
  ].join('\n');
  const prompt = buildLessonPrompt(
    'Hydrostatic Pressure',
    'Fluid Statics',
    2,
    domainBrief,
    {
      courseId: 'GET205',
      courseName: 'Fundamentals of Fluid Mechanics',
      department: 'Materials Science and Engineering',
      level: '200',
      depth: 'deep-dive',
      scope: 'DEPARTMENT',
      sourceText
    }
  );
  assert.match(prompt, /ADVANCED \/ ANALYTICAL DEPTH/);
  assert.match(prompt, /workedExamples: at least three distinct discipline-appropriate examples/);
  assert.ok(prompt.includes('HYDROSTATIC PRESSURE'));
  assert.ok(!prompt.includes('UNRELATED THERMODYNAMICS'));
});

test('module quiz prompt uses actual lesson text and refuses missing quiz evidence', () => {
  const prompt = buildModuleQuizPrompt({
    courseName: 'Fundamentals of Fluid Mechanics',
    courseCode: 'GET205',
    moduleTitle: 'Fluid Statics',
    moduleOrder: 2,
    level: '200',
    department: 'Materials Science and Engineering',
    quizTopics: ['Hydrostatic Pressure'],
    lessons: [{
      title: 'Hydrostatic Pressure',
      content: 'Pressure in a static fluid increases with vertical depth under the stated assumptions.'
    }]
  });
  assert.ok(prompt.includes('Hydrostatic Pressure'));
  assert.ok(prompt.includes('the supplied generated lessons'));
  assert.throws(() => buildModuleQuizPrompt({
    courseName: 'Fundamentals of Fluid Mechanics',
    moduleTitle: 'Fluid Statics',
    moduleOrder: 2,
    level: '200',
    department: 'Materials Science and Engineering',
    quizTopics: ['Hydrostatic Pressure'],
    lessons: []
  }), /no complete generated lesson material/);
});

test('course provenance accepts truthful empty references and retains research run metadata', () => {
  const parsed = CourseProvenanceSchema.safeParse({
    sources: [],
    modelVersion: 'provider-recorded-by-job',
    promptVersion: 'uniace-mastery-curriculum-v3.0',
    generatedAt: new Date().toISOString(),
    academicAccuracy: 'not_independently_verified',
    research: {
      status: 'evidence_found',
      runId: 'research-run-001',
      researchDepth: 'adaptive',
      retrievedAt: new Date().toISOString(),
      papersCount: 2,
      webSourcesCount: 1,
      evidenceAssessment: { verificationRequired: true },
      providerBreakdown: {},
      limitations: ['Web discoveries remain unverified.']
    }
  });
  assert.equal(parsed.success, true);
});
