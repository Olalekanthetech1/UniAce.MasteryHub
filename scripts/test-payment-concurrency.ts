import crypto from 'crypto';
import dotenv from 'dotenv';
import { getAdminApp } from '../server/firebaseAdmin';
import {
  executeTransactionalPaymentSuccess,
  getLedgerScopedCollection
} from '../server/sparkLedger';

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
  const sandboxNamespace = `sandbox_stage3a_${runId}`;
  const projectId = app!.options.projectId || process.env.FIREBASE_PROJECT_ID || 'resolved-from-credential';
  const emulatorHost =
    process.env.FIRESTORE_EMULATOR_HOST ||
    'NONE (Real Live Cloud Firestore — Isolated _ci_test_sandboxes Namespace)';

  console.log(`=== Stage 3A Payment Concurrency, FX Snapshot, Isolation & Crash Recovery Test (runId=${runId}) ===`);
  console.log(`[TARGET] projectId=${projectId} | emulator=${emulatorHost} | sandbox=${sandboxNamespace}`);

  const usersCol = getLedgerScopedCollection(db, 'users', sandboxNamespace);
  const paymentsCol = getLedgerScopedCollection(db, 'payments', sandboxNamespace);
  const configCol = getLedgerScopedCollection(db, 'system_config', sandboxNamespace);
  const affiliatesCol = getLedgerScopedCollection(db, 'affiliates', sandboxNamespace);
  const earningsCol = getLedgerScopedCollection(db, 'affiliate_earnings', sandboxNamespace);

  const trackedUid = `pay_race_tracked_${runId}`;
  const legacyUid = `pay_race_legacy_${runId}`;
  const isoUid = `pay_race_iso_${runId}`;
  const refCode = `TESTAFF_${runId.toUpperCase()}`;
  const ref1 = `payref_tracked_${runId}`;
  const ref2 = `payref_legacy_${runId}`;
  const ref3 = `payref_iso_${runId}`;

  const policyRef = configCol.doc('evaluation_policy');
  const tokenPricingRef = configCol.doc('token_pricing');

  // Snapshot top-level production collections and system_config before running to prove zero production mutation
  const PROD_COLLECTIONS = ['users', 'payments', 'affiliates', 'affiliate_earnings', 'spark_ledger', 'spark_ledger_rollups', 'system_config'];
  const beforeSnaps = await Promise.all(PROD_COLLECTIONS.map((c) => db.collection(c).get()));
  const prodCountsBefore: Record<string, number> = {};
  PROD_COLLECTIONS.forEach((c, idx) => {
    prodCountsBefore[c] = beforeSnaps[idx].size;
  });
  const [prodPolicyBefore, prodPricingBefore] = await Promise.all([
    db.collection('system_config').doc('evaluation_policy').get(),
    db.collection('system_config').doc('token_pricing').get()
  ]);

  try {
    // 1. Setup test users and affiliate inside isolated sandboxNamespace
    await Promise.all([
      usersCol.doc(trackedUid).set({
        uid: trackedUid,
        email: `${trackedUid}@uniace.test`,
        plan_type: 'free',
        role: 'student',
        ai_sparks: 15,
        free_sparks: 10,
        paid_sparks: 5,
        bucket_tracking_initialized: true,
        bucketSource: 'tracked',
        referredBy: refCode
      }),
      usersCol.doc(legacyUid).set({
        uid: legacyUid,
        email: `${legacyUid}@uniace.test`,
        plan_type: 'free',
        role: 'student',
        ai_sparks: 25
      }),
      usersCol.doc(isoUid).set({
        uid: isoUid,
        email: `${isoUid}@uniace.test`,
        plan_type: 'free',
        role: 'student',
        ai_sparks: 8,
        free_sparks: 8,
        paid_sparks: 0,
        bucket_tracking_initialized: true,
        bucketSource: 'tracked',
        referredBy: refCode
      }),
      affiliatesCol.doc(refCode).set({
        code: refCode,
        paidConversions: 0,
        totalEarned: 0,
        pendingBalance: 0
      })
    ]);

    // 2. Test 1: 5 Concurrent Calls (/api/verify-payment + /api/paystack-webhook + retries) with FX configured & Bucket Ledger ON
    await Promise.all([
      policyRef.set({ enableSparkBucketLedger: true }, { merge: true }),
      tokenPricingRef.set(
        {
          ngnPerUsdRate: 1550,
          fxSourceUrl: 'https://www.cbn.gov.ng/rates/ExchRateByCurrency.asp',
          version: 7
        },
        { merge: true }
      )
    ]);

    const raceResults1 = await Promise.all(
      Array.from({ length: 5 }, () =>
        executeTransactionalPaymentSuccess({
          app: app!,
          uid: trackedUid,
          reference: ref1,
          amount: 1550,
          planType: 'emergency_topup',
          metadata: { referredBy: refCode },
          commissionRateOverride: 0.20,
          sandboxNamespace
        })
      )
    );

    const processedCount1 = raceResults1.filter((r) => !r.alreadyProcessed).length;
    const skippedCount1 = raceResults1.filter((r) => r.alreadyProcessed).length;
    assert(
      processedCount1 === 1 && skippedCount1 === 4,
      `Expected exactly 1 processed and 4 idempotent skips in 5-way race, got processed=${processedCount1}, skipped=${skippedCount1}`
    );

    const [u1Snap, p1Snap, affSnap, earnSnap] = await Promise.all([
      usersCol.doc(trackedUid).get(),
      paymentsCol.doc(ref1).get(),
      affiliatesCol.doc(refCode).get(),
      earningsCol.doc(`${refCode}_${ref1}`).get()
    ]);

    const u1 = u1Snap.data()!;
    const p1 = p1Snap.data()!;
    const aff = affSnap.data()!;

    assert(
      u1.free_sparks === 10 && u1.paid_sparks === 505 && u1.ai_sparks === 515,
      `Tracked user must be credited exactly once (+500 paid_sparks): expected free=10, paid=505, ai=515, got free=${u1.free_sparks}, paid=${u1.paid_sparks}, ai=${u1.ai_sparks}`
    );
    assert(
      u1.ai_sparks === u1.free_sparks + u1.paid_sparks,
      'Tracked user must satisfy ai_sparks === free_sparks + paid_sparks'
    );
    assert(
      p1.fxStatus === 'VERIFIED' &&
        p1.snapshotNgnPerUsdRate === 1550 &&
        p1.amountUsd === 1 &&
        p1.fxVersion === 7 &&
        p1.affiliate_status === 'credited',
      `Payment doc must snapshot FX rate 1550, amountUsd=1.0, and affiliate_status=credited: got ${JSON.stringify(p1)}`
    );
    assert(
      aff.paidConversions === 1 && aff.totalEarned === 310 && aff.pendingBalance === 310 && earnSnap.exists,
      `Affiliate must be credited exactly once (paidConversions=1, commission=310): got ${JSON.stringify(aff)}`
    );
    console.log('[PASS] 1/4 5-way concurrent payment race credited Sparks and Affiliate Commission exactly once with VERIFIED FX snapshot');

    // 3. Test 2: Concurrent Race with Bucket Ledger OFF & FX Unconfigured (ngnPerUsdRate = null)
    await Promise.all([
      policyRef.set({ enableSparkBucketLedger: false }, { merge: true }),
      tokenPricingRef.set({ ngnPerUsdRate: null }, { merge: true })
    ]);

    const raceResults2 = await Promise.all(
      Array.from({ length: 4 }, () =>
        executeTransactionalPaymentSuccess({
          app: app!,
          uid: legacyUid,
          reference: ref2,
          amount: 500,
          planType: 'emergency_topup',
          sandboxNamespace
        })
      )
    );

    assert(
      raceResults2.filter((r) => !r.alreadyProcessed).length === 1,
      'Expected 1 processed and 3 skipped in 4-way legacy race'
    );

    const [u2Snap, p2Snap] = await Promise.all([
      usersCol.doc(legacyUid).get(),
      paymentsCol.doc(ref2).get()
    ]);
    const u2 = u2Snap.data()!;
    const p2 = p2Snap.data()!;

    assert(
      u2.ai_sparks === 525 && u2.free_sparks === undefined && u2.paid_sparks === undefined,
      `Legacy user with flag OFF must have ai_sparks=525 and no bucket fields written, got ${JSON.stringify(u2)}`
    );
    assert(
      p2.fxStatus === 'FX_UNCONFIGURED' &&
        p2.amountUsd === null &&
        p2.snapshotNgnPerUsdRate === null &&
        p2.affiliate_status === 'not_applicable',
      `Payment with null ngnPerUsdRate must record FX_UNCONFIGURED, amountUsd=null, and affiliate_status=not_applicable, got ${JSON.stringify(p2)}`
    );
    console.log('[PASS] 2/4 Legacy mode + FX_UNCONFIGURED concurrent race preserved legacy user schema and recorded null amountUsd');

    // 4. Test 3: Post-Commit Affiliate Failure Isolation (Student Sparks still committed!)
    await policyRef.set({ enableSparkBucketLedger: true }, { merge: true });
    const isoRes = await executeTransactionalPaymentSuccess({
      app: app!,
      uid: isoUid,
      reference: ref3,
      amount: 500,
      planType: 'emergency_topup',
      metadata: { referredBy: refCode },
      commissionRateOverride: 0.20,
      simulateAffiliateFailureForTest: true,
      sandboxNamespace
    });

    const [u3Snap, p3BeforeRetrySnap, earn3BeforeRetrySnap] = await Promise.all([
      usersCol.doc(isoUid).get(),
      paymentsCol.doc(ref3).get(),
      earningsCol.doc(`${refCode}_${ref3}`).get()
    ]);
    const u3 = u3Snap.data()!;
    const p3Before = p3BeforeRetrySnap.data()!;
    assert(
      !isoRes.alreadyProcessed &&
        isoRes.affiliateCredited === false &&
        u3.ai_sparks === 508 &&
        u3.paid_sparks === 500 &&
        p3Before.affiliate_status === 'pending' &&
        !earn3BeforeRetrySnap.exists,
      `Student payment credit must succeed with affiliate_status=pending when post-commit affiliate step fails: got user=${JSON.stringify(u3)}, payment=${JSON.stringify(p3Before)}`
    );
    console.log('[PASS] 3/4 Post-commit side-effect isolation verified: affiliate error did not roll back student paid Sparks');

    // 5. Test 4: Crash/Failure Recovery on Retry (`alreadyProcessed: true` recovers pending affiliate commission!)
    const retryRecoveryRes = await executeTransactionalPaymentSuccess({
      app: app!,
      uid: isoUid,
      reference: ref3,
      amount: 500,
      planType: 'emergency_topup',
      metadata: { referredBy: refCode },
      commissionRateOverride: 0.20,
      simulateAffiliateFailureForTest: false,
      sandboxNamespace
    });

    const [u3AfterRetrySnap, p3AfterRetrySnap, affAfterRetrySnap, earn3AfterRetrySnap] = await Promise.all([
      usersCol.doc(isoUid).get(),
      paymentsCol.doc(ref3).get(),
      affiliatesCol.doc(refCode).get(),
      earningsCol.doc(`${refCode}_${ref3}`).get()
    ]);
    const u3After = u3AfterRetrySnap.data()!;
    const p3After = p3AfterRetrySnap.data()!;
    const affAfter = affAfterRetrySnap.data()!;

    assert(
      retryRecoveryRes.alreadyProcessed === true && retryRecoveryRes.affiliateCredited === true,
      `Retry after post-commit crash must return alreadyProcessed=true AND affiliateCredited=true, got ${JSON.stringify(retryRecoveryRes)}`
    );
    assert(
      u3After.ai_sparks === 508 && u3After.paid_sparks === 500 && u3After.free_sparks === 8,
      `Retry must NOT double-credit user Sparks (expected ai_sparks=508, paid_sparks=500): got ${JSON.stringify(u3After)}`
    );
    assert(
      p3After.affiliate_status === 'credited' &&
        p3After.referred_by === refCode &&
        p3After.commission_amount === 100 &&
        earn3AfterRetrySnap.exists &&
        affAfter.paidConversions === 2 &&
        affAfter.totalEarned === 410,
      `Retry must recover and credit affiliate commission (+100 NGN -> totalEarned=410, paidConversions=2): got payment=${JSON.stringify(p3After)}, affiliate=${JSON.stringify(affAfter)}`
    );

    // Verify top-level production collections were NEVER touched (exact count & doc check)
    const afterSnaps = await Promise.all(PROD_COLLECTIONS.map((c) => db.collection(c).get()));
    const prodCountsAfter: Record<string, number> = {};
    PROD_COLLECTIONS.forEach((c, idx) => {
      prodCountsAfter[c] = afterSnaps[idx].size;
    });
    const [prodPolicyAfter, prodPricingAfter, prodLeakPayment] = await Promise.all([
      db.collection('system_config').doc('evaluation_policy').get(),
      db.collection('system_config').doc('token_pricing').get(),
      db.collection('payments').doc(ref1).get()
    ]);
    assert(
      !prodLeakPayment.exists &&
        JSON.stringify(prodCountsBefore) === JSON.stringify(prodCountsAfter) &&
        JSON.stringify(prodPolicyBefore.data() || null) === JSON.stringify(prodPolicyAfter.data() || null) &&
        JSON.stringify(prodPricingBefore.data() || null) === JSON.stringify(prodPricingAfter.data() || null),
      `Top-level production collections must remain 100% untouched: before=${JSON.stringify(prodCountsBefore)}, after=${JSON.stringify(prodCountsAfter)}`
    );
    console.log(`[PASS] 4/4 Post-commit affiliate crash recovery on retry + Verified zero writes to top-level production collections (${JSON.stringify(prodCountsAfter)})`);

    console.log('=== ALL STAGE 3A PAYMENT CONCURRENCY, ISOLATION & CRASH-RECOVERY TESTS PASSED ===');
  } finally {
    await Promise.all([
      usersCol.doc(trackedUid).delete().catch(() => {}),
      usersCol.doc(legacyUid).delete().catch(() => {}),
      usersCol.doc(isoUid).delete().catch(() => {}),
      paymentsCol.doc(ref1).delete().catch(() => {}),
      paymentsCol.doc(ref2).delete().catch(() => {}),
      paymentsCol.doc(ref3).delete().catch(() => {}),
      affiliatesCol.doc(refCode).delete().catch(() => {}),
      earningsCol.doc(`${refCode}_${ref1}`).delete().catch(() => {}),
      earningsCol.doc(`${refCode}_${ref3}`).delete().catch(() => {}),
      policyRef.delete().catch(() => {}),
      tokenPricingRef.delete().catch(() => {}),
      db.collection('_ci_test_sandboxes').doc(sandboxNamespace).delete().catch(() => {})
    ]);
    console.log(`[CLEANUP] Deleted isolated sandbox ${sandboxNamespace}.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FAIL] Stage 3A payment concurrency test failed:', err);
    process.exit(1);
  });
