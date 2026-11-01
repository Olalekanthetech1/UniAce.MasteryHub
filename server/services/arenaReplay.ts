export interface VerifiedRecordedHumanReplay {
  id: string;
  recordedAt: string;
  durationSeconds: number;
  questions: Array<Record<string, unknown>>;
  sourcePlayer: {
    uid: string;
    name: string;
    avatar: string | null;
  };
  actions: Array<{
    questionIndex: number;
    selectedOption: string;
    correct: boolean;
    elapsedMs: number;
    timestamp: string;
  }>;
}

const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toValidTimestamp = (value: unknown): string | null => {
  if (!(typeof value === 'string' || value instanceof Date)) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

/**
 * Accept only a finished, genuinely human-vs-human battle with a complete,
 * internally consistent question set and server-recorded answer events.
 * No timing, identity, question, answer, or score defaults are synthesized.
 */
export function validateRecordedHumanReplay(row: unknown): VerifiedRecordedHumanReplay | null {
  if (!isRecord(row) || typeof row.id !== 'string' || !row.id.trim()) return null;
  if (!isRecord(row.data) || row.data.status !== 'finished' || row.data.opponentType !== 'human') return null;

  const recordedAt = toValidTimestamp(row.updated_at);
  if (!recordedAt) return null;

  const durationSeconds = row.data.durationSeconds;
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  const questions = row.data.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  if (!questions.every(question =>
    isRecord(question) &&
    typeof question.correctAnswer === 'string' &&
    question.correctAnswer.trim().length > 0
  )) return null;

  const humanPlayers = [row.data.player1, row.data.player2]
    .filter((player): player is Record<string, any> =>
      isRecord(player) &&
      player.opponentType === 'human' &&
      Array.isArray(player.actionLog) &&
      player.actionLog.length > 0
    )
    .sort((left, right) => right.actionLog.length - left.actionLog.length);

  // Choose the most complete source once. An invalid source must fail closed;
  // it must never cause a switch to another participant's recording.
  const sourcePlayer = humanPlayers[0];
  if (!sourcePlayer) return null;

  if (
    typeof sourcePlayer.uid !== 'string' ||
    !sourcePlayer.uid.trim() ||
    typeof sourcePlayer.name !== 'string' ||
    !sourcePlayer.name.trim() ||
    ['gladiator', 'scholar'].includes(sourcePlayer.name.trim().toLowerCase())
  ) return null;

  const actions: VerifiedRecordedHumanReplay['actions'] = [];
  let previousElapsedMs = 0;

  for (let index = 0; index < sourcePlayer.actionLog.length; index += 1) {
    const action = sourcePlayer.actionLog[index];
    if (!isRecord(action)) return null;

    const questionIndex = action.questionIndex;
    const selectedOption = action.selectedOption;
    const elapsedMs = action.elapsedMs;
    const timestamp = toValidTimestamp(action.timestamp);
    const question = questions[index];

    if (
      questionIndex !== index ||
      questionIndex >= questions.length ||
      typeof selectedOption !== 'string' ||
      typeof action.correct !== 'boolean' ||
      typeof elapsedMs !== 'number' ||
      !Number.isFinite(elapsedMs) ||
      elapsedMs <= 0 ||
      elapsedMs < previousElapsedMs ||
      elapsedMs > durationSeconds * 1000 ||
      !timestamp
    ) return null;

    const correct = selectedOption === question.correctAnswer;
    if (action.correct !== correct) return null;

    actions.push({ questionIndex, selectedOption, correct, elapsedMs, timestamp });
    previousElapsedMs = elapsedMs;
  }

  if (actions.length === 0) return null;

  return {
    id: row.id,
    recordedAt,
    durationSeconds,
    questions,
    sourcePlayer: {
      uid: sourcePlayer.uid,
      name: sourcePlayer.name.trim(),
      avatar: typeof sourcePlayer.avatar === 'string' && sourcePlayer.avatar.trim()
        ? sourcePlayer.avatar
        : null
    },
    actions
  };
}
