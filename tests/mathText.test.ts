import test from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import { asDisplayMath, normalizeMathDelimiters } from '../src/shared/mathText';

test('normalizes LaTeX inline and display delimiter variants', () => {
  const source = 'Pressure is \\(p = \\rho g h\\).\n\n\\[F = ma\\]';
  const result = normalizeMathDelimiters(source);
  assert.ok(result.includes('$p = \\rho g h$'));
  assert.ok(result.includes('$$\nF = ma\n$$'));
});

test('preserves LaTeX-looking content inside fenced code blocks', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const source = 'Example source:\n' + fence + 'typescript\n\\(x + 1\\)\n' + fence + '\n\nActual: \\(x + 1\\)';
  const result = normalizeMathDelimiters(source);
  assert.ok(result.includes(fence + 'typescript\n\\(x + 1\\)\n' + fence));
  assert.ok(result.includes('$x + 1$'));
});

test('preserves LaTeX-looking content inside inline code', () => {
  const tick = String.fromCharCode(96);
  const result = normalizeMathDelimiters('Use ' + tick + '\\(x^2\\)' + tick + ' as literal source.');
  assert.ok(result.includes(tick + '\\(x^2\\)' + tick));
});

test('wraps raw and already-delimited formulas once for display', () => {
  assert.equal(asDisplayMath('\\frac{F}{A}'), '$$\n\\frac{F}{A}\n$$');
  assert.equal(asDisplayMath('\\[\\frac{F}{A}\\]'), '$$\n\\frac{F}{A}\n$$');
  assert.equal(asDisplayMath(''), '');
});

test('converts explicit math code fences into display equations', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const source = fence + 'latex\n\\frac{F}{A}\n' + fence;
  const result = normalizeMathDelimiters(source);
  assert.ok(result.includes('$$\n\\frac{F}{A}\n$$'));
  assert.equal(result.includes(fence), false);
});

test('KaTeX compiles normalized course equations into rendered math markup', () => {
  const markdown = normalizeMathDelimiters('Hydrostatic pressure: \\(p = \\rho g h\\)\n\n\\[F = ma\\]');
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false, output: 'htmlAndMathml', strict: false }));
  const html = marked.parse(markdown) as string;
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.equal(html.includes('\\rho g h'), false);
});
