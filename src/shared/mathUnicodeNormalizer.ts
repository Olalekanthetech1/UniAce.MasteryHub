/**
 * Centralized Context-Aware Unicode-to-LaTeX Normalization Engine
 *
 * Implements a robust 5-layer pipeline:
 * 1. Character-level Unicode mathematical detection (subscripts, superscripts, operators, Greek scripts).
 * 2. Strict context-awareness: standard prose, code blocks (``` and ~~~), and inline code (`...`)
 *    remain strictly untouched. Only contents inside mathematical delimiters ($, $$, \(, \]) are normalized.
 * 3. LaTeX text-mode command handling: Splits \text{...}, \textbf{...}, \textrm{...}, etc.,
 *    around mathematical scripts so scripts stay in math mode and words stay in text mode,
 *    preventing KaTeX mode: 'text' syntax errors and missing font-metric warnings.
 * 4. Idempotent and control-word safe LaTeX generation with grouped indices (_{...}, ^{...}).
 * 5. Full observability telemetry and diagnostic failure on unmapped/unsupported Unicode script glyphs.
 */

export interface MathUnicodeNormalizationEvent {
  originalGlyph: string;
  codePoint: string;
  normalizedReplacement: string;
  mode: 'math' | 'text';
  command?: string;
}

export interface UnsupportedMathUnicodeGlyph {
  glyph: string;
  codePoint: string;
}

export interface MathUnicodeInspectionResult {
  normalizedText: string;
  changed: boolean;
  source: string;
  events: MathUnicodeNormalizationEvent[];
  unsupportedCharacters: UnsupportedMathUnicodeGlyph[];
}

export const LATEX_TEXT_MODE_COMMANDS = [
  '\\textnormal',
  '\\textrm',
  '\\textbf',
  '\\textit',
  '\\textsf',
  '\\texttt',
  '\\text',
  '\\mbox',
  '\\hbox'
] as const;

/** Subscript glyph mapping to valid LaTeX script fragments */
export const unicodeSubscriptMap = new Map<string, string>();

/** Superscript glyph mapping to valid LaTeX script fragments */
export const unicodeSuperscriptMap = new Map<string, string>();

/** Math mode operator & symbol normalization map (only converted inside math delimiters) */
export const unicodeMathSymbolMap = new Map<string, string>();

const subscriptDigits = '₀₁₂₃₄₅₆₇₈₉';
const superscriptDigits = '⁰¹²³⁴⁵⁶⁷⁸⁹';

for (let index = 0; index < 10; index += 1) {
  unicodeSubscriptMap.set(subscriptDigits[index], String(index));
  unicodeSuperscriptMap.set(superscriptDigits[index], String(index));
}

// Subscripts: signs, Latin letters, Greek letters
[
  ['₊', '+'], ['₋', '-'], ['₌', '='], ['₍', '('], ['₎', ')'],
  ['ₐ', 'a'], ['ₑ', 'e'], ['ₕ', 'h'], ['ᵢ', 'i'], ['ⱼ', 'j'],
  ['ₖ', 'k'], ['ₗ', 'l'], ['ₘ', 'm'], ['ₙ', 'n'], ['ₒ', 'o'],
  ['ₚ', 'p'], ['ᵣ', 'r'], ['ₛ', 's'], ['ₜ', 't'], ['ᵤ', 'u'],
  ['ᵥ', 'v'], ['ₓ', 'x'],
  ['ᵦ', '\\beta'], ['ᵧ', '\\gamma'], ['ᵨ', '\\rho'], ['ᵩ', '\\phi'], ['ᵪ', '\\chi']
].forEach(([glyph, replacement]) => unicodeSubscriptMap.set(glyph, replacement));

// Superscripts: signs, Latin letters, capital modifiers, Greek letters
[
  ['⁺', '+'], ['⁻', '-'], ['⁼', '='], ['⁽', '('], ['⁾', ')'],
  ['ⁱ', 'i'], ['ⁿ', 'n'], ['ᵃ', 'a'], ['ᵇ', 'b'], ['ᶜ', 'c'],
  ['ᵈ', 'd'], ['ᵉ', 'e'], ['ᶠ', 'f'], ['ᵍ', 'g'], ['ʰ', 'h'],
  ['ʲ', 'j'], ['ᵏ', 'k'], ['ˡ', 'l'], ['ᵐ', 'm'], ['ᵒ', 'o'],
  ['ᵖ', 'p'], ['ʳ', 'r'], ['ˢ', 's'], ['ᵗ', 't'], ['ᵘ', 'u'],
  ['ᵛ', 'v'], ['ʷ', 'w'], ['ˣ', 'x'], ['ʸ', 'y'], ['ᶻ', 'z'],
  ['ᴬ', 'A'], ['ᴮ', 'B'], ['ᴰ', 'D'], ['ᴱ', 'E'], ['ᴳ', 'G'],
  ['ᴴ', 'H'], ['ᴵ', 'I'], ['ᴶ', 'J'], ['ᴷ', 'K'], ['ᴸ', 'L'],
  ['ᴹ', 'M'], ['ᴺ', 'N'], ['ᴼ', 'O'], ['ᴾ', 'P'], ['ᴿ', 'R'],
  ['ᵀ', 'T'], ['ᵁ', 'U'], ['ⱽ', 'V'], ['ᵂ', 'W'],
  ['ᵝ', '\\beta'], ['ᵞ', '\\gamma'], ['ᵟ', '\\delta'], ['ᵠ', '\\phi'], ['ᵡ', '\\chi'], ['ᶿ', '\\theta']
].forEach(([glyph, replacement]) => unicodeSuperscriptMap.set(glyph, replacement));

// Mathematical operator symbols inside math mode only
[
  ['×', '\\times'],
  ['÷', '\\div'],
  ['±', '\\pm'],
  ['∓', '\\mp'],
  ['≤', '\\le'],
  ['≥', '\\ge'],
  ['≠', '\\ne'],
  ['≈', '\\approx'],
  ['≡', '\\equiv'],
  ['∈', '\\in'],
  ['∉', '\\notin'],
  ['⊂', '\\subset'],
  ['⊆', '\\subseteq'],
  ['∪', '\\cup'],
  ['∩', '\\cap'],
  ['∞', '\\infty'],
  ['→', '\\to'],
  ['⇒', '\\implies'],
  ['⇔', '\\iff'],
  ['∂', '\\partial'],
  ['∇', '\\nabla'],
  ['∑', '\\sum'],
  ['∏', '\\prod'],
  ['∫', '\\int'],
  ['∝', '\\propto'],
  ['·', '\\cdot'],
  ['∘', '\\circ']
].forEach(([glyph, replacement]) => unicodeMathSymbolMap.set(glyph, replacement));

export function formatCodePoint(glyph: string): string {
  const cp = glyph.codePointAt(0);
  return cp !== undefined ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : 'U+0000';
}

export function getUnicodeScript(glyph: string): { marker: '_' | '^'; value: string } | undefined {
  const subscript = unicodeSubscriptMap.get(glyph);
  if (subscript !== undefined) return { marker: '_', value: subscript };

  const superscript = unicodeSuperscriptMap.get(glyph);
  if (superscript !== undefined) return { marker: '^', value: superscript };

  return undefined;
}

export function isUnmappedUnicodeScriptCodepoint(glyph: string): boolean {
  if (getUnicodeScript(glyph)) return false;
  const cp = glyph.codePointAt(0);
  if (cp === undefined) return false;
  // Superscripts and Subscripts block (U+2070..U+209F) or Phonetic subscript block (U+1D62..U+1D6A)
  return (cp >= 0x2070 && cp <= 0x209F) || (cp >= 0x1D62 && cp <= 0x1D6A);
}

export function appendScriptPiece(accumulated: string, nextPiece: string): string {
  if (!accumulated) return nextPiece;
  // Separate a LaTeX control word (e.g. \beta) from a following ASCII letter so TeX does not merge them
  if (/\\[a-zA-Z]+$/.test(accumulated) && /^[a-zA-Z]/.test(nextPiece)) {
    return accumulated + ' ' + nextPiece;
  }
  return accumulated + nextPiece;
}

/**
 * Converts consecutive Unicode subscript/superscript runs into grouped LaTeX scripts.
 * In text mode, ordinary text is kept in separate \text*{...} groups around each script.
 */
export function normalizeUnicodeScriptRuns(
  value: string,
  events?: MathUnicodeNormalizationEvent[]
): string {
  let output = '';
  let index = 0;

  while (index < value.length) {
    // Check for math operator symbols inside math mode
    const mathSym = unicodeMathSymbolMap.get(value[index]);
    if (mathSym !== undefined) {
      const symGlyph = value[index];
      const prevHasSpace = output.length === 0 || /\s$/.test(output);
      const nextHasSpace = index + 1 < value.length && /\s/.test(value[index + 1]);
      const prefix = prevHasSpace ? '' : ' ';
      const suffix = nextHasSpace ? '' : ' ';
      output += prefix + mathSym + suffix;
      if (events) {
        events.push({
          originalGlyph: symGlyph,
          codePoint: formatCodePoint(symGlyph),
          normalizedReplacement: mathSym,
          mode: 'math'
        });
      }
      index += 1;
      continue;
    }

    const script = getUnicodeScript(value[index]);
    if (!script) {
      output += value[index];
      index += 1;
      continue;
    }

    const marker = script.marker;
    let scriptValue = '';
    while (index < value.length) {
      const currentGlyph = value[index];
      const nextScript = getUnicodeScript(currentGlyph);
      if (!nextScript || nextScript.marker !== marker) break;
      scriptValue = appendScriptPiece(scriptValue, nextScript.value);
      if (events) {
        events.push({
          originalGlyph: currentGlyph,
          codePoint: formatCodePoint(currentGlyph),
          normalizedReplacement: `${marker}{${nextScript.value}}`,
          mode: 'math'
        });
      }
      index += 1;
    }

    output += marker + '{' + scriptValue + '}';
  }

  return output;
}

/** Converts Unicode scripts inside a \text*{...} argument without nesting text groups. */
export function normalizeTextCommandBody(
  value: string,
  commandName = '\\text',
  events?: MathUnicodeNormalizationEvent[]
): string {
  let output = '';
  let textBuffer = '';
  let index = 0;

  const flushText = () => {
    if (textBuffer.length === 0) return;
    output += commandName + '{' + textBuffer + '}';
    textBuffer = '';
  };

  while (index < value.length) {
    const script = getUnicodeScript(value[index]);
    if (!script) {
      textBuffer += value[index];
      index += 1;
      continue;
    }

    flushText();
    const marker = script.marker;
    let scriptValue = '';
    while (index < value.length) {
      const currentGlyph = value[index];
      const nextScript = getUnicodeScript(currentGlyph);
      if (!nextScript || nextScript.marker !== marker) break;
      scriptValue = appendScriptPiece(scriptValue, nextScript.value);
      if (events) {
        events.push({
          originalGlyph: currentGlyph,
          codePoint: formatCodePoint(currentGlyph),
          normalizedReplacement: `${marker}{${nextScript.value}}`,
          mode: 'text',
          command: commandName
        });
      }
      index += 1;
    }

    output += marker + '{' + scriptValue + '}';
  }

  flushText();
  return output.length === 0 ? commandName + '{}' : output;
}

/** Finds a balanced closing brace while respecting escaped braces. */
export function findMatchingMathBrace(value: string, openingBraceIndex: number): number {
  let depth = 0;

  for (let index = openingBraceIndex; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

export function matchLatexTextCommandAt(
  value: string,
  index: number
): { commandName: string; openingBraceIndex: number } | undefined {
  if (value[index] !== '\\' || (index > 0 && value[index - 1] === '\\')) {
    return undefined;
  }

  for (const commandName of LATEX_TEXT_MODE_COMMANDS) {
    if (!value.startsWith(commandName, index)) continue;
    const afterCommand = index + commandName.length;
    // Ensure we didn't match a prefix of a longer command (e.g. \text vs \textbf)
    if (afterCommand < value.length && /[a-zA-Z]/.test(value[afterCommand])) {
      continue;
    }
    let cursor = afterCommand;
    while (cursor < value.length && (value[cursor] === ' ' || value[cursor] === '\t')) {
      cursor += 1;
    }
    if (value[cursor] === '{') {
      return { commandName, openingBraceIndex: cursor };
    }
  }

  return undefined;
}

/**
 * Normalizes Unicode scripts inside a math expression. \text{...} and related
 * text-mode commands are parsed as balanced groups so chemical/text notation
 * becomes e.g. \text{H}_{2}\text{O}.
 */
export function normalizeMathBody(
  value: string,
  events?: MathUnicodeNormalizationEvent[]
): string {
  if (typeof value !== 'string' || !value) return '';
  let output = '';
  let plainStart = 0;
  let index = 0;

  while (index < value.length) {
    const matchedTextCmd = matchLatexTextCommandAt(value, index);
    if (matchedTextCmd) {
      const closingBraceIndex = findMatchingMathBrace(value, matchedTextCmd.openingBraceIndex);

      if (closingBraceIndex >= 0) {
        output += normalizeUnicodeScriptRuns(value.slice(plainStart, index), events);
        const textBody = value.slice(matchedTextCmd.openingBraceIndex + 1, closingBraceIndex);
        output += normalizeTextCommandBody(textBody, matchedTextCmd.commandName, events);
        index = closingBraceIndex + 1;
        plainStart = index;
        continue;
      }
    }

    index += 1;
  }

  output += normalizeUnicodeScriptRuns(value.slice(plainStart), events);
  return output;
}

/**
 * Checks if a string contains any mathematical Unicode characters (subscripts, superscripts,
 * or mathematical symbols).
 */
export function containsMathUnicode(text: string): boolean {
  if (!text) return false;
  for (const ch of text) {
    if (unicodeSubscriptMap.has(ch) || unicodeSuperscriptMap.has(ch) || unicodeMathSymbolMap.has(ch) || isUnmappedUnicodeScriptCodepoint(ch)) {
      return true;
    }
  }
  return false;
}

/**
 * Detects any unmapped/unsupported Unicode script characters inside math expressions
 * so validation fails transparently rather than silently corrupting or ignoring them.
 */
export function detectUnsupportedMathUnicode(markdownOrMath: string): UnsupportedMathUnicodeGlyph[] {
  if (typeof markdownOrMath !== 'string' || !markdownOrMath) return [];
  const mathBlockPattern = /(\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)(?:\\[\s\S]|[^$\\])*?(?<!\\)\$(?!\$)|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
  const codeSegmentPattern = /(\x60{3}[\s\S]*?\x60{3}|~~~[\s\S]*?~~~|\x60+[^\x60\n]*\x60+)/g;

  const found = new Map<string, UnsupportedMathUnicodeGlyph>();
  const inspectMathSlice = (slice: string) => {
    for (const ch of slice) {
      if (isUnmappedUnicodeScriptCodepoint(ch) && !found.has(ch)) {
        found.set(ch, { glyph: ch, codePoint: formatCodePoint(ch) });
      }
    }
  };

  markdownOrMath.split(codeSegmentPattern).forEach((segment, segmentIndex) => {
    if (segmentIndex % 2 === 1) return;
    let match: RegExpExecArray | null;
    while ((match = mathBlockPattern.exec(segment)) !== null) {
      inspectMathSlice(match[0]);
    }
  });

  return Array.from(found.values());
}

/**
 * Applies Unicode-to-LaTeX normalization strictly within recognized Markdown math delimiters.
 * Code blocks and ordinary prose outside math delimiters are preserved verbatim.
 */
export function normalizeMathUnicodeInMarkdown(
  value: string,
  events?: MathUnicodeNormalizationEvent[]
): string {
  if (typeof value !== 'string' || !value) return '';
  const mathBlockPattern = /(\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)(?:\\[\s\S]|[^$\\])*?(?<!\\)\$(?!\$)|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
  const codeSegmentPattern = /(\x60{3}[\s\S]*?\x60{3}|~~~[\s\S]*?~~~|\x60+[^\x60\n]*\x60+)/g;

  // Code spans/fences are opaque: mathematical-looking text in code is never rewritten.
  return value.split(codeSegmentPattern).map((segment, segmentIndex) => {
    if (segmentIndex % 2 === 1) return segment;

    return segment.replace(mathBlockPattern, (mathBlock) => {
      if (mathBlock.startsWith('$$')) {
        return '$$' + normalizeMathBody(mathBlock.slice(2, -2), events) + '$$';
      }
      if (mathBlock.startsWith('$')) {
        return '$' + normalizeMathBody(mathBlock.slice(1, -1), events) + '$';
      }
      if (mathBlock.startsWith('\\(')) {
        return '\\(' + normalizeMathBody(mathBlock.slice(2, -2), events) + '\\)';
      }
      return '\\[' + normalizeMathBody(mathBlock.slice(2, -2), events) + '\\]';
    });
  }).join('');
}

/**
 * Normalizes Markdown math Unicode and returns a structured telemetry/audit report
 * detailing every character transformation and any unsupported Unicode glyphs.
 */
export function inspectAndNormalizeMathUnicode(
  raw: string,
  source = 'markdown'
): MathUnicodeInspectionResult {
  if (typeof raw !== 'string' || !raw) {
    return {
      normalizedText: '',
      changed: false,
      source,
      events: [],
      unsupportedCharacters: []
    };
  }
  const events: MathUnicodeNormalizationEvent[] = [];
  const normalizedText = normalizeMathUnicodeInMarkdown(raw, events);
  const unsupportedCharacters = detectUnsupportedMathUnicode(normalizedText);

  return {
    normalizedText,
    changed: normalizedText !== raw,
    source,
    events,
    unsupportedCharacters
  };
}

/** Recursively normalizes math-bearing strings in structured generated lesson data. */
export function normalizeNestedMathUnicode(value: unknown): unknown {
  if (typeof value === 'string') return normalizeMathUnicodeInMarkdown(value);
  if (Array.isArray(value)) return value.map((item) => normalizeNestedMathUnicode(item));

  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const normalized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      normalized[key] = normalizeNestedMathUnicode(nestedValue);
    }
    return normalized;
  }

  return value;
}

/**
 * Normalizes Markdown transport formatting and Unicode math notation without
 * changing ordinary prose, code blocks, or formula-specific content.
 */
export function normalizeLessonMarkdownContent(raw: string): string {
  if (typeof raw !== 'string' || !raw) return '';

  let text = raw.replace(/\r\n/g, '\n').replace(/\\"/g, '"').trim();

  // If the entire text is a single line with literal \n escapes, expand them
  if (!text.includes('\n') && text.includes('\\n')) {
    text = text.replace(/\\n/g, '\n');
  }

  // Unwrap an outer Markdown fence only when it encloses the complete response.
  const outerFenceMatch = text.match(/^\x60{3}(?:markdown|md)?\s*\n([\s\S]*?)\n\x60{3}\s*$/i);
  if (outerFenceMatch && outerFenceMatch[1]) {
    text = outerFenceMatch[1].trim();
  }

  return normalizeMathUnicodeInMarkdown(text).trim();
}

