import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import {
  InstructionalContentSchema,
  normalizeLessonMarkdownContent
} from '../src/shared/courseSchemas.js';

test('normalizes Unicode scripts in LaTeX text groups and math commands', () => {
  const input = 'Formula: $\\text{H₂O} + \\log₂(x) = x²$.';
  const actual = normalizeLessonMarkdownContent(input);

  assert.equal(
    actual,
    'Formula: $\\text{H}_{2}\\text{O} + \\log_{2}(x) = x^{2}$.'
  );
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

test('supports parenthesized and bracketed LaTeX math delimiters', () => {
  const actual = normalizeLessonMarkdownContent('Inline \\(x₂\\); display \\[y³\\].');
  assert.equal(actual, 'Inline \\(x_{2}\\); display \\[y^{3}\\].');
});

test('normalization is idempotent', () => {
  const once = normalizeLessonMarkdownContent('$\\text{CO₂} + z⁴$');
  const twice = normalizeLessonMarkdownContent(once);
  assert.equal(twice, once);
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

test('normalized generated expressions compile with KaTeX', () => {
  const normalized = normalizeLessonMarkdownContent('$\\text{H₂O} + \\log₂(x) + y²$');
  const expression = normalized.slice(1, -1);

  assert.doesNotThrow(() => katex.renderToString(expression, { throwOnError: true }));
});
