/**
 * UniAce Mastery Hub: Stage 3 Verification Gate
 * Concurrency stress test for Spark Escrow & Ledger Relational Migration
 * Simulates concurrent AI requests with SELECT FOR UPDATE locks.
 */

import { SparkRepository } from '../server/repositories/sparkRepository';
import { queryPostgres } from '../server/postgresPool';

async function runSparksEscrowStressTest() {
  console.log('================================================================');
  console.log('🧪 Stage 3 Verification Gate: Spark Escrow Relational Concurrency');
  console.log('================================================================\n');

  const testUid = `test_student_concurrency_${Date.now()}`;
  console.log(`Setting up test student wallet: ${testUid}`);

  // 1. Initialize test wallet with 100 sparks
  const initSql = `
    INSERT INTO user_sparks_wallets (uid, balance, plan_type, last_spark_reset, updated_at)
    VALUES ($1, 100, 'free', NOW(), NOW())
    ON CONFLICT (uid) DO UPDATE SET balance = 100, updated_at = NOW()
    RETURNING uid, balance, plan_type;
  `;
  const initRes = await queryPostgres(initSql, [testUid]);
  console.log(`✅ Initialized wallet: balance=${initRes.rows[0].balance}, plan=${initRes.rows[0].plan_type}`);

  // 2. Concurrency test: 20 parallel requests attempting to lock 10 sparks each
  // Since balance is 100, exactly 10 requests should succeed, and 10 should be rejected cleanly due to insufficient balance.
  console.log('\n--- Test 1: High-Concurrency Contention (20 parallel requests on same wallet) ---');
  const t0 = Date.now();

  const parallelPromises = Array.from({ length: 20 }, async (_, index) => {
    try {
      const res = await SparkRepository.preAuthorizeSparks({
        uid: testUid,
        amount: 10,
        modelId: 'groq/llama-3.3-70b-versatile',
        taskType: 'chat',
        reason: `Concurrent query #${index + 1}`
      });
      return { index, success: res.granted, escrowId: res.escrowId, balance: res.currentBalance };
    } catch (err: any) {
      return { index, success: false, error: err.message };
    }
  });

  const results = await Promise.all(parallelPromises);
  const durationMs = Date.now() - t0;

  const successfulLocks = results.filter((r) => r.success);
  const rejectedLocks = results.filter((r) => !r.success);

  console.log(`Execution completed in ${durationMs}ms`);
  console.log(`Successful locks: ${successfulLocks.length} (expected 10)`);
  console.log(`Rejected locks (insufficient balance): ${rejectedLocks.length} (expected 10)`);

  if (successfulLocks.length !== 10 || rejectedLocks.length !== 10) {
    throw new Error(
      `Concurrency invariant violated! Expected 10 granted and 10 rejected, got ${successfulLocks.length} granted, ${rejectedLocks.length} rejected.`
    );
  }
  console.log('✅ Invariant 1 Passed: Exactly 10 requests locked and 10 cleanly rejected.');

  // 3. Verify balance is exactly 0
  const midWallet = await SparkRepository.getWalletBalance(testUid);
  console.log(`Mid-test balance after pre-auth: ${midWallet.balance} (expected 0)`);
  if (midWallet.balance !== 0) {
    throw new Error(`Expected balance 0, got ${midWallet.balance}`);
  }
  console.log('✅ Invariant 2 Passed: Non-negative balance constraint upheld.');

  // 4. Concurrently settle and refund locks
  console.log('\n--- Test 2: Concurrent Settlement & Refund Escrow ---');
  // Settle first 5 with actualCost = 3 (refund = 7 each) -> +35 sparks
  // Refund remaining 5 completely with actualCost = 0 (refund = 10 each) -> +50 sparks
  // Expected final balance = 35 + 50 = 85 sparks
  const settlePromises = successfulLocks.slice(0, 5).map((l) =>
    SparkRepository.settleSparks({
      escrowId: l.escrowId!,
      actualCost: 3,
      reason: 'AI chat finished with 3 tokens cost'
    })
  );

  const refundPromises = successfulLocks.slice(5, 10).map((l) =>
    SparkRepository.refundEscrow({
      escrowId: l.escrowId!,
      reason: 'AI provider error simulation'
    })
  );

  await Promise.all([...settlePromises, ...refundPromises]);

  const finalWallet = await SparkRepository.getWalletBalance(testUid);
  console.log(`Final wallet balance: ${finalWallet.balance} (expected 85)`);
  if (finalWallet.balance !== 85) {
    throw new Error(`Expected final balance 85, got ${finalWallet.balance}`);
  }
  console.log('✅ Invariant 3 Passed: Settlement and refund arithmetic 100% matched.');

  // 5. Verify transaction ledger integrity
  const ledgerRes = await queryPostgres(
    `SELECT transaction_id, delta, balance_after, type FROM spark_transactions_ledger WHERE uid = $1 ORDER BY seq ASC;`,
    [testUid]
  );
  console.log(`Recorded ${ledgerRes.rows.length} immutable ledger transactions.`);
  let computedBalance = 100;
  for (const row of ledgerRes.rows) {
    computedBalance += row.delta;
    if (computedBalance !== row.balance_after) {
      throw new Error(`Ledger drift detected! computed=${computedBalance}, recorded=${row.balance_after}`);
    }
  }
  console.log(`✅ Invariant 4 Passed: Append-only ledger reconciles 100% to final balance (${computedBalance}).`);

  // 6. Cleanup test records
  await queryPostgres(`DELETE FROM user_sparks_wallets WHERE uid = $1;`, [testUid]);
  console.log(`\n🧹 Cleaned up test wallet: ${testUid}`);

  console.log('\n================================================================');
  console.log('🎉 ALL STAGE 3 CONCURRENCY & INTEGRITY GATES PASSED');
  console.log('================================================================');
}

runSparksEscrowStressTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Stage 3 Stress Test Failed:', err);
    process.exit(1);
  });
