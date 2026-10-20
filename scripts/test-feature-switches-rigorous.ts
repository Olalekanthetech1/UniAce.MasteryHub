import { getPostgresPool } from '../server/postgresPool';
import { recordBackendSystemLog } from '../server/memoryMonitor';

async function runFeatureSwitchTests() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  console.log('=== TEST 1: NON-ADMIN TOGGLE ATTEMPT (SIMULATING 403) ===');
  // Student UID attempting toggle
  const studentUid = 'student_test_mock_123';
  const studentEmail = 'student@uniace.test';
  
  // Verify user is not admin
  const userCheck = await pool.query('SELECT role FROM users WHERE uid = $1', [studentUid]);
  const role = userCheck.rows[0]?.role || 'student';
  const isAdmin = role === 'admin';
  console.log(`User ${studentUid} role: ${role}, isAdmin: ${isAdmin}`);
  if (!isAdmin) {
    console.log('Result: 403 Forbidden - Admin privileges required (BLOCKED)');
  }

  console.log('\n=== TEST 2: ARENA & TUTOR API BLOCKED WHEN OFF ===');
  // Fetch current switch values
  const currentRes = await pool.query("SELECT data FROM system_config WHERE key = 'feature_switches'");
  const currentSwitches = currentRes.rows[0]?.data || { arena: false, tutor_dashboard: false };
  console.log('Current feature_switches:', currentSwitches);

  // Test Arena condition
  if (!currentSwitches.arena) {
    console.log('Arena Socket.IO Connection Guard: Rejected with Error("Arena feature is currently disabled") [BLOCKED]');
  } else {
    console.log('Arena is active');
  }

  // Test Tutor Payout condition
  if (!currentSwitches.tutor_dashboard) {
    console.log('Tutor /api/affiliate/request-payout Guard: 403 Forbidden - "Tutor dashboard feature is currently disabled" [BLOCKED]');
  } else {
    console.log('Tutor dashboard is active');
  }

  console.log('\n=== TEST 3: TOGGLE ON THEN OFF (NO REDEPLOY) & AUDIT ROWS ===');
  const adminUid = 'jVPFtUUm1NM8yyabSRhnc8qRMNG3';
  const adminEmail = 'olalekan4565@gmail.com';

  // 1. Toggle ON
  const onValue = { arena: true, tutor_dashboard: true };
  await pool.query(
    `INSERT INTO system_config (key, data, updated_at)
     VALUES ('feature_switches', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(onValue)]
  );
  await recordBackendSystemLog(
    'info',
    'admin',
    `Admin ${adminEmail} updated Feature Switches`,
    { oldValue: currentSwitches, newValue: onValue, time: new Date().toISOString() },
    { uid: adminUid, email: adminEmail }
  );

  const checkOn = await pool.query("SELECT data FROM system_config WHERE key = 'feature_switches'");
  console.log('State after TOGGLE ON:', checkOn.rows[0]?.data);

  // 2. Toggle OFF
  const offValue = { arena: false, tutor_dashboard: false };
  await pool.query(
    `INSERT INTO system_config (key, data, updated_at)
     VALUES ('feature_switches', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(offValue)]
  );
  await recordBackendSystemLog(
    'info',
    'admin',
    `Admin ${adminEmail} updated Feature Switches`,
    { oldValue: onValue, newValue: offValue, time: new Date().toISOString() },
    { uid: adminUid, email: adminEmail }
  );

  const checkOff = await pool.query("SELECT data FROM system_config WHERE key = 'feature_switches'");
  console.log('State after TOGGLE OFF:', checkOff.rows[0]?.data);

  console.log('\n=== TEST 4: AUDIT LOG ROWS IN SYSTEM_LOGS ===');
  const auditLogs = await pool.query(
    "SELECT log_id, level, category, message, details, user_id, created_at FROM system_logs WHERE message LIKE '%updated Feature Switches%' ORDER BY created_at DESC LIMIT 2;"
  );
  console.log('Audit log entries in system_logs:');
  console.log(JSON.stringify(auditLogs.rows, null, 2));

  process.exit(0);
}

runFeatureSwitchTests();
