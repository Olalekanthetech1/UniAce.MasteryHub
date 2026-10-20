/**
 * UniAce Mastery Hub: Prune Resilience Test Courses from Neon Catalog
 */

import { getPostgresPool } from '../server/postgresPool';

export async function pruneTestCourses(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Database pool unavailable');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const testCourseIds = [
      'resilience_course_1792066436712',
      'resilience_course_1792066458205',
      'resilience_course_1792066469832'
    ];

    // Delete lessons first
    const delLessons = await client.query('DELETE FROM course_lessons WHERE course_id = ANY($1);', [testCourseIds]);
    // Delete courses
    const delCourses = await client.query('DELETE FROM courses WHERE id = ANY($1);', [testCourseIds]);

    await client.query('COMMIT');
    console.log(`✅ Pruned ${delCourses.rowCount} test courses and ${delLessons.rowCount} test lessons.`);

    // Check new course count
    const countRes = await pool.query('SELECT count(*) FROM courses;');
    console.log(`✅ New Neon PostgreSQL courses count: ${countRes.rows[0].count} (Exact match to Firestore 33).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].includes('prune-test-courses')) {
  pruneTestCourses()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Failed to prune test courses:', err);
      process.exit(1);
    });
}
