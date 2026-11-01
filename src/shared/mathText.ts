/**
 * Shared math delimiter normalization for generation, lesson display and review.
 * Fenced code and inline code are protected so source examples remain literal.
 */
export function normalizeMathDelimiters(raw: string): string {
  if (typeof raw !== 'string' || !raw) return '';

  const protectedBlocks: string[] = [];
  const fenced = raw.replace(
    /(^|\n)(\x60{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g,
    (match, leading: string, _fence: string, info: string, body: string) => {
      const language = String(info || '').trim().toLowerCase().split(/\s+/)[0];
      if (language === 'math' || language === 'latex') {
        return leading + '\n\n$$\n' + body.trim() + '\n$$\n\n';
      }
      const marker = '\u0000UNIACE_CODE_BLOCK_' + protectedBlocks.length + '\u0000';
      protectedBlocks.push(match);
      return leading + marker;
    }
  );

  const segments = fenced.split(/(\x60[^\n\x60]*\x60)/g);
  const normalized = segments.map((segment, index) => {
    if (index % 2 === 1) return segment;
    return segment
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => '\n\n$$\n' + body.trim() + '\n$$\n\n')
      .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => '$' + body.trim() + '$');
  }).join('');

  return normalized.replace(/\u0000UNIACE_CODE_BLOCK_(\d+)\u0000/g, (_match, index: string) => {
    return protectedBlocks[Number(index)] || '';
  });
}

/** Normalizes raw or already-delimited LaTeX as display math. */
export function asDisplayMath(latex: string): string {
  const expression = typeof latex === 'string' ? latex.trim() : '';
  if (!expression) return '';
  const unwrapped = expression
    .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
    .replace(/^\$([\s\S]*)\$$/, '$1')
    .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
    .replace(/^\\\(([\s\S]*)\\\)$/, '$1')
    .trim();
  return '$$\n' + unwrapped + '\n$$';
}
