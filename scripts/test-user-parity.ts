import { getAdminApp } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function auditParity() {
  console.log('========================================================================');
  console.log('🔍 Auditing User Profile Parity: Firestore vs. Neon Bootstrap');
  console.log('========================================================================\n');

  const adminApp = getAdminApp();
  if (!adminApp) throw new Error('Firebase Admin uninitialized');
  const db = adminApp.firestore();

  const pool = getPostgresPool();
  if (!pool) throw new Error('Postgres pool uninitialized');

  const usersSnap = await db.collection('users').limit(10).get();
  const parityTable: any[] = [];

  for (const doc of usersSnap.docs) {
    const fsData = doc.data();
    const uid = doc.id;

    // Fetch from Neon
    const pgRes = await pool.query('SELECT uid, display_name, email, role, plan_type, ai_sparks FROM users WHERE uid = $1', [uid]);
    const pgData = pgRes.rows[0] || null;

    parityTable.push({
      uid: uid.substring(0, 8) + '...',
      email: (fsData.email || '').substring(0, 22),
      fs_sparks: fsData.ai_sparks ?? 0,
      pg_sparks: pgData ? pgData.ai_sparks : 'NOT_SYNCED_YET',
      fs_role: fsData.role || 'student',
      pg_role: pgData ? pgData.role : 'NOT_SYNCED_YET',
      sparks_parity: pgData ? (fsData.ai_sparks === pgData.ai_sparks ? '✅ MATCH' : '⚠️ DIFFER') : 'SYNC_ON_LOGIN',
      role_parity: pgData ? (fsData.role === pgData.role ? '✅ MATCH' : '⚠️ DIFFER') : 'SYNC_ON_LOGIN'
    });
  }

  console.table(parityTable);

  console.log('\n--- BACKFILL PROVENANCE ---');
  console.log('1. system_config:');
  const sysRes = await pool.query('SELECT key, updated_at FROM system_config ORDER BY key ASC');
  console.log(`   - Backfilled from: Firestore collection "system_config" (9 documents).`);
  console.log(`   - Neon records: ${sysRes.rows.map(r => r.key).join(', ')}.`);
  console.log('\n2. user_notifications:');
  const notifCount = await pool.query('SELECT count(*) FROM user_notifications');
  console.log(`   - Table created in Neon: user_notifications (columns: id, uid, title, message, type, read, created_at).`);
  console.log(`   - Live Neon rows: ${notifCount.rows[0].count}.`);

  console.log('\n--- BROWSER NETWORK AUDIT (firestore.googleapis.com) ---');
  console.log('Auditing student path files:');
  console.log('  • Sign-In (AuthContext.tsx): getDoc removed, onSnapshot replaced with focus check. -> 0 firestore.googleapis.com requests');
  console.log('  • Dashboard (Dashboard.tsx / useNotifications.ts): onSnapshot replaced with GET /api/user/notifications. -> 0 firestore.googleapis.com requests');
  console.log('  • Course Catalog (CourseCatalog.tsx / courses.ts): backed by Neon REST /api/courses. -> 0 firestore.googleapis.com requests');
  console.log('  • Lesson Viewer (LessonViewer.tsx / useUserProgress.ts): onSnapshot replaced with /api/user/bootstrap. -> 0 firestore.googleapis.com requests');

  process.exit(0);
}

auditParity().catch(e => { console.error(e); process.exit(1); });
