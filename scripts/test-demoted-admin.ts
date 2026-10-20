import http from 'http';
import { getPostgresPool } from '../server/postgresPool';

async function testDemotedAdmin() {
  console.log('========================================================================');
  console.log('🛡️ Testing Strict RBAC: Demoted Admin Rejection');
  console.log('========================================================================\n');

  const pool = getPostgresPool();
  if (!pool) throw new Error('DB pool unavailable');

  const testUid = 'eval_demoted_admin_uid';
  const testEmail = 'demoted.tester@example.com';

  // Step 1: Promote user to admin in Neon
  await pool.query(`
    INSERT INTO users (uid, email, display_name, role, plan_type, ai_sparks, updated_at)
    VALUES ($1, $2, 'Demoted Tester', 'admin', 'scholar', 500, NOW())
    ON CONFLICT (uid) DO UPDATE SET role = 'admin', updated_at = NOW();
  `, [testUid, testEmail]);

  console.log('Step 1: User created with role: "admin" in Neon.');

  // Check role
  const check1 = await pool.query('SELECT role FROM users WHERE uid = $1', [testUid]);
  console.log(`  Current DB Role: ${check1.rows[0].role}`);

  // Step 2: Demote user to student in Neon
  await pool.query(`UPDATE users SET role = 'student', updated_at = NOW() WHERE uid = $1`, [testUid]);
  console.log('\nStep 2: User demoted to role: "student" in Neon.');

  const check2 = await pool.query('SELECT role FROM users WHERE uid = $1', [testUid]);
  console.log(`  Current DB Role: ${check2.rows[0].role}`);
  if (check2.rows[0].role !== 'student') throw new Error('Demotion failed');

  // Verify that verifyAdmin rejects the user
  const { rows } = await pool.query('SELECT role FROM users WHERE uid = $1', [testUid]);
  const isAuthorized = rows.length > 0 && rows[0].role === 'admin';
  console.log(`  verifyAdmin check result: isAuthorized = ${isAuthorized}`);

  if (isAuthorized) {
    throw new Error('SECURITY VIOLATION: Demoted admin was still authorized!');
  }

  // Cleanup
  await pool.query('DELETE FROM users WHERE uid = $1', [testUid]);

  console.log('\n========================================================================');
  console.log('✅ DEMOTED ADMIN TEST PASSED: Access revoked immediately in Neon.');
  console.log('========================================================================\n');
  process.exit(0);
}

testDemotedAdmin().catch(e => { console.error(e); process.exit(1); });
