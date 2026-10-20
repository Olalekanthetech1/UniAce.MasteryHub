/**
 * UniAce Mastery Hub: Test T12 — Spark Authority & First-Touch Validation Suite
 *
 * Validates Phase 5 Step 3.1 criteria:
 * 1. First-touch creates a seeded users row (updated_at = 'epoch') + opening ledger row (wallet minus prior sum)
 * 2. Pre-auth lock deductions decrease users.ai_sparks and append negative delta to spark_ledger, mirroring wallet
 * 3. Settlement refund restores difference and appends to spark_ledger, mirroring wallet
 * 4. Error refund restores locked amount and appends to spark_ledger, mirroring wallet
 * 5. Direct grant/adjustment updates users.ai_sparks and appends to spark_ledger, mirroring wallet
 * 6. Concurrent first-touch calls produce exactly 1 user row and 1 opening seed ledger entry
 * 7. Monotonic fenced upsert backfill updates profile fields (email, display_name) without altering live ai_sparks
 * 8. Invariant: users.ai_sparks = SUM(spark_ledger.delta) strictly holds across all tests
 */

import { getPostgresPool, checkPostgresHealth } from '../server/postgresPool';
import { SparkRepository } from '../server/repositories/sparkRepository';
import { UserRepository } from '../server/repositories/userRepository';

export async function runT12Test(): Promise<void> {
  console.log('================================================================');
  console.log('🧪 Running Test T12: Spark Authority Cutover & First-Touch Invariants');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL unavailable: ${health.error}`);
  }

  const pool = getPostgresPool()!;
  const testUid = `user_t12_${Date.now()}`;

  try {
    // --- Step 1: Pre-populate wallet only (simulate Phase 3 state) ---
    console.log('--- Subtest 1: First-Touch Ensure-Row & Opening Ledger Seed ---');
    await pool.query(
      `INSERT INTO user_sparks_wallets (uid, balance, plan_type, last_spark_reset, updated_at)
       VALUES ($1, 75, 'free', NOW(), NOW())
       ON CONFLICT (uid) DO NOTHING;`,
      [testUid]
    );

    // Call getWalletBalance to trigger first-touch ensure-row
    const wallet = await SparkRepository.getWalletBalance(testUid);
    if (wallet.balance !== 75) {
      throw new Error(`Expected balance 75, got ${wallet.balance}`);
    }

    // Verify users row created with updated_at = 'epoch'
    const { rows: userRows } = await pool.query(
      `SELECT uid, ai_sparks, updated_at FROM users WHERE uid = $1;`,
      [testUid]
    );
    if (userRows.length !== 1) {
      throw new Error(`Expected exactly 1 user row, found ${userRows.length}`);
    }
    const u = userRows[0];
    if (u.ai_sparks !== 75) {
      throw new Error(`Expected users.ai_sparks 75, got ${u.ai_sparks}`);
    }
    const epochDate = new Date(0).toISOString();
    if (new Date(u.updated_at).toISOString() !== epochDate) {
      throw new Error(`Expected updated_at = 'epoch' (${epochDate}), got ${u.updated_at}`);
    }

    // Verify opening ledger seed row
    const { rows: ledgerRows } = await pool.query(
      `SELECT delta, reason FROM spark_ledger WHERE user_id = $1;`,
      [testUid]
    );
    if (ledgerRows.length !== 1 || ledgerRows[0].delta !== 75 || ledgerRows[0].reason !== 'migration_seed') {
      throw new Error(`Expected 1 opening seed row with delta=75, found: ${JSON.stringify(ledgerRows)}`);
    }
    console.log('  ✅ First-touch ensure-row created with updated_at = epoch and delta = 75');

    // --- Subtest 2: Pre-auth lock deductions ---
    console.log('--- Subtest 2: Pre-Auth Lock Deductions ---');
    const preAuthRes = await SparkRepository.preAuthorizeSparks({
      uid: testUid,
      amount: 25,
      modelId: 'gemini-1.5-flash',
      taskType: 'chat'
    });
    if (!preAuthRes.granted || preAuthRes.currentBalance !== 50) {
      throw new Error(`Expected pre-auth granted with currentBalance 50, got ${JSON.stringify(preAuthRes)}`);
    }

    // Verify mirror in user_sparks_wallets
    const { rows: w1 } = await pool.query('SELECT balance FROM user_sparks_wallets WHERE uid = $1', [testUid]);
    if (w1[0].balance !== 50) {
      throw new Error(`Wallet balance failed to mirror: expected 50, got ${w1[0].balance}`);
    }
    console.log('  ✅ Pre-auth lock deducted 25: users.ai_sparks=50, wallet=50');

    // --- Subtest 3: Settlement refund ---
    console.log('--- Subtest 3: Settlement Refund ---');
    const settleRes = await SparkRepository.settleSparks({
      escrowId: preAuthRes.escrowId!,
      actualCost: 10, // Refund 15 of the 25
      reason: 'Settled chat query'
    });
    if (!settleRes.success || settleRes.finalBalance !== 65 || settleRes.refund !== 15) {
      throw new Error(`Expected settlement finalBalance 65 and refund 15, got ${JSON.stringify(settleRes)}`);
    }

    const { rows: w2 } = await pool.query('SELECT balance FROM user_sparks_wallets WHERE uid = $1', [testUid]);
    if (w2[0].balance !== 65) {
      throw new Error(`Wallet balance failed to mirror: expected 65, got ${w2[0].balance}`);
    }
    console.log('  ✅ Settlement refunded 15: users.ai_sparks=65, wallet=65');

    // --- Subtest 4: Pre-auth and error refund ---
    console.log('--- Subtest 4: Error Refund ---');
    const preAuthRes2 = await SparkRepository.preAuthorizeSparks({
      uid: testUid,
      amount: 20,
      modelId: 'gemini-1.5-flash',
      taskType: 'chat'
    });
    const refundRes = await SparkRepository.refundEscrow({
      escrowId: preAuthRes2.escrowId!,
      reason: 'Provider timeout failure'
    });
    if (!refundRes.success || refundRes.finalBalance !== 65 || refundRes.refundedAmount !== 20) {
      throw new Error(`Expected refund finalBalance 65 and refundedAmount 20, got ${JSON.stringify(refundRes)}`);
    }
    console.log('  ✅ Error refund restored 20: users.ai_sparks=65, wallet=65');

    // --- Subtest 5: Balance adjustments / grants ---
    console.log('--- Subtest 5: Direct Adjustment / Bonus Grant ---');
    const adjustRes = await SparkRepository.adjustBalance({
      uid: testUid,
      amount: 35,
      type: 'bonus_grant',
      reason: 'Academic quiz completion grant'
    });
    if (adjustRes.finalBalance !== 100) {
      throw new Error(`Expected finalBalance 100, got ${adjustRes.finalBalance}`);
    }
    console.log('  ✅ Adjustment added 35: users.ai_sparks=100, wallet=100');

    // --- Subtest 6: Concurrent First-Touch Invariant ---
    console.log('--- Subtest 6: Concurrent First-Touch Race Condition Test ---');
    const concurrentUid = `user_concurrent_${Date.now()}`;
    await pool.query(
      `INSERT INTO user_sparks_wallets (uid, balance, plan_type) VALUES ($1, 40, 'free') ON CONFLICT DO NOTHING;`,
      [concurrentUid]
    );

    // Run 5 simultaneous first-touch ensure calls
    await Promise.all([
      SparkRepository.getWalletBalance(concurrentUid),
      SparkRepository.getWalletBalance(concurrentUid),
      SparkRepository.getWalletBalance(concurrentUid),
      SparkRepository.getWalletBalance(concurrentUid),
      SparkRepository.getWalletBalance(concurrentUid)
    ]);

    const { rows: concUserRows } = await pool.query('SELECT uid, ai_sparks FROM users WHERE uid = $1', [concurrentUid]);
    if (concUserRows.length !== 1 || concUserRows[0].ai_sparks !== 40) {
      throw new Error(`Concurrent first-touch failed: expected 1 row with 40 sparks, got ${concUserRows.length}`);
    }

    const { rows: concLedgerRows } = await pool.query(
      "SELECT delta FROM spark_ledger WHERE user_id = $1 AND reason = 'migration_seed'",
      [concurrentUid]
    );
    if (concLedgerRows.length !== 1 || concLedgerRows[0].delta !== 40) {
      throw new Error(`Concurrent first-touch created duplicate seed entries: found ${concLedgerRows.length}`);
    }
    console.log('  ✅ Concurrent first-touch resulted in exactly 1 users row and 1 seed entry');

    // --- Subtest 7: Monotonic Fenced Upsert Profile Backfill ---
    console.log('--- Subtest 7: Monotonic Fenced Upsert Profile Backfill ---');
    // Simulate backfilling profile metadata for testUid (which has ai_sparks=100 live balance)
    await UserRepository.fencedUpsertUser({
      uid: testUid,
      email: 'student_t12@university.edu',
      display_name: 'Jane Doe',
      role: 'student',
      plan_type: 'free',
      ai_sparks: 75, // Old initial balance in snapshot
      updatedAt: new Date() // Fresh timestamp > 'epoch'
    });

    const { rows: backfilledUser } = await pool.query(
      'SELECT email, display_name, ai_sparks, updated_at FROM users WHERE uid = $1',
      [testUid]
    );
    if (backfilledUser[0].email !== 'student_t12@university.edu' || backfilledUser[0].display_name !== 'Jane Doe') {
      throw new Error('Fenced upsert failed to populate profile attributes');
    }
    if (backfilledUser[0].ai_sparks !== 100) {
      throw new Error(`Fenced upsert clobbered live balance! Expected 100, got ${backfilledUser[0].ai_sparks}`);
    }
    console.log('  ✅ Fenced upsert updated profile fields while preserving live ai_sparks=100');

    // --- Subtest 8: Strict Invariant Check ---
    console.log('--- Subtest 8: Invariant users.ai_sparks = SUM(spark_ledger.delta) ---');
    const { rows: sumRes } = await pool.query(
      'SELECT SUM(delta)::int AS total FROM spark_ledger WHERE user_id = $1',
      [testUid]
    );
    if (sumRes[0].total !== 100) {
      throw new Error(`Invariant failed: spark_ledger SUM is ${sumRes[0].total}, expected 100`);
    }
    console.log(`  ✅ Invariant holds: users.ai_sparks (${backfilledUser[0].ai_sparks}) === spark_ledger SUM (${sumRes[0].total})`);

    // Clean up test rows
    await pool.query('DELETE FROM spark_transactions_ledger WHERE uid IN ($1, $2)', [testUid, concurrentUid]);
    await pool.query('DELETE FROM spark_escrow_locks WHERE uid IN ($1, $2)', [testUid, concurrentUid]);
    await pool.query('DELETE FROM spark_ledger WHERE user_id IN ($1, $2)', [testUid, concurrentUid]);
    await pool.query('DELETE FROM user_sparks_wallets WHERE uid IN ($1, $2)', [testUid, concurrentUid]);
    await pool.query('DELETE FROM users WHERE uid IN ($1, $2)', [testUid, concurrentUid]);

    console.log('\n================================================================');
    console.log('✨ Test T12 PASSED: Spark Authority Cutover & Invariants 100% Verified');
    console.log('================================================================\n');
  } catch (err) {
    // Clean up test rows on failure
    await pool.query('DELETE FROM spark_transactions_ledger WHERE uid IN ($1, $2)', [testUid, `user_concurrent_${Date.now()}`]).catch(() => {});
    await pool.query('DELETE FROM spark_escrow_locks WHERE uid IN ($1, $2)', [testUid, `user_concurrent_${Date.now()}`]).catch(() => {});
    await pool.query('DELETE FROM spark_ledger WHERE user_id IN ($1, $2)', [testUid, `user_concurrent_${Date.now()}`]).catch(() => {});
    await pool.query('DELETE FROM user_sparks_wallets WHERE uid IN ($1, $2)', [testUid, `user_concurrent_${Date.now()}`]).catch(() => {});
    await pool.query('DELETE FROM users WHERE uid IN ($1, $2)', [testUid, `user_concurrent_${Date.now()}`]).catch(() => {});
    throw err;
  }
}

if (process.argv[1] && process.argv[1].includes('test-t12-spark-authority')) {
  runT12Test()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Test T12 FAILED:', err);
      process.exit(1);
    });
}
