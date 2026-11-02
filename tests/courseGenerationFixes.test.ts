import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CourseProvenanceSchema,
  InstructionalContentSchema,
  LessonContentBlocksSchema,
  StructuredLessonOutputSchema,
  renderLessonContentBlocksToMarkdown,
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

const typedContentBlocks = () => [
  {
    id: 'explanation-1',
    type: 'explanation' as const,
    title: 'Hydrostatic pressure',
    markdown: 'A fluid at rest develops pressure throughout its volume. The pressure field is related to the weight of the fluid above a point, subject to the assumptions of a static fluid and a consistent gravitational field. The pressure distribution must be interpreted using the fluid density, elevation difference and the reference pressure. '.repeat(4)
  },
  {
    id: 'derivation-1',
    type: 'mathematical_derivation' as const,
    title: 'Hydrostatic pressure relation',
    assumptions: ['The fluid is at rest.', 'Density is constant over the interval considered.'],
    steps: [
      { explanation: 'Consider vertical force equilibrium on a differential fluid element.', equation: 'dP = -rho g dz' },
      { explanation: 'Integrate between the free surface and the point at depth h.', equation: 'P - P_0 = rho g h' }
    ],
    conclusion: 'The gauge pressure increases linearly with depth for a constant-density fluid.'
  },
  {
    id: 'diagram-1',
    type: 'engineering_diagram' as const,
    title: 'Pressure with depth',
    format: 'mermaid' as const,
    source: 'flowchart TD\n  A["Free surface"] --> B["Fluid column"]\n  B --> C["Point at depth"]',
    altText: 'Conceptual diagram showing the free surface, fluid column and a point located below the surface.'
  },
  {
    id: 'example-1',
    type: 'worked_example' as const,
    exampleIndex: 0,
    title: 'Pressure at a stated depth'
  },
  {
    id: 'simulation-1',
    type: 'interactive_simulation' as const,
    title: 'Explore pressure versus depth',
    description: 'Adjust the declared density parameter and observe how the pressure-depth relationship changes.',
    expression: 'rho * 9.81 * x',
    xRange: [0, 5] as [number, number],
    xLabel: 'Depth (m)',
    yLabel: 'Gauge pressure (Pa)',
    parameters: [{ id: 'rho', label: 'Density', unit: 'kg/m^3', min: 500, max: 1500, step: 50, initial: 1000 }]
  },
  {
    id: 'knowledge-check-1',
    type: 'knowledge_check' as const,
    activityIndex: 0
  }
];

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

test('legacy instructional content remains valid when typed content blocks are absent', () => {
  assert.equal(InstructionalContentSchema.safeParse(instructionalContent()).success, true);
});

test('typed content block contract validates all six block variants and compiles Markdown', () => {
  const blocks = typedContentBlocks();
  const parsedBlocks = LessonContentBlocksSchema.safeParse(blocks);
  assert.equal(parsedBlocks.success, true);

  const compiled = renderLessonContentBlocksToMarkdown(blocks, instructionalContent().workedExamples);
  assert.ok(compiled.includes('## Hydrostatic pressure'));
  assert.ok(compiled.includes('$\n'));
  assert.ok(compiled.includes('flowchart TD'));
  assert.ok(compiled.includes('## Explore pressure versus depth'));
  assert.ok(compiled.includes('Complete Check 1'));

  const instructional = {
    ...instructionalContent(),
    contentBlocks: blocks
  };
  assert.equal(InstructionalContentSchema.safeParse(instructional).success, true);

  const generated = StructuredLessonOutputSchema.safeParse({
    title: 'Hydrostatic Pressure',
    pedagogicalReasoning: 'The block sequence proceeds from explanation to formal development, application and retrieval.',
    content: 'This input is replaced by the canonical Markdown adapter.',
    instructionalContent: instructional
  });
  assert.equal(generated.success, true);
  if (generated.success) {
    assert.equal(generated.data.instructionalContent.contentBlocks?.length, 6);
    assert.ok(generated.data.content.includes('flowchart TD'));
    assert.ok(generated.data.content.length >= 800);
  }
});

test('typed simulation blocks reject undeclared identifiers and invalid slider ranges', () => {
  const blocks = typedContentBlocks();
  const simulationIndex = blocks.findIndex((block) => block.type === 'interactive_simulation');
  const simulation = blocks[simulationIndex];
  if (simulation.type !== 'interactive_simulation') throw new Error('Simulation fixture missing');

  const unknownSymbol = blocks.map((block, index) => index === simulationIndex
    ? { ...simulation, expression: 'rho * hiddenValue * x' }
    : block);
  assert.equal(LessonContentBlocksSchema.safeParse(unknownSymbol).success, false);

  const invalidRange = blocks.map((block, index) => index === simulationIndex
    ? { ...simulation, parameters: [{ ...simulation.parameters[0], min: 1500, max: 500 }] }
    : block);
  assert.equal(LessonContentBlocksSchema.safeParse(invalidRange).success, false);
});

test('typed knowledge-check blocks must point to an existing protected activity', () => {
  const invalid = typedContentBlocks().map((block) => block.type === 'knowledge_check'
    ? { ...block, activityIndex: 99 }
    : block);
  assert.equal(LessonContentBlocksSchema.safeParse(invalid).success, true);
  assert.equal(
    InstructionalContentSchema.safeParse({ ...instructionalContent(), contentBlocks: invalid }).success,
    false
  );
});

test('new lesson output cannot omit typed content blocks', () => {
  const generated = StructuredLessonOutputSchema.safeParse({
    title: 'Hydrostatic Pressure',
    content: 'A sufficiently long legacy Markdown lesson. '.repeat(30),
    instructionalContent: instructionalContent()
  });
  assert.equal(generated.success, false);
});

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
  assert.match(prompt, /instructionalContent\.contentBlocks/);
  assert.match(prompt, /interactive_simulation/);
  assert.match(prompt, /knowledge_check/);
  assert.match(prompt, /MUST NOT contain an answer, expected reasoning, rubric, hint or answer key/);
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


test('typed lesson blocks reference the canonical worked-example and protected knowledge-check records', () => {
  const instructional = {
    ...instructionalContent(),
    workedExamples: [{
      title: 'Specific weight from density',
      exampleType: 'numerical' as const,
      problem: 'Determine the specific weight of a fluid from its density.',
      givens: [{ name: 'Density', value: '1000', unit: 'kg/m³' }],
      assumptions: ['Use standard gravitational acceleration for this worked example.'],
      reasoningSteps: [
        'Start with the definition of specific weight as weight per unit volume.',
        'Substitute the density and gravitational acceleration, then check the SI units.'
      ],
      solution: 'The specific weight is 9,810 N/m³ for the stated values.',
      verification: 'The result has units of force per volume and is physically consistent with water.'
    }]
  };
  const contentBlocks = [
    {
      id: 'explanation-1',
      type: 'explanation' as const,
      title: 'Specific weight',
      markdown: 'Specific weight is the weight of a substance per unit volume. '.repeat(18)
    },
    {
      id: 'worked-example-1',
      type: 'worked_example' as const,
      exampleIndex: 0
    },
    {
      id: 'knowledge-check-1',
      type: 'knowledge_check' as const,
      activityIndex: 0
    }
  ];
  const candidate = { ...instructional, contentBlocks };

  assert.equal(InstructionalContentSchema.safeParse(candidate).success, true);
  assert.equal(LessonContentBlocksSchema.safeParse(contentBlocks).success, true);

  const simulationBlock = {
    id: 'simulation-1',
    type: 'interactive_simulation' as const,
    title: 'Hydrostatic pressure model',
    description: 'Explore how fluid density, gravity and depth affect hydrostatic pressure.',
    expression: 'rho * g * x',
    xRange: [0, 10] as [number, number],
    xLabel: 'Depth (m)',
    yLabel: 'Pressure increase (Pa)',
    parameters: [
      { id: 'rho', label: 'Fluid density', unit: 'kg/m³', min: 1, max: 2000, step: 10, initial: 1000 },
      { id: 'g', label: 'Gravitational acceleration', unit: 'm/s²', min: 1, max: 20, step: 0.1, initial: 9.81 }
    ]
  };
  const withValidSimulation = {
    ...candidate,
    contentBlocks: [...contentBlocks, simulationBlock]
  };
  assert.equal(InstructionalContentSchema.safeParse(withValidSimulation).success, true);
  const withInvalidSimulation = {
    ...candidate,
    contentBlocks: [...contentBlocks, { ...simulationBlock, expression: 'unknownVariable * x' }]
  };
  assert.equal(InstructionalContentSchema.safeParse(withInvalidSimulation).success, false);

  const unreferencedWorkedExample = {
    ...candidate,
    workedExamples: [
      ...candidate.workedExamples,
      { ...candidate.workedExamples[0], title: 'A second example not placed in the lesson' }
    ]
  };
  assert.equal(InstructionalContentSchema.safeParse(unreferencedWorkedExample).success, false);

  const unavailableExample = {
    ...candidate,
    contentBlocks: [{ ...contentBlocks[0] }, { ...contentBlocks[1], exampleIndex: 3 }, { ...contentBlocks[2] }]
  };
  assert.equal(InstructionalContentSchema.safeParse(unavailableExample).success, false);

  const unavailableCheck = {
    ...candidate,
    contentBlocks: [{ ...contentBlocks[0] }, { ...contentBlocks[1] }, { ...contentBlocks[2], activityIndex: 8 }]
  };
  assert.equal(InstructionalContentSchema.safeParse(unavailableCheck).success, false);

  const compiled = renderLessonContentBlocksToMarkdown(contentBlocks, instructional.workedExamples);
  assert.match(compiled, /Specific weight is the weight/);
  assert.match(compiled, /9,810 N\/m³/);
  assert.match(compiled, /Complete Check 1/);
});

test('new structured lesson output compiles validated blocks into compatible Markdown', () => {
  const instructional = {
    ...instructionalContent(),
    workedExamples: [{
      title: 'Pressure at depth',
      exampleType: 'numerical' as const,
      problem: 'Determine the pressure increase at a stated depth in a static fluid.',
      givens: [],
      assumptions: ['The fluid is at rest and has constant density.'],
      reasoningSteps: [
        'Apply the hydrostatic pressure relationship.',
        'Substitute the supplied density, gravitational acceleration and depth.'
      ],
      solution: 'The pressure increase is calculated from density multiplied by gravity and depth.',
      verification: 'The units reduce to pascals, which is the SI unit of pressure.'
    }],
    contentBlocks: [
      {
        id: 'explanation-1',
        type: 'explanation' as const,
        title: 'Hydrostatic pressure',
        markdown: 'Hydrostatic pressure is the pressure variation associated with depth in a fluid at rest. '.repeat(20)
      },
      { id: 'worked-example-1', type: 'worked_example' as const, exampleIndex: 0 },
      { id: 'knowledge-check-1', type: 'knowledge_check' as const, activityIndex: 0 }
    ]
  };

  const parsed = StructuredLessonOutputSchema.safeParse({
    title: 'Hydrostatic pressure',
    pedagogicalReasoning: 'The lesson develops the concept, applies its governing relationship and checks understanding.',
    content: 'This legacy field is replaced by the validated block adapter.',
    instructionalContent: instructional
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues));
  assert.ok(parsed.data.content.includes('## Hydrostatic pressure'));
  assert.ok(parsed.data.content.includes('**Verification**'));
  assert.ok(parsed.data.content.length >= 800);
});
