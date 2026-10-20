import { getPostgresPool } from '../server/postgresPool';

async function runFeatureSwitchesTest() {
  console.log('=== Feature Switches Verification Test Suite ===');
  const pool = getPostgresPool();
  if (!pool) {
    console.error('❌ Failed: Postgres pool unavailable');
    process.exit(1);
  }

  try {
    // 1. Ensure feature_switches config row exists in system_config
    console.log('1. Verifying system_config feature_switches key in Neon...');
    await pool.query(
      `INSERT INTO system_config (key, data, updated_at)
       VALUES ('feature_switches', '{"arena": false, "tutor_dashboard": false}', NOW())
       ON CONFLICT (key) DO NOTHING`
    );

    const checkRes = await pool.query("SELECT data FROM system_config WHERE key = 'feature_switches'");
    console.log('Current feature_switches row:', checkRes.rows[0]?.data);

    // 2. Test toggling switches in database
    console.log('2. Simulating Admin toggle ON: arena=true, tutor_dashboard=true...');
    await pool.query(
      `UPDATE system_config SET data = '{"arena": true, "tutor_dashboard": true}', updated_at = NOW() WHERE key = 'feature_switches'`
    );

    const toggleOnRes = await pool.query("SELECT data FROM system_config WHERE key = 'feature_switches'");
    if (toggleOnRes.rows[0]?.data?.arena !== true || toggleOnRes.rows[0]?.data?.tutor_dashboard !== true) {
      console.error('❌ Failed: Feature switch toggle ON failed to persist');
      process.exit(1);
    }
    console.log('✅ Feature switch toggle ON persisted successfully.');

    // 3. Reset default OFF state: arena=false, tutor_dashboard=false
    console.log('3. Resetting default OFF state: arena=false, tutor_dashboard=false...');
    await pool.query(
      `UPDATE system_config SET data = '{"arena": false, "tutor_dashboard": false}', updated_at = NOW() WHERE key = 'feature_switches'`
    );

    const toggleOffRes = await pool.query("SELECT data FROM system_config WHERE key = 'feature_switches'");
    if (toggleOffRes.rows[0]?.data?.arena !== false || toggleOffRes.rows[0]?.data?.tutor_dashboard !== false) {
      console.error('❌ Failed: Feature switch toggle OFF failed to persist');
      process.exit(1);
    }
    console.log('✅ Default OFF state verified successfully.');

    console.log('\n🎉 ALL FEATURE SWITCHES VERIFICATION TESTS PASSED SUCCESSFULLY!');
  } catch (err: any) {
    console.error('❌ Error during feature switches test:', err?.message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runFeatureSwitchesTest().catch(err => {
  console.error(err);
  process.exit(1);
});
