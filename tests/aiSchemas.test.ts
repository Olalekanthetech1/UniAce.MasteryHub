import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FlashcardSchema,
  FlashcardsResponseSchema,
  QuickCheckSchema,
  QuizQuestionSchema,
  safeParseAIResponse
} from '../src/services/validators/aiSchemas';

const validQuizQuestion = () => ({
  id: 'question-001',
  type: 'multiple-choice',
  question: 'Which option is correct?',
  options: ['Option A', 'Option B'],
  correctAnswer: 'Option A',
  explanation: 'The stored source supports Option A.',
  hint: 'Compare the two supplied options.',
  difficulty: 2,
  sourceReference: 'Lesson 1',
  bloomLevel: 'understanding'
});

test('quiz validation rejects missing generated IDs, explanations, and hints', () => {
  const missingId = validQuizQuestion() as any;
  delete missingId.id;
  assert.equal(QuizQuestionSchema.safeParse(missingId).success, false);

  const missingExplanation = validQuizQuestion() as any;
  delete missingExplanation.explanation;
  assert.equal(QuizQuestionSchema.safeParse(missingExplanation).success, false);

  const missingHint = validQuizQuestion() as any;
  delete missingHint.hint;
  assert.equal(QuizQuestionSchema.safeParse(missingHint).success, false);
});

test('quick checks and flashcards require provider-generated identifiers', () => {
  const quickCheck = {
    ...validQuizQuestion(),
    type: 'multiple-choice'
  } as any;
  delete quickCheck.id;
  assert.equal(QuickCheckSchema.safeParse(quickCheck).success, false);

  const flashcard = {
    front: 'What is the definition?',
    back: 'The source-grounded definition.'
  };
  assert.equal(FlashcardSchema.safeParse(flashcard).success, false);
});

test('empty flashcard arrays and partially invalid generated arrays fail closed', () => {
  assert.equal(FlashcardsResponseSchema.safeParse({ flashcards: [] }).success, false);

  const validCard = {
    id: 'card-001',
    front: 'What is the definition?',
    back: 'The source-grounded definition.'
  };
  const invalidCard = {
    front: 'Missing generated identifier',
    back: 'No identifier was supplied.'
  };

  assert.throws(
    () => safeParseAIResponse(FlashcardsResponseSchema, {
      flashcards: [validCard, invalidCard]
    }),
    /does not match required schema/
  );
});
