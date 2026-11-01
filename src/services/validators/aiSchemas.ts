import { z } from 'zod';

/**
 * Dynamically heals and aligns quiz questions so that correctAnswer is strictly and exactly present
 * in the options list. Handles various common AI mistakes such as different prefixes, casing,
 * letter-only answers, digit-only answers, partial substrings, and duplicate options.
 */
export function autoHealQuestion(q: any): any {
  if (!q || typeof q !== 'object' || Array.isArray(q)) {
    throw new Error('Quiz question must be an object returned by the live generator.');
  }

  const type = q.type;
  if (type !== 'multiple-choice' && type !== 'fill-in-the-blank') {
    throw new Error('Quiz question is missing a supported question type.');
  }

  const question = typeof q.question === 'string' ? q.question.trim() : '';
  if (!question) {
    throw new Error('Quiz question text is missing.');
  }

  const options = Array.isArray(q.options)
    ? q.options.map((value: unknown) => typeof value === 'string' ? value.trim() : '')
    : [];
  let correctAnswer = typeof q.correctAnswer === 'string'
    ? q.correctAnswer.trim()
    : (typeof q.answer === 'string' ? q.answer.trim() : '');

  if (!correctAnswer) {
    throw new Error('Quiz question is missing its generated answer or model-answer rubric.');
  }

  if (type === 'multiple-choice') {
    if (options.length < 2 || options.some((option: string) => !option)) {
      throw new Error('Multiple-choice question must contain at least two non-empty generated options.');
    }

    const normalizedOptions = options.map((option: string) => option.toLocaleLowerCase());
    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      throw new Error('Multiple-choice question contains duplicate options; refusing to invent replacements.');
    }

    let matchedOption = options.find((option: string) => option === correctAnswer);
    if (!matchedOption) {
      matchedOption = options.find(
        (option: string) => option.toLocaleLowerCase() === correctAnswer.toLocaleLowerCase()
      );
    }

    if (!matchedOption) {
      const cleanedAnswer = correctAnswer
        .replace(/^(?:Option\\s+)?[A-Da-d1-4][\\).\\s\\-:]+/, '')
        .trim()
        .toLocaleLowerCase();
      matchedOption = options.find((option: string) =>
        option.replace(/^(?:Option\\s+)?[A-Da-d1-4][\\).\\s\\-:]+/, '')
          .trim()
          .toLocaleLowerCase() === cleanedAnswer
      );
    }

    if (!matchedOption) {
      const letterMatch = correctAnswer.match(/^[A-Da-d]$/);
      const numericMatch = correctAnswer.match(/^[1-4]$/);
      const zeroBasedMatch = correctAnswer.match(/^[0-3]$/);
      const optionIndex = letterMatch
        ? correctAnswer.toUpperCase().charCodeAt(0) - 65
        : numericMatch
          ? Number(correctAnswer) - 1
          : zeroBasedMatch
            ? Number(correctAnswer)
            : -1;
      if (optionIndex >= 0 && optionIndex < options.length) {
        matchedOption = options[optionIndex];
      }
    }

    if (!matchedOption) {
      throw new Error('Generated answer does not match any supplied option; refusing to rewrite or fabricate an option.');
    }
    correctAnswer = matchedOption;
  }

  return {
    ...q,
    type,
    question,
    options,
    correctAnswer,
    answer: correctAnswer,
    explanation: typeof q.explanation === 'string' ? q.explanation.trim() : '',
    hint: typeof q.hint === 'string' ? q.hint.trim() : ''
  };
}

// 1. Quiz Question Schema
export const QuizQuestionSchema = z.object({
  id: z.string().min(1).optional().or(z.null()).transform((val) => val || `q-${Math.random().toString(36).substring(2, 11)}`),
  type: z.enum(['multiple-choice', 'fill-in-the-blank']),
  question: z.string().trim().min(1, 'Question text cannot be empty'),
  options: z.array(z.string()).optional().default([]),
  correctAnswer: z.string().trim().min(1, 'Correct answer or model-answer rubric cannot be empty'),
  explanation: z.string().optional(),
  hint: z.string().optional(),
  difficulty: z.number().int().min(1).max(5),
  sourceReference: z.string().trim().min(1, 'A source reference is required'),
  bloomLevel: z.enum(['remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating']),
}).transform((q) => autoHealQuestion(q));

export const QuizQuestionsResponseSchema = z.object({
  questions: z.array(QuizQuestionSchema)
});

// 2. Evaluate Written Answer Schema
export const EvaluateWrittenAnswerSchema = z.object({
  score: z.number().min(0).max(100),
  isCorrect: z.boolean(),
  feedback: z.string().trim().min(1, 'Feedback cannot be empty'),
});

// 3. Quick Check Schema
export const QuickCheckSchema = z.object({
  id: z.string().optional().or(z.null()).transform((val) => val || `qc-${Math.random().toString(36).substring(2, 11)}`),
  type: z.literal('multiple-choice'),
  question: z.string().min(1, 'Question text cannot be empty'),
  options: z.array(z.string()).min(2, 'Multiple-choice questions need at least 2 options'),
  correctAnswer: z.string().min(1, 'Correct answer cannot be empty'),
  explanation: z.string().optional().default(''),
  hint: z.string().optional().default(''),
}).transform((q) => autoHealQuestion(q));

// 4. Flashcard Schema
export const FlashcardSchema = z.object({
  id: z.string().optional().or(z.null()).transform((val) => val || `fc-${Math.random().toString(36).substring(2, 11)}`),
  front: z.string().min(1, 'Front cannot be empty'),
  back: z.string().min(1, 'Back cannot be empty'),
  moduleId: z.string().optional(),
  subTopicId: z.string().optional(),
});

export const FlashcardsResponseSchema = z.object({
  flashcards: z.array(FlashcardSchema)
});

// 5. Daily Mission / Smart Recommendation Schema
export const RecommendationSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty'),
  reason: z.string().min(1, 'Reason cannot be empty'),
  moduleId: z.string().optional(),
  subTopicId: z.string().optional(),
  type: z.enum(['review', 'new', 'mastery']),
});

// 6. Exam Readiness Prediction Schema
export const ExamReadinessSchema = z.object({
  probability: z.number().min(0).max(100),
  analysis: z.string().trim().min(1, 'Analysis cannot be empty'),
  weakestArea: z.string().trim().min(1, 'Weakest-area evidence is required'),
});

// 7. Study Plan Schedule Item Schema
export const StudyPlanTaskSchema = z.object({
  day: z.string().min(1, 'Day field cannot be empty'),
  focus: z.string().min(1, 'Focus field cannot be empty'),
  tasks: z.array(z.string().trim().min(1)).min(1, 'Tasks array must contain at least one task'),
});

// 8. Study Plan / Fast-Track Plan Schema
export const StudyPlanSchema = z.object({
  title: z.string().trim().min(1, 'Title cannot be empty'),
  overview: z.string().trim().min(1, 'Overview cannot be empty'),
  dailySchedule: z.array(StudyPlanTaskSchema).min(1, 'A study plan must include source-grounded schedule items'),
  tips: z.array(z.string().trim().min(1)),
});

// 9. Booster Lesson Schema
export const BoosterLessonSchema = z.object({
  focus: z.string().trim().min(1, 'Focus cannot be empty'),
  tasks: z.array(z.string().trim().min(1)).min(1, 'Tasks cannot be empty'),
});

/**
 * Parses and validates live AI JSON payload against a Zod schema.
 * Enforces Zero-Fallback Policy: strictly prohibits static fallbacks or mock substitutions.
 * Only validates and recovers real dynamically retrieved data, throwing an error if invalid.
 */
export function safeParseAIResponse<T>(
  schema: z.ZodSchema<T>,
  data: any,
  fallback?: T
): T {
  if (!data) {
    throw new Error('Zero-Fallback Policy: No dynamic AI data received to validate.');
  }

  // Try standard parsing
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }

  console.warn('AI Zod validation failed, attempting partial recovery from dynamic data:', result.error.format());

  // Attempt partial array recovery for arrays of items (filtering out bad ones instead of failing all)
  if (Array.isArray(data) && (schema instanceof z.ZodArray || (schema as any)._def?.typeName === 'ZodArray')) {
    const itemSchema = (schema as any).element || (schema as any)._def?.type;
    if (itemSchema) {
      const parsedItems = data
        .map((item) => {
          const itemResult = itemSchema.safeParse(item);
          return itemResult.success ? itemResult.data : null;
        })
        .filter((item): item is any => item !== null);

      if (parsedItems.length > 0) {
        return parsedItems as unknown as T;
      }
    }
  }

  // Attempt recovery for objects containing arrays of items (like { questions: [...] } or { flashcards: [...] })
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    for (const key of keys) {
      const val = data[key];
      if (Array.isArray(val)) {
        // If the target schema expects an object with an array key (e.g. QuizQuestionsResponseSchema)
        const shape = (schema as any).shape;
        if (shape && shape[key]) {
          const fieldSchema = shape[key];
          const elementSchema = fieldSchema.element || fieldSchema._def?.type;
          if (elementSchema) {
            const parsedItems = val
              .map((item) => {
                const itemResult = elementSchema.safeParse(item);
                return itemResult.success ? itemResult.data : null;
              })
              .filter((item): item is any => item !== null);

            if (parsedItems.length > 0) {
              return { [key]: parsedItems } as unknown as T;
            }
          }
        }
      }
    }
  }

  throw new Error(`Zero-Fallback Policy: AI response data does not match required schema (${result.error.issues.map(i => i.message).join('; ')}). Refusing to return static fallback.`);
}
