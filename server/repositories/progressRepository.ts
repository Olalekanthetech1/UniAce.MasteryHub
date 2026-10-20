/**
 * UniAce Mastery Hub: Student Progress & Study Batch Repository
 *
 * Implements Stage 5C Phase 2:
 * - When ENABLE_POSTGRES_PROGRESS is true:
 *   - Neon PostgreSQL is the SOLE authoritative source of truth (Zero-Fallback Policy).
 *   - Snapshot-safe atomic Upsert CTE with guarded batches.
 *   - Bounded exponential retries (3 attempts, max 1500ms) failing fast to HTTP 503 on persistent outage.
 *   - Monotonic audit logging to entity_change_log.
 * - When ENABLE_POSTGRES_PROGRESS is false:
 *   - Routes through Firestore baseline.
 */

import crypto from 'crypto';
import { getFeatureFlags } from '../config/features';
import { getAdminApp } from '../firebaseAdmin';
import { queryPostgres } from '../postgresPool';
import { UserCourseProgressEntity } from '../../src/types/databaseSchema';
import { logger } from '../logger';

export interface ProgressSyncInput {
  uid: string;
  courseId: string;
  batchId?: string | null;
  deltaSeconds?: number;
  completedLessonId?: string | null;
  moduleId?: string | null;
  clientTimestamp?: string | null;
}

export interface ProgressSyncResult {
  success: boolean;
  deduplicated: boolean;
  totalStudySeconds: number;
  completedLessonRecorded: boolean;
}

export interface QuizAttemptSubmission {
  uid: string;
  courseId: string;
  moduleId: string;
  quizId: string;
  attemptIdempotencyKey: string;
  timeSpentSeconds: number;
  answers: Array<{
    questionId: string;
    selectedOptionIndex: number;
  }>;
  canonicalQuestions: Array<{
    id: string;
    question: string;
    options: string[];
    correct_option_index: number;
    explanation?: string;
    latex_proof?: string;
  }>;
  passingScorePct?: number;
}

export interface QuizAttemptResult {
  id: string;
  uid: string;
  courseId: string;
  moduleId: string;
  quizId: string;
  scorePct: number;
  passed: boolean;
  timeSpentSeconds: number;
  questionsSnapshotHash: string;
  answersBreakdown: any[];
  attemptedAt: string;
  idempotentRetry: boolean;
}

/**
 * Bounded exponential retry helper for transient network errors
 */
async function executeWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt >= maxRetries) {
        logger.error({ attempt, err: err.message }, '[ProgressRepository] Retries exhausted; throwing HTTP 503');
        const serviceErr: any = new Error(`Progress database unavailable: ${err.message}`);
        serviceErr.statusCode = 503;
        throw serviceErr;
      }
      const backoffMs = Math.min(1500, 100 * Math.pow(3, attempt - 1));
      await new Promise((res) => setTimeout(res, backoffMs));
    }
  }
}

export class ProgressRepository {
  /**
   * Records student study time and/or lesson completions atomically
   */
  async recordStudyBatch(input: ProgressSyncInput): Promise<ProgressSyncResult> {
    const { uid, courseId, batchId, deltaSeconds = 0, completedLessonId, moduleId, clientTimestamp } = input;
    const flags = getFeatureFlags();

    if (flags.ENABLE_POSTGRES_PROGRESS) {
      return executeWithRetry(async () => {
        // Enforce bounds: delta_seconds between 0 and 120
        const boundedDelta = Math.min(120, Math.max(0, Number(deltaSeconds) || 0));
        const effectiveBatchId = batchId && boundedDelta > 0 ? batchId : null;
        const nowIso = new Date().toISOString();
        const payloadHash = crypto
          .createHash('sha256')
          .update(JSON.stringify({ uid, courseId, batchId: effectiveBatchId, deltaSeconds: boundedDelta, completedLessonId }))
          .digest('hex');

        // Check if batch was already recorded for idempotency
        let deduplicated = false;
        if (effectiveBatchId) {
          const checkBatch = await queryPostgres(
            `SELECT batch_id FROM user_study_batches WHERE uid = $1 AND course_id = $2 AND batch_id = $3 LIMIT 1;`,
            [uid, courseId, effectiveBatchId]
          );
          if (checkBatch.rows.length > 0) {
            deduplicated = true;
          }
        }

        // Snapshot-Safe Atomic Upsert CTE with Guarded Batches
        const cteQuery = `
          WITH inserted_batch AS (
            INSERT INTO user_study_batches (uid, course_id, batch_id, delta_seconds, client_timestamp)
            SELECT $1::varchar, $2::varchar, $4::varchar, $5::int, $6::timestamptz
            WHERE $4::varchar IS NOT NULL AND $5::int > 0
            ON CONFLICT (uid, course_id, batch_id) DO NOTHING
            RETURNING delta_seconds
          ),
          inserted_lesson AS (
            INSERT INTO user_lesson_completions (uid, lesson_id, course_id, module_id, time_spent_seconds)
            SELECT $1::varchar, $7::varchar, $2::varchar, $8::varchar, COALESCE($9::int, 0)
            WHERE $7::varchar IS NOT NULL
            ON CONFLICT (uid, lesson_id) DO NOTHING
            RETURNING lesson_id
          ),
          upserted_progress AS (
            INSERT INTO user_course_progress (
              uid,
              course_id,
              total_study_seconds,
              last_studied_lesson_id,
              last_studied_at,
              completed_lessons_count,
              version,
              updated_at
            )
            SELECT
              $1::varchar,
              $2::varchar,
              COALESCE((SELECT delta_seconds FROM inserted_batch), 0),
              $3::varchar,
              NOW(),
              (SELECT COUNT(*)::int FROM inserted_lesson),
              1,
              NOW()
            WHERE EXISTS (SELECT 1 FROM inserted_batch) OR EXISTS (SELECT 1 FROM inserted_lesson)
            ON CONFLICT (uid, course_id) DO UPDATE
            SET
              total_study_seconds = user_course_progress.total_study_seconds + EXCLUDED.total_study_seconds,
              completed_lessons_count = user_course_progress.completed_lessons_count + EXCLUDED.completed_lessons_count,
              last_studied_lesson_id = COALESCE(EXCLUDED.last_studied_lesson_id, user_course_progress.last_studied_lesson_id),
              last_studied_at = NOW(),
              version = user_course_progress.version + 1,
              updated_at = NOW()
            RETURNING *
          )
          INSERT INTO entity_change_log (event_id, entity_type, entity_id, operation, entity_version, payload, transaction_boundary_id, recorded_at)
          SELECT gen_random_uuid()::varchar, 'user_course_progress', $1::varchar || ':' || $2::varchar, 'ATOMIC_SYNC', version, jsonb_build_object('payload_hash', $10::text), $4::varchar, NOW()
          FROM upserted_progress
          RETURNING id;
        `;

        await queryPostgres(cteQuery, [
          uid,
          courseId,
          completedLessonId || null,
          effectiveBatchId,
          boundedDelta,
          clientTimestamp || nowIso,
          completedLessonId || null,
          moduleId || 'general',
          boundedDelta,
          payloadHash
        ]);

        // Retrieve current authoritative values
        const currentRes = await queryPostgres<{ total_study_seconds: number; completed_lessons_count: number }>(
          `SELECT total_study_seconds, completed_lessons_count FROM user_course_progress WHERE uid = $1 AND course_id = $2;`,
          [uid, courseId]
        );

        const totalStudySeconds = currentRes.rows.length > 0 ? Number(currentRes.rows[0].total_study_seconds || 0) : 0;

        return {
          success: true,
          deduplicated,
          totalStudySeconds,
          completedLessonRecorded: Boolean(completedLessonId)
        };
      });
    }

    // Default Firestore baseline path
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const progressDocId = `${uid}_${courseId}`;
    const progressRef = db.collection('user_course_progress').doc(progressDocId);
    const batchRef = batchId ? db.collection('user_study_batches').doc(`${uid}_${courseId}_${batchId}`) : null;

    let totalStudySeconds = 0;
    let deduplicated = false;
    let completedLessonRecorded = false;

    await db.runTransaction(async (tx) => {
      let batchExists = false;
      if (batchRef) {
        const batchSnap = await tx.get(batchRef);
        batchExists = batchSnap.exists;
      }
      const progressSnap = await tx.get(progressRef);

      if (batchExists) {
        deduplicated = true;
        totalStudySeconds = progressSnap.exists ? Number(progressSnap.data()?.total_study_seconds || 0) : 0;
        return;
      }

      const serverTimestampIso = new Date().toISOString();
      const currentSeconds = progressSnap.exists ? Number(progressSnap.data()?.total_study_seconds || 0) : 0;
      totalStudySeconds = currentSeconds + Math.max(0, deltaSeconds);

      if (batchRef && deltaSeconds > 0) {
        tx.set(batchRef, {
          id: `${uid}_${courseId}_${batchId}`,
          uid,
          course_id: courseId,
          batch_id: batchId,
          delta_seconds: deltaSeconds,
          client_timestamp: clientTimestamp || null,
          recorded_at: serverTimestampIso
        });
      }

      const progressUpdates: Record<string, any> = {
        uid,
        course_id: courseId,
        total_study_seconds: totalStudySeconds,
        last_studied_at: serverTimestampIso,
        updated_at: serverTimestampIso
      };

      if (completedLessonId) {
        progressUpdates.last_studied_lesson_id = completedLessonId;
        const lessonCompletionRef = db
          .collection('user_lesson_completions')
          .doc(`${uid}_${completedLessonId}`);
        tx.set(lessonCompletionRef, {
          uid,
          course_id: courseId,
          module_id: moduleId || null,
          lesson_id: completedLessonId,
          completed_at: serverTimestampIso,
          time_spent_seconds: deltaSeconds
        });
        progressUpdates.completed_lessons_count = (progressSnap.data()?.completed_lessons_count || 0) + 1;
        completedLessonRecorded = true;
      }

      tx.set(progressRef, progressUpdates, { merge: true });
    });

    return {
      success: true,
      deduplicated,
      totalStudySeconds,
      completedLessonRecorded
    };
  }

  /**
   * Fetches current study progress for a user and course
   */
  async getCourseProgress(uid: string, courseId: string): Promise<UserCourseProgressEntity | null> {
    const flags = getFeatureFlags();

    if (flags.ENABLE_POSTGRES_PROGRESS) {
      return executeWithRetry(async () => {
        const res = await queryPostgres<any>(
          `SELECT uid, course_id, total_study_seconds, last_studied_lesson_id,
                  last_studied_at, completed_lessons_count, completed_modules_count, version, updated_at
           FROM user_course_progress
           WHERE uid = $1 AND course_id = $2
           LIMIT 1;`,
          [uid, courseId]
        );

        if (res.rows.length === 0) return null;

        const r = res.rows[0];
        return {
          id: `${r.uid}_${r.course_id}`,
          uid: r.uid,
          course_id: r.course_id,
          total_study_seconds: Number(r.total_study_seconds || 0),
          last_studied_lesson_id: r.last_studied_lesson_id || null,
          last_studied_at: typeof r.last_studied_at === 'string' ? r.last_studied_at : new Date(r.last_studied_at).toISOString(),
          completed_lessons_count: Number(r.completed_lessons_count || 0),
          completed_modules_count: Number(r.completed_modules_count || 0),
          version: Number(r.version || 1),
          updated_at: typeof r.updated_at === 'string' ? r.updated_at : new Date(r.updated_at).toISOString()
        };
      });
    }

    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const snap = await db.collection('user_course_progress').doc(`${uid}_${courseId}`).get().catch(() => null);
    if (!snap || !snap.exists) return null;

    const data = snap.data() || {};
    return {
      id: snap.id,
      uid: data.uid,
      course_id: data.course_id,
      total_study_seconds: Number(data.total_study_seconds || 0),
      last_studied_lesson_id: data.last_studied_lesson_id || null,
      last_studied_at: data.last_studied_at || new Date().toISOString(),
      completed_lessons_count: Number(data.completed_lessons_count || 0),
      completed_modules_count: Number(data.completed_modules_count || 0),
      version: Number(data.version || 1),
      updated_at: data.updated_at || new Date().toISOString()
    };
  }

  /**
   * Fetches list of completed lesson IDs for a user in a course
   */
  async getUserLessonCompletions(uid: string, courseId: string): Promise<string[]> {
    const flags = getFeatureFlags();

    if (flags.ENABLE_POSTGRES_PROGRESS) {
      return executeWithRetry(async () => {
        const res = await queryPostgres<{ lesson_id: string }>(
          `SELECT lesson_id FROM user_lesson_completions WHERE uid = $1 AND course_id = $2 ORDER BY completed_at ASC;`,
          [uid, courseId]
        );
        return res.rows.map((r) => r.lesson_id);
      });
    }

    const app = getAdminApp();
    if (!app) return [];
    const db = app.firestore();
    const snap = await db
      .collection('user_lesson_completions')
      .where('uid', '==', uid)
      .where('course_id', '==', courseId)
      .get()
      .catch(() => ({ docs: [] } as any));

    return snap.docs.map((d: any) => d.data().lesson_id).filter(Boolean);
  }

  /**
   * Authoritative server-side quiz grading & idempotent attempt recording
   */
  async recordQuizAttempt(submission: QuizAttemptSubmission): Promise<QuizAttemptResult> {
    const {
      uid,
      courseId,
      moduleId,
      quizId,
      attemptIdempotencyKey,
      timeSpentSeconds,
      answers,
      canonicalQuestions,
      passingScorePct = 70
    } = submission;

    // 1. Authoritative grading against canonical questions
    const questionMap = new Map<string, (typeof canonicalQuestions)[0]>();
    canonicalQuestions.forEach((q) => questionMap.set(q.id, q));

    let correctCount = 0;
    const answersBreakdown = answers.map((ans) => {
      const canonical = questionMap.get(ans.questionId);
      const isCorrect = canonical ? canonical.correct_option_index === ans.selectedOptionIndex : false;
      if (isCorrect) correctCount++;
      return {
        questionId: ans.questionId,
        selectedOptionIndex: ans.selectedOptionIndex,
        correctOptionIndex: canonical ? canonical.correct_option_index : -1,
        isCorrect,
        explanation: canonical?.explanation || null,
        latexProof: canonical?.latex_proof || null
      };
    });

    const totalQuestions = canonicalQuestions.length > 0 ? canonicalQuestions.length : 1;
    const rawScore = (correctCount / totalQuestions) * 100;
    const scorePct = Number(rawScore.toFixed(2));
    const passed = scorePct >= passingScorePct;
    const questionsSnapshotHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(canonicalQuestions.map((q) => ({ id: q.id, correct: q.correct_option_index }))))
      .digest('hex');

    const flags = getFeatureFlags();

    if (flags.ENABLE_POSTGRES_PROGRESS) {
      return executeWithRetry(async () => {
        // Idempotent upsert: ON CONFLICT DO UPDATE SET uid = EXCLUDED.uid RETURNING *
        const insertSql = `
          INSERT INTO user_quiz_attempts (
            uid, course_id, module_id, quiz_id, attempt_idempotency_key,
            score_pct, passed, time_spent_seconds, questions_snapshot_hash,
            answers_breakdown, attempted_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
          ON CONFLICT (uid, quiz_id, attempt_idempotency_key)
          DO UPDATE SET uid = EXCLUDED.uid
          RETURNING *;
        `;

        const res = await queryPostgres<any>(insertSql, [
          uid,
          courseId,
          moduleId,
          quizId,
          attemptIdempotencyKey,
          scorePct,
          passed,
          Math.max(0, timeSpentSeconds || 0),
          questionsSnapshotHash,
          JSON.stringify(answersBreakdown)
        ]);

        const row = res.rows[0];

        // Audit log
        await queryPostgres(
          `INSERT INTO entity_change_log (event_id, entity_type, entity_id, operation, entity_version, payload, transaction_boundary_id, recorded_at)
           VALUES (gen_random_uuid()::varchar, 'user_quiz_attempts', $1 || ':' || $2, 'QUIZ_SUBMIT', 1, $3::jsonb, $4, NOW());`,
          [uid, quizId, JSON.stringify({ scorePct, passed, questionsSnapshotHash }), attemptIdempotencyKey]
        ).catch(() => {});

        return {
          id: row.id,
          uid: row.uid,
          courseId: row.course_id,
          moduleId: row.module_id,
          quizId: row.quiz_id,
          scorePct: Number(row.score_pct),
          passed: Boolean(row.passed),
          timeSpentSeconds: Number(row.time_spent_seconds),
          questionsSnapshotHash: row.questions_snapshot_hash,
          answersBreakdown: row.answers_breakdown,
          attemptedAt: typeof row.attempted_at === 'string' ? row.attempted_at : new Date(row.attempted_at).toISOString(),
          idempotentRetry: res.rowCount === 0
        };
      });
    }

    // Firestore baseline path
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const attemptDocId = `${uid}_${quizId}_${attemptIdempotencyKey}`;
    const attemptRef = db.collection('user_quiz_attempts').doc(attemptDocId);

    const docSnap = await attemptRef.get();
    if (docSnap.exists) {
      const data = docSnap.data()!;
      return {
        id: docSnap.id,
        uid: data.uid,
        courseId: data.course_id,
        moduleId: data.module_id,
        quizId: data.quiz_id,
        scorePct: Number(data.score_pct),
        passed: Boolean(data.passed),
        timeSpentSeconds: Number(data.time_spent_seconds),
        questionsSnapshotHash: data.questions_snapshot_hash,
        answersBreakdown: data.answers_breakdown,
        attemptedAt: data.attempted_at,
        idempotentRetry: true
      };
    }

    const nowIso = new Date().toISOString();
    const newAttempt = {
      uid,
      course_id: courseId,
      module_id: moduleId,
      quiz_id: quizId,
      attempt_idempotency_key: attemptIdempotencyKey,
      score_pct: scorePct,
      passed,
      time_spent_seconds: timeSpentSeconds,
      questions_snapshot_hash: questionsSnapshotHash,
      answers_breakdown: answersBreakdown,
      attempted_at: nowIso
    };

    await attemptRef.set(newAttempt);

    return {
      id: attemptDocId,
      uid,
      courseId,
      moduleId,
      quizId,
      scorePct,
      passed,
      timeSpentSeconds,
      questionsSnapshotHash,
      answersBreakdown,
      attemptedAt: nowIso,
      idempotentRetry: false
    };
  }
}

export const progressRepository = new ProgressRepository();
