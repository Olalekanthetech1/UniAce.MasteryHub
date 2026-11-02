import { normalizeMathBody, normalizeMathUnicodeInMarkdown } from './mathUnicodeNormalizer.js';

/**
 * Shared math delimiter and Unicode script normalization for generation, lesson display and review.
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
        return leading + '\n\n$$\n' + normalizeMathBody(body.trim()) + '\n$$\n\n';
      }
      const marker = '\u0000UNIACE_CODE_BLOCK_' + protectedBlocks.length + '\u0000';
      protectedBlocks.push(match);
      return leading + marker;
    }
  );

  const segments = fenced.split(/(\x60[^\n\x60]*\x60)/g);
  const normalized = segments.map((segment, index) => {
    if (index % 2 === 1) return segment;
    const withStandardDelimiters = segment
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => '\n\n$$\n' + normalizeMathBody(body.trim()) + '\n$$\n\n')
      .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => '$' + normalizeMathBody(body.trim()) + '$');
    return normalizeMathUnicodeInMarkdown(withStandardDelimiters);
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
  return '$$\n' + normalizeMathBody(unwrapped) + '\n$$';
}

const RAW_LATEX_COMMAND_REGEX =
  /\\(?:int|iint|iiint|oint|sum|prod|frac|dfrac|tfrac|sqrt|lim|partial|nabla|infty|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|pm|mp|times|div|cdot|circ|approx|neq|ne|equiv|le|leq|ge|geq|in|notin|subset|subseteq|cup|cap|to|rightarrow|leftarrow|implies|iff|forall|exists|sin|cos|tan|csc|sec|cot|ln|log|exp|vec|hat|bar|dot|ddot|mathbf|mathrm|mathcal|mathbb|left|right)\b|[A-Za-z0-9)\]}]\s*(?:\^\{[^}]+\}|_\{[^}]+\}|\^[A-Za-z0-9]|_[A-Za-z0-9])/;

/**
 * Returns true when a user input string contains either explicit math delimiters
 * ($...$, $$...$$, \(...\), \[...\]) or raw LaTeX mathematical commands/scripts.
 */
export function containsLatexMath(raw: string): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  if (/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/.test(raw)) {
    return true;
  }
  return RAW_LATEX_COMMAND_REGEX.test(raw);
}

/**
 * Ensures bare LaTeX expressions typed or inserted by a student are wrapped in $...$
 * so KaTeX renders them properly in live previews and sent chat bubbles, while leaving
 * already-delimited math ($...$, $$...$$) and plain prose untouched.
 */
export function ensureMathDelimiters(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return raw || '';
  const normalized = normalizeMathDelimiters(raw);

  // If the string already contains explicit $...$ or $$...$$ delimiters, preserve segments
  // inside delimiters and only wrap undelimited segments that contain bare LaTeX commands.
  const parts = normalized.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return parts
    .map((segment, idx) => {
      // Odd indices are already-delimited math segments
      if (idx % 2 === 1) return segment;
      if (!RAW_LATEX_COMMAND_REGEX.test(segment)) return segment;

      // If the entire segment is a mathematical expression (no multi-word plain prose sentence),
      // wrap the whole trimmed segment in $...$
      const trimmed = segment.trim();
      const plainWords = trimmed
        .replace(/\\[A-Za-z]+/g, ' ')
        .replace(/[^A-Za-z\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 2 && !/^(?:sin|cos|tan|log|exp|lim|max|min|det|mod|and|for)$/i.test(w));

      if (plainWords.length <= 1) {
        const leadingSpace = segment.match(/^\s*/)?.[0] || '';
        const trailingSpace = segment.match(/\s*$/)?.[0] || '';
        return `${leadingSpace}$${trimmed}$${trailingSpace}`;
      }

      // Otherwise wrap contiguous LaTeX command/formula spans within prose
      return segment.replace(
        /(?:\\[A-Za-z]+(?:\s*[_^]?\{[^{}]*\}|\s*[_^][A-Za-z0-9]|\s*\\[,;!: ])*|[A-Za-z0-9)\]}]+(?:\^\{[^{}]+\}|_\{[^{}]+\}|\^[A-Za-z0-9]|_[A-Za-z0-9])+)(?:\s*(?:[+\-*/=<>]|\\[A-Za-z]+|\([A-Za-z0-9,+\-*/\s\\^_{}]*\)|[A-Za-z0-9]+(?:\^\{[^{}]+\}|_\{[^{}]+\}|\^[A-Za-z0-9]|_[A-Za-z0-9])*))*/g,
        (match) => {
          const m = match.trim();
          if (!m || !RAW_LATEX_COMMAND_REGEX.test(m)) return match;
          const lead = match.match(/^\s*/)?.[0] || '';
          const trail = match.match(/\s*$/)?.[0] || '';
          return `${lead}$${m}$${trail}`;
        }
      );
    })
    .join('');
}

