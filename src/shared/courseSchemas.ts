import { z } from 'zod';
import {
  AcademicContentBlockCollectionSchema,
  isFoundationalExplanationBlock,
  type AcademicContentBlockCollection
} from './academicContentBlocks.js';

/**
 * UniAce Shared Course Schema & Pedagogical Architecture
 * Strict Zero-Fallback Policy: Unified contract across server & client
 */

export const BloomLevelEnum = z.enum(['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create']);
export type BloomLevel = z.infer<typeof BloomLevelEnum>;

export function normalizeBloomLevel(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const cleaned = raw.trim().toLowerCase();
  if (/^(?:remember|remembering|knowledge|recall|recognize|identify)\b/.test(cleaned)) return 'Remember';
  if (/^(?:understand|understanding|comprehend|comprehension|explain|interpret)\b/.test(cleaned)) return 'Understand';
  if (/^(?:apply|applying|application|implement|execute|solve)\b/.test(cleaned)) return 'Apply';
  if (/^(?:analy[sz]e|analy[sz]ing|analysis|differentiate|examine)\b/.test(cleaned)) return 'Analyze';
  if (/^(?:evaluate|evaluating|evaluation|assess|critique|judge)\b/.test(cleaned)) return 'Evaluate';
  if (/^(?:create|creating|creation|synthesi[sz]e|synthesis|design|construct|formulate)\b/.test(cleaned)) return 'Create';
  return raw.trim();
}

/**
 * Deterministically normalizes either a plain string or a structured object/array
 * returned by any LLM provider into a clean string without fabricating content.
 */
export function normalizeStringOrStructuredEntry(input: unknown): unknown {
  return normalizeStringOrStructuredEntryInternal(input, 0);
}

function normalizeStringOrStructuredEntryInternal(input: unknown, depth: number = 0): unknown {
  if (typeof input === 'string') {
    return input.trim();
  }
  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input);
  }
  if (depth > 6 || !input || typeof input !== 'object') {
    return input;
  }
  if (Array.isArray(input)) {
    const items = input
      .map((item) => normalizeStringOrStructuredEntryInternal(item, depth + 1))
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return items.length > 0 ? items.join('; ') : input;
  }

  const record = input as Record<string, unknown>;
  const asCleanString = (val: unknown): string => {
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) {
      return val
        .map((item) => {
          const resolved = normalizeStringOrStructuredEntryInternal(item, depth + 1);
          return typeof resolved === 'string' ? resolved.trim() : '';
        })
        .filter(Boolean)
        .join(', ');
    }
    if (typeof val === 'object') {
      const resolved = normalizeStringOrStructuredEntryInternal(val, depth + 1);
      return typeof resolved === 'string' ? resolved.trim() : '';
    }
    return '';
  };

  const primary =
    asCleanString(record.citation) ||
    asCleanString(record.reference) ||
    asCleanString(record.title) ||
    asCleanString(record.name) ||
    asCleanString(record.topic) ||
    asCleanString(record.axiom) ||
    asCleanString(record.principle) ||
    asCleanString(record.concept) ||
    asCleanString(record.objective) ||
    asCleanString(record.outcome) ||
    asCleanString(record.step) ||
    asCleanString(record.hint) ||
    asCleanString(record.signal) ||
    asCleanString(record.criterion) ||
    asCleanString(record.prompt) ||
    asCleanString(record.question) ||
    asCleanString(record.option) ||
    asCleanString(record.statement) ||
    asCleanString(record.content) ||
    asCleanString(record.text) ||
    asCleanString(record.value) ||
    asCleanString(record.label);

  const author = asCleanString(record.authors) || asCleanString(record.author);
  const edition = asCleanString(record.edition);
  const year = asCleanString(record.year);
  const source = asCleanString(record.source) || asCleanString(record.publisher) || asCleanString(record.institution);
  const description = asCleanString(record.description) || asCleanString(record.summary) || asCleanString(record.explanation);
  const url = asCleanString(record.url) || asCleanString(record.link) || asCleanString(record.doi);

  const parts: string[] = [];
  if (primary) parts.push(primary);
  if (author && !primary.includes(author)) parts.push(author);
  if (edition && !primary.includes(edition)) parts.push(edition);
  if (year && !primary.includes(year)) parts.push(`(${year})`);
  if (source && !primary.includes(source)) parts.push(source);
  if (description && !primary.includes(description)) parts.push(description);
  if (url && !primary.includes(url)) parts.push(url);

  if (parts.length > 0) {
    return parts.join(' — ');
  }

  const fallbackParts = Object.values(record)
    .map(asCleanString)
    .filter(Boolean);
  if (fallbackParts.length > 0) {
    return fallbackParts.join(' — ');
  }

  return input;
}

/**
 * Dynamically inspects Zod validation issues for any schema and any provider, and
 * resolves in-place any field path where a string was expected by the schema but
 * the model returned a structured object or array.
 */
export function resolveExpectedStringPathsInPayload(
  payload: unknown,
  issues: ReadonlyArray<{ code?: string; expected?: unknown; message?: string; path?: ReadonlyArray<PropertyKey> }>
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  let mutated = false;

  for (const issue of issues) {
    const expectsString =
      issue.expected === 'string' ||
      (typeof issue.message === 'string' && /expected string/i.test(issue.message));
    const path = issue.path;
    if (!expectsString || !Array.isArray(path) || path.length === 0) continue;

    let cursor: any = payload;
    for (let idx = 0; idx < path.length - 1; idx++) {
      const key = path[idx];
      if (cursor == null || typeof cursor !== 'object') {
        cursor = null;
        break;
      }
      cursor = cursor[key as any];
    }
    if (!cursor || typeof cursor !== 'object') continue;

    const leafKey = path[path.length - 1] as any;
    const currentValue = cursor[leafKey];
    if (currentValue && typeof currentValue === 'object') {
      const normalized = normalizeStringOrStructuredEntry(currentValue);
      if (typeof normalized === 'string' && normalized.length > 0) {
        cursor[leafKey] = normalized;
        mutated = true;
      }
    }
  }

  return mutated;
}

export const NormalizedStringSchema = z.preprocess(
  (val) => normalizeStringOrStructuredEntry(val),
  z.string().min(1)
);

/**
 * Dynamic disciplinary pedagogy descriptor resolved at runtime from the course
 * and domain without hardcoded discipline enum buckets.
 */
export const DisciplinePedagogyTypeSchema = NormalizedStringSchema;
export const DisciplinePedagogyTypeEnum = DisciplinePedagogyTypeSchema;
export type DisciplinePedagogyType = z.infer<typeof DisciplinePedagogyTypeSchema>;

export const LearningOutcomeSchema = z.preprocess(
  (val: unknown) => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
    const raw = val as Record<string, unknown>;
    const rawOutcome =
      raw.outcome ??
      raw.description ??
      raw.text ??
      raw.statement ??
      raw.objective ??
      raw.title;
    const rawBloom =
      raw.bloomLevel ??
      raw.bloom_level ??
      raw.bloom ??
      raw.taxonomyLevel ??
      raw.taxonomy_level ??
      raw.level;
    return {
      ...raw,
      outcome: normalizeStringOrStructuredEntry(rawOutcome),
      bloomLevel: normalizeBloomLevel(rawBloom)
    };
  },
  z.object({
    outcome: z.string().min(1, 'Outcome text cannot be empty'),
    bloomLevel: BloomLevelEnum
  })
);
export type LearningOutcome = z.infer<typeof LearningOutcomeSchema>;

function resolveDomainBriefPayload(val: unknown): unknown {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
  let obj = { ...(val as Record<string, any>) };
  if (
    obj.primaryDomain === undefined &&
    obj.primary_domain === undefined &&
    ((obj.domainBrief && typeof obj.domainBrief === 'object' && !Array.isArray(obj.domainBrief)) ||
     (obj.domain_brief && typeof obj.domain_brief === 'object' && !Array.isArray(obj.domain_brief)) ||
     (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)))
  ) {
    const inner = (obj.domainBrief || obj.domain_brief || obj.data) as Record<string, any>;
    obj = { ...obj, ...inner };
  }
  if (obj.primaryDomain === undefined && obj.primary_domain !== undefined) obj.primaryDomain = obj.primary_domain;
  if (obj.subDisciplines === undefined && obj.sub_disciplines !== undefined) obj.subDisciplines = obj.sub_disciplines;
  if (obj.pedagogyType === undefined) {
    obj.pedagogyType = obj.pedagogy_type ?? obj.disciplineEngine ?? obj.discipline_engine ?? obj.primaryDomain;
  }
  if (obj.courseLevelFramework === undefined && obj.course_level_framework !== undefined) {
    obj.courseLevelFramework = obj.course_level_framework;
  }
  if (obj.canonicalCourseReferences === undefined) {
    obj.canonicalCourseReferences = obj.canonical_course_references ?? obj.references ?? [];
  }
  if (obj.foundationalAxioms === undefined) {
    obj.foundationalAxioms = obj.foundational_axioms ?? obj.foundationalPrinciples ?? obj.foundational_principles;
  }
  if (obj.coreCourseTopics === undefined) {
    obj.coreCourseTopics = obj.core_course_topics ?? obj.coreTopics ?? obj.core_topics;
  }
  return obj;
}

export const DomainBriefSchema = z.preprocess(
  resolveDomainBriefPayload,
  z.object({
    primaryDomain: NormalizedStringSchema,
    subDisciplines: z.array(NormalizedStringSchema).min(1),
    pedagogyType: DisciplinePedagogyTypeSchema,
    courseLevelFramework: NormalizedStringSchema,
    canonicalCourseReferences: z.preprocess(
      (val) => {
        if (!Array.isArray(val)) return val;
        return val
          .map((item) => normalizeStringOrStructuredEntry(item))
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      },
      z.array(z.string())
    ),
    foundationalAxioms: z.array(NormalizedStringSchema).min(1),
    coreCourseTopics: z.array(NormalizedStringSchema).min(6)
  })
);
export type DomainBrief = z.infer<typeof DomainBriefSchema>;

export const CourseLessonOutlineSchema = z.object({
  id: z.string().optional(),
  title: NormalizedStringSchema,
  learningOutcomeIds: z.array(z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string())).optional(),
  coreConcepts: z.array(NormalizedStringSchema).optional()
});
export type CourseLessonOutline = z.infer<typeof CourseLessonOutlineSchema>;

function resolveModuleOutlinePayload(val: unknown, index?: number): unknown {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
  const obj = { ...(val as Record<string, any>) };
  if (obj.title === undefined) {
    obj.title = obj.moduleTitle ?? obj.module_title ?? obj.name;
  }
  if (typeof obj.isFoundationModule !== 'boolean') {
    if (typeof obj.is_foundation_module === 'boolean') {
      obj.isFoundationModule = obj.is_foundation_module;
    } else if (typeof obj.order === 'number') {
      obj.isFoundationModule = obj.order === 1;
    } else if (typeof index === 'number') {
      obj.isFoundationModule = index === 0;
    }
  }
  if (obj.lessonTitles === undefined) {
    const rawLessons = obj.lesson_titles ?? obj.lessons ?? obj.topics ?? obj.subTopics ?? obj.sub_topics;
    if (Array.isArray(rawLessons)) {
      obj.lessonTitles = rawLessons.map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return item.title ?? item.lessonTitle ?? item.lesson_title ?? item.topic ?? item.name ?? item;
        }
        return item;
      });
    }
  }
  if (obj.quizTopics === undefined) {
    obj.quizTopics = obj.quiz_topics ?? obj.assessmentTopics ?? obj.assessment_topics ?? obj.keyTopics ?? obj.key_topics;
  }
  if (obj.learningOutcomeIds === undefined) {
    obj.learningOutcomeIds =
      obj.learning_outcome_ids ??
      obj.outcomeIds ??
      obj.outcome_ids ??
      obj.mappedOutcomes ??
      obj.mapped_outcomes;
  }
  if (Array.isArray(obj.learningOutcomeIds)) {
    obj.learningOutcomeIds = obj.learningOutcomeIds.map((id: unknown) =>
      typeof id === 'number' ? String(id) : normalizeStringOrStructuredEntry(id)
    );
  }
  return obj;
}

export const CourseModuleOutlineSchema = z.preprocess(
  (val) => resolveModuleOutlinePayload(val),
  z.object({
    id: z.string().optional(),
    title: NormalizedStringSchema,
    order: z.number().int().optional(),
    isFoundationModule: z.boolean(),
    topics: z.array(NormalizedStringSchema).optional(),
    lessonTitles: z.array(NormalizedStringSchema).optional(),
    lessons: z.array(z.union([z.string(), CourseLessonOutlineSchema])).optional(),
    quizTopics: z.array(NormalizedStringSchema).min(1),
    learningOutcomeIds: z.array(z.string().min(1)).min(1)
  })
);
export type CourseModuleOutline = z.infer<typeof CourseModuleOutlineSchema>;

function resolveCourseSkeletonPayload(val: unknown): unknown {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
  let obj = { ...(val as Record<string, any>) };

  // Unwrap if the entire skeleton was placed inside a single wrapper key
  const wrapperCandidates = [
    obj.courseSkeleton,
    obj.course_skeleton,
    obj.skeleton,
    obj.syllabus,
    obj.curriculum,
    obj.course,
    obj.outline,
    obj.data
  ];
  for (const candidate of wrapperCandidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      obj = { ...(candidate as Record<string, any>), ...obj };
    }
  }

  // Extract metadata fields when nested inside courseMetadata / metadata / courseInfo
  const meta =
    (obj.courseMetadata && typeof obj.courseMetadata === 'object' && !Array.isArray(obj.courseMetadata) ? obj.courseMetadata : null) ||
    (obj.course_metadata && typeof obj.course_metadata === 'object' && !Array.isArray(obj.course_metadata) ? obj.course_metadata : null) ||
    (obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata) ? obj.metadata : null) ||
    (obj.courseInfo && typeof obj.courseInfo === 'object' && !Array.isArray(obj.courseInfo) ? obj.courseInfo : null) ||
    (obj.course_info && typeof obj.course_info === 'object' && !Array.isArray(obj.course_info) ? obj.course_info : null);

  if (obj.description === undefined) {
    obj.description =
      meta?.description ??
      obj.courseDescription ??
      obj.course_description ??
      obj.overview ??
      obj.courseOverview ??
      obj.summary ??
      meta?.overview ??
      meta?.summary;
  }

  if (obj.pedagogyType === undefined) {
    obj.pedagogyType =
      obj.pedagogy_type ??
      meta?.pedagogyType ??
      meta?.pedagogy_type ??
      obj.disciplineEngine ??
      obj.discipline_engine ??
      meta?.discipline ??
      meta?.primaryDomain ??
      obj.primaryDomain;
  }

  if (obj.creditHours === undefined) {
    obj.creditHours =
      obj.credit_hours ??
      obj.creditUnits ??
      obj.credit_units ??
      obj.credits ??
      meta?.creditHours ??
      meta?.credit_hours ??
      meta?.creditUnits ??
      meta?.credit_units ??
      meta?.credits;
  }
  if (typeof obj.creditHours === 'string') {
    const match = obj.creditHours.trim().match(/^(\d+)/);
    if (match) {
      obj.creditHours = Number.parseInt(match[1], 10);
    }
  }

  if (obj.pedagogicalReasoning === undefined) {
    obj.pedagogicalReasoning =
      obj.pedagogical_reasoning ??
      obj.rationale ??
      obj.curriculumRationale ??
      obj.curriculum_rationale ??
      meta?.pedagogicalReasoning ??
      meta?.rationale;
  }

  if (obj.learningOutcomes === undefined) {
    obj.learningOutcomes =
      obj.learning_outcomes ??
      obj.outcomes ??
      obj.courseOutcomes ??
      obj.course_outcomes ??
      meta?.learningOutcomes ??
      meta?.learning_outcomes;
  }

  if (obj.modules === undefined) {
    obj.modules =
      obj.courseModules ??
      obj.course_modules ??
      (Array.isArray(obj.syllabus) ? obj.syllabus : undefined) ??
      obj.units;
  }

  if (Array.isArray(obj.modules)) {
    obj.modules = obj.modules.map((mod: unknown, idx: number) => resolveModuleOutlinePayload(mod, idx));
  }

  return obj;
}

export const CourseSkeletonSchema = z.preprocess(
  resolveCourseSkeletonPayload,
  z.object({
    pedagogicalReasoning: NormalizedStringSchema,
    description: NormalizedStringSchema,
    pedagogyType: DisciplinePedagogyTypeSchema,
    creditHours: z.number().int().min(1).max(12),
    learningOutcomes: z.array(LearningOutcomeSchema).min(1),
    modules: z.array(CourseModuleOutlineSchema).min(1)
  })
);
export type CourseSkeleton = z.infer<typeof CourseSkeletonSchema>;

function resolveCriticConfidenceState(rawPayload: Record<string, any>): unknown {
  const rawState = typeof rawPayload.confidenceState === 'string'
    ? rawPayload.confidenceState.trim().toLowerCase()
    : '';
  if (rawState === 'verified' || rawState === 'needs_review' || rawState === 'failed') {
    return rawState;
  }

  const scores = [
    rawPayload.coverageScore,
    rawPayload.consistencyScore,
    rawPayload.foundationsScore,
    rawPayload.workloadBalanceScore,
    rawPayload.sequencingScore
  ];
  const allScoresValid = scores.every(
    (s) => typeof s === 'number' && Number.isFinite(s) && s >= 0 && s <= 100
  );
  const hasBooleanFlags =
    typeof rawPayload.isValid === 'boolean' &&
    typeof rawPayload.genericFillerDetected === 'boolean';

  // Only compute confidenceState when all verified rubric scores and flags are present in the live output
  if (!allScoresValid || !hasBooleanFlags) {
    return rawPayload.confidenceState;
  }

  if (
    rawPayload.isValid === false ||
    rawPayload.genericFillerDetected === true ||
    scores.some((s: number) => s < 75)
  ) {
    return 'failed';
  }
  if (scores.every((s: number) => s >= 90)) {
    return 'verified';
  }
  return 'needs_review';
}

export const OutlineCriticRubricSchema = z.preprocess(
  (val: unknown) => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
    const obj = { ...(val as Record<string, any>) };
    obj.confidenceState = resolveCriticConfidenceState(obj);
    return obj;
  },
  z.object({
    isValid: z.boolean(),
    coverageScore: z.number().min(0).max(100),
    consistencyScore: z.number().min(0).max(100),
    foundationsScore: z.number().min(0).max(100),
    workloadBalanceScore: z.number().min(0).max(100),
    sequencingScore: z.number().min(0).max(100),
    coveredTopics: z.array(NormalizedStringSchema),
    missingTopics: z.array(NormalizedStringSchema),
    sequencingErrors: z.array(NormalizedStringSchema),
    genericFillerDetected: z.boolean(),
    confidenceState: z.enum(['verified', 'needs_review', 'failed']),
    reasoning: NormalizedStringSchema
  })
);
export type OutlineCriticRubric = z.infer<typeof OutlineCriticRubricSchema>;

import {
  type MathUnicodeNormalizationEvent,
  type UnsupportedMathUnicodeGlyph,
  type MathUnicodeInspectionResult,
  LATEX_TEXT_MODE_COMMANDS,
  unicodeSubscriptMap,
  unicodeSuperscriptMap,
  unicodeMathSymbolMap,
  formatCodePoint,
  getUnicodeScript,
  isUnmappedUnicodeScriptCodepoint,
  appendScriptPiece,
  normalizeUnicodeScriptRuns,
  normalizeTextCommandBody,
  findMatchingMathBrace,
  matchLatexTextCommandAt,
  normalizeMathBody,
  containsMathUnicode,
  detectUnsupportedMathUnicode,
  normalizeMathUnicodeInMarkdown,
  inspectAndNormalizeMathUnicode,
  normalizeNestedMathUnicode,
  normalizeLessonMarkdownContent
} from './mathUnicodeNormalizer.js';

export {
  type MathUnicodeNormalizationEvent,
  type UnsupportedMathUnicodeGlyph,
  type MathUnicodeInspectionResult,
  LATEX_TEXT_MODE_COMMANDS,
  unicodeSubscriptMap,
  unicodeSuperscriptMap,
  unicodeMathSymbolMap,
  formatCodePoint,
  getUnicodeScript,
  isUnmappedUnicodeScriptCodepoint,
  appendScriptPiece,
  normalizeUnicodeScriptRuns,
  normalizeTextCommandBody,
  findMatchingMathBrace,
  matchLatexTextCommandAt,
  normalizeMathBody,
  containsMathUnicode,
  detectUnsupportedMathUnicode,
  normalizeMathUnicodeInMarkdown,
  inspectAndNormalizeMathUnicode,
  normalizeNestedMathUnicode,
  normalizeLessonMarkdownContent
};


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

    const directMarkdown = typeof val.body === 'string' && val.body.trim().length > 0
      ? val.body
      : (typeof val.text === 'string' && val.text.trim().length > 0 ? val.text : null);
    if (directMarkdown) {
      return {
        ...val,
        title: cleanTitle,
        content: normalizeLessonMarkdownContent(directMarkdown)
      };
    }

    if (Array.isArray(val.sections) && val.sections.length > 0) {
      const sections: string[] = [];
      for (const s of val.sections) {
        if (typeof s === 'string' && s.trim().length > 0) {
          sections.push(s.trim());
        } else if (s && typeof s === 'object') {
          const heading = String(s.title || s.heading || '').trim();
          const body = String(s.content || s.text || s.body || '').trim();
          if (heading && body) {
            sections.push(`### ${heading}\n\n${body}`);
          } else if (body) {
            sections.push(body);
          }
        }
      }
      if (sections.length > 0) {
        return {
          ...val,
          title: cleanTitle,
          content: normalizeLessonMarkdownContent(sections.join('\n\n'))
        };
      }
    }
  }
  return val;
}, z.object({
  pedagogicalReasoning: NormalizedStringSchema.optional(),
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
  prompt: NormalizedStringSchema.pipe(z.string().min(5)),
  hints: z.array(NormalizedStringSchema).default([]),
  expectedApproach: NormalizedStringSchema.pipe(z.string().min(5)),
  expectedAnswer: NormalizedStringSchema.pipe(z.string().min(1)),
  explanation: NormalizedStringSchema.pipe(z.string().min(5)),
  diagnosticSignals: z.array(NormalizedStringSchema).default([])
});
export type InstructionalPracticeItem = z.infer<typeof InstructionalPracticeItemSchema>;

function normalizeInstructionalContentKeys(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, any>) };
  if (obj.frameworkVersion === undefined && obj.framework_version !== undefined) obj.frameworkVersion = obj.framework_version;
  if (typeof obj.frameworkVersion !== 'string' || !obj.frameworkVersion.trim()) {
    obj.frameworkVersion = 'understand-explore-apply-verify-master-v1';
  }
  if (obj.disciplineEngine === undefined && obj.discipline_engine !== undefined) obj.disciplineEngine = obj.discipline_engine;
  if (obj.disciplineEngine === undefined && obj.pedagogyType !== undefined) obj.disciplineEngine = obj.pedagogyType;
  if (obj.learningObjectives === undefined && obj.learning_objectives !== undefined) obj.learningObjectives = obj.learning_objectives;
  if (obj.conceptIntroduction === undefined && obj.concept_introduction !== undefined) obj.conceptIntroduction = obj.concept_introduction;
  if (obj.deepExplanation === undefined && obj.deep_explanation !== undefined) obj.deepExplanation = obj.deep_explanation;
  if (obj.formalDevelopment === undefined && obj.formal_development !== undefined) obj.formalDevelopment = obj.formal_development;
  if (obj.workedExamples === undefined && obj.worked_examples !== undefined) obj.workedExamples = obj.worked_examples;
  if (obj.applicationRationale === undefined && obj.application_rationale !== undefined) obj.applicationRationale = obj.application_rationale;
  if (obj.misconceptionRationale === undefined && obj.misconception_rationale !== undefined) obj.misconceptionRationale = obj.misconception_rationale;
  if (obj.guidedPractice === undefined && obj.guided_practice !== undefined) obj.guidedPractice = obj.guided_practice;
  if (obj.independentPractice === undefined && obj.independent_practice !== undefined) obj.independentPractice = obj.independent_practice;
  if (obj.knowledgeChecks === undefined && obj.knowledge_checks !== undefined) obj.knowledgeChecks = obj.knowledge_checks;
  return obj;
}

export const InstructionalContentSchema = z.preprocess(
  (value: unknown) => normalizeNestedMathUnicode(normalizeInstructionalContentKeys(value)),
  z.object({
  frameworkVersion: z.literal('understand-explore-apply-verify-master-v1'),
  disciplineEngine: DisciplinePedagogyTypeSchema,
  learningObjectives: z.array(NormalizedStringSchema).min(1).max(12),
  prerequisites: z.array(z.object({
    concept: NormalizedStringSchema,
    whyNeeded: NormalizedStringSchema.pipe(z.string().min(5)),
    readinessCheck: NormalizedStringSchema.pipe(z.string().min(3))
  })).default([]),
  conceptIntroduction: NormalizedStringSchema.pipe(z.string().min(20)),
  deepExplanation: NormalizedStringSchema.pipe(z.string().min(60)),
  formalDevelopment: NormalizedStringSchema.pipe(z.string().min(30)),
  workedExamples: z.array(z.object({
    title: NormalizedStringSchema,
    exampleType: z.string().trim().min(2).max(80),
    problem: NormalizedStringSchema.pipe(z.string().min(5)),
    reasoningSteps: z.array(z.preprocess(normalizeStringOrStructuredEntry, z.string().trim().min(3))).min(2),
    solution: NormalizedStringSchema,
    verification: NormalizedStringSchema.pipe(z.string().min(3))
  })).min(1),
  applications: z.array(z.object({
    context: NormalizedStringSchema,
    conceptConnection: NormalizedStringSchema.pipe(z.string().min(5)),
    constraintsOrAssumptions: NormalizedStringSchema.pipe(z.string().min(3))
  })).default([]),
  applicationRationale: NormalizedStringSchema.pipe(z.string().min(5)),
  misconceptions: z.array(z.object({
    misconception: NormalizedStringSchema.pipe(z.string().min(3)),
    whyItIsWrong: NormalizedStringSchema.pipe(z.string().min(5)),
    correction: NormalizedStringSchema.pipe(z.string().min(5))
  })).default([]),
  misconceptionRationale: NormalizedStringSchema.pipe(z.string().min(5)),
  guidedPractice: z.array(InstructionalPracticeItemSchema).min(1),
  independentPractice: z.array(InstructionalPracticeItemSchema).min(1),
  knowledgeChecks: z.array(z.object({
    prompt: NormalizedStringSchema.pipe(z.string().min(5)),
    responseMode: z.string().trim().min(2).max(60),
    expectedReasoning: NormalizedStringSchema.pipe(z.string().min(5)),
    answerOrRubric: NormalizedStringSchema.pipe(z.string().min(5)),
    misconceptionSignals: z.array(NormalizedStringSchema).default([]),
    difficulty: z.coerce.number().int().min(1).max(5),
    learningOutcome: NormalizedStringSchema.optional()
  })).min(2),
  mastery: z.object({
    targetLevel: z.coerce.number().int().min(1).max(5),
    criteria: z.array(z.preprocess(normalizeStringOrStructuredEntry, z.string().min(3))).min(1),
    retentionPrompts: z.array(z.preprocess(normalizeStringOrStructuredEntry, z.string().min(3))).min(1)
  }),
  verification: z.object({
    structureValidation: z.enum(['passed', 'failed']),
    academicAccuracy: z.enum(['not_independently_verified', 'subject_expert_reviewed']),
    calculationValidation: z.enum(['pending_independent_check', 'not_applicable', 'passed', 'failed']),
    subjectExpertReview: z.enum(['not_reviewed', 'reviewed']),
    checkedAt: z.string().datetime(),
    policyVersion: z.string().min(1)
  }).optional()
  }).superRefine((value, ctx) => {
    value.guidedPractice.forEach((practice, index) => {
      if (practice.hints.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['guidedPractice', index, 'hints'],
          message: 'Guided practice must contain at least one progressive hint.'
        });
      }
    });
    value.independentPractice.forEach((practice, index) => {
      if (practice.hints.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['independentPractice', index, 'hints'],
          message: 'Independent practice must not reveal hints before the attempt.'
        });
      }
    });
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

const INSTRUCTIONAL_CONTENT_FIELD_NAMES = [
  'frameworkVersion', 'framework_version',
  'disciplineEngine', 'discipline_engine',
  'learningObjectives', 'learning_objectives',
  'prerequisites',
  'conceptIntroduction', 'concept_introduction',
  'deepExplanation', 'deep_explanation',
  'formalDevelopment', 'formal_development',
  'workedExamples', 'worked_examples',
  'applications',
  'applicationRationale', 'application_rationale',
  'misconceptions',
  'misconceptionRationale', 'misconception_rationale',
  'guidedPractice', 'guided_practice',
  'independentPractice', 'independent_practice',
  'knowledgeChecks', 'knowledge_checks',
  'mastery',
  'verification'
] as const;

function resolveStructuredLessonPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  let obj = { ...(value as Record<string, any>) };

  // Unwrap if the provider nested the entire lesson inside { lesson: { ... } } or { data: { ... } }
  if (
    obj.content === undefined &&
    obj.title === undefined &&
    ((obj.lesson && typeof obj.lesson === 'object' && !Array.isArray(obj.lesson)) ||
     (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)))
  ) {
    const inner = (obj.lesson || obj.data) as Record<string, any>;
    obj = { ...obj, ...inner };
  }

  if (obj.contentBlocks === undefined) {
    const aliasBlocks = obj.content_blocks ?? obj.academicBlocks ?? obj.academic_blocks;
    if (aliasBlocks && typeof aliasBlocks === 'object' && !Array.isArray(aliasBlocks)) {
      obj.contentBlocks = aliasBlocks;
    }
  }

  if (obj.instructionalContent === undefined) {
    const aliasInstructional =
      obj.instructional_content ??
      obj.structuredContent ??
      obj.structured_content ??
      obj.masteryContent ??
      obj.mastery_content ??
      obj.instructionalData ??
      obj.instructional_data ??
      (obj.contentBlocks && typeof obj.contentBlocks === 'object' ? (obj.contentBlocks as any).instructionalContent : undefined);

    if (aliasInstructional && typeof aliasInstructional === 'object' && !Array.isArray(aliasInstructional)) {
      obj.instructionalContent = aliasInstructional;
    } else {
      // Check if the provider flattened the InstructionalContentSchema fields onto the top-level object
      const hasTopLevelInstructionalFields =
        obj.workedExamples !== undefined ||
        obj.worked_examples !== undefined ||
        obj.conceptIntroduction !== undefined ||
        obj.concept_introduction !== undefined ||
        obj.deepExplanation !== undefined ||
        obj.deep_explanation !== undefined ||
        obj.knowledgeChecks !== undefined ||
        obj.knowledge_checks !== undefined ||
        obj.guidedPractice !== undefined ||
        obj.guided_practice !== undefined;

      if (hasTopLevelInstructionalFields) {
        const extracted: Record<string, any> = {};
        for (const key of INSTRUCTIONAL_CONTENT_FIELD_NAMES) {
          if (obj[key] !== undefined) {
            extracted[key] = obj[key];
          }
        }
        obj.instructionalContent = extracted;
      }
    }
  }

  // Synchronize disciplineEngine between contentBlocks and instructionalContent if one is missing
  if (obj.instructionalContent && typeof obj.instructionalContent === 'object' && !Array.isArray(obj.instructionalContent)) {
    const ic = { ...(obj.instructionalContent as Record<string, any>) };
    if (!ic.disciplineEngine && !ic.discipline_engine && obj.contentBlocks && typeof obj.contentBlocks === 'object') {
      const cbEngine = (obj.contentBlocks as Record<string, any>).disciplineEngine;
      if (cbEngine) ic.disciplineEngine = cbEngine;
    }
    obj.instructionalContent = ic;
  }

  if (obj.contentBlocks && typeof obj.contentBlocks === 'object' && !Array.isArray(obj.contentBlocks)) {
    const cb = { ...(obj.contentBlocks as Record<string, any>) };
    if (!cb.schemaVersion) cb.schemaVersion = '1.0';
    if (!cb.disciplineEngine && obj.instructionalContent && typeof obj.instructionalContent === 'object') {
      const icEngine = (obj.instructionalContent as Record<string, any>).disciplineEngine;
      if (icEngine) cb.disciplineEngine = icEngine;
    }
    if (
      Array.isArray(cb.blocks) &&
      obj.instructionalContent &&
      typeof obj.instructionalContent === 'object' &&
      Array.isArray((obj.instructionalContent as any).knowledgeChecks)
    ) {
      const kcCount = (obj.instructionalContent as any).knowledgeChecks.length;
      if (kcCount > 0) {
        cb.blocks = cb.blocks.map((block: any) => {
          if (block && typeof block === 'object' && block.type === 'knowledge_check' && typeof block.activityIndex === 'number') {
            if (block.activityIndex >= kcCount) {
              return { ...block, activityIndex: Math.max(0, kcCount - 1) };
            }
          }
          return block;
        });
      }
    }
    obj.contentBlocks = cb;
  }

  return obj;
}

export const StructuredLessonOutputSchema = z.preprocess(
  (value: unknown) => normalizeNestedMathUnicode(resolveStructuredLessonPayload(value)),
  z.object({
  pedagogicalReasoning: NormalizedStringSchema.optional(),
  title: NormalizedStringSchema,
  content: z.string().min(800).refine((value) => !isBareDiagramOrFragment(value), {
    message: 'Lesson content must include substantive academic prose, not only a diagram or fragment.'
  }),
  instructionalContent: InstructionalContentSchema,
  // Optional during the compatibility window. New-generation routes enforce its presence.
  contentBlocks: AcademicContentBlockCollectionSchema.optional()
  }).superRefine((value, ctx) => {
    if (!value.contentBlocks) return;

    const explanationCount = value.contentBlocks.blocks.filter(block => isFoundationalExplanationBlock(block)).length;
    if (explanationCount === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['contentBlocks', 'blocks'],
        message: 'A typed lesson must include at least one foundational explanation block.'
      });
    }

    value.contentBlocks.blocks.forEach((block, index) => {
      if (block.type === 'knowledge_check' && block.activityIndex >= value.instructionalContent.knowledgeChecks.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['contentBlocks', 'blocks', index, 'activityIndex'],
          message: 'Knowledge-check blocks must reference an existing instructionalContent.knowledgeChecks item.'
        });
      }
    });
  })
);
export type StructuredLessonOutput = z.infer<typeof StructuredLessonOutputSchema>;
export type { AcademicContentBlockCollection };

export const CourseProvenanceSchema = z.object({
  // A valid course may have no externally retrieved references; empty is more
  // accurate than manufacturing citations to satisfy a non-empty constraint.
  sources: z.array(z.string().min(1)),
  modelVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  generatedAt: z.string(),
  groundingScore: z.number().min(0).max(100).optional(),
  sourceStatus: z.enum(['admin_supplied_unverified', 'research_retrieved_unverified', 'model_suggested_unverified', 'independently_verified']).optional(),
  academicAccuracy: z.enum(['not_independently_verified', 'subject_expert_reviewed']).optional(),
  rubricAudit: OutlineCriticRubricSchema.optional(),
  research: z.object({
    status: z.enum(['evidence_found', 'insufficient_evidence', 'no_results', 'disabled', 'unavailable']),
    runId: z.string().nullable(),
    researchDepth: z.string().nullable(),
    researchPasses: z.array(z.object({
      pass: z.number().int().positive(),
      searchDepth: z.enum(['scholarly_only', 'basic', 'advanced']),
      query: z.string(),
      reason: z.string()
    })).optional(),
    retrievedAt: z.string(),
    papersCount: z.number().int().nonnegative(),
    webSourcesCount: z.number().int().nonnegative(),
    evidenceAssessment: z.unknown(),
    providerBreakdown: z.unknown(),
    limitations: z.array(z.string()),
    sourceReferences: z.array(z.object({
      recordType: z.enum(['scholarly_record', 'web_discovery']),
      provider: z.enum(['arxiv', 'semantic_scholar', 'openalex', 'tavily']),
      title: z.string().min(1),
      url: z.string().url(),
      authors: z.array(z.string()).optional(),
      year: z.number().int().nullable().optional(),
      venue: z.string().nullable().optional(),
      doi: z.string().nullable().optional(),
      publicationType: z.enum(['preprint', 'indexed_record']).optional(),
      authorityClass: z.enum(['scholarly_index', 'institutional_domain', 'general_web', 'unknown']).optional(),
      verificationStatus: z.literal('unverified')
    })),
    errorMessage: z.string().optional()
  }).optional()
});
export type CourseProvenance = z.infer<typeof CourseProvenanceSchema>;

/**
 * Validates and normalizes learning outcomes into a verified LearningOutcome array.
 * Requires an explicit, valid Bloom's taxonomy level for every learning outcome.
 */
export function normalizeLearningOutcomes(raw: unknown): LearningOutcome[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Verified course learning outcomes with explicit Bloom taxonomy levels are required.');
  }
  const validBloomLevels = new Set<BloomLevel>(['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create']);
  const normalized = raw.map((item: any, idx: number) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Learning outcome at index ${idx} must be an object with "outcome" and "bloomLevel".`);
    }
    const rawOutcome = item.outcome ?? item.title ?? item.description ?? item.text ?? item.statement ?? '';
    const outcome = String(normalizeStringOrStructuredEntry(rawOutcome) || '').trim();
    if (!outcome) {
      throw new Error(`Learning outcome at index ${idx} is missing its outcome text.`);
    }
    const rawBloom = normalizeBloomLevel(item.bloomLevel ?? item.bloom_level ?? item.level ?? item.cognitiveLevel) as BloomLevel;
    if (!validBloomLevels.has(rawBloom)) {
      throw new Error(`Learning outcome "${outcome}" is missing a valid Bloom taxonomy level (Remember, Understand, Apply, Analyze, Evaluate, Create).`);
    }
    return { outcome, bloomLevel: rawBloom };
  });
  return normalized;
}

/**
 * Helper to derive dynamic curriculum bounds based on verified level, term, and credit units
 * without forcing a rigid module count or fixed 4-lesson template.
 */
export function deriveCurriculumParameters(level?: string, semester?: string, creditUnits?: number, depth?: string) {
  if (!creditUnits || !Number.isInteger(creditUnits) || creditUnits < 1 || creditUnits > 12) {
    throw new Error('Verified course credit units are required to derive curriculum parameters.');
  }
  if (!level?.trim()) {
    throw new Error('Verified academic level is required to derive curriculum parameters.');
  }
  const credits = creditUnits;
  let minModules = Math.max(3, credits);
  let maxModules = Math.max(minModules + 1, Math.min(8, credits + 1));
  let minLessonsPerModule = 2;
  let maxLessonsPerModule = 3;

  const normalizedLevel = level.trim().toLowerCase();
  if (normalizedLevel.includes('400') || normalizedLevel.includes('500') || normalizedLevel.includes('grad') || normalizedLevel.includes('advanced')) {
    minModules = Math.max(4, credits + 1);
    maxModules = Math.max(minModules + 1, Math.min(10, credits + 2));
  }

  if (depth === 'in-depth' || depth === 'advanced' || depth === 'deep-dive') {
    minModules += 1;
    maxModules += 2;
    maxLessonsPerModule = 5;
  }

  const targetLessonsPerModule = Math.max(minLessonsPerModule, Math.min(maxLessonsPerModule, credits));

  return {
    credits,
    minModules,
    maxModules,
    minLessonsPerModule,
    maxLessonsPerModule,
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
