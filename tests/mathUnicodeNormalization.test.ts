import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import {
  InstructionalContentSchema,
  normalizeLessonMarkdownContent,
  inspectAndNormalizeMathUnicode,
  detectUnsupportedMathUnicode
} from '../src/shared/courseSchemas.js';
import {
  normalizeMathDelimiters,
  asDisplayMath
} from '../src/shared/mathText.js';
import { validateLessonSyntax } from '../server/curriculumEngine.js';

test('normalizes Unicode scripts in LaTeX text groups and math commands', () => {
  const input = 'Formula: $\\text{H₂O} + \\textbf{CO₂} + \\textrm{SO₄²⁻} + \\log₂(x) = x²$.';
  const actual = normalizeLessonMarkdownContent(input);

  assert.equal(
    actual,
    'Formula: $\\text{H}_{2}\\text{O} + \\textbf{CO}_{2} + \\textrm{SO}_{4}^{2-} + \\log_{2}(x) = x^{2}$.'
  );
});

test('normalizes Greek Unicode subscripts and superscripts with safe LaTeX control-word spacing', () => {
  const actual = normalizeLessonMarkdownContent('$xᵦₐ + yᵝ³ + zᵧ$');
  assert.equal(actual, '$x_{\\beta a} + y^{\\beta3} + z_{\\gamma}$');
});

test('groups consecutive subscripts and superscripts, including signs', () => {
  const actual = normalizeLessonMarkdownContent('$a₀₁ + b⁻² + c⁺$');
  assert.equal(actual, '$a_{01} + b^{-2} + c^{+}$');
});

test('preserves Unicode in prose and code spans/fences', () => {
  const tick = String.fromCharCode(96);
  const fence = tick.repeat(3);
  const input = 'Plain H₂O and x². Code: ' + tick + '$x₂$' + tick + '.\n' +
    fence + 'latex\n$x₂$\n' + fence + '\nMath: $x₂$.';
  const actual = normalizeLessonMarkdownContent(input);

  assert.equal(
    actual,
    'Plain H₂O and x². Code: ' + tick + '$x₂$' + tick + '.\n' +
      fence + 'latex\n$x₂$\n' + fence + '\nMath: $x_{2}$.'
  );
});

test('supports parenthesized and bracketed LaTeX math delimiters and mathText helpers', () => {
  const actual = normalizeLessonMarkdownContent('Inline \\(x₂\\); display \\[y³\\].');
  assert.equal(actual, 'Inline \\(x_{2}\\); display \\[y^{3}\\].');

  const delimited = normalizeMathDelimiters('Rate is \\(\\text{CO₂}\\) and \\[k₂ = x²\\]');
  assert.equal(delimited, 'Rate is $\\text{CO}_{2}$ and \n\n$$\nk_{2} = x^{2}\n$$\n\n');

  const display = asDisplayMath('\\text{H₂O} \\rightleftharpoons \\text{H⁺} + \\text{OH⁻}');
  assert.equal(display, '$$\n\\text{H}_{2}\\text{O} \\rightleftharpoons \\text{H}^{+} + \\text{OH}^{-}\n$$');
});

test('normalization is idempotent', () => {
  const once = normalizeLessonMarkdownContent('$\\text{CO₂} + \\textbf{H₂O} + z⁴$');
  const twice = normalizeLessonMarkdownContent(once);
  assert.equal(twice, once);
});

test('records observability telemetry and detects unsupported mathematical Unicode characters', () => {
  const inspection = inspectAndNormalizeMathUnicode('Consider $\\text{H₂O} + x²$ and $aₔ$.', 'unit-test');
  assert.equal(inspection.normalizedText, 'Consider $\\text{H}_{2}\\text{O} + x^{2}$ and $aₔ$.');
  assert.equal(inspection.changed, true);
  assert.equal(inspection.source, 'unit-test');
  assert.equal(inspection.events.length, 2);
  assert.deepEqual(
    inspection.events.map((e) => ({ glyph: e.originalGlyph, mode: e.mode })),
    [
      { glyph: '₂', mode: 'text' },
      { glyph: '²', mode: 'math' }
    ]
  );
  assert.deepEqual(inspection.unsupportedCharacters, [{ glyph: 'ₔ', codePoint: 'U+2094' }]);
  assert.deepEqual(detectUnsupportedMathUnicode('$aₔ$'), [{ glyph: 'ₔ', codePoint: 'U+2094' }]);
});

test('validateLessonSyntax normalizes valid Unicode math and fails transparently on unsupported Unicode', () => {
  const validLessonBody = [
    '## 1. Chemical Equilibrium Foundations',
    'In aqueous equilibrium systems, reversible reactions govern proton transfer across molecular species such as $\\text{H₂O} + \\textbf{CO₂} \\rightleftharpoons \\text{H₂CO₃}$. The equilibrium constant relates the activities of reactants and products at a given temperature and pressure.',
    '## 2. Thermodynamic Derivation and Logarithmic Form',
    'By relating the standard Gibbs free energy change to the reaction quotient, we obtain the logarithmic relationship $\\log₂(K_c) = xᵦₐ + y²$ across coupled reaction stages in solution.',
    '## 3. Quantitative Verification and Stoichiometry',
    'When evaluating carbonate buffering in physiological and environmental systems, the conservation of mass and charge ensures that $\\textrm{SO₄²⁻}$ and bicarbonate concentrations satisfy strict stoichiometric balance across all compartments.'
  ].join('\n\n');

  const validCheck = validateLessonSyntax(validLessonBody);
  assert.equal(validCheck.isValid, true);
  assert.deepEqual(validCheck.errors, []);
  assert.ok((validCheck.normalizationEvents?.length ?? 0) >= 5);

  const invalidLessonBody = validLessonBody + '\n\nUnsupported subscript schwa in math: $xₔ + 1$.';
  const invalidCheck = validateLessonSyntax(invalidLessonBody);
  assert.equal(invalidCheck.isValid, false);
  assert.ok(invalidCheck.errors.some((e) => e.includes('U+2094')));
});

test('normalizes nested instructional content before schema validation', () => {
  const practice = {
    prompt: 'Calculate the value of the expression.',
    hints: ['Start by identifying the exponent.'],
    expectedApproach: 'Apply the exponent rule carefully.',
    expectedAnswer: '$x_{2}$',
    explanation: 'The subscript is represented using standard LaTeX.',
    diagnosticSignals: []
  };
  const parsed = InstructionalContentSchema.parse({
    frameworkVersion: 'understand-explore-apply-verify-master-v1',
    disciplineEngine: 'STEM_MATHEMATICAL',
    learningObjectives: ['Interpret $x₂$ correctly.'],
    prerequisites: [],
    conceptIntroduction: 'Begin by interpreting the notation $x₂$ in context.',
    deepExplanation: 'A subscript identifies an indexed quantity. The notation $x₂$ is normalized before validation.',
    formalDevelopment: 'Write the indexed quantity as $x_{2}$ in standard mathematical notation.',
    workedExamples: [{
      title: 'Indexed variable',
      exampleType: 'numerical',
      problem: 'Interpret the indexed variable $x₂$.',
      reasoningSteps: ['Identify the base symbol.', 'Read the subscript as the index.'],
      solution: 'The normalized expression is $x_{2}$.',
      verification: 'The expression retains the same index after normalization.'
    }],
    applications: [],
    applicationRationale: 'No additional application is required for this notation check.',
    misconceptions: [],
    misconceptionRationale: 'The example directly checks the notation.',
    guidedPractice: [practice],
    independentPractice: [practice],
    knowledgeChecks: [
      {
        prompt: 'What does the subscript identify?',
        responseMode: 'explain',
        expectedReasoning: 'It identifies the indexed quantity.',
        answerOrRubric: 'Explain the role of the index.',
        misconceptionSignals: [],
        difficulty: 2
      },
      {
        prompt: 'Rewrite the expression in standard LaTeX.',
        responseMode: 'construct',
        expectedReasoning: 'Replace the Unicode subscript with a LaTeX subscript.',
        answerOrRubric: 'The result should use an underscore and grouped index.',
        misconceptionSignals: [],
        difficulty: 2
      }
    ],
    mastery: {
      targetLevel: 3,
      criteria: ['Correctly interpret indexed notation.'],
      retentionPrompts: ['Explain the meaning of a subscript in a variable.']
    }
  });

  assert.equal(parsed.learningObjectives[0], 'Interpret $x_{2}$ correctly.');
  assert.equal(parsed.workedExamples[0].solution, 'The normalized expression is $x_{2}$.');
  assert.equal(parsed.guidedPractice[0].expectedAnswer, '$x_{2}$');
});

test('normalized generated expressions compile with KaTeX without warnings', () => {
  const normalized = normalizeLessonMarkdownContent('$\\text{H₂O} + \\textbf{CO₂} + \\log₂(x) + xᵦ₂ + y²$');
  const expression = normalized.slice(1, -1);

  assert.doesNotThrow(() =>
    katex.renderToString(expression, {
      throwOnError: true,
      strict: (errorCode: string) =>
        errorCode === 'unknownSymbol' || errorCode === 'unicodeTextInMathMode' ? 'error' : 'ignore'
    })
  );
});

