import crypto from 'crypto';
import dotenv from 'dotenv';
import { getAdminApp } from '../server/firebaseAdmin';
import {
  getLedgerScopedCollection,
  computeSparkMarginMetrics,
  executeSparkPreAuth,
  executeSparkSettle,
  executeTransactionalPaymentSuccess
} from '../server/sparkLedger';
import {
  executePaystackReversalOrDispute,
  reconcileSparkRollups,
  acquireCutoffLock,
  releaseCutoffLock,
  toKobo,
  toNgn
} from '../server/sparkRollups';

dotenv.config();

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function main() {
  const app = getAdminApp();
  assert(Boolean(app), 'Firebase Admin app must be initialized');
  const db = app!.firestore();

  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const sandboxNamespace = `sandbox_stage3b_${runId}`;
  const projectId = app!.options.projectId || process.env.FIREBASE_PROJECT_ID || 'resolved-from-credential';

  console.log(`=== Stage 3B Financial Rollups, Multiple-Refund Idempotency & Watermarked Cutoff Test (runId=${runId}) ===`);
  console.log(`[TARGET] projectId=${projectId} | sandbox=${sandboxNamespace}`);

  const usersCol = getLedgerScopedCollection(db, 'users', sandboxNamespace);
  const paymentsCol = getLedgerScopedCollection(db, 'payments', sandboxNamespace);
  const ledgerCol = getLedgerScopedCollection(db, 'spark_ledger', sandboxNamespace);
  const rollupsCol = getLedgerScopedCollection(db, 'spark_ledger_rollups', sandboxNamespace);
  const configCol = getLedgerScopedCollection(db, 'system_config', sandboxNamespace);

  // Enable bucket accounting and token pricing in sandbox
  await Promise.all([
    configCol.doc('evaluation_policy').set({ enableSparkBucketLedger: true }),
    configCol.doc('token_pricing').set({
      ngnPerUsdRate: 1550,
      fxSourceUrl: 'https://www.cbn.gov.ng',
      version: 1,
      standardUsdPer1k: 0.0015,
      highUsdPer1k: 0.0030,
      lastVerifiedAt: new Date().toISOString(),
      sourceUrl: 'https://openrouter.ai'
    })
  ]);

  try {
    // -------------------------------------------------------------------------------------------------
    // TEST 1: Double-Entry Balance & Equity Lifecycle (Purchase -> Pre-Auth -> Settle -> Dispute Hold -> Resolution)
    // -------------------------------------------------------------------------------------------------
    console.log('\n--- TEST 1: Double-Entry Balance & Equity Lifecycle ---');
    const user1Uid = `user_lifecycle_${runId}`;
    const ref1 = `pay_lifecycle_${runId}`;

    // Step 1.1: Purchase Pack (1,000 NGN -> 500 Sparks)
    await usersCol.doc(user1Uid).set({
      uid: user1Uid,
      email: `${user1Uid}@uniace.test`,
      plan_type: 'free',
      role: 'student',
      ai_sparks: 10,
      free_sparks: 10,
      paid_sparks: 0,
      bucket_tracking_initialized: true,
      bucketSource: 'tracked'
    });

    const payResult = await executeTransactionalPaymentSuccess({
      app: app!,
      uid: user1Uid,
      reference: ref1,
      amount: 1000,
      planType: 'emergency_topup',
      sandboxNamespace
    });

    assert(!payResult.alreadyProcessed, 'Payment 1 must process successfully');
    assert(payResult.newPaidSparks === 500, `Paid sparks must be 500, got ${payResult.newPaidSparks}`);
    assert(payResult.newAiSparks === 510, `Total ai_sparks must be 510, got ${payResult.newAiSparks}`);

    const uSnap1 = await usersCol.doc(user1Uid).get();
    const u1 = uSnap1.data()!;
    assert(u1.paid_sparks === 500 && u1.free_sparks === 10, 'User balances must match post-purchase');

    // Step 1.2: Pre-Auth (deducts 10 sparks atomically from free bucket first)
    const token1 = `token_preauth_${runId}`;
    const preAuthRes = await executeSparkPreAuth({
      app: app!,
      uid: user1Uid,
      userEmail: u1.email,
      idempotencyToken: token1,
      complexity: 'standard',
      maxPreAuth: 10,
      rateLimitSeconds: 0,
      endpoint: 'http_chat',
      isAdminEmailFn: () => false,
      sandboxNamespace
    });

    assert(preAuthRes.freeSparks === 0, `Free sparks must be 0 after pre-auth, got ${preAuthRes.freeSparks}`);
    assert(preAuthRes.paidSparks === 500, `Paid sparks must remain 500, got ${preAuthRes.paidSparks}`);

    // Step 1.3: Settle with actual cost 6 (4 free sparks refunded)
    const settleRes = await executeSparkSettle({
      app: app!,
      uid: user1Uid,
      userEmail: u1.email,
      idempotencyToken: token1,
      isFreeUser: true,
      fallbackPreAuthDeduction: 10,
      actualCost: 6,
      totalTokens: 1500,
      complexity: 'standard',
      endpoint: 'http_chat',
      providerUsed: 'groq',
      planType: 'free',
      role: 'student',
      sandboxNamespace
    });

    assert(settleRes.freeSparks === 4, `Free sparks must be 4 after refund, got ${settleRes.freeSparks}`);
    assert(settleRes.paidSparks === 500, `Paid sparks must remain 500, got ${settleRes.paidSparks}`);
    assert(settleRes.finalSparks === 504, `Final ai_sparks must be 504, got ${settleRes.finalSparks}`);

    // Step 1.4: Dispute Create on Payment (Quarantine 250 paid sparks to frozen_disputed_paid_sparks)
    const dispEvent1 = `evt_disp_${runId}`;
    const disputeHoldRes = await executePaystackReversalOrDispute({
      app: app!,
      eventId: dispEvent1,
      eventType: 'dispute.create',
      reference: ref1,
      disputeAmountNgn: 500, // 50% dispute -> 250 sparks quarantined
      reason: 'Customer initiated chargeback',
      sandboxNamespace
    });

    assert(!disputeHoldRes.alreadyProcessed, 'Dispute create must execute');
    const uSnapDisp = await usersCol.doc(user1Uid).get();
    const uDisp = uSnapDisp.data()!;
    assert(uDisp.paid_sparks === 250, `Available paid_sparks must decrement to 250, got ${uDisp.paid_sparks}`);
    assert(uDisp.frozen_disputed_paid_sparks === 250, `Frozen disputed sparks must be 250, got ${uDisp.frozen_disputed_paid_sparks}`);
    // System Unsettled Equity Conservation Identity:
    const unsettledEquity = (uDisp.paid_sparks || 0) + (uDisp.frozen_disputed_paid_sparks || 0);
    assert(unsettledEquity === 500, `Total unsettled equity must remain exactly 500: got ${unsettledEquity}`);

    // Step 1.5: Dispute Won -> Unfreeze back to spendable paid_sparks
    const dispWinEvent = `evt_disp_win_${runId}`;
    const disputeWonRes = await executePaystackReversalOrDispute({
      app: app!,
      eventId: dispWinEvent,
      eventType: 'dispute.resolved',
      reference: ref1,
      disputeStatus: 'won',
      sandboxNamespace
    });

    assert(!disputeWonRes.alreadyProcessed, 'Dispute won must execute');
    assert(disputeWonRes.unfrozenSparks === 250, `Must unfreeze 250 sparks, got ${disputeWonRes.unfrozenSparks}`);
    const uSnapWon = await usersCol.doc(user1Uid).get();
    const uWon = uSnapWon.data()!;
    assert(uWon.paid_sparks === 500, `Available paid sparks must restore to 500, got ${uWon.paid_sparks}`);
    assert(uWon.frozen_disputed_paid_sparks === 0, `Frozen disputed sparks must be 0, got ${uWon.frozen_disputed_paid_sparks}`);
    console.log('[PASS] Test 1: Complete Double-Entry Balance & Equity Lifecycle verified with zero double-counting');

    // -------------------------------------------------------------------------------------------------
    // TEST 2: CACHE_HIT Consistency & Estimated Model Value Benchmark
    // -------------------------------------------------------------------------------------------------
    console.log('\n--- TEST 2: CACHE_HIT Consistency & Margin Reporting ---');
    const cacheMetrics = computeSparkMarginMetrics(
      'semantic_cache',
      2400, // tokens saved
      10,   // sparks charged
      'standard',
      null, // rate card not required for cache
      14,
      0.01, // implied rate $0.01/Spark benchmark
      { paidSparksUsed: 10, bucketSource: 'tracked' }
    );

    assert(cacheMetrics.costStatus === 'CACHE_HIT', `Must produce CACHE_HIT, got ${cacheMetrics.costStatus}`);
    assert(cacheMetrics.estimatedCostUsd === 0, `Cache hit must have exactly $0.00 provider cost: got ${cacheMetrics.estimatedCostUsd}`);
    assert(cacheMetrics.estimatedRevenueUsd === 0.1, `Revenue benchmark must be 0.1 (10 * 0.01): got ${cacheMetrics.estimatedRevenueUsd}`);
    assert(cacheMetrics.grossMarginUsd === 0.1, `Gross margin must equal estimated revenue: got ${cacheMetrics.grossMarginUsd}`);

    // Non-cache provider with zero tokens must produce COST_UNKNOWN (never $0)
    const zeroTokenMetrics = computeSparkMarginMetrics(
      'gemini_direct',
      0, // zero tokens reported
      5,
      'standard',
      null,
      14,
      0.01
    );
    assert(zeroTokenMetrics.costStatus === 'COST_UNKNOWN', `Must be COST_UNKNOWN, got ${zeroTokenMetrics.costStatus}`);
    assert(zeroTokenMetrics.estimatedCostUsd === null, `Estimated cost must be null, never $0: got ${zeroTokenMetrics.estimatedCostUsd}`);
    console.log('[PASS] Test 2: CACHE_HIT unit economics and COST_UNKNOWN zero-token integrity verified');

    // -------------------------------------------------------------------------------------------------
    // TEST 3: Multiple Partial Refunds, Idempotency & Shortfall Safeguards
    // -------------------------------------------------------------------------------------------------
    console.log('\n--- TEST 3: Multiple Partial Refunds, Webhook Idempotency & Shortfall Safeguards ---');
    const user2Uid = `user_refunds_${runId}`;
    const ref2 = `pay_refunds_${runId}`;

    await usersCol.doc(user2Uid).set({
      uid: user2Uid,
      email: `${user2Uid}@uniace.test`,
      plan_type: 'free',
      role: 'student',
      ai_sparks: 0,
      free_sparks: 0,
      paid_sparks: 0,
      bucket_tracking_initialized: true,
      bucketSource: 'tracked'
    });

    // Payment: 2,000 NGN -> 1,000 Sparks added
    await executeTransactionalPaymentSuccess({
      app: app!,
      uid: user2Uid,
      reference: ref2,
      amount: 2000,
      planType: 'scholar',
      sandboxNamespace
    });

    // Simulate user spending 800 paid sparks, leaving 200 spendable sparks
    await usersCol.doc(user2Uid).update({
      paid_sparks: 200,
      ai_sparks: 200
    });

    // First Partial Refund: 1,000 NGN (50% refund) -> Target Clawback = floor(2000 * 1000 / 2000) = 1000 sparks
    const refundEvent1 = `rfnd_part1_${runId}`;
    const refund1Res = await executePaystackReversalOrDispute({
      app: app!,
      eventId: refundEvent1,
      eventType: 'charge.refunded',
      reference: ref2,
      refundAmountNgn: 1000,
      sandboxNamespace
    });

    assert(!refund1Res.alreadyProcessed, 'First partial refund must execute');
    assert(refund1Res.clawedBackSparks === 200, `Must claw back up to spendable 200 sparks, got ${refund1Res.clawedBackSparks}`);
    assert(refund1Res.shortfallSparks === 800, `Must record shortfall of 800 sparks, got ${refund1Res.shortfallSparks}`);

    const uSnapR1 = await usersCol.doc(user2Uid).get();
    assert(uSnapR1.data()!.paid_sparks === 0, 'User paid sparks must be written down to 0');

    const pSnapR1 = await paymentsCol.doc(ref2).get();
    assert(pSnapR1.data()!.sparks_clawed_back === 200, 'Payment must record 200 clawed back');
    assert(pSnapR1.data()!.sparks_shortfall_unrecovered === 800, 'Payment must record 800 shortfall');

    // Idempotent retry of First Partial Refund with same event ID
    const refund1Retry = await executePaystackReversalOrDispute({
      app: app!,
      eventId: refundEvent1,
      eventType: 'charge.refunded',
      reference: ref2,
      refundAmountNgn: 1000,
      sandboxNamespace
    });
    assert(refund1Retry.alreadyProcessed === true, 'Retry must be caught idempotently as alreadyProcessed');
    const uSnapRetry = await usersCol.doc(user2Uid).get();
    assert(uSnapRetry.data()!.paid_sparks === 0, 'Balance must remain 0 after retry');

    // Second Partial Refund: 500 NGN (25% refund, cumulative 1,500 NGN = 75%)
    // Cumulative Target = floor(2000 * 1500 / 2000) = 1500 sparks.
    // Accounted so far = 200 (clawed) + 800 (shortfall) = 1000. Marginal Target = 500 sparks.
    const refundEvent2 = `rfnd_part2_${runId}`;
    const refund2Res = await executePaystackReversalOrDispute({
      app: app!,
      eventId: refundEvent2,
      eventType: 'charge.refunded',
      reference: ref2,
      refundAmountNgn: 500,
      sandboxNamespace
    });

    assert(!refund2Res.alreadyProcessed, 'Second partial refund must execute');
    assert(refund2Res.clawedBackSparks === 0, `Available balance is 0, so clawed back must be 0: got ${refund2Res.clawedBackSparks}`);
    assert(refund2Res.shortfallSparks === 500, `Marginal shortfall must be 500 sparks: got ${refund2Res.shortfallSparks}`);

    const pSnapR2 = await paymentsCol.doc(ref2).get();
    assert(pSnapR2.data()!.sparks_shortfall_unrecovered === 1300, `Cumulative shortfall must be 1300: got ${pSnapR2.data()!.sparks_shortfall_unrecovered}`);

    // Shortfall Safeguard: User purchases a NEW pack of 500 sparks
    // The previous 1300 shortfall MUST NOT be clawed back from this new purchase!
    const refNewPack = `pay_newpack_${runId}`;
    await executeTransactionalPaymentSuccess({
      app: app!,
      uid: user2Uid,
      reference: refNewPack,
      amount: 1000,
      planType: 'emergency_topup',
      sandboxNamespace
    });

    const uSnapNew = await usersCol.doc(user2Uid).get();
    assert(
      uSnapNew.data()!.paid_sparks === 500,
      `New purchase balance must remain intact at 500 sparks (never clawed back for prior shortfall): got ${uSnapNew.data()!.paid_sparks}`
    );
    console.log('[PASS] Test 3: Multiple partial refunds, event deduplication, and shortfall non-re-clawing verified');

    // -------------------------------------------------------------------------------------------------
    // TEST 4: Watermarked Cutoff Reconciliation, Concurrency Isolation & Zero Silent Overwrites
    // -------------------------------------------------------------------------------------------------
    console.log('\n--- TEST 4: Watermarked Cutoff Lock & Reconciliation ---');

    // 4.1: Cutoff Lock Concurrency & Conflict
    const workerA = `worker_A_${runId}`;
    const workerB = `worker_B_${runId}`;
    const batch1 = `batch_1_${runId}`;

    const lockA = await acquireCutoffLock(db, workerA, batch1, sandboxNamespace);
    assert(lockA.acquired === true, 'Worker A must acquire lock');

    const lockB = await acquireCutoffLock(db, workerB, `batch_2_${runId}`, sandboxNamespace);
    assert(lockB.acquired === false, 'Worker B must be rejected while lock is held by Worker A');

    await releaseCutoffLock(db, workerA, batch1, sandboxNamespace);

    // 4.2: Temporal Watermark Isolation (Concurrent Write Boundary)
    const cutoffWatermark = new Date();
    // Delay 50ms so after-timestamp is strictly greater
    await new Promise((r) => setTimeout(r, 50));

    // Seed an event BEFORE the watermark
    const beforeEventId = `PREAUTH_before_${runId}`;
    await ledgerCol.doc(beforeEventId).set({
      id: beforeEventId,
      action: 'PRE_AUTH',
      preAuthAmount: 10,
      createdAtIso: new Date(cutoffWatermark.getTime() - 5000).toISOString()
    });

    // Seed a concurrent event AFTER the watermark (must be ignored by reconciliation!)
    const afterEventId = `PREAUTH_after_${runId}`;
    await ledgerCol.doc(afterEventId).set({
      id: afterEventId,
      action: 'PRE_AUTH',
      preAuthAmount: 100,
      createdAtIso: new Date(cutoffWatermark.getTime() + 5000).toISOString()
    });

    // Run Dry-Run Reconcile bounded by cutoffWatermark
    const dryRunReport = await reconcileSparkRollups({
      db,
      workerId: workerA,
      dryRun: true,
      cutoffTimestamp: cutoffWatermark,
      sandboxNamespace
    });

    assert(dryRunReport.dryRun === true, 'Report must be dry run');
    assert(
      dryRunReport.recomputedRollup.totalPreAuthSparks === 20,
      `Must only scan the pre-cutoff events (10 from Test 1 + 10 from seed = 20 sparks), ignoring post-cutoff (100 sparks): got ${dryRunReport.recomputedRollup.totalPreAuthSparks}`
    );

    // Verify dry-run did NOT write all_time rollup document
    const storedRollupSnap = await rollupsCol.doc('all_time').get();
    assert(!storedRollupSnap.exists, 'Dry run must be strictly read-only; all_time rollup must not be written');

    // Run Live Reconcile Commit bounded by cutoffWatermark
    const liveReport = await reconcileSparkRollups({
      db,
      workerId: workerA,
      dryRun: false,
      cutoffTimestamp: cutoffWatermark,
      sandboxNamespace
    });

    assert(liveReport.dryRun === false, 'Live report must not be dry run');
    const liveStoredSnap = await rollupsCol.doc('all_time').get();
    assert(liveStoredSnap.exists, 'Live commit must persist stored all_time rollup document');
    assert(
      liveStoredSnap.data()?.totalPreAuthSparks === 20,
      `Persisted rollup must have exactly 20 pre-auth sparks: got ${liveStoredSnap.data()?.totalPreAuthSparks}`
    );

    // Verify user balances were NOT modified by reconciliation (Zero Silent Repair policy)
    const userSnapAfterReconcile = await usersCol.doc(user2Uid).get();
    assert(
      userSnapAfterReconcile.data()!.paid_sparks === 500,
      'User balance must remain unaltered by reconciliation process'
    );
    console.log('[PASS] Test 4: Watermarked cutoff lock, concurrent write isolation, and zero-silent-repair verified');

    console.log('\n========================================================================');
    console.log('✅ ALL STAGE 3B FINANCIAL & RECONCILIATION SUITES PASSED CLEANLY');
    console.log('========================================================================\n');
  } finally {
    // Clean up sandbox documents to avoid cluttering Firestore
    console.log(`Cleaning up test sandbox ${sandboxNamespace}...`);
    const subcols = ['users', 'payments', 'spark_ledger', 'spark_ledger_rollups', 'paystack_webhook_events', 'spark_ledger_reconciliations', 'system_config', 'system_logs'];
    for (const sub of subcols) {
      const snap = await getLedgerScopedCollection(db, sub, sandboxNamespace).get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      if (snap.size > 0) {
        await batch.commit();
      }
    }
    console.log(`Sandbox ${sandboxNamespace} successfully cleaned up.`);
  }
}

main().catch((err) => {
  console.error('STAGE 3B TEST SUITE FAILED:', err);
  process.exit(1);
});
