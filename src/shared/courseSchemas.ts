import { z } from 'zod';

/**
 * UniAce Shared Course Schema & Pedagogical Architecture
 * Strict Zero-Fallback Policy: Unified contract across server & client
 */

export const BloomLevelEnum = z.enum(['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create']);
export type BloomLevel = z.infer<typeof BloomLevelEnum>;

export const LearningOutcomeSchema = z.object({
  outcome: z.string().min(1, 'Outcome text cannot be empty'),
  bloomLevel: BloomLevelEnum
});
export type LearningOutcome = z.infer<typeof LearningOutcomeSchema>;

export const DisciplinePedagogyTypeEnum = z.enum([
  'STEM_MATHEMATICAL',
  'HUMANITIES_LAW_ARTS',
  'SOCIAL_SCIENCES_BUSINESS',
  'BIOMEDICAL_LIFE_SCIENCES',
  'GENERAL_FOUNDATIONS'
]);
export type DisciplinePedagogyType = z.infer<typeof DisciplinePedagogyTypeEnum>;

export const DomainBriefSchema = z.object({
  primaryDomain: z.string().min(1),
  subDisciplines: z.array(z.string()).min(1),
  pedagogyType: DisciplinePedagogyTypeEnum,
  courseLevelFramework: z.string().min(1),
  canonicalCourseReferences: z.array(z.string()),
  foundationalAxioms: z.array(z.string()).min(1),
  coreCourseTopics: z.array(z.string()).min(6)
});
export type DomainBrief = z.infer<typeof DomainBriefSchema>;

export const CourseLessonOutlineSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  learningOutcomeIds: z.array(z.string()).optional(),
  coreConcepts: z.array(z.string()).optional()
});
export type CourseLessonOutline = z.infer<typeof CourseLessonOutlineSchema>;

export const CourseModuleOutlineSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  order: z.number().int().optional(),
  isFoundationModule: z.boolean(),
  topics: z.array(z.string()).optional(),
  lessonTitles: z.array(z.string()).optional(),
  lessons: z.array(z.union([z.string(), CourseLessonOutlineSchema])).optional(),
  quizTopics: z.array(z.string().min(1)).min(1),
  learningOutcomeIds: z.array(z.string().min(1)).min(1)
});
export type CourseModuleOutline = z.infer<typeof CourseModuleOutlineSchema>;

export const CourseSkeletonSchema = z.object({
  pedagogicalReasoning: z.string().trim().min(1),
  description: z.string().trim().min(1),
  pedagogyType: DisciplinePedagogyTypeEnum,
  creditHours: z.number().int().min(1).max(12),
  learningOutcomes: z.array(z.union([z.string().trim().min(1), LearningOutcomeSchema])).min(1),
  modules: z.array(CourseModuleOutlineSchema).min(1)
});
export type CourseSkeleton = z.infer<typeof CourseSkeletonSchema>;

export const OutlineCriticRubricSchema = z.object({
  isValid: z.boolean(),
  coverageScore: z.number().min(0).max(100),
  consistencyScore: z.number().min(0).max(100),
  foundationsScore: z.number().min(0).max(100),
  workloadBalanceScore: z.number().min(0).max(100),
  sequencingScore: z.number().min(0).max(100),
  coveredTopics: z.array(z.string()),
  missingTopics: z.array(z.string()),
  sequencingErrors: z.array(z.string()),
  genericFillerDetected: z.boolean(),
  confidenceState: z.enum(['verified', 'needs_review', 'failed']),
  reasoning: z.string()
});
export type OutlineCriticRubric = z.infer<typeof OutlineCriticRubricSchema>;

/**
 * Unicode mathematical glyphs that have direct, semantics-preserving LaTeX script equivalents.
 * The maps are character-level rules, not formula-specific substitutions.
 */
const unicodeSubscriptMap = new Map<string, string>();
const unicodeSuperscriptMap = new Map<string, string>();

const subscriptDigits = '₀₁₂₃₄₅₆₇₈₉';
const superscriptDigits = '⁰¹²³⁴⁵⁶⁷⁸⁹';

for (let index = 0; index < 10; index += 1) {
  unicodeSubscriptMap.set(subscriptDigits[index], String(index));
  unicodeSuperscriptMap.set(superscriptDigits[index], String(index));
}

[
  ['₊', '+'], ['₋', '-'], ['₌', '='], ['₍', '('], ['₎', ')'],
  ['ₐ', 'a'], ['ₑ', 'e'], ['ₕ', 'h'], ['ᵢ', 'i'], ['ⱼ', 'j'],
  ['ₖ', 'k'], ['ₗ', 'l'], ['ₘ', 'm'], ['ₙ', 'n'], ['ₒ', 'o'],
  ['ₚ', 'p'], ['ᵣ', 'r'], ['ₛ', 's'], ['ₜ', 't'], ['ᵤ', 'u'],
  ['ᵥ', 'v'], ['ₓ', 'x'],
  ['ᵦ', '\\beta'], ['ᵧ', '\\gamma'], ['ᵨ', '\\rho'], ['ᵩ', '\\phi'], ['ᵪ', '\\chi']
].forEach(([glyph, replacement]) => unicodeSubscriptMap.set(glyph, replacement));

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

const LATEX_TEXT_MODE_COMMANDS = [
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

function formatCodePoint(glyph: string): string {
  const cp = glyph.codePointAt(0);
  return cp !== undefined ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : 'U+0000';
}

function getUnicodeScript(glyph: string): { marker: '_' | '^'; value: string } | undefined {
  const subscript = unicodeSubscriptMap.get(glyph);
  if (subscript !== undefined) return { marker: '_', value: subscript };

  const superscript = unicodeSuperscriptMap.get(glyph);
  if (superscript !== undefined) return { marker: '^', value: superscript };

  return undefined;
}

function isUnmappedUnicodeScriptCodepoint(glyph: string): boolean {
  if (getUnicodeScript(glyph)) return false;
  const cp = glyph.codePointAt(0);
  if (cp === undefined) return false;
  // Superscripts and Subscripts block (U+2070..U+209F) or Phonetic subscript block (U+1D62..U+1D6A)
  return (cp >= 0x2070 && cp <= 0x209F) || (cp >= 0x1D62 && cp <= 0x1D6A);
}

function appendScriptPiece(accumulated: string, nextPiece: string): string {
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
function normalizeUnicodeScriptRuns(
  value: string,
  events?: MathUnicodeNormalizationEvent[]
): string {
  let output = '';
  let index = 0;

  while (index < value.length) {
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
function normalizeTextCommandBody(
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
function findMatchingMathBrace(value: string, openingBraceIndex: number): number {
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

function matchLatexTextCommandAt(
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

/** Applies Unicode-to-LaTeX normalization only to recognized Markdown math delimiters. */
export function normalizeMathUnicodeInMarkdown(
  value: string,
  events?: MathUnicodeNormalizationEvent[]
): string {
  if (typeof value !== 'string' || !value) return '';
  const mathBlockPattern = /(\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)(?:\\[\s\S]|[^$\\])*?(?<!\\)\$(?!\$)|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
  const codeSegmentPattern = /(\x60{3}[\s\S]*?\x60{3}|~~~[\s\S]*?~~~|\x60+[^\x60\n]*\x60+)/g;

  // Code spans/fences are opaque: mathematical-looking text in code is not rewritten.
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
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.replace(/\r\n/g, '\n').trim();

  // Unwrap an outer Markdown fence only when it encloses the complete response.
  const outerFenceMatch = text.match(/^\x60{3}(?:markdown|md)?\s*\n([\s\S]*?)\n\x60{3}\s*$/i);
  if (outerFenceMatch && outerFenceMatch[1]) {
    text = outerFenceMatch[1].trim();
  }

  return normalizeMathUnicodeInMarkdown(text).trim();
}

/**
 * Checks whether a lesson title is a generic placeholder rather than a real academic topic title.
 */
export function isGenericLessonTitle(title?: string | null): boolean {
  if (!title || typeof title !== 'string') return true;
  const cleaned = title.trim().toLowerCase();
  return (
    cleaned === '' ||
    cleaned === 'lesson' ||
    cleaned === 'untitled' ||
    cleaned === 'untitled lesson' ||
    cleaned === 'topic' ||
    cleaned === 'subtopic'
  );
}

/**
 * Checks whether lesson markdown is a bare diagram/code snippet or mid-sentence truncated fragment instead of a full university lesson.
 */
export function isBareDiagramOrFragment(content: string): boolean {
  if (!content || typeof content !== 'string') return true;
  const trimmed = content.trim();
  if (trimmed.length < 600) return true;

  // Reject if the lesson starts mid-sentence (e.g., lowercase word or leading ellipsis/punctuation from a truncated prefix)
  if (/^(?:\.\.\.|[,;:]|[a-z]{2,}\s)/.test(trimmed)) {
    return true;
  }

  // Reject if the entire content starts with a raw svg or function-plot header without markdown prose
  if (/^(?:svg\s*\n?\s*<svg|function-plot\s*\n|<svg\b)/i.test(trimmed) && !/^#{1,3}\s+/m.test(trimmed)) {
    return true;
  }

  // Strip fenced code blocks and raw <svg> blocks and check remaining academic prose length
  const proseOnly = trimmed
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .trim();

  if (proseOnly.length < 400) {
    return true;
  }

  return false;
}

export const LessonContentSchema = z.preprocess((val: any) => {
  if (typeof val === 'string') {
    const normalized = normalizeLessonMarkdownContent(val);
    const headingMatch = normalized.match(/^#\s+([^\n]+)/m);
    const extractedTitle = headingMatch ? headingMatch[1].trim() : undefined;
    return {
      title: extractedTitle && !isGenericLessonTitle(extractedTitle) ? extractedTitle : undefined,
      content: normalized
    };
  }
  if (val && typeof val === 'object') {
    const cleanTitle = !isGenericLessonTitle(val.title) ? String(val.title).trim() : undefined;

    if (typeof val.content === 'string' && val.content.trim().length > 0) {
      return {
        ...val,
        title: cleanTitle,
        content: normalizeLessonMarkdownContent(val.content)
      };
    }

    const sections: string[] = [];
    if (val.introduction || val.executiveSummary) {
      sections.push(`## Executive Summary\n\n${val.introduction || val.executiveSummary}`);
    }
    if (val.theoreticalFoundations || val.theory) {
      sections.push(`## Theoretical Foundations\n\n${val.theoreticalFoundations || val.theory}`);
    }
    if (val.detailedBreakdown || val.breakdown || val.mechanisms) {
      sections.push(`## Detailed Breakdown\n\n${val.detailedBreakdown || val.breakdown || val.mechanisms}`);
    }
    if (val.caseStudy || val.realWorldCaseStudy) {
      sections.push(`## Real-World Case Study\n\n${val.caseStudy || val.realWorldCaseStudy}`);
    }
    if (val.keyTakeaways || val.takeaways) {
      sections.push(`## Key Takeaways\n\n${val.keyTakeaways || val.takeaways}`);
    }
    if (val.practiceDiscussion || val.discussionPrompt) {
      sections.push(`## Practice Discussion & Exercises\n\n${val.practiceDiscussion || val.discussionPrompt}`);
    }
    if (Array.isArray(val.sections)) {
      for (const s of val.sections) {
        if (typeof s === 'string') sections.push(s);
        else if (s && typeof s === 'object') {
          sections.push(`### ${s.title || s.heading || 'Section'}\n\n${s.content || s.text || s.body || ''}`);
        }
      }
    }
    if (val.body) sections.push(String(val.body));
    if (val.text) sections.push(String(val.text));

    if (sections.length > 0) {
      return {
        ...val,
        title: cleanTitle,
        content: normalizeLessonMarkdownContent(sections.join('\n\n'))
      };
    }
  }
  return val;
}, z.object({
  pedagogicalReasoning: z.string().optional(),
  title: z.string().optional(),
  content: z.string()
    .min(600, 'Lesson content must be comprehensive university-level prose (at least 600 characters).')
    .refine(
      (val) => !isBareDiagramOrFragment(val),
      { message: 'Lesson content cannot be a bare SVG/function-plot diagram snippet without substantive university prose and section headings.' }
    )
}));
export type LessonContent = z.infer<typeof LessonContentSchema>;

/**
 * Structured lesson data for the Universal Mastery Framework.
 * Optional collections can be empty when a component is not appropriate.
 */
export const InstructionalPracticeItemSchema = z.object({
  prompt: z.string().min(10),
  hints: z.array(z.string().min(1)).min(1),
  expectedApproach: z.string().min(10),
  expectedAnswer: z.string().min(1),
  explanation: z.string().min(10),
  diagnosticSignals: z.array(z.string().min(1))
});
export type InstructionalPracticeItem = z.infer<typeof InstructionalPracticeItemSchema>;

export const InstructionalContentSchema = z.preprocess(
  (value: unknown) => normalizeNestedMathUnicode(value),
  z.object({
  frameworkVersion: z.literal('understand-explore-apply-verify-master-v1'),
  disciplineEngine: DisciplinePedagogyTypeEnum,
  learningObjectives: z.array(z.string().min(1)).min(1).max(8),
  prerequisites: z.array(z.object({
    concept: z.string().min(1),
    whyNeeded: z.string().min(10),
    readinessCheck: z.string().min(5)
  })),
  conceptIntroduction: z.string().min(30),
  deepExplanation: z.string().min(80),
  formalDevelopment: z.string().min(40),
  workedExamples: z.array(z.object({
    title: z.string().min(1),
    exampleType: z.enum(['numerical', 'conceptual', 'proof', 'case-analysis', 'experimental', 'design']),
    problem: z.string().min(10),
    reasoningSteps: z.array(z.string().min(5)).min(2),
    solution: z.string().min(10),
    verification: z.string().min(10)
  })).min(1),
  applications: z.array(z.object({
    context: z.string().min(1),
    conceptConnection: z.string().min(10),
    constraintsOrAssumptions: z.string().min(5)
  })),
  applicationRationale: z.string().min(10),
  misconceptions: z.array(z.object({
    misconception: z.string().min(5),
    whyItIsWrong: z.string().min(10),
    correction: z.string().min(10)
  })),
  misconceptionRationale: z.string().min(10),
  guidedPractice: z.array(InstructionalPracticeItemSchema).min(1),
  independentPractice: z.array(InstructionalPracticeItemSchema).min(1),
  knowledgeChecks: z.array(z.object({
    prompt: z.string().min(10),
    responseMode: z.enum(['explain', 'calculate', 'compare', 'interpret', 'construct', 'multiple-choice']),
    expectedReasoning: z.string().min(10),
    answerOrRubric: z.string().min(10),
    misconceptionSignals: z.array(z.string().min(1)),
    difficulty: z.number().int().min(1).max(5),
    learningOutcome: z.string().optional()
  })).min(2),
  mastery: z.object({
    targetLevel: z.number().int().min(1).max(5),
    criteria: z.array(z.string().min(5)).min(1),
    retentionPrompts: z.array(z.string().min(5)).min(1)
  }),
  verification: z.object({
    structureValidation: z.enum(['passed', 'failed']),
    academicAccuracy: z.enum(['not_independently_verified', 'subject_expert_reviewed']),
    calculationValidation: z.enum(['pending_independent_check', 'not_applicable', 'passed', 'failed']),
    subjectExpertReview: z.enum(['not_reviewed', 'reviewed']),
    checkedAt: z.string().datetime(),
    policyVersion: z.string().min(1)
  }).optional()
  })
);
export type InstructionalContent = z.infer<typeof InstructionalContentSchema>;

/**
 * Student API representation: prompts and hints are available up front, while
 * answer keys and diagnostic rubrics are released only after a persisted attempt.
 */
export type StudentPracticePrompt = Omit<
  InstructionalPracticeItem,
  'expectedApproach' | 'expectedAnswer' | 'explanation' | 'diagnosticSignals'
>;
export type StudentKnowledgeCheckPrompt = Omit<
  InstructionalContent['knowledgeChecks'][number],
  'expectedReasoning' | 'answerOrRubric' | 'misconceptionSignals'
>;
export type StudentInstructionalContent = Omit<
  InstructionalContent,
  'guidedPractice' | 'independentPractice' | 'knowledgeChecks'
> & {
  guidedPractice: StudentPracticePrompt[];
  independentPractice: StudentPracticePrompt[];
  knowledgeChecks: StudentKnowledgeCheckPrompt[];
};

export const StructuredLessonOutputSchema = z.preprocess(
  (value: unknown) => normalizeNestedMathUnicode(value),
  z.object({
  pedagogicalReasoning: z.string().optional(),
  title: z.string().min(1),
  content: z.string().min(800).refine((value) => !isBareDiagramOrFragment(value), {
    message: 'Lesson content must include substantive academic prose, not only a diagram or fragment.'
  }),
  instructionalContent: InstructionalContentSchema
  })
);
export type StructuredLessonOutput = z.infer<typeof StructuredLessonOutputSchema>;

export const CourseProvenanceSchema = z.object({
  sources: z.array(z.string().min(1)).min(1),
  modelVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  generatedAt: z.string(),
  groundingScore: z.number().min(0).max(100).optional(),
  sourceStatus: z.enum(['admin_supplied_unverified', 'model_suggested_unverified', 'independently_verified']).optional(),
  academicAccuracy: z.enum(['not_independently_verified', 'subject_expert_reviewed']).optional(),
  rubricAudit: OutlineCriticRubricSchema.optional()
});
export type CourseProvenance = z.infer<typeof CourseProvenanceSchema>;

/**
 * Normalizes any variation of objectives or learning outcomes into a clean LearningOutcome array
 */
export function normalizeLearningOutcomes(raw: any): LearningOutcome[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any) => {
    if (typeof item === 'string') {
      return { outcome: item.trim(), bloomLevel: 'Understand' as BloomLevel };
    }
    if (item && typeof item === 'object') {
      const outcome = item.outcome || item.title || item.description || item.text || '';
      let bloomLevel: BloomLevel = 'Understand';
      if (item.bloomLevel && ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'].includes(item.bloomLevel)) {
        bloomLevel = item.bloomLevel as BloomLevel;
      }
      return { outcome: String(outcome).trim(), bloomLevel };
    }
    return { outcome: String(item).trim(), bloomLevel: 'Understand' as BloomLevel };
  }).filter(o => o.outcome.length > 0);
}

/**
 * Helper to derive curriculum parameters based on level, term, and credits
 */
export function deriveCurriculumParameters(level?: string, semester?: string, creditUnits?: number, depth?: string) {
  if (!creditUnits || !Number.isInteger(creditUnits) || creditUnits < 1 || creditUnits > 12) throw new Error('Verified course credit units are required to derive curriculum parameters.');
  if (!level?.trim()) throw new Error('Verified academic level is required to derive curriculum parameters.');
  const credits = creditUnits;
  let minModules = 6;
  let maxModules = 10;
  let targetLessonsPerModule = 4;

  const normalizedLevel = (level || '').toLowerCase();
  if (normalizedLevel.includes('100') || normalizedLevel.includes('intro') || normalizedLevel.includes('first')) {
    // 100 level: Broad foundational breadth, thorough orientation
    minModules = Math.max(6, Math.min(10, credits * 2));
    maxModules = minModules + 2;
    targetLessonsPerModule = 4;
  } else if (normalizedLevel.includes('400') || normalizedLevel.includes('500') || normalizedLevel.includes('grad') || normalizedLevel.includes('advanced')) {
    // Advanced level: Deep specialized thematic modules
    minModules = Math.max(6, Math.min(12, credits * 2 + 1));
    maxModules = minModules + 2;
    targetLessonsPerModule = 4;
  } else {
    // 200-300 level: Core intermediate progression
    minModules = Math.max(6, Math.min(10, credits * 2));
    maxModules = minModules + 2;
    targetLessonsPerModule = 4;
  }

  if (depth === 'in-depth' || depth === 'advanced') {
    minModules += 1;
    maxModules += 2;
  }

  return {
    credits,
    minModules,
    maxModules,
    targetLessonsPerModule
  };
}

/**
 * Extracts a deterministic numeric sort index for a course module (1, 2, 3, ...).
 */
export function getModuleOrderIndex(mod: any, fallbackIdx: number = 999): number {
  if (!mod || typeof mod !== 'object') return fallbackIdx;
  if (typeof mod.order === 'number' && !isNaN(mod.order) && mod.order > 0) {
    return mod.order;
  }
  const titleStr = String(mod.title || '').trim();
  const titleMatch = titleStr.match(/\bModule\s+(\d+)\b/i) || titleStr.match(/^(\d+)[\.\:\-\)]/);
  if (titleMatch) {
    const parsed = parseInt(titleMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const idStr = String(mod.id || '').trim();
  const idMatch = idStr.match(/^m(\d+)$/i) || idStr.match(/(\d+)$/);
  if (idMatch) {
    const parsed = parseInt(idMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  if (mod.isFoundationModule === true) return 1;
  return fallbackIdx;
}

/**
 * Extracts a deterministic numeric sort index for a lesson / subTopic (1, 2, 3, ...).
 */
export function getLessonOrderIndex(lesson: any, fallbackIdx: number = 999): number {
  if (!lesson || typeof lesson !== 'object') return fallbackIdx;
  if (typeof lesson.order === 'number' && !isNaN(lesson.order) && lesson.order > 0) {
    return lesson.order;
  }
  const idStr = String(lesson.id || '').trim();
  const idMatch = idStr.match(/-l(\d+)$/i) || idStr.match(/^l(\d+)$/i) || idStr.match(/(\d+)$/);
  if (idMatch) {
    const parsed = parseInt(idMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const titleStr = String(lesson.title || '').trim();
  const titleMatch = titleStr.match(/^(?:Lesson|Topic|Unit)\s+(\d+)\b/i) || titleStr.match(/^(\d+)[\.\:\-\)]/);
  if (titleMatch) {
    const parsed = parseInt(titleMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return fallbackIdx;
}

/**
 * Sorts a course syllabus array so modules (1..N) and their subTopics/lessons (1..M)
 * are strictly arranged in ascending pedagogical order.
 */
export function sortCourseSyllabus<T extends Record<string, any>>(syllabus: T[] | undefined | null): T[] {
  if (!Array.isArray(syllabus) || syllabus.length === 0) return [];
  return [...syllabus]
    .map((mod, mIdx) => {
      if (!mod || typeof mod !== 'object') return { mod, sortOrder: mIdx + 1 };
      const sortedSubTopics = Array.isArray(mod.subTopics)
        ? [...mod.subTopics]
            .map((st: any, lIdx: number) => ({ st, lOrder: getLessonOrderIndex(st, lIdx + 1) }))
            .sort((a, b) => a.lOrder - b.lOrder)
            .map(item => item.st)
        : mod.subTopics;
      return {
        mod: { ...mod, subTopics: sortedSubTopics },
        sortOrder: getModuleOrderIndex(mod, mIdx + 1)
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(item => item.mod);
}
