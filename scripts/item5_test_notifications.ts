import { getPostgresPool } from '../server/postgresPool';
import crypto from 'crypto';

async function testNotifications() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  console.log('=== ITEM 5: GLOBAL NOTIFICATIONS & PER-USER READ STATE TEST ===\n');

  const ts = Date.now();
  const uidA = `test_student_a_${ts}`;
  const uidB = `test_student_b_${ts}`;
  const announcementId = `annc_${ts}_${crypto.randomBytes(3).toString('hex')}`;

  try {
    // 0. Create ephemeral test student accounts in users table to satisfy foreign keys
    console.log(`0. Creating ephemeral test accounts: ${uidA}, ${uidB}`);
    await pool.query(
      `INSERT INTO users (uid, email, display_name, role, plan_type, ai_sparks, learning_profile, created_at, updated_at)
       VALUES 
       ($1, 'studentA@test.uniace.app', 'Test Student A', 'student', 'free', 100, '{}', NOW(), NOW()),
       ($2, 'studentB@test.uniace.app', 'Test Student B', 'student', 'free', 100, '{}', NOW(), NOW());`,
      [uidA, uidB]
    );

    // 1. Create a global announcement
    console.log(`1. Publishing Global Announcement: id=${announcementId}`);
    await pool.query(
      `INSERT INTO announcements (id, title, message, severity, audience, active, created_at, updated_at)
       VALUES ($1, 'Global Campus Notice', 'End of Semester Examinations schedule released.', 'info', 'all', TRUE, NOW(), NOW());`,
      [announcementId]
    );

    // 2. Query unread announcements for Student A and Student B before dismissal
    const getUnreadQuery = `
      SELECT a.id, a.title, a.message
      FROM announcements a
      LEFT JOIN announcement_dismissals d ON a.id = d.announcement_id AND d.uid = $1
      WHERE a.active = TRUE AND d.announcement_id IS NULL AND a.id = $2;
    `;

    const unreadBeforeA = await pool.query(getUnreadQuery, [uidA, announcementId]);
    const unreadBeforeB = await pool.query(getUnreadQuery, [uidB, announcementId]);
    console.log(`   Initial State:`);
    console.log(`     Student A unread count for announcement: ${unreadBeforeA.rows.length}`);
    console.log(`     Student B unread count for announcement: ${unreadBeforeB.rows.length}`);

    // 3. Student A marks announcement as read/dismissed
    console.log(`\n2. Student A marks announcement ${announcementId} as read/dismissed...`);
    await pool.query(
      `INSERT INTO announcement_dismissals (uid, announcement_id, dismissed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (uid, announcement_id) DO NOTHING;`,
      [uidA, announcementId]
    );

    // 4. Query unread announcements after Student A dismisses
    const unreadAfterA = await pool.query(getUnreadQuery, [uidA, announcementId]);
    const unreadAfterB = await pool.query(getUnreadQuery, [uidB, announcementId]);

    console.log(`   State After Student A Marks Read:`);
    console.log(`     Student A unread count: ${unreadAfterA.rows.length} (Expected: 0)`);
    console.log(`     Student B unread count: ${unreadAfterB.rows.length} (Expected: 1)`);

    const isolationPass = (unreadAfterA.rows.length === 0 && unreadAfterB.rows.length === 1);
    console.log(`\n   Per-User Read State Verification: ${isolationPass ? 'PASS (Per-user isolation verified: A marked read, B remains unread)' : 'FAIL'}`);

    // 5. Test Bulk Insert for Targeted Sends
    console.log('\n3. Testing Bulk Insert for Targeted Sends into user_notifications...');
    const notifBatch = [
      {
        id: `notif_${ts}_A`,
        uid: uidA,
        title: 'Targeted Lab Assignment',
        message: 'Your lab report has been graded.'
      },
      {
        id: `notif_${ts}_B`,
        uid: uidB,
        title: 'Targeted Lab Assignment',
        message: 'Your lab report has been graded.'
      }
    ];

    // Efficient multi-row bulk insert
    const valuesPlaceholders = notifBatch.map((_, i) => `($${i*4 + 1}, $${i*4 + 2}, $${i*4 + 3}, $${i*4 + 4}, 'academic', FALSE, NOW())`).join(', ');
    const params = notifBatch.flatMap(n => [n.id, n.uid, n.title, n.message]);

    const bulkRes = await pool.query(
      `INSERT INTO user_notifications (id, uid, title, message, type, read, created_at)
       VALUES ${valuesPlaceholders}
       RETURNING id, uid, title, read;`,
      params
    );

    console.log(`   Bulk inserted ${bulkRes.rowCount} targeted notifications:`);
    bulkRes.rows.forEach(r => console.log(`     Notification id=${r.id} -> uid=${r.uid}, read=${r.read}`));

    // Student A reads their targeted notification
    console.log('\n4. Student A reads their targeted notification...');
    await pool.query(`UPDATE user_notifications SET read = TRUE WHERE uid = $1 AND title = 'Targeted Lab Assignment'`, [uidA]);
    const notifA = await pool.query(`SELECT uid, read FROM user_notifications WHERE uid = $1 AND title = 'Targeted Lab Assignment'`, [uidA]);
    const notifB = await pool.query(`SELECT uid, read FROM user_notifications WHERE uid = $1 AND title = 'Targeted Lab Assignment'`, [uidB]);

    console.log(`   Targeted Notification Read Status:`);
    console.log(`     Student A: read = ${notifA.rows[0]?.read} (Expected: true)`);
    console.log(`     Student B: read = ${notifB.rows[0]?.read} (Expected: false)`);

    const bulkPass = notifA.rows[0]?.read === true && notifB.rows[0]?.read === false;
    console.log(`\n=== ITEM 5 NOTIFICATIONS TEST RESULT: ${isolationPass && bulkPass ? 'PASS' : 'FAIL'} ===`);

    if (!isolationPass || !bulkPass) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Error during Item 5 test:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup
    console.log('\n--- Cleanup Ephemeral Test Data ---');
    await pool.query(`DELETE FROM announcement_dismissals WHERE uid IN ($1, $2);`, [uidA, uidB]);
    await pool.query(`DELETE FROM announcements WHERE id = $1;`, [announcementId]);
    await pool.query(`DELETE FROM user_notifications WHERE uid IN ($1, $2);`, [uidA, uidB]);
    await pool.query(`DELETE FROM users WHERE uid IN ($1, $2);`, [uidA, uidB]);
    console.log('Cleaned test announcements, dismissals, user notifications, and ephemeral users.');

    await pool.end();
  }
}

testNotifications().catch(e => {
  console.error(e);
  process.exit(1);
});
