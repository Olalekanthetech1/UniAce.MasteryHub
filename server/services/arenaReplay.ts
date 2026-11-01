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

  // The replay query must prove that both participant UIDs exist in the
  // authoritative users table; JSON fields alone are not proof of identity.
  const verifiedPlayer1Uid = row.verified_player1_uid;
  const verifiedPlayer2Uid = row.verified_player2_uid;
  if (
    typeof verifiedPlayer1Uid !== 'string' ||
    typeof verifiedPlayer2Uid !== 'string' ||
    !verifiedPlayer1Uid.trim() ||
    !verifiedPlayer2Uid.trim() ||
    verifiedPlayer1Uid === verifiedPlayer2Uid ||
    row.data.player1?.uid !== verifiedPlayer1Uid ||
    row.data.player2?.uid !== verifiedPlayer2Uid
  ) return null;

  const recordedAt = toValidTimestamp(row.updated_at);
  if (!recordedAt) return null;
  const recordedAtMs = new Date(recordedAt).getTime();

  const startedAtEpochMs = row.data.startedAtEpochMs;
  if (typeof startedAtEpochMs !== 'number' || !Number.isFinite(startedAtEpochMs) || startedAtEpochMs <= 0) {
    return null;
  }

  const durationSeconds = row.data.durationSeconds;
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  const questions = row.data.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  if (!questions.every(question =>
    isRecord(question) &&
    typeof question.question === 'string' &&
    question.question.trim().length > 0 &&
    typeof question.correctAnswer === 'string' &&
    question.correctAnswer.trim().length > 0 &&
    Array.isArray(question.options) &&
    question.options.length >= 2 &&
    question.options.every(option => typeof option === 'string' && option.trim().length > 0) &&
    question.options.includes(question.correctAnswer)
  )) return null;

  const humanPlayers = [row.data.player1, row.data.player2]
    .filter((player): player is Record<string, any> =>
      isRecord(player) &&
      player.opponentType === 'human' &&
      typeof player.uid === 'string' &&
      player.uid.trim().length > 0 &&
      typeof player.name === 'string' &&
      player.name.trim().length > 0 &&
      !['gladiator', 'scholar'].includes(player.name.trim().toLowerCase()) &&
      Array.isArray(player.actionLog) &&
      player.actionLog.length > 0
    )
    .sort((left, right) => right.actionLog.length - left.actionLog.length);

  for (const sourcePlayer of humanPlayers) {
    const actions: VerifiedRecordedHumanReplay['actions'] = [];
    let previousElapsedMs = 0;
    let previousTimestampMs = 0;
    let valid = true;

    for (let index = 0; index < sourcePlayer.actionLog.length; index += 1) {
      const action = sourcePlayer.actionLog[index];
      if (!isRecord(action)) {
        valid = false;
        break;
      }

      const questionIndex = action.questionIndex;
      const selectedOption = action.selectedOption;
      const elapsedMs = action.elapsedMs;
      const timestamp = toValidTimestamp(action.timestamp);
      const timestampMs = timestamp ? new Date(timestamp).getTime() : NaN;
      const question = questions[index];

      if (
        questionIndex !== index ||
        questionIndex >= questions.length ||
        typeof selectedOption !== 'string' ||
        !Array.isArray(question.options) ||
        !question.options.includes(selectedOption) ||
        typeof action.correct !== 'boolean' ||
        typeof elapsedMs !== 'number' ||
        !Number.isFinite(elapsedMs) ||
        elapsedMs <= 0 ||
        elapsedMs < previousElapsedMs ||
        elapsedMs > durationSeconds * 1000 ||
        !timestamp ||
        !Number.isFinite(timestampMs) ||
        timestampMs < startedAtEpochMs ||
        timestampMs > recordedAtMs ||
        Math.abs(timestampMs - (startedAtEpochMs + elapsedMs)) > 5000 ||
        timestampMs < previousTimestampMs
      ) {
        valid = false;
        break;
      }

      const correct = selectedOption === question.correctAnswer;
      if (action.correct !== correct) {
        valid = false;
        break;
      }

      actions.push({ questionIndex, selectedOption, correct, elapsedMs, timestamp });
      previousElapsedMs = elapsedMs;
      previousTimestampMs = timestampMs;
    }

    if (valid && actions.length > 0) {
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
  }

  return null;
}
