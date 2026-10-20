/**
 * UniAce Mastery Hub: Step 4.1b — Diagnose Surplus Courses in Neon PostgreSQL
 */

import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

export async function diagnoseSurplusCourses(): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Firestore uninitialized');

  const fsSnap = await db.collection('courses').get();
  const fsIds = fsSnap.docs.map(d => d.id);
  console.log(`Firestore course count: ${fsIds.length}`);

  const pool = getPostgresPool();
  if (!pool) throw new Error('Postgres pool unavailable');

  const { rows: surplus } = await pool.query(
    `SELECT c.id, c.code, c.title, c.created_at, 
            (SELECT count(*)::int FROM course_knowledge_chunks k WHERE k.course_id = c.id) AS chunks,
            (SELECT count(*)::int FROM course_lessons l WHERE l.course_id = c.id) AS lessons
     FROM courses c
     WHERE c.id != ALL($1)
     ORDER BY c.created_at;`,
    [fsIds]
  );

  console.log(`\nSurplus courses in Neon (${surplus.length}):`);
  for (const s of surplus) {
    const { rows: enr } = await pool.query(
      'SELECT count(*)::int AS cnt FROM user_course_progress WHERE course_id = $1;',
      [s.id]
    ).catch(() => ({ rows: [{ cnt: 0 }] }));

    const { rows: jobs } = await pool.query(
      'SELECT count(*)::int AS cnt FROM course_generation_jobs WHERE course_id = $1;',
      [s.id]
    ).catch(() => ({ rows: [{ cnt: 0 }] }));

    console.log(`  - ID: ${s.id}`);
    console.log(`    Code: ${s.code} | Title: "${s.title}"`);
    console.log(`    Lessons: ${s.lessons} | Chunks: ${s.chunks} | Enrollments/Progress: ${enr[0].cnt} | Jobs: ${jobs[0].cnt}`);
    console.log(`    Created: ${s.created_at}\n`);
  }
}

if (process.argv[1] && process.argv[1].includes('diagnose-surplus-courses')) {
  diagnoseSurplusCourses()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Failed to diagnose surplus courses:', err);
      process.exit(1);
    });
}
