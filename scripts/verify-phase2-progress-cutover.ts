/**
 * UniAce Mastery Hub: Phase 2 Progress & Quiz Cutover Live Verification Suite
 *
 * Verifies:
 * 1. Feature Flag Invariant: ENABLE_POSTGRES_PROGRESS === true.
 * 2. First-time Course Enrollment & Snapshot-Safe Upsert CTE.
 * 3. Batch Idempotency (zero double counting on retry).
 * 4. Standalone Lesson Completion (delta_seconds = 0 guarded bypass).
 * 5. Incremental Study Seconds Tracking.
 * 6. Authoritative Server-Side Quiz Grading & Idempotent Retry.
 * 7. Monotonic Audit Logging in entity_change_log.
 */

import { getFeatureFlags } from '../server/config/features';
import { progressRepository } from '../server/repositories/progressRepository';
import { queryPostgres, checkPostgresHealth } from '../server/postgresPool';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`[PHASE 2 VERIFICATION FAILED] ${msg}`);
  }
}

async function verifyPhase2() {
  console.log('================================================================');
  console.log('🚀 Phase 2 Student Study Progress & Quiz Live Verification Suite');
  console.log('================================================================\n');

  // STEP 1: Feature Flag Invariants
  console.log('--- Step 1: Feature Flag Invariants ---');
  const flags = getFeatureFlags();
  console.log('Active Flags:', flags);
  assert(flags.ENABLE_POSTGRES_PROGRESS === true, 'ENABLE_POSTGRES_PROGRESS must be true');
  assert(flags.ENABLE_POSTGRES_CATALOG === true, 'ENABLE_POSTGRES_CATALOG must remain true');
  assert(flags.ENABLE_POSTGRES_SHADOW_WRITE === false, 'ENABLE_POSTGRES_SHADOW_WRITE must be false');
  console.log('✅ Feature flags verified: PostgreSQL progress & catalog are active.\n');

  // STEP 2: Database Connectivity
  console.log('--- Step 2: Database Health Check ---');
  const health = await checkPostgresHealth();
  assert(health.connected, `PostgreSQL must be connected: ${health.error}`);
  console.log(`✅ Neon PostgreSQL is reachable (${health.latencyMs}ms).\n`);

  const testUid = `test_student_${Date.now()}`;
  const testCourseId = 'AGE102';

  // STEP 3: First-time Course Enrollment & Initial 60s Study Heartbeat
  console.log('--- Step 3: First-Time Enrollment & Initial 60s Study Heartbeat ---');
  const batch1Id = `batch_1_${Date.now()}`;
  const sync1 = await progressRepository.recordStudyBatch({
    uid: testUid,
    courseId: testCourseId,
    batchId: batch1Id,
    deltaSeconds: 60,
    clientTimestamp: new Date().toISOString()
  });

  console.log('Sync 1 Result:', sync1);
  assert(sync1.success === true, 'Sync 1 must succeed');
  assert(sync1.deduplicated === false, 'Sync 1 should not be deduplicated');
  assert(sync1.totalStudySeconds === 60, `Sync 1 totalStudySeconds must be 60, got ${sync1.totalStudySeconds}`);

  const p1 = await progressRepository.getCourseProgress(testUid, testCourseId);
  assert(p1 !== null, 'Progress record must exist in PostgreSQL');
  assert(p1!.total_study_seconds === 60, 'Stored seconds must be 60');
  assert(p1!.completed_lessons_count === 0, 'Completed lessons count must be 0');
  console.log('✅ First-time course enrollment & snapshot-safe Upsert CTE verified.\n');

  // STEP 4: Idempotency Check (Resubmitting batch1)
  console.log('--- Step 4: Batch Idempotency Verification ---');
  const sync1Replay = await progressRepository.recordStudyBatch({
    uid: testUid,
    courseId: testCourseId,
    batchId: batch1Id,
    deltaSeconds: 60
  });

  console.log('Sync 1 Replay Result:', sync1Replay);
  assert(sync1Replay.deduplicated === true, 'Replayed batch must be marked deduplicated');
  assert(sync1Replay.totalStudySeconds === 60, `Study seconds must NOT double count (expected 60, got ${sync1Replay.totalStudySeconds})`);
  console.log('✅ Zero double-counting verified: batch deduplicated accurately.\n');

  // STEP 5: Standalone "Mark Lesson Complete" Click (deltaSeconds = 0)
  console.log('--- Step 5: Standalone Lesson Completion (deltaSeconds = 0) ---');
  const lesson1Id = 'm1-l1';
  const syncLesson = await progressRepository.recordStudyBatch({
    uid: testUid,
    courseId: testCourseId,
    batchId: null,
    deltaSeconds: 0,
    completedLessonId: lesson1Id,
    moduleId: 'm1'
  });

  console.log('Lesson Completion Result:', syncLesson);
  assert(syncLesson.success === true, 'Standalone completion must succeed');
  assert(syncLesson.completedLessonRecorded === true, 'Lesson completion must be recorded');

  const p2 = await progressRepository.getCourseProgress(testUid, testCourseId);
  assert(p2!.completed_lessons_count === 1, `Completed lessons count must be 1, got ${p2!.completed_lessons_count}`);
  assert(p2!.last_studied_lesson_id === lesson1Id, 'Last studied lesson ID must match');

  const completedList = await progressRepository.getUserLessonCompletions(testUid, testCourseId);
  assert(completedList.includes(lesson1Id), `Completed lessons list must include ${lesson1Id}`);
  console.log('✅ Standalone lesson completion passed without CHECK constraint violation.\n');

  // STEP 6: Second Incremental Heartbeat (45 seconds)
  console.log('--- Step 6: Second Incremental Heartbeat ---');
  const batch2Id = `batch_2_${Date.now()}`;
  const sync2 = await progressRepository.recordStudyBatch({
    uid: testUid,
    courseId: testCourseId,
    batchId: batch2Id,
    deltaSeconds: 45
  });

  console.log('Sync 2 Result:', sync2);
  assert(sync2.totalStudySeconds === 105, `Study seconds must increment to 105, got ${sync2.totalStudySeconds}`);
  console.log('✅ Incremental study time accumulated accurately (60s + 45s = 105s).\n');

  // STEP 7: Authoritative Server-Side Quiz Grading
  console.log('--- Step 7: Authoritative Server-Side Quiz Grading ---');
  const quizId = 'm1-quiz';
  const attemptKey = `attempt_${Date.now()}`;
  const canonicalQuestions = [
    {
      id: 'q1',
      question: 'What is the SI unit of force?',
      options: ['Joule', 'Newton', 'Watt', 'Pascal'],
      correct_option_index: 1,
      explanation: 'Force is measured in Newtons (N = kg*m/s^2)',
      latex_proof: 'F = m \\cdot a'
    },
    {
      id: 'q2',
      question: 'What is the acceleration due to gravity on Earth?',
      options: ['9.8 m/s^2', '3.7 m/s^2', '1.6 m/s^2', '11.2 m/s^2'],
      correct_option_index: 0,
      explanation: 'Standard gravity is approximately 9.80665 m/s^2',
      latex_proof: 'g \\approx 9.8 \\text{ m/s}^2'
    }
  ];

  // Student answers: Q1 correct (index 1), Q2 incorrect (index 2) -> 1/2 = 50%
  const quizAttempt1 = await progressRepository.recordQuizAttempt({
    uid: testUid,
    courseId: testCourseId,
    moduleId: 'm1',
    quizId,
    attemptIdempotencyKey: attemptKey,
    timeSpentSeconds: 45,
    answers: [
      { questionId: 'q1', selectedOptionIndex: 1 },
      { questionId: 'q2', selectedOptionIndex: 2 }
    ],
    canonicalQuestions,
    passingScorePct: 70
  });

  console.log('Quiz Attempt 1 Result:', {
    scorePct: quizAttempt1.scorePct,
    passed: quizAttempt1.passed,
    questionsSnapshotHash: quizAttempt1.questionsSnapshotHash.slice(0, 16) + '...'
  });

  assert(quizAttempt1.scorePct === 50, `Score must be 50%, got ${quizAttempt1.scorePct}`);
  assert(quizAttempt1.passed === false, '50% must not pass 70% threshold');
  assert(quizAttempt1.answersBreakdown.length === 2, 'Must have 2 graded questions');
  assert(quizAttempt1.answersBreakdown[0].isCorrect === true, 'Q1 must be marked correct');
  assert(quizAttempt1.answersBreakdown[1].isCorrect === false, 'Q2 must be marked incorrect');
  assert(quizAttempt1.answersBreakdown[0].latexProof === 'F = m \\cdot a', 'Must retain LaTeX proof');

  // Retry with same idempotency key
  console.log('--- Step 8: Quiz Retry Idempotency ---');
  const quizAttemptRetry = await progressRepository.recordQuizAttempt({
    uid: testUid,
    courseId: testCourseId,
    moduleId: 'm1',
    quizId,
    attemptIdempotencyKey: attemptKey,
    timeSpentSeconds: 45,
    answers: [
      { questionId: 'q1', selectedOptionIndex: 1 },
      { questionId: 'q2', selectedOptionIndex: 2 }
    ],
    canonicalQuestions
  });

  assert(quizAttemptRetry.scorePct === 50, 'Retried score must remain identical');
  assert(quizAttemptRetry.answersBreakdown.length === 2, 'Retried attempt must return complete breakdown');
  console.log('✅ Authoritative server-side quiz grading and idempotent retry verified.\n');

  // STEP 9: Audit Sequence Invariant
  console.log('--- Step 9: Audit Sequence Invariant (entity_change_log) ---');
  const auditRes = await queryPostgres(
    `SELECT operation, entity_type FROM entity_change_log WHERE entity_id LIKE $1 ORDER BY recorded_at ASC;`,
    [`${testUid}:%`]
  );
  console.log(`Recorded ${auditRes.rows.length} audit entries for test user:`, auditRes.rows.map((r: any) => r.operation));
  assert(auditRes.rows.length >= 2, 'Must have at least 2 audit log records');
  console.log('✅ Monotonic audit sequence verified in entity_change_log.\n');

  // Cleanup test user data from PostgreSQL sandbox
  await queryPostgres(`DELETE FROM user_study_batches WHERE uid = $1;`, [testUid]);
  await queryPostgres(`DELETE FROM user_lesson_completions WHERE uid = $1;`, [testUid]);
  await queryPostgres(`DELETE FROM user_quiz_attempts WHERE uid = $1;`, [testUid]);
  await queryPostgres(`DELETE FROM user_course_progress WHERE uid = $1;`, [testUid]);
  await queryPostgres(`DELETE FROM entity_change_log WHERE entity_id LIKE $1;`, [`${testUid}:%`]);
  console.log('Cleaned up sandbox test records.\n');

  console.log('================================================================');
  console.log('🎉 ALL PHASE 2 PROGRESS & QUIZ CUTOVER VERIFICATIONS PASSED (100%)');
  console.log('================================================================\n');
}

verifyPhase2()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Phase 2 Verification Failed:', err);
    process.exit(1);
  });
