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
  /\\(?:int|iint|iiint|oint|sum|prod|frac|dfrac|tfrac|sqrt|lim|partial|nabla|infty|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|pm|mp|times|div|cdot|circ|approx|neq|ne|equiv|le|leq|ge|geq|in|notin|subset|subseteq|cup|cap|to|rightarrow|leftarrow|implies|iff|forall|exists|sin|cos|tan|csc|sec|cot|ln|log|exp|vec|hat|bar|dot|ddot|mathbf|mathrm|mathcal|mathbb|text|quad|qquad|left|right|lvert|rvert|lVert|rVert)\b|\\\|[\s\S]*?\\\||\|[A-Za-z0-9\\{}]+\|\s*(?:\^\{[^{}]+\}|_\{[^{}]+\}|\^[A-Za-z0-9]|_[A-Za-z0-9])|[A-Za-z0-9)\]}]\s*(?:\^\{[^}]+\}|_\{[^}]+\}|\^[A-Za-z0-9]|_[A-Za-z0-9])|\b(?:[0-9]*[a-z]{1,2}\s*[+\-]\s*)+[0-9]*[a-z]{1,2}\s*=\s*[+-]?[0-9A-Za-z]+\b|\b[A-Z]\(\s*[a-z](?:_[0-9a-zA-Z]+)?\s*,\s*[a-z](?:_[0-9a-zA-Z]+)?(?:\s*,\s*[a-z](?:_[0-9a-zA-Z]+)?)?\s*\)/;

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
 * Ensures bare LaTeX expressions typed or inserted by a student or stored in structured
 * academic fields are wrapped in $...$ so KaTeX renders them properly, while leaving
 * already-delimited math ($...$, $$...$$), fenced code blocks, inline code, and SVG blocks untouched.
 */
export function ensureMathDelimiters(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return raw || '';

  // Mask fenced code blocks, inline SVG markup, and inline backtick code spans before delimiter wrapping
  const protectedSpans: string[] = [];
  const maskSpan = (match: string): string => {
    const token = `\u0000UNIACE_PROTECTED_SPAN_${protectedSpans.length}\u0000`;
    protectedSpans.push(match);
    return token;
  };

  const maskedInput = raw
    .replace(/(^|\n)(\x60{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g, (m) => maskSpan(m))
    .replace(/<svg[\s\S]*?<\/svg>/gi, (m) => maskSpan(m))
    .replace(/\x60[^\n\x60]+\x60/g, (m) => maskSpan(m));

  const normalized = normalizeMathDelimiters(maskedInput);

  // Preserve segments already inside $...$ or $$...$$ delimiters and only wrap
  // undelimited segments that contain bare LaTeX commands, norms, algebraic equations, or scripts.
  const parts = normalized.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  const processed = parts
    .map((segment, idx) => {
      // Odd indices are already-delimited math segments
      if (idx % 2 === 1) return segment;
      if (!RAW_LATEX_COMMAND_REGEX.test(segment)) return segment;

      // If the entire segment is a mathematical expression (no multi-word plain prose sentence),
      // wrap the whole trimmed segment in $...$
      const trimmed = segment.trim();
      if (!trimmed.includes('\u0000UNIACE_PROTECTED_SPAN_')) {
        const plainWords = trimmed
          .replace(/\\text\s*\{[^{}]*\}/g, ' ')
          .replace(/\\[A-Za-z]+/g, ' ')
          .replace(/[^A-Za-z\s]/g, ' ')
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 2 && !/^(?:sin|cos|tan|csc|sec|cot|log|exp|lim|max|min|det|mod|and|for)$/i.test(w));

        if (plainWords.length <= 1) {
          const leadingSpace = segment.match(/^\s*/)?.[0] || '';
          const trailingSpace = segment.match(/\s*$/)?.[0] || '';
          return `${leadingSpace}$${trimmed}$${trailingSpace}`;
        }
      }

      // First wrap standalone algebraic equations like "ax + by + c = 0" and symbolic point tuples like "P(x, y)"
      let workingSegment = segment
        .replace(
          /\b((?:[0-9]*[a-z]{1,2}\s*[+\-]\s*)+[0-9]*[a-z]{1,2}\s*=\s*[+-]?[0-9A-Za-z]+)\b/g,
          '$$$1$$'
        )
        .replace(
          /\b([A-Z]\(\s*[a-z](?:_[0-9a-zA-Z]+)?\s*,\s*[a-z](?:_[0-9a-zA-Z]+)?(?:\s*,\s*[a-z](?:_[0-9a-zA-Z]+)?)?\s*\))/g,
          '$$$1$$'
        );

      // Next wrap contiguous LaTeX command/formula/norm/exponent spans within prose on remaining undelimited pieces
      const subParts = workingSegment.split(/(\$[^$\n]+?\$)/g);
      const atomicMathToken =
        '(?:\\\\\\|[\\s\\S]+?\\\\\\||\\|[A-Za-z0-9\\\\{}]+\\|(?:\\s*(?:\\^\\{[^{}]+\\}|_\\{[^{}]+\\}|\\^[A-Za-z0-9]|_[A-Za-z0-9]))?|\\\\(?:text|mathbf|mathrm|mathcal|mathbb|vec|hat|bar|sqrt)\\s*\\{[^{}]*\\}(?:\\s*(?:\\^\\{[^{}]+\\}|_\\{[^{}]+\\}|\\^[A-Za-z0-9]|_[A-Za-z0-9]))*|\\\\[A-Za-z]+(?:\\s*[_^]?\\{[^{}]*\\}|\\s*[_^][A-Za-z0-9]|\\s*\\\\[,;!: ])*|[A-Za-z0-9)\\]}]+(?:\\^\\{[^{}]+\\}|_\\{[^{}]+\\}|\\^[A-Za-z0-9]|_[A-Za-z0-9])+)';
      const mathParenGroup =
        '\\((?:\\\\[A-Za-z]+|[0-9]+|[A-Za-z](?![A-Za-z])|[+\\-*/=<>^_{},\\s|])+\\)(?:\\s*(?:\\^\\{[^{}]+\\}|_\\{[^{}]+\\}|\\^[A-Za-z0-9]|_[A-Za-z0-9]))?';
      const compoundMathRegex = new RegExp(
        `${atomicMathToken}(?:\\s*(?:[+\\-*/=<>]|,[\\s]*(?=\\\\[A-Za-z]+|[A-Za-z0-9|\\\\]+\\s*[=<>_^])|\\\\(?:quad|qquad|cdot|times|pm|mp|frac|dfrac|tfrac|sqrt|alpha|beta|gamma|theta|pi|cos|sin|tan)\\b|${mathParenGroup}|${atomicMathToken}|[0-9]+(?:\\.[0-9]+)?))*`,
        'g'
      );

      return subParts
        .map((sub, sIdx) => {
          if (sIdx % 2 === 1) return sub;
          return sub.replace(compoundMathRegex, (match) => {
            const m = match.trim();
            if (!m || !RAW_LATEX_COMMAND_REGEX.test(m)) return match;
            const lead = match.match(/^\s*/)?.[0] || '';
            const trail = match.match(/\s*$/)?.[0] || '';
            const trailingPunctMatch = m.match(/([.,;:])+$/);
            const cleanMath = trailingPunctMatch ? m.slice(0, -trailingPunctMatch[0].length).trim() : m;
            const trailingPunct = trailingPunctMatch ? trailingPunctMatch[0] : '';
            if (!cleanMath) return match;
            return `${lead}$${cleanMath}$${trailingPunct}${trail}`;
          });
        })
        .join('');
    })
    .join('');

  return processed.replace(/\u0000UNIACE_PROTECTED_SPAN_(\d+)\u0000/g, (_m, idxStr: string) => {
    return protectedSpans[Number(idxStr)] || '';
  });
}



