import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function auditTesterProgress() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!pool || !db) {
    console.error('Pool or DB unavailable');
    return;
  }

  console.log('=== ITEM 1: TESTER PROGRESS AUDIT (FIRESTORE vs NEON) ===\n');

  const pgUsersRes = await pool.query('SELECT uid, email, display_name FROM users ORDER BY created_at ASC;');
  const pgUsers = pgUsersRes.rows;

  const fsUsersSnap = await db.collection('users').get();
  const fsUserMap = new Map();
  fsUsersSnap.docs.forEach(d => fsUserMap.set(d.id, d.data()));

  console.log(`Total Postgres Users: ${pgUsers.length} | Total Firestore Users: ${fsUsersSnap.size}\n`);

  for (const user of pgUsers.slice(0, 5)) {
    const uid = user.uid;
    const email = user.email || 'N/A';
    const fsData = fsUserMap.get(uid) || {};

    const pgProgRes = await pool.query('SELECT course_id, completed_lessons_count, total_study_seconds FROM user_course_progress WHERE uid = $1;', [uid]);
    const fsEnrolled = fsData.enrolledCourses || [];
    const fsCompletedLessons = fsData.completedLessons || [];
    const fsStudyTime = fsData.totalStudySeconds || 0;

    const pgSrsRes = await pool.query('SELECT count(*) FROM user_spaced_repetition WHERE uid = $1;', [uid]);
    const fsSrsSnap = await db.collection('users').doc(uid).collection('srs_cards').get().catch(() => ({ size: 0 }));

    const pgNotifRes = await pool.query('SELECT count(*) FROM user_notifications WHERE uid = $1;', [uid]);
    const fsNotifSnap = await db.collection('users').doc(uid).collection('notifications').get().catch(() => ({ size: 0 }));

    const pgAlertRes = await pool.query('SELECT count(*) FROM system_alerts WHERE requested_by = $1;', [uid]);
    const fsAlertSnap = await db.collection('system_alerts').where('requestedBy', '==', uid).get().catch(() => ({ size: 0 }));

    console.log(`--- TESTER: ${email} (${uid}) ---`);
    console.log(`  Course Progress -> PG rows: ${pgProgRes.rows.length} | FS Enrolled: ${fsEnrolled.length}, CompletedLessons: ${fsCompletedLessons.length}, StudySecs: ${fsStudyTime}`);
    console.log(`  SRS Cards -> PG: ${pgSrsRes.rows[0].count} | FS: ${fsSrsSnap.size}`);
    console.log(`  Notifications -> PG: ${pgNotifRes.rows[0].count} | FS: ${fsNotifSnap.size}`);
    console.log(`  System Alerts -> PG: ${pgAlertRes.rows[0].count} | FS: ${fsAlertSnap.size}`);
    console.log('');
  }

  await pool.end();
}

auditTesterProgress().catch(console.error);
