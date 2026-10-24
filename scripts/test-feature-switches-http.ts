import { getPostgresPool } from '../server/postgresPool';

async function testFeatureSwitchesHttp() {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Postgres pool unavailable');

  console.log('=== ITEM D: FEATURE SWITCHES REAL HTTP TEST ===\n');

  // 1. Toggle ON via HTTP
  console.log('1. Toggling Feature Switches ON via HTTP...');
  const resOn = await fetch('http://localhost:3000/api/admin/feature-switches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer uniace-secure-local-eval-token'
    },
    body: JSON.stringify({
      featureSwitches: { arena: true, tutor_dashboard: true }
    })
  }).catch(() => null);

  if (resOn) {
    const errJson = await resOn.json().catch(() => ({}));
    console.log(`Toggle ON Status: HTTP ${resOn.status}`, errJson);
  }

  // Bootstrap call with switch ON
  const bootOn = await fetch('http://localhost:3000/api/user/bootstrap', {
    headers: { 'Authorization': 'Bearer uniace-secure-local-eval-token' }
  });
  const bootOnJson = await bootOn.json();
  console.log('Bootstrap with Switch ON:', {
    status: bootOn.status,
    featureSwitches: bootOnJson.featureSwitches || bootOnJson.switches
  });

  // 2. Toggle OFF via HTTP
  console.log('\n2. Toggling Feature Switches OFF via HTTP...');
  const resOff = await fetch('http://localhost:3000/api/admin/feature-switches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer uniace-secure-local-eval-token'
    },
    body: JSON.stringify({
      featureSwitches: { arena: false, tutor_dashboard: false }
    })
  }).catch(() => null);

  if (resOff) {
    console.log(`Toggle OFF Status: HTTP ${resOff.status}`);
  }

  // Bootstrap call with switch OFF
  const bootOff = await fetch('http://localhost:3000/api/user/bootstrap', {
    headers: { 'Authorization': 'Bearer uniace-secure-local-eval-token' }
  });
  const bootOffJson = await bootOff.json();
  console.log('Bootstrap with Switch OFF:', {
    status: bootOff.status,
    featureSwitches: bootOffJson.featureSwitches || bootOffJson.switches
  });

  // 3. Inspect Audit Rows in system_logs
  console.log('\n3. Inspecting Audit Log Rows in system_logs...');
  const auditRes = await pool.query(
    "SELECT log_id, level, category, message, details, user_id, created_at FROM system_logs WHERE message LIKE '%updated Feature Switches%' ORDER BY created_at DESC LIMIT 2;"
  );
  console.log('Audit log rows:');
  console.log(JSON.stringify(auditRes.rows, null, 2));

  await pool.end();
}

testFeatureSwitchesHttp().catch(console.error);
