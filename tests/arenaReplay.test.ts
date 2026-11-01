import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecordedHumanReplay } from '../server/services/arenaReplay';

const validRow = () => ({
  id: 'battle-real-001',
  updated_at: '2026-10-31T12:01:00.000Z',
  data: {
    status: 'finished',
    opponentType: 'human',
    durationSeconds: 60,
    questions: [
      { question: 'What is 2 + 2?', options: ['3', '4'], correctAnswer: '4' },
      { question: 'What is 3 + 3?', options: ['5', '6'], correctAnswer: '6' }
    ],
    player1: {
      uid: 'firebase-user-001',
      name: 'Recorded Student',
      opponentType: 'human',
      actionLog: [
        { questionIndex: 0, selectedOption: '4', correct: true, elapsedMs: 1200, timestamp: '2026-10-31T12:00:01.200Z' },
        { questionIndex: 1, selectedOption: '5', correct: false, elapsedMs: 4300, timestamp: '2026-10-31T12:00:04.300Z' }
      ]
    },
    player2: {
      uid: 'firebase-user-002',
      name: 'Other Student',
      opponentType: 'human',
      actionLog: [
        { questionIndex: 0, selectedOption: '3', correct: false, elapsedMs: 2100, timestamp: '2026-10-31T12:00:02.100Z' }
      ]
    }
  }
});

test('accepts an internally consistent recorded human battle without inventing fields', () => {
  const replay = validateRecordedHumanReplay(validRow());
  assert.ok(replay);
  assert.equal(replay.id, 'battle-real-001');
  assert.equal(replay.durationSeconds, 60);
  assert.equal(replay.questions.length, 2);
  assert.equal(replay.sourcePlayer.uid, 'firebase-user-001');
  assert.equal(replay.actions.length, 2);
  assert.deepEqual(replay.actions.map(action => action.correct), [true, false]);
});

test('rejects AI, ghost, unfinished, and otherwise non-human opponent records', () => {
  for (const opponentType of ['ai_challenger', 'ghost_replay', 'unknown']) {
    const row = validRow();
    row.data.opponentType = opponentType;
    assert.equal(validateRecordedHumanReplay(row), null);
  }

  const unfinished = validRow();
  unfinished.data.status = 'active';
  assert.equal(validateRecordedHumanReplay(unfinished), null);
});

test('rejects missing historical questions, duration, or recording timestamps', () => {
  const missingQuestions = validRow();
  delete (missingQuestions.data as any).questions;
  assert.equal(validateRecordedHumanReplay(missingQuestions), null);

  const missingDuration = validRow();
  delete (missingDuration.data as any).durationSeconds;
  assert.equal(validateRecordedHumanReplay(missingDuration), null);

  const missingTimestamp = validRow();
  missingTimestamp.data.player1.actionLog[0].timestamp = '';
  missingTimestamp.data.player2.actionLog[0].timestamp = '';
  assert.equal(validateRecordedHumanReplay(missingTimestamp), null);

  const missingUpdatedAt = validRow();
  missingUpdatedAt.updated_at = null;
  assert.equal(validateRecordedHumanReplay(missingUpdatedAt), null);
});

test('rejects fabricated or inconsistent answer outcomes and question indices', () => {
  const incorrectOutcome = validRow();
  incorrectOutcome.data.player1.actionLog[0].correct = false;
  incorrectOutcome.data.player2.actionLog[0].correct = true;
  assert.equal(validateRecordedHumanReplay(incorrectOutcome), null);

  const incorrectQuestionIndex = validRow();
  incorrectQuestionIndex.data.player1.actionLog[1].questionIndex = 0;
  incorrectQuestionIndex.data.player2.actionLog[0].questionIndex = 1;
  assert.equal(validateRecordedHumanReplay(incorrectQuestionIndex), null);
});

test('rejects fallback identities and actions whose recorded time exceeds the original match', () => {
  const fallbackIdentity = validRow();
  fallbackIdentity.data.player1.name = 'Gladiator';
  fallbackIdentity.data.player2.name = 'Scholar';
  assert.equal(validateRecordedHumanReplay(fallbackIdentity), null);

  const lateAction = validRow();
  lateAction.data.player1.actionLog[1].elapsedMs = 61000;
  lateAction.data.player2.actionLog[0].elapsedMs = 61000;
  assert.equal(validateRecordedHumanReplay(lateAction), null);
});

test('does not switch to a shorter participant log when the selected primary recording is invalid', () => {
  const row = validRow();
  row.data.player1.actionLog[0].timestamp = '';

  // The validator selects the participant with the most complete recorded
  // history. If that primary source fails validation, it fails closed instead
  // of substituting another participant's shorter recording.
  assert.equal(validateRecordedHumanReplay(row), null);
});
