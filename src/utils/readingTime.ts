import type { SubTopic } from '../types';
import type { StudentInstructionalContent } from '../shared/courseSchemas';

export interface ReadingTimeOptions {
  /** Average words per minute for university-level technical material (default: 200) */
  wordsPerMinute?: number;
  /** Additional comprehension seconds per standalone display equation (default: 8) */
  secondsPerDisplayEquation?: number;
  /** Additional comprehension seconds per inline mathematical expression (default: 2) */
  secondsPerInlineMath?: number;
  /** Additional inspection seconds per diagram, function plot, or visual figure (default: 12) */
  secondsPerFigure?: number;
}

export interface ReadingTimeEstimate {
  /** True only when live lesson prose or structured instructional content is non-empty */
  hasContent: boolean;
  /** Count of readable words across markdown prose and structured instructional sections */
  wordCount: number;
  /** Total mathematical expressions (display + inline) detected */
  equationCount: number;
  /** Total visual diagrams/figures (SVG, Mermaid, function-plot, images) detected */
  figureCount: number;
  /** Total estimated reading & comprehension time in seconds */
  totalSeconds: number;
  /** Rounded reading time in minutes (at least 1 when hasContent is true) */
  minutes: number;
  /** Concise human-readable badge label (e.g. "4 min read", "< 1 min read", or "" if empty) */
  formatted: string;
  /** Detailed summary label including word count (e.g. "4 min read • 780 words") */
  detailedLabel: string;
}

const DEFAULT_OPTIONS: Required<ReadingTimeOptions> = {
  wordsPerMinute: 200,
  secondsPerDisplayEquation: 8,
  secondsPerInlineMath: 2,
  secondsPerFigure: 12
};

/**
 * Formats a reading duration in minutes/seconds into a scannable label.
 */
export function formatReadingTime(minutes: number, totalSeconds?: number): string {
  if ((totalSeconds !== undefined && totalSeconds <= 0) || minutes <= 0) {
    return '';
  }
  if (totalSeconds !== undefined && totalSeconds < 45) {
    return '< 1 min read';
  }
  return `${Math.max(1, Math.round(minutes))} min read`;
}

/**
 * Extracts all student-facing text from structured instructional content so reading time
 * reflects worked examples, formal development, and practice prompts in addition to prose.
 */
export function extractInstructionalText(
  instructional?: StudentInstructionalContent | null
): string {
  if (!instructional || typeof instructional !== 'object') return '';

  const segments: string[] = [];

  const pushText = (value?: string | null) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      segments.push(value.trim());
    }
  };

  if (Array.isArray(instructional.learningObjectives)) {
    instructional.learningObjectives.forEach(pushText);
  }
  if (Array.isArray(instructional.prerequisites)) {
    instructional.prerequisites.forEach((prereq) => {
      pushText(prereq?.concept);
      pushText(prereq?.whyNeeded);
      pushText(prereq?.readinessCheck);
    });
  }

  pushText(instructional.conceptIntroduction);
  pushText(instructional.deepExplanation);
  pushText(instructional.formalDevelopment);

  if (Array.isArray(instructional.workedExamples)) {
    instructional.workedExamples.forEach((ex) => {
      pushText(ex?.title);
      pushText(ex?.problem);
      if (Array.isArray(ex?.reasoningSteps)) {
        ex.reasoningSteps.forEach(pushText);
      }
      pushText(ex?.solution);
      pushText(ex?.verification);
    });
  }

  if (Array.isArray(instructional.applications)) {
    instructional.applications.forEach((app) => {
      pushText(app?.context);
      pushText(app?.conceptConnection);
      pushText(app?.constraintsOrAssumptions);
    });
  }

  if (Array.isArray(instructional.misconceptions)) {
    instructional.misconceptions.forEach((misc) => {
      pushText(misc?.misconception);
      pushText(misc?.whyItIsWrong);
      pushText(misc?.correction);
    });
  }

  if (Array.isArray(instructional.guidedPractice)) {
    instructional.guidedPractice.forEach((item) => {
      pushText(item?.prompt);
      if (Array.isArray(item?.hints)) {
        item.hints.forEach(pushText);
      }
    });
  }

  if (Array.isArray(instructional.independentPractice)) {
    instructional.independentPractice.forEach((item) => {
      pushText(item?.prompt);
      if (Array.isArray(item?.hints)) {
        item.hints.forEach(pushText);
      }
    });
  }

  if (Array.isArray(instructional.knowledgeChecks)) {
    instructional.knowledgeChecks.forEach((kc) => {
      pushText(kc?.prompt);
    });
  }

  if (instructional.mastery) {
    if (Array.isArray(instructional.mastery.criteria)) {
      instructional.mastery.criteria.forEach(pushText);
    }
    if (Array.isArray(instructional.mastery.retentionPrompts)) {
      instructional.mastery.retentionPrompts.forEach(pushText);
    }
  }

  return segments.join('\n\n');
}

const UNGENERATED_PLACEHOLDER_PATTERNS = [
  /^###\s+Content Not Available/i,
  /This lesson content hasn't been generated yet/i
];

/**
 * Calculates the estimated reading and comprehension time for a subtopic's content.
 * Returns `hasContent: false` if the content is empty or an ungenerated placeholder,
 * ensuring no fabricated estimates are ever shown.
 */
export function calculateReadingTime(
  content?: string | null,
  instructionalContent?: StudentInstructionalContent | null,
  options?: ReadingTimeOptions
): ReadingTimeEstimate {
  const cfg = { ...DEFAULT_OPTIONS, ...options };
  const safeWpm = cfg.wordsPerMinute > 0 ? cfg.wordsPerMinute : DEFAULT_OPTIONS.wordsPerMinute;

  const rawMarkdown = typeof content === 'string' ? content.trim() : '';
  const isPlaceholderOnly = UNGENERATED_PLACEHOLDER_PATTERNS.some((pattern) =>
    pattern.test(rawMarkdown)
  );
  const effectiveMarkdown = isPlaceholderOnly ? '' : rawMarkdown;
  const instructionalText = extractInstructionalText(instructionalContent);

  const combinedSource = [effectiveMarkdown, instructionalText]
    .filter((part) => part.length > 0)
    .join('\n\n')
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
    .trim();

  if (!combinedSource) {
    return {
      hasContent: false,
      wordCount: 0,
      equationCount: 0,
      figureCount: 0,
      totalSeconds: 0,
      minutes: 0,
      formatted: '',
      detailedLabel: ''
    };
  }

  // 1. Count visual figures (fenced mermaid/function-plot/svg blocks, raw <svg> blocks, markdown images)
  const fencedDiagramMatches =
    combinedSource.match(/```(?:mermaid|function-plot|svg)\b[\s\S]*?```/gi) || [];
  const withoutFencedDiagrams = combinedSource.replace(
    /```(?:mermaid|function-plot|svg)\b[\s\S]*?```/gi,
    ' '
  );
  const rawSvgMatches = withoutFencedDiagrams.match(/<svg[\s\S]*?<\/svg>/gi) || [];
  const markdownImageMatches =
    withoutFencedDiagrams.match(/!\[[^\]]*\]\([^)]+\)/g) || [];
  const figureCount =
    fencedDiagramMatches.length + rawSvgMatches.length + markdownImageMatches.length;

  // Strip diagrams and images before counting math & words so SVG coordinates don't inflate word counts
  const textWithoutFigures = withoutFencedDiagrams
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ');

  // 2. Count display and inline mathematical expressions
  const displayMathMatches =
    textWithoutFigures.match(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g) || [];
  const withoutDisplayMath = textWithoutFigures.replace(
    /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g,
    ' '
  );
  const inlineMathMatches =
    withoutDisplayMath.match(
      /(?<!\\)\$(?!\$)(?:\\[\s\S]|[^$\\\n])+?(?<!\\)\$(?!\$)|\\\([\s\S]*?\\\)/g
    ) || [];

  const displayEquationCount = displayMathMatches.length;
  const inlineEquationCount = inlineMathMatches.length;
  const equationCount = displayEquationCount + inlineEquationCount;

  // 3. Clean remaining markdown syntax and HTML tags to count readable words accurately
  const readableProse = withoutDisplayMath
    .replace(/(?<!\\)\$(?!\$)(?:\\[\s\S]|[^$\\\n])+?(?<!\\)\$(?!\$)|\\\([\s\S]*?\\\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`#*~_>|[\]()]/g, ' ')
    .trim();

  const words = readableProse.length > 0 ? readableProse.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;

  if (wordCount === 0 && equationCount === 0 && figureCount === 0) {
    return {
      hasContent: false,
      wordCount: 0,
      equationCount: 0,
      figureCount: 0,
      totalSeconds: 0,
      minutes: 0,
      formatted: '',
      detailedLabel: ''
    };
  }

  const proseSeconds = (wordCount / safeWpm) * 60;
  const mathSeconds =
    displayEquationCount * cfg.secondsPerDisplayEquation +
    inlineEquationCount * cfg.secondsPerInlineMath;
  const figureSeconds = figureCount * cfg.secondsPerFigure;

  const totalSeconds = Math.max(1, Math.round(proseSeconds + mathSeconds + figureSeconds));
  const minutes = Math.max(1, Math.ceil(totalSeconds / 60));
  const formatted = formatReadingTime(minutes, totalSeconds);
  const detailedLabel =
    wordCount > 0
      ? `${formatted} • ${wordCount.toLocaleString()} ${wordCount === 1 ? 'word' : 'words'}`
      : formatted;

  return {
    hasContent: true,
    wordCount,
    equationCount,
    figureCount,
    totalSeconds,
    minutes,
    formatted,
    detailedLabel
  };
}

/**
 * Convenience helper to compute reading time directly from a SubTopic object.
 */
export function calculateSubTopicReadingTime(
  subTopic?: Pick<SubTopic, 'content' | 'instructionalContent'> | null,
  options?: ReadingTimeOptions
): ReadingTimeEstimate {
  if (!subTopic) {
    return calculateReadingTime('', null, options);
  }
  return calculateReadingTime(subTopic.content, subTopic.instructionalContent, options);
}

/**
 * Aggregates reading time across all subtopics in a module that have loaded content.
 */
export function calculateModuleReadingTime(
  subTopics?: Array<Pick<SubTopic, 'content' | 'instructionalContent'>> | null,
  options?: ReadingTimeOptions
): ReadingTimeEstimate {
  if (!Array.isArray(subTopics) || subTopics.length === 0) {
    return calculateReadingTime('', null, options);
  }

  let totalWords = 0;
  let totalEquations = 0;
  let totalFigures = 0;
  let totalSeconds = 0;
  let anyContent = false;

  for (const topic of subTopics) {
    const estimate = calculateSubTopicReadingTime(topic, options);
    if (estimate.hasContent) {
      anyContent = true;
      totalWords += estimate.wordCount;
      totalEquations += estimate.equationCount;
      totalFigures += estimate.figureCount;
      totalSeconds += estimate.totalSeconds;
    }
  }

  if (!anyContent) {
    return {
      hasContent: false,
      wordCount: 0,
      equationCount: 0,
      figureCount: 0,
      totalSeconds: 0,
      minutes: 0,
      formatted: '',
      detailedLabel: ''
    };
  }

  const minutes = Math.max(1, Math.ceil(totalSeconds / 60));
  const formatted = formatReadingTime(minutes, totalSeconds);
  const detailedLabel =
    totalWords > 0
      ? `${formatted} • ${totalWords.toLocaleString()} ${totalWords === 1 ? 'word' : 'words'}`
      : formatted;

  return {
    hasContent: true,
    wordCount: totalWords,
    equationCount: totalEquations,
    figureCount: totalFigures,
    totalSeconds,
    minutes,
    formatted,
    detailedLabel
  };
}
