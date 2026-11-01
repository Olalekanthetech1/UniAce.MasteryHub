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
 * Normalizes transport-level markdown formatting without hardcoding or mutating math formulas.
 */
export function normalizeLessonMarkdownContent(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.replace(/\r\n/g, '\n').trim();

  // Unwrap outer markdown fence if the entire string is wrapped in ```markdown ... ```
  const outerFenceMatch = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (outerFenceMatch && outerFenceMatch[1]) {
    text = outerFenceMatch[1].trim();
  }

  return text.trim();
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

export const InstructionalContentSchema = z.object({
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
});
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

export const StructuredLessonOutputSchema = z.object({
  pedagogicalReasoning: z.string().optional(),
  title: z.string().min(1),
  content: z.string().min(800).refine((value) => !isBareDiagramOrFragment(value), {
    message: 'Lesson content must include substantive academic prose, not only a diagram or fragment.'
  }),
  instructionalContent: InstructionalContentSchema
});
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
  if (!creditUnits || !Number.isInteger(creditUnits) || creditUnits <= 0) throw new Error('Verified course credit units are required to derive curriculum parameters.');
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
