import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CourseProvenanceSchema,
  CourseSkeletonSchema,
  DomainBriefSchema,
  InstructionalContentSchema,
  OutlineCriticRubricSchema,
  StructuredLessonOutputSchema,
  deriveCurriculumParameters
} from '../src/shared/courseSchemas';
import {
  buildDomainBriefPrompt,
  buildCurriculumSkeletonPrompt,
  buildOutlineCriticPrompt,
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
  disciplineEngine: 'Applied Fluid & Continuum Mechanics',
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
  pedagogyType: 'Applied Fluid & Continuum Mechanics',
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

  const legacyAdvancedPrompt = buildLessonPrompt(
    'Hydrostatic Pressure',
    'Fluid Statics',
    2,
    domainBrief,
    {
      courseId: 'GET205',
      courseName: 'Fundamentals of Fluid Mechanics',
      department: 'Materials Science and Engineering',
      level: '200',
      depth: 'advanced',
      scope: 'DEPARTMENT',
      sourceText
    }
  );
  assert.match(legacyAdvancedPrompt, /ADVANCED \/ ANALYTICAL DEPTH/);
  assert.match(legacyAdvancedPrompt, /at least four reasoning checks/);
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
    promptVersion: 'uniace-mastery-curriculum-v4.0',
    generatedAt: new Date().toISOString(),
    sourceStatus: 'research_retrieved_unverified',
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
      limitations: ['Web discoveries remain unverified.'],
      sourceReferences: [{
        recordType: 'scholarly_record',
        provider: 'arxiv',
        title: 'Fluid mechanics research record',
        url: 'https://arxiv.org/abs/2401.00001',
        authors: ['A. Author'],
        year: 2024,
        publicationType: 'preprint',
        verificationStatus: 'unverified'
      }, {
        recordType: 'web_discovery',
        provider: 'tavily',
        title: 'University fluid mechanics page',
        url: 'https://example.edu/fluid-mechanics',
        authorityClass: 'institutional_domain',
        verificationStatus: 'unverified'
      }]
    }
  });
  assert.equal(parsed.success, true);
});


test('course curriculum does not force a history-first module', () => {
  const options = {
    courseId: 'GET205',
    courseName: 'Fundamentals of Fluid Mechanics',
    courseCode: 'GET205',
    department: 'Materials Science and Engineering',
    level: '200',
    semester: 'First Semester',
    creditUnits: 3,
    scope: 'DEPARTMENT'
  };
  const curriculumPrompt = buildCurriculumSkeletonPrompt(domainBrief, options);
  assert.match(curriculumPrompt, /HISTORY IS OPTIONAL, NOT A DEFAULT REQUIREMENT/);
  assert.match(curriculumPrompt, /Do not automatically add a history, origin, evolution, or timeline module/);
  assert.match(curriculumPrompt, /course-specific concepts/);
  assert.doesNotMatch(curriculumPrompt, /Module 1 MUST establish the history/);
  assert.doesNotMatch(curriculumPrompt, /Module 1 Title \(Foundations & Discipline Scope\)/);

  const criticPrompt = buildOutlineCriticPrompt(
    domainBrief,
    {
      modules: [{
        title: 'Fluid Properties',
        lessonTitles: ['Density and Specific Weight', 'Viscosity']
      }]
    } as any,
    options
  );
  assert.match(criticPrompt, /Do not reward a history, scope, taxonomy, or evolution section merely for being present/);
  assert.match(criticPrompt, /unnecessary history module is generic filler/);
});

test('DomainBriefSchema normalizes structured citation objects in canonicalCourseReferences into strings', () => {
  const parsed = DomainBriefSchema.safeParse({
    primaryDomain: 'Electrical Engineering',
    subDisciplines: ['Circuit Analysis', { name: 'Electromagnetism' }],
    pedagogyType: 'Quantitative Circuit & Field Analysis',
    courseLevelFramework: {
      level: '200 Level',
      description: 'Second-year core analytical methods and circuit theorems'
    },
    canonicalCourseReferences: [
      {
        title: 'Fundamentals of Electric Circuits',
        authors: ['Charles K. Alexander', 'Matthew N.O. Sadiku'],
        edition: '7th Edition',
        year: 2021,
        url: 'https://example.edu/circuits'
      },
      'Nilsson & Riedel — Electric Circuits (11th Edition)'
    ],
    foundationalAxioms: [
      { principle: 'Kirchhoff Current Law', description: 'Conservation of electric charge at a node' }
    ],
    coreCourseTopics: [
      'Circuit Variables and Elements',
      'Resistive Circuits and Ohm Law',
      'Nodal and Mesh Analysis',
      'Circuit Theorems (Thevenin and Norton)',
      'Operational Amplifiers',
      'Capacitors, Inductors, and First-Order RL/RC Circuits'
    ]
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.canonicalCourseReferences.length, 2);
    assert.match(parsed.data.canonicalCourseReferences[0], /Fundamentals of Electric Circuits/);
    assert.match(parsed.data.canonicalCourseReferences[0], /Charles K\. Alexander/);
    assert.match(parsed.data.canonicalCourseReferences[0], /https:\/\/example\.edu\/circuits/);
    assert.equal(parsed.data.subDisciplines[1], 'Electromagnetism');
    assert.match(parsed.data.foundationalAxioms[0], /Kirchhoff Current Law/);
  }
});

test('OutlineCriticRubricSchema dynamically normalizes confidenceState synonyms and object reasoning across providers', () => {
  const parsed = OutlineCriticRubricSchema.safeParse({
    isValid: true,
    coverageScore: 92,
    consistencyScore: 95,
    foundationsScore: 90,
    workloadBalanceScore: 91,
    sequencingScore: 94,
    coveredTopics: ['Multivariable Functions', { topic: 'Partial Derivatives' }],
    missingTopics: [],
    sequencingErrors: [],
    genericFillerDetected: false,
    confidenceState: 'HIGH',
    reasoning: {
      summary: 'The proposed syllabus covers all 200-level engineering mathematics foundations.',
      sequencing: 'Logical progression from limits and partial derivatives to ODEs.'
    }
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.confidenceState, 'verified');
    assert.match(parsed.data.reasoning, /200-level engineering mathematics/);
    assert.equal(parsed.data.coveredTopics[1], 'Partial Derivatives');
  }
});

test('StructuredLessonOutputSchema dynamically resolves flattened or snake_case instructionalContent across providers', () => {
  const validProse = [
    '## Fundamental Concepts of Partial Derivatives',
    'In multivariable calculus, a partial derivative of a function of several variables is its derivative with respect to one of those variables, with the others held constant. This mathematical structure is essential across thermodynamics, fluid mechanics, and electromagnetism where state functions depend on multiple independent coordinates.',
    '## Geometric and Analytical Interpretation',
    'Consider a surface defined by $z = f(x, y)$ in three-dimensional Euclidean space. Holding $y = y_0$ fixed restricts our attention to the plane curve formed by the intersection of the surface with the vertical plane $y = y_0$. The slope of the tangent line to this curve at $(x_0, y_0)$ is given by the partial derivative $\\frac{\\partial f}{\\partial x}(x_0, y_0)$.',
    '## Higher-Order Partial Derivatives and Clairaut Theorem',
    'When a function $f(x, y)$ possesses continuous second-order mixed partial derivatives on an open disk, Clairaut theorem guarantees that $\\frac{\\partial^2 f}{\\partial x \\partial y} = \\frac{\\partial^2 f}{\\partial y \\partial x}$. Engineers rely on this symmetry to verify exact differentials in potential field analysis and state equations.'
  ].join('\n\n');

  const flattenedPayload = {
    title: 'Partial Derivatives and Tangent Planes',
    pedagogicalReasoning: { focus: 'Connect geometric tangent slopes to analytical partial differentiation.' },
    content: validProse,
    ...instructionalContent()
  };

  const parsed = StructuredLessonOutputSchema.safeParse(flattenedPayload);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.instructionalContent.frameworkVersion, 'understand-explore-apply-verify-master-v1');
    assert.equal(parsed.data.instructionalContent.workedExamples.length, 1);
    assert.match(parsed.data.pedagogicalReasoning || '', /Connect geometric tangent slopes/);
  }
});

test('prepareProviderMessages preserves full untruncated prompts without mutating caller messages and fails transparently on empty input', async () => {
  const { prepareProviderMessages } = await import('../server/providers');

  const largePrompt = 'Audit the following engineering mathematics syllabus against university standards. '.repeat(200);
  const originalMessages = [{ role: 'user', content: largePrompt }];
  const prepared = prepareProviderMessages(originalMessages, {
    jsonMode: true,
    providerName: 'groq'
  });

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].role, 'user');
  assert.ok(prepared[0].content.startsWith(largePrompt));
  assert.match(prepared[0].content, /valid JSON object/i);
  // Original caller message must never be mutated in-place
  assert.equal(originalMessages[0].content, largePrompt);

  // Empty messages must fail transparently
  assert.throws(
    () => prepareProviderMessages([], { providerName: 'groq' }),
    /Cannot invoke groq with an empty messages array/
  );
});

test('CourseSkeletonSchema dynamically resolves nested courseMetadata, deeply nested pedagogicalReasoning, and dynamic pedagogyType across providers', () => {
  const mistralNestedSkeleton = {
    courseMetadata: {
      courseTitle: 'GET209: Engineering Mathematics I',
      description: 'A comprehensive 200-level engineering mathematics course covering multivariable calculus, ODEs, and linear algebra.',
      pedagogyType: 'Applied Mathematics (Engineering Focus)',
      creditHours: '3 credit units'
    },
    pedagogicalReasoning: {
      rationale: {
        moduleDesign: 'Modules progress from differential and integral calculus of several variables to ordinary differential equations.',
        abetAlignment: 'Aligned with ABET Criterion 3 engineering problem-solving outcomes.'
      }
    },
    learningOutcomes: [
      { outcome: 'Formulate and solve first- and second-order ordinary differential equations.', bloomLevel: 'Apply' },
      { outcome: 'Analyze multivariable functions using partial derivatives and multiple integrals.', bloomLevel: 'Analysis' }
    ],
    modules: [
      {
        title: 'Module 1: Differential Calculus of Functions of Several Variables',
        isFoundationModule: true,
        lessonTitles: [
          { title: 'Limits, Continuity, and Partial Derivatives' },
          'Total Differentials, Chain Rule, and Directional Derivatives'
        ],
        quizTopics: ['Partial Derivatives', 'Directional Derivatives and Gradient'],
        learningOutcomeIds: [0, 1]
      }
    ]
  };

  const parsed = CourseSkeletonSchema.safeParse(mistralNestedSkeleton);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.pedagogyType, 'Applied Mathematics (Engineering Focus)');
    assert.equal(parsed.data.creditHours, 3);
    assert.match(parsed.data.description, /comprehensive 200-level engineering mathematics/);
    assert.match(parsed.data.pedagogicalReasoning, /ABET Criterion 3/);
    assert.equal(parsed.data.learningOutcomes[1].bloomLevel, 'Analyze');
    assert.equal(parsed.data.modules[0].lessonTitles[0], 'Limits, Continuity, and Partial Derivatives');
    assert.deepEqual(parsed.data.modules[0].learningOutcomeIds, ['0', '1']);
  }
});

