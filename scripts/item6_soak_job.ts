import { getPostgresPool } from '../server/postgresPool';

export async function runSoakJob() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  console.log(`=== ITEM 6: 3-QUERY SOAK JOB EXECUTION [${timestamp}] ===\n`);

  try {
    // 1. parity_mismatch count (users.ai_sparks vs user_sparks_wallets.balance)
    const q1Res = await pool.query(`
      SELECT 
        COUNT(*) as parity_mismatch_count,
        json_agg(json_build_object(
          'user_uid', u.uid,
          'user_sparks', u.ai_sparks,
          'wallet_uid', w.uid,
          'wallet_balance', w.balance
        )) FILTER (WHERE u.ai_sparks IS DISTINCT FROM w.balance) as mismatches
      FROM users u
      FULL OUTER JOIN user_sparks_wallets w ON u.uid = w.uid
      WHERE u.ai_sparks IS DISTINCT FROM w.balance;
    `);

    const parityMismatchCount = parseInt(q1Res.rows[0].parity_mismatch_count, 10);
    const parityMismatches = q1Res.rows[0].mismatches || [];

    // Filter to isolate real students vs ephemeral test artifacts
    const realStudentMismatches = parityMismatches.filter((m: any) => 
      (m.user_uid && !m.user_uid.startsWith('test_')) || (m.wallet_uid && !m.wallet_uid.startsWith('test_'))
    );

    console.log(`[Query 1] Parity Mismatch Count: ${parityMismatchCount}`);
    console.log(`          Real Student Mismatches: ${realStudentMismatches.length}`);
    if (parityMismatches.length > 0) {
      console.log('          Mismatched rows (including test artifacts):', JSON.stringify(parityMismatches, null, 2));
    }

    // 2. dual_write_failures count
    const q2Res = await pool.query(`
      SELECT COUNT(*) as dual_write_failures_count
      FROM dual_write_failures;
    `);
    const dualWriteFailuresCount = parseInt(q2Res.rows[0].dual_write_failures_count, 10);
    console.log(`\n[Query 2] Dual Write Failures Count: ${dualWriteFailuresCount}`);

    // 3. ai_sparks = SUM(delta) violators (users.ai_sparks vs sum of spark_ledger.delta)
    const q3Res = await pool.query(`
      SELECT 
        u.uid,
        u.ai_sparks,
        COALESCE(SUM(l.delta), 0) as ledger_sum,
        (u.ai_sparks - COALESCE(SUM(l.delta), 0)) as discrepancy
      FROM users u
      LEFT JOIN spark_ledger l ON u.uid = l.user_id
      GROUP BY u.uid, u.ai_sparks
      HAVING u.ai_sparks != COALESCE(SUM(l.delta), 0);
    `);
    const violatorsCount = q3Res.rows.length;
    const violators = q3Res.rows;
    const realStudentViolators = violators.filter((v: any) => !v.uid.startsWith('test_'));

    console.log(`\n[Query 3] ai_sparks = SUM(delta) Violators Count: ${violatorsCount}`);
    console.log(`          Real Student Violators: ${realStudentViolators.length}`);
    if (violators.length > 0) {
      console.log('          Violator rows:', JSON.stringify(violators, null, 2));
    }

    const soakRecord = {
      timestamp,
      parity_mismatch_count: parityMismatchCount,
      real_student_parity_mismatch_count: realStudentMismatches.length,
      dual_write_failures_count: dualWriteFailuresCount,
      sum_delta_violators_count: violatorsCount,
      real_student_sum_delta_violators_count: realStudentViolators.length,
      violators_detail: violators,
      mismatches_detail: parityMismatches
    };

    // Store in system_config with timestamp
    await pool.query(`
      INSERT INTO system_config (key, data, updated_at)
      VALUES ('soak_job_agreed_queries', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();
    `, [JSON.stringify(soakRecord)]);

    // Also append to system_logs for audit trail
    const logId = `soak_log_${Date.now()}`;
    await pool.query(`
      INSERT INTO system_logs (log_id, level, category, message, details, created_at)
      VALUES (
        $1,
        'info',
        'SOAK_JOB_EXECUTION',
        'Daily soak job executed 3 agreed queries',
        $2,
        NOW()
      );
    `, [logId, JSON.stringify(soakRecord)]);

    console.log(`\n✅ Soak results successfully recorded in system_config ('soak_job_agreed_queries') and system_logs with timestamp ${timestamp}`);
    return soakRecord;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('item6_soak_job.ts')) {
  runSoakJob().then(() => process.exit(0)).catch(err => {
    console.error('Soak job failed:', err);
    process.exit(1);
  });
}
