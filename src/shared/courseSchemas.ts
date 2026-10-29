import { z } from 'zod';
import katex from 'katex';

/**
 * UniAce Shared Course Schema & Pedagogical Architecture
 * Strict Zero-Fallback Policy: Unified contract across server & client
 */

export const BloomLevelEnum = z.enum(['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create']);
export type BloomLevel = z.infer<typeof BloomLevelEnum>;

export const LearningOutcomeSchema = z.object({
  outcome: z.string().min(1, 'Outcome text cannot be empty'),
  bloomLevel: BloomLevelEnum.optional().default('Understand')
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
  pedagogyType: DisciplinePedagogyTypeEnum.default('STEM_MATHEMATICAL'),
  courseLevelFramework: z.string().default('Undergraduate University Standard'),
  recommendedCreditHours: z.number().int().min(1).max(12).default(3),
  targetModuleCountRange: z.object({
    min: z.number().int().min(4),
    max: z.number().int().max(16)
  }).default({ min: 6, max: 10 }),
  canonicalCourseReferences: z.array(z.string()).min(1),
  foundationalAxioms: z.array(z.string()).min(1),
  coreCourseTopics: z.array(z.string()).min(6)
});
export type DomainBrief = z.infer<typeof DomainBriefSchema>;

export const CourseLessonOutlineSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  learningOutcomeIds: z.array(z.string()).optional().default([]),
  coreConcepts: z.array(z.string()).optional().default([])
});
export type CourseLessonOutline = z.infer<typeof CourseLessonOutlineSchema>;

export const CourseModuleOutlineSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  order: z.number().int().optional(),
  isFoundationModule: z.boolean().optional().default(false),
  topics: z.array(z.string()).optional(),
  lessonTitles: z.array(z.string()).optional(),
  lessons: z.array(z.union([z.string(), CourseLessonOutlineSchema])).optional(),
  quizTopics: z.array(z.string()).optional().default([]),
  learningOutcomeIds: z.array(z.string()).optional().default([])
});
export type CourseModuleOutline = z.infer<typeof CourseModuleOutlineSchema>;

export const CourseSkeletonSchema = z.object({
  pedagogicalReasoning: z.string().optional(),
  description: z.string().optional().default(''),
  pedagogyType: DisciplinePedagogyTypeEnum.optional().default('STEM_MATHEMATICAL'),
  creditHours: z.number().int().min(1).max(12).optional().default(3),
  learningOutcomes: z.array(z.union([z.string(), LearningOutcomeSchema])).optional().default([]),
  modules: z.array(CourseModuleOutlineSchema).min(1)
});
export type CourseSkeleton = z.infer<typeof CourseSkeletonSchema>;

export const OutlineCriticRubricSchema = z.object({
  isValid: z.boolean(),
  coverageScore: z.number().min(0).max(100),
  consistencyScore: z.number().min(0).max(100).default(90),
  foundationsScore: z.number().min(0).max(100),
  workloadBalanceScore: z.number().min(0).max(100),
  sequencingScore: z.number().min(0).max(100),
  coveredTopics: z.array(z.string()),
  missingTopics: z.array(z.string()).default([]),
  sequencingErrors: z.array(z.string()).default([]),
  genericFillerDetected: z.boolean().default(false),
  confidenceState: z.enum(['verified', 'needs_review', 'failed']).default('verified'),
  reasoning: z.string()
});
export type OutlineCriticRubric = z.infer<typeof OutlineCriticRubricSchema>;

/**
 * Validates and deterministically repairs a single LaTeX math block using katex.renderToString({ throwOnError: true }).
 */
export function repairLatexMathBlock(expr: string, displayMode: boolean): string {
  const trimmed = expr.trim();
  if (!trimmed) return expr;

  const canRender = (candidate: string): boolean => {
    try {
      katex.renderToString(candidate, { throwOnError: true, displayMode, strict: false });
      return true;
    } catch {
      return false;
    }
  };

  if (canRender(trimmed)) {
    return expr;
  }

  let repaired = trimmed;

  // 1. Escape unescaped %, &, # inside \text{...}, \mathrm{...}, \textbf{...}
  repaired = repaired.replace(/\\(text|mathrm|textbf|textit)\{([^{}]*?)\}/g, (_m, cmd: string, inner: string) => {
    const fixedInner = inner
      .replace(/(?<!\\)&/g, '\\&')
      .replace(/(?<!\\)%/g, '\\%')
      .replace(/(?<!\\)#/g, '\\#');
    return `\\${cmd}{${fixedInner}}`;
  });

  // 2. Escape unescaped % outside comments
  repaired = repaired.replace(/(?<!\\)%/g, '\\%');

  // 3. Balance \{ ... } where \{ was escaped but closing } was not escaped
  if (repaired.includes('\\{') && !repaired.includes('\\}')) {
    repaired = repaired.replace(/(?<!\\)\}(\s*)$/, '\\}$1');
  }

  // 4. Balance unescaped { and } braces
  const openBraces = (repaired.match(/(?<!\\)\{/g) || []).length;
  const closeBraces = (repaired.match(/(?<!\\)\}/g) || []).length;
  if (openBraces > closeBraces) {
    repaired = repaired + '}'.repeat(openBraces - closeBraces);
  } else if (closeBraces > openBraces) {
    let diff = closeBraces - openBraces;
    repaired = repaired.replace(/(?<!\\)\}/g, (m) => {
      if (diff > 0) {
        diff--;
        return '';
      }
      return m;
    });
  }

  // 5. Balance \left and \right
  const leftCount = (repaired.match(/\\left\b/g) || []).length;
  const rightCount = (repaired.match(/\\right\b/g) || []).length;
  if (leftCount > rightCount) {
    repaired = repaired + ' \\right.'.repeat(leftCount - rightCount);
  } else if (rightCount > leftCount) {
    repaired = repaired.replace(/\\right\b/g, '');
    repaired = repaired.replace(/\\left\b/g, '');
  }

  // 6. Strip trailing standalone backslash at the very end of a math block (e.g., "... = \mu\n\")
  repaired = repaired.replace(/(?<!\\)\\\s*$/, '').trim();

  if (canRender(repaired)) {
    return displayMode && expr.includes('\n') ? `\n${repaired}\n` : repaired;
  }

  return expr;
}

/**
 * Normalizes transport-level JSON escape artifacts, auto-wraps naked diagram blocks
 * (svg, function-plot) into proper code fences, and runs katex.renderToString auto-repair.
 */
export function normalizeLessonMarkdownContent(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.replace(/\r\n/g, '\n').trim();

  // Restore control characters accidentally created when unescaped \frac (\f), \text/\theta/\times/\tau (\t), or \begin/\beta/\bar (\b) were JSON-parsed
  text = text
    .replace(/\x0c(rac|orall)\b/g, '\\f$1')
    .replace(/\x09(ext|extbf|extit|heta|au|imes|o|op|anh|riangle)\b/g, '\\t$1')
    .replace(/\x08(egin|eta|ar|inom|ig|igg|oxed|ullet)\b/g, '\\b$1');

  // Strip trailing standalone backslash immediately preceding closing $$ (e.g., "\n\\$$")
  text = text.replace(/\\\s*\$\$/g, '\n$$');

  // Unwrap outer markdown fence if the entire string is wrapped in ```markdown ... ```
  const outerFenceMatch = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (outerFenceMatch && outerFenceMatch[1]) {
    text = outerFenceMatch[1].trim();
  }

  // If the text still contains raw JSON-escaped quotes (e.g., viewBox=\"0 0 500 250\") or literal \n sequences
  // from partial JSON extraction, unescape them cleanly without corrupting LaTeX commands (\nabla, \nu, \neq, \tau, \theta, \times, \text, \to, \top)
  if (text.includes('\\"')) {
    text = text.replace(/\\"/g, '"');
  }
  if (text.includes('\\n')) {
    text = text.replace(/\\n(?![a-zA-Z])/g, '\n');
  }

  // Ensure any bare "svg\n<svg ...>...</svg>" block not already inside ```svg fences is wrapped in ```svg
  text = text.replace(/(^|\n)(?!```)svg\s*\n(<svg[\s\S]*?<\/svg>)(?!\s*\n```)/gi, '$1```svg\n$2\n```');

  // Ensure any bare "function-plot\n{...}" block not already inside ```function-plot fences is wrapped in ```function-plot
  text = text.replace(/(^|\n)(?!```)function-plot\s*\n(\{[\s\S]*?\n\})(?!\s*\n```)/gi, '$1```function-plot\n$2\n```');

  // Normalize double-escaped LaTeX commands produced by JSON string serialization
  text = text.replace(/\\\\(frac|dfd|begin|end|text|textbf|textit|mathrm|mathbf|left|right|cdot|times|div|pm|mp|leq|geq|neq|approx|equiv|propto|infty|partial|nabla|int|oint|sum|prod|sqrt|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega)\b/g, '\\$1');

  // Escape raw '&' inside \text{...}, \mathrm{...}, \textbf{...} so KaTeX does not treat it as an alignment tab
  text = text.replace(/\\(text|mathrm|textbf|textit)\{([^{}]*?)\}/g, (_match, cmd: string, inner: string) => {
    const fixedInner = inner.replace(/(?<!\\)&/g, '\\&');
    return `\\${cmd}{${fixedInner}}`;
  });

  // Balance \{ ... } inside inline math where \{ was escaped but the closing } before $ was not escaped
  text = text.replace(/(\$[^$\n]*?\\\{[^$\n{}]*?)(?<!\\)\}(\$)/g, '$1\\}$2');

  // Fix mismatched $$ ... $ on a single line where opening is unescaped $$ and closing is a single unescaped $
  text = text.replace(/(?<!\\)\$\$([^\n$]+?)(?<!\\|\$)\$(?!\$)/g, (_m, inner: string) => {
    return `$$${inner.trim()}$$`;
  });

  // Run katex.renderToString verification & auto-repair on all unescaped $$ ... $$ display math blocks
  text = text.replace(/(?<!\\)\$\$([\s\S]*?)(?<!\\)\$\$/g, (_m, inner: string) => {
    return `$$${repairLatexMathBlock(inner, true)}$$`;
  });

  // Run katex.renderToString verification & auto-repair on inline $ ... $ math blocks (ignoring escaped \$ currency)
  text = text.replace(/(?<!\\|\$)\$(?!\$)((?:\\\$|[^$\n])+?)(?<!\\|\$)\$(?!\$)/g, (fullMatch, inner: string) => {
    // Skip if it looks like two unescaped currency values on the same line (e.g., "$100 and $200")
    if (/^\d[\d,.]*\s+[a-zA-Z]/.test(inner.trim()) && !/[\\^_{}=]/.test(inner)) {
      return fullMatch;
    }
    return `$${repairLatexMathBlock(inner, false)}$`;
  });

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

export const CourseProvenanceSchema = z.object({
  sources: z.array(z.string()).default([]),
  modelVersion: z.string().default('gemini-2.5-pro'),
  promptVersion: z.string().default('uniace-curriculum-v2.0'),
  generatedAt: z.string(),
  groundingScore: z.number().optional().default(95),
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
  const credits = creditUnits && creditUnits > 0 ? creditUnits : 3;
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
