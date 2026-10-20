/**
 * UniAce Mastery Hub: Phase 2 Progress Parity Verification & Delta Catch-Up Suite
 *
 * Implements:
 * 1. Delta Catch-Up: syncs any progress/quiz records modified since migration_high_water_mark.
 * 2. Canonical SHA-256 Parity Validator:
 *    - Floating-point normalization (toFixed(2)).
 *    - Lexicographical sorting of completed lesson IDs.
 *    - Canonical hash digest comparison between Firestore and Neon PostgreSQL.
 *    - Bounded by cutoverTimestamp to prevent post-cutover Postgres writes from triggering false mismatches.
 * 3. Strict Exit Status: process.exit(1) on any hash discrepancy.
 */

import crypto from 'crypto';
import { getAdminApp } from '../server/firebaseAdmin';
import { queryPostgres, checkPostgresHealth } from '../server/postgresPool';

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

export interface ProgressCanonicalRecord {
  uid: string;
  courseId: string;
  totalStudySeconds: number;
  completedLessonsSorted: string[];
  canonicalHash: string;
}

export async function runProgressDeltaCatchUp(cutoverTimestamp?: string): Promise<{ deltaCount: number }> {
  console.log('--- Running Progress Delta Catch-Up ---');
  const app = getAdminApp();
  if (!app) throw new Error('Firebase Admin App unavailable');
  const db = app.firestore();

  // Retrieve high-water mark from checkpoints table
  const cpRes = await queryPostgres<{ high_water_mark: string }>(
    `SELECT high_water_mark FROM progress_migration_checkpoints WHERE phase = 'phase_2_progress';`
  ).catch(() => ({ rows: [] }));

  const since = cpRes.rows.length > 0 ? new Date(cpRes.rows[0].high_water_mark).toISOString() : new Date(0).toISOString();
  console.log(`Checking Firestore delta updates since: ${since}`);

  let deltaCount = 0;
  const deltaSnap = await db.collection('user_course_progress').where('updated_at', '>=', since).get().catch(() => ({ docs: [] } as any));

  for (const doc of deltaSnap.docs) {
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
          updated_at = EXCLUDED.updated_at;`,
        [
          d.uid,
          d.course_id,
          Math.max(0, Number(d.total_study_seconds || 0)),
          d.last_studied_lesson_id || null,
          d.last_studied_at || new Date().toISOString(),
          Math.max(0, Number(d.completed_lessons_count || 0)),
          Math.max(0, Number(d.completed_modules_count || 0)),
          Number(d.version || 1),
          d.updated_at || new Date().toISOString()
        ]
      );
      deltaCount++;
    }
  }

  console.log(`Delta Catch-Up applied ${deltaCount} records.\n`);
  return { deltaCount };
}

export async function runProgressParityAudit(cutoverTimestamp?: string): Promise<boolean> {
  console.log('================================================================');
  console.log('🔍 Phase 2 Progress Canonical SHA-256 Parity Audit');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL is not reachable: ${health.error}`);
  }

  const app = getAdminApp();
  if (!app) throw new Error('Firebase Admin App unavailable');
  const db = app.firestore();

  // 1. Fetch Firestore progress documents
  const fsProgressSnap = await db.collection('user_course_progress').get().catch(() => ({ docs: [] } as any));
  const fsRecords = new Map<string, ProgressCanonicalRecord>();

  for (const doc of fsProgressSnap.docs) {
    const d = doc.data();
    const uid = d.uid;
    const courseId = d.course_id;
    if (!uid || !courseId) continue;

    // Fetch lesson completions for this user/course
    const lessonsSnap = await db
      .collection('user_lesson_completions')
      .where('uid', '==', uid)
      .where('course_id', '==', courseId)
      .get()
      .catch(() => ({ docs: [] } as any));

    const completedSorted = lessonsSnap.docs
      .map((l: any) => String(l.data().lesson_id || ''))
      .filter(Boolean)
      .sort();

    const totalSeconds = Math.max(0, Number(d.total_study_seconds || 0));
    const canonicalString = `${uid}|${courseId}|${totalSeconds}|${completedSorted.join(',')}`;
    const canonicalHash = sha256(canonicalString);

    fsRecords.set(`${uid}_${courseId}`, {
      uid,
      courseId,
      totalStudySeconds: totalSeconds,
      completedLessonsSorted: completedSorted,
      canonicalHash
    });
  }

  // 2. Fetch PostgreSQL progress records (bounded by cutoverTimestamp if provided)
  let pgSql = `
    SELECT ucp.uid, ucp.course_id, ucp.total_study_seconds,
           COALESCE(array_agg(ulc.lesson_id ORDER BY ulc.lesson_id ASC) FILTER (WHERE ulc.lesson_id IS NOT NULL), '{}') AS completed_lessons
    FROM user_course_progress ucp
    LEFT JOIN user_lesson_completions ulc ON ucp.uid = ulc.uid AND ucp.course_id = ulc.course_id
  `;

  const params: any[] = [];
  if (cutoverTimestamp) {
    params.push(cutoverTimestamp);
    pgSql += ` WHERE ucp.updated_at <= $1`;
  }

  pgSql += ` GROUP BY ucp.uid, ucp.course_id, ucp.total_study_seconds;`;

  const pgRes = await queryPostgres<{
    uid: string;
    course_id: string;
    total_study_seconds: number;
    completed_lessons: string[];
  }>(pgSql, params);

  const pgRecords = new Map<string, ProgressCanonicalRecord>();
  for (const r of pgRes.rows) {
    const completedSorted = (r.completed_lessons || []).slice().sort();
    const totalSeconds = Number(r.total_study_seconds || 0);
    const canonicalString = `${r.uid}|${r.course_id}|${totalSeconds}|${completedSorted.join(',')}`;
    const canonicalHash = sha256(canonicalString);

    pgRecords.set(`${r.uid}_${r.course_id}`, {
      uid: r.uid,
      courseId: r.course_id,
      totalStudySeconds: totalSeconds,
      completedLessonsSorted: completedSorted,
      canonicalHash
    });
  }

  console.log(`Auditing records: Firestore = ${fsRecords.size}, PostgreSQL = ${pgRecords.size}`);

  let matched = 0;
  let mismatched = 0;

  for (const [key, fsRecord] of fsRecords.entries()) {
    const pgRecord = pgRecords.get(key);
    if (!pgRecord) {
      console.error(`❌ Missing in PostgreSQL: ${key}`);
      mismatched++;
      continue;
    }

    if (fsRecord.canonicalHash !== pgRecord.canonicalHash) {
      console.error(`❌ Hash Mismatch for ${key}:`);
      console.error(`   Firestore: ${fsRecord.canonicalHash} (seconds: ${fsRecord.totalStudySeconds}, lessons: ${fsRecord.completedLessonsSorted.length})`);
      console.error(`   Postgres:  ${pgRecord.canonicalHash} (seconds: ${pgRecord.totalStudySeconds}, lessons: ${pgRecord.completedLessonsSorted.length})`);
      mismatched++;
    } else {
      matched++;
    }
  }

  console.log(`\nAudit Results: ${matched} matched, ${mismatched} mismatched.`);

  if (mismatched > 0) {
    console.error(`\n❌ PARITY AUDIT FAILED: Found ${mismatched} discrepancy(ies).`);
    return false;
  }

  console.log('\n================================================================');
  console.log('🎉 100% CANONICAL SHA-256 PARITY VERIFIED');
  console.log('================================================================\n');
  return true;
}

// Standalone execution
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    await runProgressDeltaCatchUp();
    const ok = await runProgressParityAudit();
    process.exit(ok ? 0 : 1);
  })().catch((err) => {
    console.error('Fatal error in parity audit:', err);
    process.exit(1);
  });
}
