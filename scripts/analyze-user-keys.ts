import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function inspectUserKeys() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!db || !pool) return;

  const targetTesters = [
    'KaY7fckuvreU8bU1ip4oKHg2GzG2', // olalekan4587@gmail.com
    'PTi7egvSxzYzSh4VsEUuM6xpTle2', // babatundemubeen28@gmail.com
    'fXj3VzbcIMX8OJn5tlQL5fKf2Na2'  // olatunbosuncrowther17@gmail.com
  ];

  console.log('=== ITEM B: FIRESTORE USER KEYS VS NEON POSTGRESQL ===\n');

  for (const uid of targetTesters) {
    const fsSnap = await db.collection('users').doc(uid).get();
    const fsData = fsSnap.data() || {};

    const pgRes = await pool.query('SELECT uid, email, role, plan_type, ai_sparks, learning_profile FROM users WHERE uid = $1;', [uid]);
    const pgData = pgRes.rows[0] || {};

    console.log(`--- TESTER: ${pgData.email || uid} (${uid}) ---`);
    console.log('Firestore Keys:', Object.keys(fsData).sort());
    console.log('Firestore Sample:', {
      xp: fsData.xp,
      level: fsData.level,
      streak: fsData.streak,
      achievements: fsData.achievements,
      mastery: fsData.mastery,
      bookmarks: fsData.bookmarks,
      topicLastStudied: fsData.topicLastStudied,
      totalStudySeconds: fsData.totalStudySeconds,
      enrolledCourses: fsData.enrolledCourses
    });
    console.log('Neon `users` Row:', {
      role: pgData.role,
      plan_type: pgData.plan_type,
      ai_sparks: pgData.ai_sparks,
      learning_profile: pgData.learning_profile
    });
    console.log('');
  }

  await pool.end();
}

inspectUserKeys().catch(console.error);
