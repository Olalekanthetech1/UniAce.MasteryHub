import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInstructionalActivityReveal,
  redactInstructionalAnswersForStudent
} from '../server/services/instructionalDelivery';

const lesson = {
  frameworkVersion: 'understand-explore-apply-verify-master-v1',
  guidedPractice: [{
    prompt: 'Explain the governing relationship.',
    hints: ['Identify the relevant variables.'],
    expectedApproach: 'Start from the governing law.',
    expectedAnswer: 'The final expression is p = rho g h.',
    explanation: 'Substitute the known quantities and check units.',
    diagnosticSignals: ['Confuses pressure and force']
  }],
  independentPractice: [{
    prompt: 'Calculate the hydrostatic pressure.',
    hints: [],
    expectedApproach: 'Use p = rho g h.',
    expectedAnswer: '19620 Pa',
    explanation: 'Multiply density, gravity and depth.',
    diagnosticSignals: ['Drops units']
  }],
  knowledgeChecks: [{
    prompt: 'Why does pressure increase with depth?',
    responseMode: 'explain',
    expectedReasoning: 'The fluid column above the point becomes taller.',
    answerOrRubric: 'Award credit for linking depth to hydrostatic head.',
    misconceptionSignals: ['Says pressure depends only on container shape'],
    difficulty: 2
  }]
};

test('typed lesson blocks remain available in the student payload without exposing mastery answers', () => {
  const contentBlocks = [
    { id: 'explanation-1', type: 'explanation', markdown: 'A substantive explanation of the concept.' },
    { id: 'knowledge-check-1', type: 'knowledge_check', activityIndex: 0 }
  ];
  const source = {
    ...lesson,
    contentBlocks,
    knowledgeChecks: [{
      ...lesson.knowledgeChecks[0],
      expectedReasoning: 'Private comparison reasoning.',
      answerOrRubric: 'Private answer rubric.',
      misconceptionSignals: ['Private diagnostic signal.']
    }]
  };

  const safe = redactInstructionalAnswersForStudent(source);
  assert.deepEqual(safe.contentBlocks, contentBlocks);
  assert.equal('expectedReasoning' in safe.knowledgeChecks[0], false);
  assert.equal('answerOrRubric' in safe.knowledgeChecks[0], false);
  assert.equal('misconceptionSignals' in safe.knowledgeChecks[0], false);
});

test('student lesson payload removes practice answers and diagnostic keys', () => {
  const safe = redactInstructionalAnswersForStudent(lesson);
  assert.equal(safe.guidedPractice[0].prompt, lesson.guidedPractice[0].prompt);
  assert.equal('expectedAnswer' in safe.guidedPractice[0], false);
  assert.equal('expectedApproach' in safe.guidedPractice[0], false);
  assert.equal('explanation' in safe.guidedPractice[0], false);
  assert.equal('diagnosticSignals' in safe.guidedPractice[0], false);
  assert.equal('answerOrRubric' in safe.knowledgeChecks[0], false);
  assert.equal('expectedReasoning' in safe.knowledgeChecks[0], false);
  assert.equal('misconceptionSignals' in safe.knowledgeChecks[0], false);
  assert.equal(lesson.guidedPractice[0].expectedAnswer, 'The final expression is p = rho g h.');
});

test('practice answers are returned only for the requested activity after server-side submission', () => {
  assert.deepEqual(
    getInstructionalActivityReveal(lesson, 'guidedPractice', 0),
    {
      expectedApproach: 'Start from the governing law.',
      expectedAnswer: 'The final expression is p = rho g h.',
      explanation: 'Substitute the known quantities and check units.'
    }
  );
});

test('knowledge checks return their comparison rubric without practice-answer fields', () => {
  assert.deepEqual(
    getInstructionalActivityReveal(lesson, 'knowledgeChecks', 0),
    {
      expectedReasoning: 'The fluid column above the point becomes taller.',
      answerOrRubric: 'Award credit for linking depth to hydrostatic head.'
    }
  );
});

test('missing activity indexes and malformed answer data fail closed', () => {
  assert.throws(() => getInstructionalActivityReveal(lesson, 'guidedPractice', 3), /not found/);
  assert.throws(() => getInstructionalActivityReveal(lesson, 'knowledgeChecks', -1), /index/);
  assert.throws(
    () => getInstructionalActivityReveal({ knowledgeChecks: [{}] }, 'knowledgeChecks', 0),
    /no stored comparison guide/
  );
});
