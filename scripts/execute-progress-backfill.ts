import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function executeBackfill() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!db || !pool) throw new Error('DB or Pool uninitialized');

  console.log('=== EXECUTING BACKFILL IN ONE TRANSACTION ===\n');

  // Count before
  const beforeRes = await pool.query('SELECT count(*) FROM user_course_progress;');
  const countBefore = Number(beforeRes.rows[0].count);
  console.log(`Count BEFORE backfill in user_course_progress: ${countBefore}`);

  const fsUsersSnap = await db.collection('users').get();
  const client = await pool.connect();

  let insertedRows = 0;

  try {
    await client.query('BEGIN');

    for (const doc of fsUsersSnap.docs) {
      const uid = doc.id;
      const data = doc.data() || {};
      const enrolledCourses: string[] = data.enrolledCourses || [];
      const totalStudySeconds: number = data.totalStudySeconds || 0;

      for (const courseId of enrolledCourses) {
        if (!courseId) continue;
        const res = await client.query(
          `INSERT INTO user_course_progress (uid, course_id, completed_lessons_count, total_study_seconds, updated_at)
           VALUES ($1, $2, 0, $3, NOW())
           ON CONFLICT (uid, course_id) DO NOTHING;`,
          [uid, courseId, totalStudySeconds]
        );
        if ((res.rowCount || 0) > 0) {
          insertedRows++;
        }
      }
    }

    await client.query('COMMIT');
    console.log(`Successfully committed transaction! Inserted ${insertedRows} new progress enrollment rows.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction failed and rolled back:', err);
  } finally {
    client.release();
  }

  // Count after
  const afterRes = await pool.query('SELECT count(*) FROM user_course_progress;');
  const countAfter = Number(afterRes.rows[0].count);
  console.log(`Count AFTER backfill in user_course_progress: ${countAfter}\n`);

  // Call /api/user/bootstrap for 2 testers with real Firebase ID tokens
  console.log('=== CALLING /api/user/bootstrap FOR 2 TESTERS ===\n');
  const testerUids = ['PTi7egvSxzYzSh4VsEUuM6xpTle2', 'fXj3VzbcIMX8OJn5tlQL5fKf2Na2'];

  const fsNode = await import('fs');
  const appletConfig = JSON.parse(fsNode.readFileSync('./firebase-applet-config.json', 'utf8'));
  const firebaseWebApiKey = process.env.VITE_FIREBASE_API_KEY || appletConfig.apiKey;

  const admin = await import('firebase-admin');

  for (const uid of testerUids) {
    const customToken = await admin.auth().createCustomToken(uid);
    const tokenRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${firebaseWebApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      }
    );
    const { idToken } = (await tokenRes.json()) as { idToken: string };

    const res = await fetch(`http://localhost:3000/api/user/bootstrap`, {
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    }).catch(() => null);

    if (res) {
      const json = await res.json().catch(() => ({}));
      console.log(`Bootstrap response for ${uid}: HTTP ${res.status}`);
      console.log(JSON.stringify(json, null, 2));
    }
  }

  await pool.end();
}

executeBackfill().catch(console.error);

