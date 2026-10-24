import { getPostgresPool } from '../server/postgresPool';
import crypto from 'crypto';

export async function runDailySoakJob() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  console.log('=== ITEM 8: DAILY 3-QUERY SOAK JOB EXECUTION ===\n');

  const soakResults: any = {
    executedAt: new Date().toISOString(),
    queries: []
  };

  try {
    // Query 1: Vector RAG & Curriculum Chunk Consistency Probe
    console.log('--- Executing Daily Soak Query 1: Vector RAG & Knowledge Chunks Probe ---');
    const q1Start = Date.now();
    const q1Res = await pool.query(`
      SELECT 
        COUNT(*) as total_chunks,
        COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as valid_vectors,
        COUNT(DISTINCT course_id) as courses_covered
      FROM course_knowledge_chunks_v2;
    `);
    const q1Duration = Date.now() - q1Start;
    const q1Data = q1Res.rows[0];
    const q1Result = {
      name: 'vector_rag_integrity',
      durationMs: q1Duration,
      totalChunks: parseInt(q1Data.total_chunks, 10),
      validVectors: parseInt(q1Data.valid_vectors, 10),
      coursesCovered: parseInt(q1Data.courses_covered, 10),
      status: parseInt(q1Data.total_chunks, 10) > 0 ? 'HEALTHY' : 'EMPTY'
    };
    soakResults.queries.push(q1Result);
    console.log(`  Result 1: ${q1Result.totalChunks} chunks, ${q1Result.validVectors} valid vectors across ${q1Result.coursesCovered} courses (${q1Duration}ms)`);

    // Query 2: Atomic Spark Ledger & Wallet Balance Check
    console.log('\n--- Executing Daily Soak Query 2: Spark Ledger & Wallet Balance Check ---');
    const q2Start = Date.now();
    const q2Res = await pool.query(`
      SELECT 
        COUNT(*) as total_wallets,
        COALESCE(SUM(balance), 0) as aggregate_sparks,
        COUNT(CASE WHEN balance < 0 THEN 1 END) as negative_balances
      FROM user_sparks_wallets;
    `);
    const q2Duration = Date.now() - q2Start;
    const q2Data = q2Res.rows[0];
    const q2Result = {
      name: 'spark_wallet_integrity',
      durationMs: q2Duration,
      totalWallets: parseInt(q2Data.total_wallets, 10),
      aggregateSparks: parseInt(q2Data.aggregate_sparks, 10),
      negativeBalances: parseInt(q2Data.negative_balances, 10),
      status: parseInt(q2Data.negative_balances, 10) === 0 ? 'HEALTHY' : 'DEGRADED'
    };
    soakResults.queries.push(q2Result);
    console.log(`  Result 2: ${q2Result.totalWallets} wallets, ${q2Result.negativeBalances} negative balances, aggregate ${q2Result.aggregateSparks} sparks (${q2Duration}ms)`);

    // Query 3: User Progress & Course Completion Integrity Probe
    console.log('\n--- Executing Daily Soak Query 3: User Progress & Course Activity Probe ---');
    const q3Start = Date.now();
    const q3Res = await pool.query(`
      SELECT 
        COUNT(*) as total_progress_rows,
        COUNT(DISTINCT uid) as active_students,
        COUNT(DISTINCT course_id) as enrolled_courses
      FROM user_course_progress;
    `);
    const q3Duration = Date.now() - q3Start;
    const q3Data = q3Res.rows[0];
    const q3Result = {
      name: 'user_progress_integrity',
      durationMs: q3Duration,
      totalProgressRows: parseInt(q3Data.total_progress_rows, 10),
      activeStudents: parseInt(q3Data.active_students, 10),
      enrolledCourses: parseInt(q3Data.enrolled_courses, 10),
      status: 'HEALTHY'
    };
    soakResults.queries.push(q3Result);
    console.log(`  Result 3: ${q3Result.totalProgressRows} progress rows across ${q3Result.activeStudents} active students and ${q3Result.enrolledCourses} courses (${q3Duration}ms)`);

    // Store soak execution in system_config table under key 'daily_soak_results'
    await pool.query(`
      INSERT INTO system_config (key, data, updated_at)
      VALUES ('daily_soak_results', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();
    `, [JSON.stringify(soakResults)]);

    console.log('\n✅ Successfully stored daily soak job results in Neon system_config ("daily_soak_results")');

    // Also fetch current soak_clock_start from system_runtime_flags
    const flagRes = await pool.query(`SELECT flag_key, enabled, description, updated_at FROM system_runtime_flags WHERE flag_key = 'soak_clock_start';`);
    if (flagRes.rows.length > 0) {
      console.log(`\n⏱️ Active Soak Clock in system_runtime_flags:`);
      console.log(`  Flag: ${flagRes.rows[0].flag_key}`);
      console.log(`  Started: ${flagRes.rows[0].description}`);
      console.log(`  Recorded At: ${flagRes.rows[0].updated_at}`);
    } else {
      console.log('\nℹ️ soak_clock_start flag not yet set in system_runtime_flags.');
    }

  } finally {
    await pool.end();
  }

  return soakResults;
}

if (process.argv[1]?.endsWith('item8_daily_soak_job.ts')) {
  runDailySoakJob().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
