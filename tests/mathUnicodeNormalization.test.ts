import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { normalizeLessonMarkdownContent } from '../src/shared/courseSchemas.js';

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
  const input = 'Plain H₂O and x². Code: \\x60$x₂$\\x60.\n\\x60\\x60\\x60latex\n$x₂$\n\\x60\\x60\\x60\nMath: $x₂$.';
  const actual = normalizeLessonMarkdownContent(input);

  assert.equal(
    actual,
    'Plain H₂O and x². Code: \\x60$x₂$\\x60.\n\\x60\\x60\\x60latex\n$x₂$\n\\x60\\x60\\x60\nMath: $x_{2}$.'
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

test('normalized generated expressions compile with KaTeX', () => {
  const normalized = normalizeLessonMarkdownContent('$\\text{H₂O} + \\log₂(x) + y²$');
  const expression = normalized.slice(1, -1);

  assert.doesNotThrow(() => katex.renderToString(expression, { throwOnError: true }));
});
