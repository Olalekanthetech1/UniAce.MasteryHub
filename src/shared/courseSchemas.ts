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
  learningOutcomes: z.array(LearningOutcomeSchema).min(1),
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
  hints: z.array(z.string().min(1)),
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

export const StructuredLessonOutputSchema = z.preprocess(
  (value: unknown) => normalizeNestedMathUnicode(value),
  z.object({
  pedagogicalReasoning: z.string().optional(),
  title: z.string().min(1),
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
    const outcome = String(item.outcome || item.title || item.description || item.text || '').trim();
    if (!outcome) {
      throw new Error(`Learning outcome at index ${idx} is missing its outcome text.`);
    }
    const rawBloom = String(item.bloomLevel || '').trim() as BloomLevel;
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
  let minModules = Math.max(3, credits * 2 - 1);
  let maxModules = Math.max(minModules + 2, Math.min(14, credits * 3 + 2));
  let minLessonsPerModule = 2;
  let maxLessonsPerModule = 6;

  const normalizedLevel = level.trim().toLowerCase();
  if (normalizedLevel.includes('400') || normalizedLevel.includes('500') || normalizedLevel.includes('grad') || normalizedLevel.includes('advanced')) {
    minModules = Math.max(4, credits * 2);
    maxModules = Math.max(minModules + 2, Math.min(15, credits * 3 + 3));
  }

  if (depth === 'in-depth' || depth === 'advanced' || depth === 'deep-dive') {
    minModules += 1;
    maxModules += 2;
    maxLessonsPerModule = 7;
  }

  const targetLessonsPerModule = Math.max(minLessonsPerModule, Math.min(maxLessonsPerModule, credits + 1));

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
