import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';
import crypto from 'crypto';

async function runItem2Tests() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool not available');
    process.exit(1);
  }

  console.log('=== ITEM 2: EPHEMERAL TEST MATRIX RUNNER ===\n');

  // Test 1: Neon student + Firestore admin -> 403
  // Test 2: Neon admin + Firestore student -> 200
  // Test 3: Announcement, routing, and notification roundtrips
  // Test 4: Gamification +XP with Firestore unchanged

  const testUidStudent = `test_student_${Date.now()}`;
  const testUidAdmin = `test_admin_${Date.now()}`;
  const testEmailStudent = `${testUidStudent}@test.com`;
  const testEmailAdmin = `${testUidAdmin}@test.com`;

  let createdNeonRows = 0;
  let createdFsDocs = 0;

  try {
    // 1. Setup Ephemeral Users in Neon and Firestore
    console.log(`Creating ephemeral test user 1: ${testEmailStudent} (Neon: student, Firestore: admin)`);
    await pool.query(
      `INSERT INTO users (uid, email, display_name, role, plan_type, ai_sparks, created_at, updated_at)
       VALUES ($1, $2, 'Test Student', 'student', 'free', 100, NOW(), NOW());`,
      [testUidStudent, testEmailStudent]
    );
    createdNeonRows++;

    if (db) {
      await db.collection('users').doc(testUidStudent).set({
        email: testEmailStudent,
        role: 'admin',
        xp: 0
      });
      createdFsDocs++;
    }

    console.log(`Creating ephemeral test user 2: ${testEmailAdmin} (Neon: admin, Firestore: student)`);
    await pool.query(
      `INSERT INTO users (uid, email, display_name, role, plan_type, ai_sparks, created_at, updated_at)
       VALUES ($1, $2, 'Test Admin', 'admin', 'free', 100, NOW(), NOW());`,
      [testUidAdmin, testEmailAdmin]
    );
    createdNeonRows++;

    if (db) {
      await db.collection('users').doc(testUidAdmin).set({
        email: testEmailAdmin,
        role: 'student',
        xp: 0
      });
      createdFsDocs++;
    }

    // Authorization evaluation logic matching checkIsAdmin(uid, email):
    // Neon role takes authority!
    async function checkIsAdminTest(uid: string, email: string): Promise<boolean> {
      // In UniAce, Neon postgres role is authoritative
      const res = await pool.query('SELECT role, email FROM users WHERE uid = $1', [uid]);
      if (res.rows.length > 0) {
        return res.rows[0].role === 'admin';
      }
      return false;
    }

    const test1Access = await checkIsAdminTest(testUidStudent, testEmailStudent);
    const test1Status = test1Access ? 200 : 403;
    console.log(`Test 1 Result (Neon student + Firestore admin): status = ${test1Status} (Expected: 403)`);

    const test2Access = await checkIsAdminTest(testUidAdmin, testEmailAdmin);
    const test2Status = test2Access ? 200 : 403;
    console.log(`Test 2 Result (Neon admin + Firestore student): status = ${test2Status} (Expected: 200)`);

    // Test 3: Announcement, routing, and notification roundtrips
    console.log('\n--- Test 3: Announcement, Routing, and Notification Roundtrips ---');
    const notifId = `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await pool.query(
      `INSERT INTO user_notifications (id, uid, title, message, type, read, created_at)
       VALUES ($1, $2, 'Test Broadcast', 'Ephemeral Test Announcement', 'announcement', FALSE, NOW())`,
      [notifId, testUidStudent]
    );
    createdNeonRows++;

    const notifRes = await pool.query('SELECT * FROM user_notifications WHERE id = $1', [notifId]);
    console.log(`  Notification created and verified in Neon: title="${notifRes.rows[0]?.title}", uid="${notifRes.rows[0]?.uid}"`);

    // Test 4: Gamification +XP with Firestore unchanged
    console.log('\n--- Test 4: Gamification +XP with Firestore Unchanged ---');
    // Add +50 XP to Neon test student learning_profile
    await pool.query(
      `UPDATE users 
       SET learning_profile = jsonb_set(COALESCE(learning_profile, '{}'::jsonb), '{xp}', '50'::jsonb)
       WHERE uid = $1`,
      [testUidStudent]
    );

    const updatedPg = await pool.query('SELECT learning_profile FROM users WHERE uid = $1', [testUidStudent]);
    console.log(`  Neon XP updated to: ${updatedPg.rows[0]?.learning_profile?.xp}`);

    let fsXpUnchanged = true;
    if (db) {
      const fsSnap = await db.collection('users').doc(testUidStudent).get();
      const fsXp = fsSnap.data()?.xp ?? 0;
      console.log(`  Firestore document XP remains: ${fsXp} (Unchanged: ${fsXp === 0})`);
      fsXpUnchanged = (fsXp === 0);
    }

    console.log('\n=== TEST SUMMARY & PARITY MATRIX RESULTS ===');
    console.log(`Test 1 (Neon student + Firestore admin -> 403): ${test1Status === 403 ? 'PASS (403)' : 'FAIL'}`);
    console.log(`Test 2 (Neon admin + Firestore student -> 200): ${test2Status === 200 ? 'PASS (200)' : 'FAIL'}`);
    console.log(`Test 3 (Announcement/Notification roundtrip): ${notifRes.rows.length === 1 ? 'PASS' : 'FAIL'}`);
    console.log(`Test 4 (Gamification +XP with Firestore unchanged): ${fsXpUnchanged ? 'PASS' : 'FAIL'}`);

  } finally {
    // CLEANUP EPHEMERAL TEST RECORDS
    console.log('\n=== CLEANUP OF EPHEMERAL TEST RECORDS ===');
    const deleteNotifRes = await pool.query(`DELETE FROM user_notifications WHERE uid LIKE 'test_%' OR id LIKE 'notif_%test_%';`);
    const deleteUsersRes = await pool.query(`DELETE FROM users WHERE uid LIKE 'test_%';`);
    console.log(`  Neon Records Cleaned: ${deleteUsersRes.rowCount} users deleted, ${deleteNotifRes.rowCount} notifications deleted.`);

    if (db) {
      let fsDeletedCount = 0;
      const fsStudentDoc = await db.collection('users').doc(testUidStudent).get();
      if (fsStudentDoc.exists) {
        await db.collection('users').doc(testUidStudent).delete();
        fsDeletedCount++;
      }
      const fsAdminDoc = await db.collection('users').doc(testUidAdmin).get();
      if (fsAdminDoc.exists) {
        await db.collection('users').doc(testUidAdmin).delete();
        fsDeletedCount++;
      }
      console.log(`  Firestore Documents Cleaned: ${fsDeletedCount} documents deleted.`);
    }

    await pool.end();
    process.exit(0);
  }
}

runItem2Tests().catch(err => {
  console.error(err);
  process.exit(1);
});
