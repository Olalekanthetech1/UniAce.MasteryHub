/**
 * UniAce Mastery Hub: Phase 2 Historical Progress Migration & High-Water Mark Snapshot
 *
 * Scans Firestore for existing student progress, study time batches, lesson completions,
 * and quiz attempts, recording an authoritative migration_high_water_mark and migrating
 * all records into Neon PostgreSQL with idempotent ON CONFLICT semantics.
 */

import crypto from 'crypto';
import { getAdminApp } from '../server/firebaseAdmin';
import { queryPostgres, checkPostgresHealth } from '../server/postgresPool';

export interface MigrationSummary {
  highWaterMark: string;
  userProgressCount: number;
  studyBatchesCount: number;
  lessonCompletionsCount: number;
  quizAttemptsCount: number;
  usersScanned: number;
}

export async function runHistoricalProgressMigration(): Promise<MigrationSummary> {
  console.log('================================================================');
  console.log('📦 Starting Historical Progress Migration to Neon PostgreSQL');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL is not reachable: ${health.error}`);
  }

  const app = getAdminApp();
  if (!app) {
    throw new Error('Firebase Admin App unavailable');
  }
  const db = app.firestore();

  // Authoritative High-Water Mark Timestamp
  const highWaterMark = new Date().toISOString();
  console.log(`Authoritative High-Water Mark recorded: ${highWaterMark}\n`);

  let userProgressCount = 0;
  let studyBatchesCount = 0;
  let lessonCompletionsCount = 0;
  let quizAttemptsCount = 0;
  let usersScanned = 0;

  // 1. Scan user_course_progress collection
  console.log('--- 1. Migrating user_course_progress ---');
  const ucpSnap = await db.collection('user_course_progress').get().catch(() => ({ docs: [] } as any));
  for (const doc of ucpSnap.docs) {
    const d = doc.data();
    if (d.uid && d.course_id) {
      await queryPostgres(
        `INSERT INTO user_course_progress (
          uid, course_id, total_study_seconds, last_studied_lesson_id,
          last_studied_at, completed_lessons_count, completed_modules_count, version, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (uid, course_id) DO UPDATE SET
          total_study_seconds = EXCLUDED.total_study_seconds,
          last_studied_lesson_id = COALESCE(EXCLUDED.last_studied_lesson_id, user_course_progress.last_studied_lesson_id),
          last_studied_at = EXCLUDED.last_studied_at,
          completed_lessons_count = EXCLUDED.completed_lessons_count,
          completed_modules_count = EXCLUDED.completed_modules_count,
          version = EXCLUDED.version,
          updated_at = EXCLUDED.updated_at`,
        [
          d.uid,
          d.course_id,
          Math.max(0, Number(d.total_study_seconds || 0)),
          d.last_studied_lesson_id || null,
          d.last_studied_at || highWaterMark,
          Math.max(0, Number(d.completed_lessons_count || 0)),
          Math.max(0, Number(d.completed_modules_count || 0)),
          Number(d.version || 1),
          d.updated_at || highWaterMark
        ]
      );
      userProgressCount++;
    }
  }
  console.log(`Migrated ${userProgressCount} user_course_progress records.`);

  // 2. Scan user_study_batches collection
  console.log('--- 2. Migrating user_study_batches ---');
  const usbSnap = await db.collection('user_study_batches').get().catch(() => ({ docs: [] } as any));
  for (const doc of usbSnap.docs) {
    const d = doc.data();
    const delta = Number(d.delta_seconds || 0);
    if (d.uid && d.course_id && d.batch_id && delta > 0 && delta <= 120) {
      // Ensure parent progress exists first
      await queryPostgres(
        `INSERT INTO user_course_progress (uid, course_id, total_study_seconds, last_studied_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (uid, course_id) DO NOTHING`,
        [d.uid, d.course_id, delta, d.recorded_at || highWaterMark, d.recorded_at || highWaterMark]
      );

      await queryPostgres(
        `INSERT INTO user_study_batches (uid, course_id, batch_id, delta_seconds, client_timestamp, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (uid, course_id, batch_id) DO NOTHING`,
        [d.uid, d.course_id, d.batch_id, delta, d.client_timestamp || highWaterMark, d.recorded_at || highWaterMark]
      );
      studyBatchesCount++;
    }
  }
  console.log(`Migrated ${studyBatchesCount} user_study_batches records.`);

  // 3. Scan user_lesson_completions collection
  console.log('--- 3. Migrating user_lesson_completions ---');
  const ulcSnap = await db.collection('user_lesson_completions').get().catch(() => ({ docs: [] } as any));
  for (const doc of ulcSnap.docs) {
    const d = doc.data();
    if (d.uid && d.lesson_id && d.course_id) {
      // Ensure parent progress exists
      await queryPostgres(
        `INSERT INTO user_course_progress (uid, course_id, last_studied_lesson_id, last_studied_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (uid, course_id) DO NOTHING`,
        [d.uid, d.course_id, d.lesson_id, d.completed_at || highWaterMark, d.completed_at || highWaterMark]
      );

      await queryPostgres(
        `INSERT INTO user_lesson_completions (uid, lesson_id, course_id, module_id, completed_at, time_spent_seconds)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (uid, lesson_id) DO NOTHING`,
        [
          d.uid,
          d.lesson_id,
          d.course_id,
          d.module_id || 'unknown',
          d.completed_at || highWaterMark,
          Math.max(0, Number(d.time_spent_seconds || 0))
        ]
      );
      lessonCompletionsCount++;
    }
  }
  console.log(`Migrated ${lessonCompletionsCount} user_lesson_completions records.`);

  // 4. Scan user_quiz_attempts collection
  console.log('--- 4. Migrating user_quiz_attempts ---');
  const uqaSnap = await db.collection('user_quiz_attempts').get().catch(() => ({ docs: [] } as any));
  for (const doc of uqaSnap.docs) {
    const d = doc.data();
    if (d.uid && d.course_id && d.quiz_id) {
      const score = Math.min(100, Math.max(0, Number(d.score_pct || d.score || 0)));
      const answersBreakdown = Array.isArray(d.answers_breakdown) ? d.answers_breakdown : (Array.isArray(d.answers) ? d.answers : []);
      const snapshotHash = d.questions_snapshot_hash || crypto.createHash('sha256').update(doc.id).digest('hex');

      await queryPostgres(
        `INSERT INTO user_quiz_attempts (
          uid, course_id, module_id, quiz_id, attempt_idempotency_key,
          score_pct, passed, time_spent_seconds, questions_snapshot_hash, answers_breakdown, attempted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (uid, quiz_id, attempt_idempotency_key) DO NOTHING`,
        [
          d.uid,
          d.course_id,
          d.module_id || 'unknown',
          d.quiz_id,
          d.attempt_idempotency_key || doc.id,
          score,
          Boolean(d.passed ?? (score >= 70)),
          Math.max(0, Number(d.time_spent_seconds || 0)),
          snapshotHash,
          JSON.stringify(answersBreakdown),
          d.attempted_at || highWaterMark
        ]
      );
      quizAttemptsCount++;
    }
  }
  console.log(`Migrated ${quizAttemptsCount} user_quiz_attempts records.`);

  // 5. Store high-water mark in progress_migration_checkpoints
  await queryPostgres(
    `CREATE TABLE IF NOT EXISTS progress_migration_checkpoints (
      phase VARCHAR(64) PRIMARY KEY,
      high_water_mark TIMESTAMPTZ NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`
  );

  await queryPostgres(
    `INSERT INTO progress_migration_checkpoints (phase, high_water_mark, metadata, completed_at)
     VALUES ('phase_2_progress', $1, $2, NOW())
     ON CONFLICT (phase) DO UPDATE SET
       high_water_mark = EXCLUDED.high_water_mark,
       metadata = EXCLUDED.metadata,
       completed_at = EXCLUDED.completed_at`,
    [
      highWaterMark,
      JSON.stringify({
        userProgressCount,
        studyBatchesCount,
        lessonCompletionsCount,
        quizAttemptsCount
      })
    ]
  );

  console.log('\n================================================================');
  console.log('🎉 HISTORICAL PROGRESS MIGRATION COMPLETED');
  console.log(`High-Water Mark: ${highWaterMark}`);
  console.log('================================================================\n');

  return {
    highWaterMark,
    userProgressCount,
    studyBatchesCount,
    lessonCompletionsCount,
    quizAttemptsCount,
    usersScanned
  };
}

// Standalone execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runHistoricalProgressMigration()
    .then((res) => {
      console.log('Result:', JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Migration failed:', err);
      process.exit(1);
    });
}
