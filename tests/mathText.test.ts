import test from 'node:test';
import assert from 'node:assert/strict';
import { asDisplayMath, normalizeMathDelimiters } from '../src/shared/mathText';

test('normalizes LaTeX inline and display delimiter variants', () => {
  const source = String.raw\`Pressure is \(p = \\rho g h\\).\\n\\n\\[F = ma\\]\`;
  const result = normalizeMathDelimiters(source);
  assert.match(result, /\\$p = \\\\rho g h\\$/);
  assert.match(result, /\\$\\$\\s*F = ma\\s*\\$\\$/);
});

test('preserves LaTeX-looking content inside fenced code blocks', () => {
  const source = String.raw\`Example source:\\n\\\`\\\`\\\`latex\\n\\\\(x + 1\\\\)\\n\\\`\\\`\\\`\\n\\nActual: \\\\(x + 1\\\\)\`;
  const result = normalizeMathDelimiters(source);
  assert.match(result, /\\\`\\\`\\\`latex\\n\\\\\\(x \\+ 1\\\\\\)\\n\\\`\\\`\\\`/);
  assert.match(result, /\\$x \\+ 1\\$/);
});

test('preserves LaTeX-looking content inside inline code', () => {
  const result = normalizeMathDelimiters(String.raw\`Use \\\`\\\\(x^2\\\\)\\\` as literal source.\`);
  assert.match(result, /\\\`\\\\\\(x\\^2\\\\\\)\\\`/);
});

test('wraps raw and already-delimited formulas once for display', () => {
  assert.equal(asDisplayMath(String.raw\`\\\\frac{F}{A}\`), String.raw\`$$\\n\\\\frac{F}{A}\\n$$\`);
  assert.equal(asDisplayMath(String.raw\`\\[\\\\frac{F}{A}\\]\`), String.raw\`$$\\n\\\\frac{F}{A}\\n$$\`);
  assert.equal(asDisplayMath(''), '');
});
