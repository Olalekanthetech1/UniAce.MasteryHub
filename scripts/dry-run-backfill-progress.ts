import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function dryRunBackfill() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!db || !pool) return;

  console.log('=== DRY-RUN BACKFILL PREVIEW (NO DB WRITES) ===\n');

  const targetTesters = [
    'PTi7egvSxzYzSh4VsEUuM6xpTle2', // babatundemubeen28@gmail.com
    'fXj3VzbcIMX8OJn5tlQL5fKf2Na2', // olatunbosuncrowther17@gmail.com
    'GkFz9eIdcfPZW0xzkZXvAUuzgVj1'  // fareedathbalogun@gmail.com
  ];

  for (const uid of targetTesters) {
    const fsDoc = await db.collection('users').doc(uid).get();
    if (!fsDoc.exists) continue;
    const data = fsDoc.data() || {};
    const email = data.email || uid;
    const enrolledCourses = data.enrolledCourses || [];
    const completedLessons = data.completedLessons || [];
    const totalStudySeconds = data.totalStudySeconds || 0;

    console.log(`--- DRY-RUN DIFF FOR TESTER: ${email} (${uid}) ---`);
    console.log(`Firestore Source: Enrolled: [${enrolledCourses.join(', ')}], CompletedLessons: ${completedLessons.length}, StudyTime: ${totalStudySeconds}s`);

    const pgProgRes = await pool.query('SELECT course_id FROM user_course_progress WHERE uid = $1;', [uid]);
    const existingPgCourses = new Set(pgProgRes.rows.map(r => r.course_id));

    const proposedStatements: string[] = [];

    for (const courseId of enrolledCourses) {
      if (!existingPgCourses.has(courseId)) {
        // Calculate lessons completed for this specific course
        const courseLessonsCount = completedLessons.filter((lId: string) => String(lId).startsWith(courseId)).length;
        proposedStatements.push(
          `INSERT INTO user_course_progress (id, uid, course_id, completed_lessons_count, total_study_seconds, created_at, updated_at)\n` +
          `VALUES ('${uid}_${courseId}', '${uid}', '${courseId}', ${courseLessonsCount}, ${totalStudySeconds}, NOW(), NOW())\n` +
          `ON CONFLICT (id) DO NOTHING;`
        );
      }
    }

    if (proposedStatements.length === 0) {
      console.log('  Status: Already in 100% parity with Neon PostgreSQL (0 statements needed).');
    } else {
      console.log(`  Proposed Idempotent SQL Statements (${proposedStatements.length}):`);
      proposedStatements.forEach(s => console.log(`  ${s}`));
    }
    console.log('');
  }

  await pool.end();
}

dryRunBackfill().catch(console.error);
