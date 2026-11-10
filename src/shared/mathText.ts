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

const BRACED_GROUP_PATTERN = '\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\}';

const KNOWN_LATEX_COMMANDS_PATTERN =
  'int|iint|iiint|oint|sum|prod|frac|dfrac|tfrac|sqrt|lim|partial|nabla|infty|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|pm|mp|times|div|cdot|circ|approx|neq|ne|equiv|le|leq|ge|geq|in|notin|subset|subseteq|cup|cap|to|rightarrow|leftarrow|implies|iff|forall|exists|sin|cos|tan|csc|sec|cot|ln|log|exp|vec|hat|bar|dot|ddot|mathbf|mathrm|mathcal|mathbb|text|quad|qquad|left|right|lvert|rvert|lVert|rVert|binom|choose|overline|underline|tilde|widetilde|widehat';

const DOUBLE_ESCAPED_LATEX_CMD_REGEX = new RegExp(
  `\\\\\\\\(?=(?:${KNOWN_LATEX_COMMANDS_PATTERN})\\b|[|{}])`,
  'g'
);

const RAW_LATEX_COMMAND_REGEX = new RegExp(
  `\\\\(?:${KNOWN_LATEX_COMMANDS_PATTERN})\\b|\\\\\\|[\\s\\S]*?\\\\\\||\\|(?=\\S)(?:\\\\[A-Za-z]+|[A-Za-z0-9_^+\\-*/.,\\s{}()]+?)(?<=\\S)\\|\\s*(?:\\^${BRACED_GROUP_PATTERN}|_${BRACED_GROUP_PATTERN}|\\^[+-]?[A-Za-z0-9]+|_[A-Za-z0-9]{1,4})?|\\b[A-Za-z][0-9]*\\s*(?:\\^${BRACED_GROUP_PATTERN}|_${BRACED_GROUP_PATTERN}|\\^[+-]?[A-Za-z0-9]+|_[A-Za-z0-9]{1,4})\\b|[\\]0-9)}|]\\s*(?:\\^${BRACED_GROUP_PATTERN}|_${BRACED_GROUP_PATTERN}|\\^[+-]?[A-Za-z0-9]+|_[A-Za-z0-9]{1,4})|[\\]A-Za-z0-9)}|]+\\s*(?:\\^${BRACED_GROUP_PATTERN}|_${BRACED_GROUP_PATTERN})|\\b(?:[0-9]*[a-z]{1,2}\\s*[+\\-]\\s*)+[0-9]*[a-z]{1,2}\\s*=\\s*[+-]?[0-9A-Za-z]+\\b|\\b[A-Z](?:_[0-9a-zA-Z]+|_${BRACED_GROUP_PATTERN})?\\(\\s*[a-z](?:_[0-9a-zA-Z]+|_${BRACED_GROUP_PATTERN})?\\s*,\\s*[a-z](?:_[0-9a-zA-Z]+|_${BRACED_GROUP_PATTERN})?(?:\\s*,\\s*[a-z](?:_[0-9a-zA-Z]+|_${BRACED_GROUP_PATTERN})?)?\\s*\\)|(?<!\\\\)\\bsqrt\\s*\\(`
);

/**
 * Converts bare ASCII sqrt(...) calls (outside code blocks) into \sqrt{...} using balanced parenthesis scanning.
 */
function convertBareSqrtToLatex(input: string): string {
  if (!/\bsqrt\s*\(/.test(input)) return input;
  let result = '';
  let i = 0;
  const len = input.length;

  while (i < len) {
    const rest = input.slice(i);
    const match = rest.match(/^(?<!\\)\bsqrt\s*\(/);
    if (match && (i === 0 || !/[A-Za-z0-9_\\]/.test(input[i - 1]))) {
      const openParenIdx = i + match[0].length - 1;
      let depth = 0;
      let closeIdx = -1;
      for (let j = openParenIdx; j < len; j++) {
        if (input[j] === '(') depth++;
        else if (input[j] === ')') {
          depth--;
          if (depth === 0) {
            closeIdx = j;
            break;
          }
        }
      }
      if (closeIdx !== -1) {
        const inner = convertBareSqrtToLatex(input.slice(openParenIdx + 1, closeIdx).trim());
        result += `\\sqrt{${inner}}`;
        i = closeIdx + 1;
        continue;
      }
    }
    result += input[i];
    i++;
  }
  return result;
}

const SCRIPT_SUFFIX_PATTERN = `(?:\\s*(?:\\^${BRACED_GROUP_PATTERN}|_${BRACED_GROUP_PATTERN}|\\^[+-]?[A-Za-z0-9]+|_[A-Za-z0-9]{1,4}))+`;
const ABS_OR_NORM_GROUP_PATTERN = `(?:\\\\\\|[\\s\\S]*?\\\\\\||\\|(?=\\S)(?:\\\\[A-Za-z]+|[A-Za-z0-9_^+\\-*/.,\\s{}()]+?)(?<=\\S)\\|)(?:${SCRIPT_SUFFIX_PATTERN})?`;
const LATEX_CMD_GROUP_PATTERN = `\\\\[A-Za-z]+(?:\\s*\\[[^\\]]*\\])*(?:\\s*[_^]?\\s*${BRACED_GROUP_PATTERN}|\\s*[_^][A-Za-z0-9]|\\s*\\\\[,;!: ])*(?:${SCRIPT_SUFFIX_PATTERN})?`;
const SCRIPTED_ATOM_PATTERN = `(?:(?:\\b[A-Za-z][0-9]*|[0-9]+|[\\])}])(?:${SCRIPT_SUFFIX_PATTERN})|[\\]A-Za-z0-9)}]+(?:\\s*(?:\\^${BRACED_GROUP_PATTERN}|_${BRACED_GROUP_PATTERN}))+)`;
const MATH_PAREN_GROUP_PATTERN = `\\((?:\\\\[A-Za-z]+|\\s*${BRACED_GROUP_PATTERN}|[0-9]+|[A-Za-z](?![A-Za-z])|[+\\-*/=<>^_{},\\s|])+\\)(?:${SCRIPT_SUFFIX_PATTERN})?`;
const ATOMIC_MATH_TOKEN_PATTERN = `(?:${ABS_OR_NORM_GROUP_PATTERN}|${LATEX_CMD_GROUP_PATTERN}|${SCRIPTED_ATOM_PATTERN}|${MATH_PAREN_GROUP_PATTERN})`;
const OPTIONAL_EQUATION_LHS_PATTERN = `(?:(?:\\b[A-Za-z](?:_[A-Za-z0-9]{1,4}|_${BRACED_GROUP_PATTERN})?|\\|[A-Za-z0-9\\\\{}]+\\|)\\s*[=<>]\\s*)?`;

const COMPOUND_MATH_REGEX = new RegExp(
  `${OPTIONAL_EQUATION_LHS_PATTERN}${ATOMIC_MATH_TOKEN_PATTERN}(?:\\s*(?:[+\\-*/=<>]|,[\\s]*(?=\\\\[A-Za-z]+|[A-Za-z0-9|\\\\]+\\s*[=<>_^])|\\\\(?:quad|qquad|cdot|times|div|pm|mp|frac|dfrac|tfrac|sqrt|alpha|beta|gamma|theta|pi|cos|sin|tan|leq|geq|neq|approx|equiv|to|rightarrow|implies|iff)\\b|${ATOMIC_MATH_TOKEN_PATTERN}|[0-9]+(?:\\.[0-9]+)?|\\b[A-Za-z]\\b(?=\\s*(?:[+\\-*/=<>^_)|]|$))))*`,
  'g'
);

function wrapBareMathInSingleLine(line: string): string {
  if (!line || !line.trim()) return line;

  // Preserve Markdown table separator lines verbatim
  if (/^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line)) {
    return line;
  }

  // If the line is a Markdown table row (starts and ends with | and has multiple cells), process each cell
  if (/^\s*\|.*\|\s*$/.test(line) && (line.match(/\s\|\s|^\s*\||\|\s*$/g) || []).length >= 2) {
    return line.replace(/(^\s*\||\|\s*$|\s+\|\s+)/g, '\u0000TABLE_PIPE\u0000$& \u0000TABLE_PIPE\u0000')
      .split('\u0000TABLE_PIPE\u0000')
      .map((chunk) => (/^\s*\|/.test(chunk) ? chunk : wrapBareMathInSingleLine(chunk)))
      .join('')
      .replace(/\| \u0000TABLE_PIPE\u0000/g, '|');
  }

  // Peel off leading Markdown block prefixes (- , * , 1. , ### , > ) or option prefixes (A. , (a) )
  const prefixMatch = line.match(/^((?:\s*(?:(?:[-*+]|\d+[.)]|#{1,6}|>)\s+|(?:[A-Da-d][.)]|\([A-Da-d1-4]\))\s+))*\s*)/);
  const leadingPrefix = prefixMatch ? prefixMatch[0] : '';
  const body = line.slice(leadingPrefix.length);

  if (!body.trim() || !RAW_LATEX_COMMAND_REGEX.test(body)) {
    return line;
  }

  const normalizedBody = convertBareSqrtToLatex(body.replace(DOUBLE_ESCAPED_LATEX_CMD_REGEX, '\\'));
  const trimmed = normalizedBody.trim();

  // Check if the entire line body is a standalone mathematical formula/equation (e.g. a quiz option)
  if (!trimmed.includes('\u0000UNIACE_PROTECTED_SPAN_') && !/\*\*|__/.test(trimmed)) {
    const plainWords = trimmed
      .replace(new RegExp(`\\\\(?:text|mathrm|mathbf|mathcal|mathbb)\\s*${BRACED_GROUP_PATTERN}`, 'g'), ' ')
      .replace(/\\[A-Za-z]+/g, ' ')
      .replace(new RegExp(`(?:_|\\^)(?:${BRACED_GROUP_PATTERN}|[A-Za-z0-9]+)`, 'g'), ' ')
      .replace(/\b[A-Za-z]\b/g, ' ')
      .replace(/[^A-Za-z\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 2 &&
          !/^(?:sin|cos|tan|csc|sec|cot|sinh|cosh|tanh|arcsin|arccos|arctan|log|exp|lim|max|min|sup|inf|det|dim|ker|mod|gcd|lcm|arg|deg|and|for|where)$/i.test(w)
      );

    if (plainWords.length <= 1) {
      const trailingSpace = normalizedBody.match(/\s*$/)?.[0] || '';
      const trailingPunctMatch = trimmed.match(/([.;])$/);
      const cleanFormula = trailingPunctMatch ? trimmed.slice(0, -trailingPunctMatch[0].length).trim() : trimmed;
      const trailingPunct = trailingPunctMatch ? trailingPunctMatch[0] : '';
      return `${leadingPrefix}$${cleanFormula}$${trailingPunct}${trailingSpace}`;
    }
  }

  // Mixed prose + math line: first wrap standalone algebraic equations ("ax + by + c = 0") and point coordinates ("P_1(x_1, y_1)")
  const workingBody = normalizedBody
    .replace(
      /\b((?:[0-9]*[a-z]{1,2}\s*[+\-]\s*)+[0-9]*[a-z]{1,2}\s*=\s*[+-]?[0-9A-Za-z]+)\b/g,
      '$$$1$$'
    )
    .replace(
      new RegExp(
        `\\b([A-Z](?:_[0-9a-zA-Z]+|_${BRACED_GROUP_PATTERN})?\\(\\s*[a-z](?:_[0-9a-zA-Z]+|_${BRACED_GROUP_PATTERN})?\\s*,\\s*[a-z](?:_[0-9a-zA-Z]+|_${BRACED_GROUP_PATTERN})?(?:\\s*,\\s*[a-z](?:_[0-9a-zA-Z]+|_${BRACED_GROUP_PATTERN})?)?\\s*\\))`,
        'g'
      ),
      '$$$1$$'
    );

  const subParts = workingBody.split(/(\$[^$\n]+?\$)/g);
  const wrappedBody = subParts
    .map((sub, sIdx) => {
      if (sIdx % 2 === 1) return sub;
      return sub.replace(COMPOUND_MATH_REGEX, (match) => {
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

  return `${leadingPrefix}${wrappedBody}`;
}

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
 * academic fields (including QuickCheck, Quiz options, Flashcards, and prose) are wrapped in $...$
 * so KaTeX renders them properly, while leaving already-delimited math ($...$, $$...$$),
 * fenced code blocks, inline code, URLs, HTML tags, and SVG blocks untouched.
 */
export function ensureMathDelimiters(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return raw || '';

  // Mask fenced code blocks, inline SVG markup, inline backtick code spans, Markdown links/URLs, and HTML tags
  const protectedSpans: string[] = [];
  const maskSpan = (match: string): string => {
    const token = `\u0000UNIACE_PROTECTED_SPAN_${protectedSpans.length}\u0000`;
    protectedSpans.push(match);
    return token;
  };

  const maskedInput = raw
    .replace(/(^|\n)(\x60{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g, (m, _l, _f, info: string) => {
      const lang = String(info || '').trim().toLowerCase().split(/\s+/)[0];
      if (lang === 'math' || lang === 'latex') return m;
      return maskSpan(m);
    })
    .replace(/<svg[\s\S]*?<\/svg>/gi, (m) => maskSpan(m))
    .replace(/\x60[^\n\x60]+\x60/g, (m) => maskSpan(m))
    .replace(/!?\[[^\]]*\]\([^)\n]+\)/g, (m) => maskSpan(m))
    .replace(/https?:\/\/[^\s)]+/g, (m) => maskSpan(m))
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^>\n]*)?>/g, (m) => maskSpan(m));

  const normalized = normalizeMathDelimiters(maskedInput);

  // Preserve segments already inside $...$ or $$...$$ delimiters (collapsing any surviving \\ inside them)
  // and process undelimited segments line-by-line so inline $...$ never spans across newlines.
  const parts = normalized.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  const processed = parts
    .map((segment, idx) => {
      if (idx % 2 === 1) {
        return segment.replace(DOUBLE_ESCAPED_LATEX_CMD_REGEX, '\\');
      }
      if (!RAW_LATEX_COMMAND_REGEX.test(segment)) return segment;
      return segment
        .split('\n')
        .map((line) => wrapBareMathInSingleLine(line))
        .join('\n');
    })
    .join('');

  return processed.replace(/\u0000UNIACE_PROTECTED_SPAN_(\d+)\u0000/g, (_m, idxStr: string) => {
    return protectedSpans[Number(idxStr)] || '';
  });
}



