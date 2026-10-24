import { getPostgresPool } from '../server/postgresPool.js';

async function runUnfilteredSoak() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  console.log(`=== ITEM 2: UNFILTERED SOAK QUERIES EXECUTION [${timestamp}] ===\n`);

  try {
    // 1. UNFILTERED parity_mismatch count (users.ai_sparks vs user_sparks_wallets.balance)
    const q1Res = await pool.query(`
      SELECT 
        COUNT(*) as total_rows_evaluated,
        COUNT(CASE WHEN u.ai_sparks IS DISTINCT FROM w.balance THEN 1 END) as parity_mismatch_count,
        COALESCE(json_agg(json_build_object(
          'user_uid', u.uid,
          'user_email', u.email,
          'user_sparks', u.ai_sparks,
          'wallet_uid', w.uid,
          'wallet_balance', w.balance
        )) FILTER (WHERE u.ai_sparks IS DISTINCT FROM w.balance), '[]'::json) as mismatches
      FROM users u
      FULL OUTER JOIN user_sparks_wallets w ON u.uid = w.uid;
    `);

    const q1Total = parseInt(q1Res.rows[0].total_rows_evaluated, 10);
    const parityMismatchCount = parseInt(q1Res.rows[0].parity_mismatch_count, 10);
    const parityMismatches = q1Res.rows[0].mismatches;

    console.log(`[Query 1: Parity Mismatch Probe]`);
    console.log(`  Total Evaluated: ${q1Total}`);
    console.log(`  Parity Mismatch Count: ${parityMismatchCount}`);
    if (parityMismatches.length > 0) {
      console.log('  Mismatched Rows:', JSON.stringify(parityMismatches, null, 2));
    } else {
      console.log('  Mismatched Rows: NONE (0 mismatches across all users and wallets)');
    }

    // 2. UNFILTERED dual_write_failures count
    const q2Res = await pool.query(`
      SELECT 
        COUNT(*) as dual_write_failures_count,
        COALESCE(json_agg(row_to_json(f)), '[]'::json) as failure_rows
      FROM dual_write_failures f;
    `);
    const dualWriteFailuresCount = parseInt(q2Res.rows[0].dual_write_failures_count, 10);
    const failureRows = q2Res.rows[0].failure_rows;

    console.log(`\n[Query 2: Dual Write Failures Probe]`);
    console.log(`  Dual Write Failures Count: ${dualWriteFailuresCount}`);
    if (failureRows.length > 0) {
      console.log('  Failure Rows:', JSON.stringify(failureRows, null, 2));
    } else {
      console.log('  Failure Rows: NONE (0 dual write failures recorded)');
    }

    // 3. UNFILTERED ai_sparks = SUM(delta) violators in spark_ledger
    const q3Res = await pool.query(`
      SELECT 
        u.uid,
        u.email,
        u.ai_sparks,
        COALESCE(SUM(l.delta), 0)::integer as ledger_sum,
        (u.ai_sparks - COALESCE(SUM(l.delta), 0)::integer) as discrepancy
      FROM users u
      LEFT JOIN spark_ledger l ON u.uid = l.user_id
      GROUP BY u.uid, u.email, u.ai_sparks
      HAVING u.ai_sparks != COALESCE(SUM(l.delta), 0)::integer;
    `);
    const violatorsCount = q3Res.rows.length;
    const violators = q3Res.rows;

    console.log(`\n[Query 3: ai_sparks = SUM(delta) Violators Probe]`);
    console.log(`  Violators Count: ${violatorsCount}`);
    if (violators.length > 0) {
      console.log('  Violators Rows:', JSON.stringify(violators, null, 2));
    } else {
      console.log('  Violators Rows: NONE (0 violators across all users)');
    }

    // Also show all real 18 rows for spark ledger sum vs ai_sparks
    const allLedgerRes = await pool.query(`
      SELECT 
        u.uid,
        u.email,
        u.ai_sparks,
        COALESCE(SUM(l.delta), 0)::integer as ledger_sum,
        COUNT(l.ledger_id) as ledger_entry_count
      FROM users u
      LEFT JOIN spark_ledger l ON u.uid = l.user_id
      GROUP BY u.uid, u.email, u.ai_sparks
      ORDER BY u.ai_sparks DESC;
    `);

    console.log('\n--- Full Unfiltered Ledger vs User Sparks Summary ---');
    console.table(allLedgerRes.rows);

    const soakRecord = {
      timestamp,
      unfiltered: true,
      total_users_evaluated: q1Total,
      parity_mismatch_count: parityMismatchCount,
      dual_write_failures_count: dualWriteFailuresCount,
      sum_delta_violators_count: violatorsCount,
      violators_detail: violators,
      mismatches_detail: parityMismatches
    };

    // Store in system_config
    await pool.query(`
      INSERT INTO system_config (key, data, updated_at)
      VALUES ('soak_job_unfiltered_queries', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();
    `, [JSON.stringify(soakRecord)]);

    // Store in system_logs
    const logId = `soak_unfiltered_${Date.now()}`;
    await pool.query(`
      INSERT INTO system_logs (log_id, level, category, message, details, created_at)
      VALUES ($1, 'info', 'SOAK_JOB_UNFILTERED', 'Unfiltered soak job executed 3 agreed queries', $2, NOW());
    `, [logId, JSON.stringify(soakRecord)]);

    console.log(`\n✅ Stored unfiltered soak results in system_config ('soak_job_unfiltered_queries') and system_logs with log_id ${logId}`);

  } finally {
    await pool.end();
  }
}

runUnfilteredSoak().catch(e => {
  console.error(e);
  process.exit(1);
});
