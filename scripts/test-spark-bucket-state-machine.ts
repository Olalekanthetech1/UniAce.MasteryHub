import crypto from 'crypto';
import dotenv from 'dotenv';
import { getAdminApp } from '../server/firebaseAdmin';
import {
  executeSparkPreAuth,
  executeSparkSettle,
  executeSparkRefund,
  executeQualityBountyRefund,
  computeSparkMarginMetrics,
  getLedgerScopedCollection
} from '../server/sparkLedger';

dotenv.config();

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function assertUserBucketInvariant(
  db: FirebaseFirestore.Firestore,
  sandboxNamespace: string,
  uid: string,
  contextLabel: string
): Promise<{ ai_sparks: number; free_sparks: number; paid_sparks: number; bucketSource: string }> {
  const usersCol = getLedgerScopedCollection(db, 'users', sandboxNamespace);
  const snap = await usersCol.doc(uid).get();
  assert(snap.exists, `[${contextLabel}] User doc ${uid} must exist in sandbox ${sandboxNamespace}`);
  const data = snap.data()!;
  const ai = Number(data.ai_sparks);
  const free = Number(data.free_sparks);
  const paid = Number(data.paid_sparks);

  assert(Number.isFinite(ai) && ai >= 0, `[${contextLabel}] ai_sparks (${ai}) must be >= 0`);
  assert(Number.isFinite(free) && free >= 0, `[${contextLabel}] free_sparks (${free}) must be >= 0`);
  assert(Number.isFinite(paid) && paid >= 0, `[${contextLabel}] paid_sparks (${paid}) must be >= 0`);
  assert(
    ai === free + paid,
    `[${contextLabel}] Invariant violated: ai_sparks (${ai}) !== free_sparks (${free}) + paid_sparks (${paid})`
  );

  return {
    ai_sparks: ai,
    free_sparks: free,
    paid_sparks: paid,
    bucketSource: data.bucketSource || 'unknown'
  };
}

async function main() {
  const app = getAdminApp();
  assert(Boolean(app), 'Firebase Admin app must be initialized');
  const db = app!.firestore();

  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const sandboxNamespace = `sandbox_stage2_${runId}`;
  const testUid = `stage2_sm_test_${runId}`;
  const legacyUid = `stage2_legacy_test_${runId}`;
  const createdLedgerDocIds = new Set<string>();

  const usersCol = getLedgerScopedCollection(db, 'users', sandboxNamespace);
  const ledgerCol = getLedgerScopedCollection(db, 'spark_ledger', sandboxNamespace);

  const trackToken = (token: string) => {
    createdLedgerDocIds.add(`${token}_PRE_AUTH`);
    createdLedgerDocIds.add(`${token}_SETTLE`);
    createdLedgerDocIds.add(`${token}_REFUND`);
    createdLedgerDocIds.add(`${token}_QUALITY_BOUNTY`);
    return token;
  };

  const projectId = app!.options.projectId || process.env.FIREBASE_PROJECT_ID || 'resolved-from-credential';
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || 'NONE (Real Live Cloud Firestore — Isolated _ci_test_sandboxes Namespace)';

  console.log(`=== Stage 2 Spark Bucket State-Machine & Invariant Verification (runId=${runId}) ===`);
  console.log(`[TARGET] projectId=${projectId} | emulator=${emulatorHost} | sandbox=${sandboxNamespace}`);

  const PROD_COLLECTIONS = ['users', 'payments', 'affiliates', 'affiliate_earnings', 'spark_ledger', 'spark_ledger_rollups', 'system_config'];
  const beforeSnaps = await Promise.all(PROD_COLLECTIONS.map((c) => db.collection(c).get()));
  const prodCountsBefore: Record<string, number> = {};
  PROD_COLLECTIONS.forEach((c, idx) => {
    prodCountsBefore[c] = beforeSnaps[idx].size;
  });

  try {
    // 1. Unit-level checks on computeSparkMarginMetrics (ZeroMock, COST_UNKNOWN, backfilled_estimate exclusion)
    const missingTokensMetrics = computeSparkMarginMetrics(
      'groq',
      0,
      3,
      'standard',
      {
        standardUsdPer1k: 0.0005,
        highUsdPer1k: 0.002,
        sourceUrl: 'https://wow.groq.com/pricing',
        lastVerifiedAt: new Date().toISOString(),
        verifiedBy: 'test@uniace.app'
      },
      14,
      0.002,
      { paidSparksUsed: 2, bucketSource: 'tracked', pricingVersion: 1 }
    );
    assert(
      missingTokensMetrics.costStatus === 'COST_UNKNOWN' &&
        missingTokensMetrics.estimatedCostUsd === null &&
        missingTokensMetrics.grossMarginUsd === null,
      'Missing or 0 token usage on non-cache provider must yield COST_UNKNOWN and null cost/margin (never $0)'
    );

    const backfilledMetrics = computeSparkMarginMetrics(
      'groq',
      1500,
      3,
      'standard',
      {
        standardUsdPer1k: 0.0005,
        highUsdPer1k: 0.002,
        sourceUrl: 'https://wow.groq.com/pricing',
        lastVerifiedAt: new Date().toISOString(),
        verifiedBy: 'test@uniace.app'
      },
      14,
      0.002,
      { paidSparksUsed: 3, bucketSource: 'backfilled_estimate', pricingVersion: 1 }
    );
    assert(
      backfilledMetrics.estimatedRevenueUsd === null && backfilledMetrics.grossMarginUsd === null,
      'backfilled_estimate users must be excluded from tracked estimatedRevenueUsd KPI'
    );

    const trackedMetrics = computeSparkMarginMetrics(
      'groq',
      2000,
      3,
      'standard',
      {
        standardUsdPer1k: 0.0005,
        highUsdPer1k: 0.002,
        sourceUrl: 'https://wow.groq.com/pricing',
        lastVerifiedAt: new Date().toISOString(),
        verifiedBy: 'test@uniace.app'
      },
      14,
      0.002,
      { paidSparksUsed: 2, bucketSource: 'tracked', pricingVersion: 1 }
    );
    assert(
      trackedMetrics.costStatus === 'VERIFIED' &&
        trackedMetrics.estimatedCostUsd === 0.001 &&
        trackedMetrics.estimatedRevenueUsd === 0.004 &&
        trackedMetrics.grossMarginUsd === 0.003,
      `Tracked metrics mismatch: got ${JSON.stringify(trackedMetrics)}`
    );
    console.log('[PASS] 1/6 ZeroMock computeSparkMarginMetrics (COST_UNKNOWN + backfilled_estimate exclusion + UsdPer1k)');

    // 2. Test Legacy Mode Refill & Mid-Flight Flag Flip Safety inside isolated sandbox
    await usersCol.doc(legacyUid).set({
      uid: legacyUid,
      email: `${legacyUid}@uniace.test`,
      ai_sparks: 12,
      plan_type: 'free',
      role: 'student',
      last_spark_reset: '2020-01-01'
    });

    const legTok1 = trackToken(`${legacyUid}_tok1`);
    const legPre1 = await executeSparkPreAuth({
      app: app!,
      uid: legacyUid,
      userEmail: `${legacyUid}@uniace.test`,
      idempotencyToken: legTok1,
      complexity: 'standard',
      maxPreAuth: 3,
      dailyFreeSparks: null,
      enableSparkBucketLedger: false,
      rateLimitSeconds: 0,
      endpoint: 'http_chat',
      isAdminEmailFn: () => false,
      sandboxNamespace
    });
    assert(
      legPre1.sparks === 9 && legPre1.bucketAccountingEnabled === false,
      `Unset dailyFreeSparks must not refill; expected 9 after preAuth 3 from 12, got ${legPre1.sparks}`
    );
    const legSnapAfterPre1 = (await usersCol.doc(legacyUid).get()).data()!;
    assert(
      legSnapAfterPre1.free_sparks === undefined &&
        legSnapAfterPre1.paid_sparks === undefined &&
        legSnapAfterPre1.last_spark_reset === '2020-01-01',
      'Legacy mode with unset dailyFreeSparks must not create bucket fields or update last_spark_reset'
    );

    const legSettle1 = await executeSparkSettle({
      app: app!,
      uid: legacyUid,
      userEmail: `${legacyUid}@uniace.test`,
      idempotencyToken: legTok1,
      isFreeUser: true,
      fallbackPreAuthDeduction: 3,
      actualCost: 1,
      totalTokens: null,
      complexity: 'standard',
      endpoint: 'http_chat',
      providerUsed: 'groq',
      planType: 'free',
      role: 'student',
      sandboxNamespace
    });
    assert(
      legSettle1.bucketAccountingEnabled === false &&
        legSettle1.finalSparks === 11 &&
        legSettle1.costStatus === 'COST_UNKNOWN',
      'SETTLE must honor bucketAccountingEnabled=false from PRE_AUTH and mark null tokens COST_UNKNOWN'
    );
    console.log('[PASS] 2/6 Unset dailyFreeSparks no-op refill + Legacy flag respect + Mid-flight flag flip safety');

    // 3. Deterministic Anti-Spark-Laundering Checks (Mixed Free + Paid Bucket Deduction, Settle, Refund, and Bounty)
    const tokInit = trackToken(`${testUid}_init`);
    await executeSparkPreAuth({
      app: app!,
      uid: testUid,
      userEmail: `${testUid}@uniace.test`,
      idempotencyToken: tokInit,
      complexity: 'standard',
      maxPreAuth: 3,
      dailyFreeSparks: 5,
      enableSparkBucketLedger: true,
      rateLimitSeconds: 0,
      endpoint: 'http_chat',
      isAdminEmailFn: () => false,
      sandboxNamespace
    });
    await executeSparkRefund({
      app: app!,
      uid: testUid,
      userEmail: `${testUid}@uniace.test`,
      idempotencyToken: tokInit,
      isFreeUser: true,
      fallbackPreAuthDeduction: 3,
      attemptFee: 0,
      complexity: 'standard',
      endpoint: 'http_chat',
      planType: 'free',
      role: 'student',
      reason: 'Initial refund test',
      sandboxNamespace
    });
    let state = await assertUserBucketInvariant(db, sandboxNamespace, testUid, 'After init + full refund');
    assert(state.free_sparks === 5 && state.paid_sparks === 0 && state.ai_sparks === 5, 'Expected 5 free, 0 paid');

    // Top up 20 paid_sparks -> free=5, paid=20, ai=25
    await usersCol.doc(testUid).set(
      {
        paid_sparks: 20,
        ai_sparks: 25
      },
      { merge: true }
    );
    state = await assertUserBucketInvariant(db, sandboxNamespace, testUid, 'After +20 paid_sparks topup');

    // Pre-auth 10 Sparks -> should deduct 5 free + 5 paid -> leaving free=0, paid=15, ai=15
    const tokMixed = trackToken(`${testUid}_mixed`);
    const preMixed = await executeSparkPreAuth({
      app: app!,
      uid: testUid,
      userEmail: `${testUid}@uniace.test`,
      idempotencyToken: tokMixed,
      complexity: 'standard',
      maxPreAuth: 10,
      dailyFreeSparks: 5,
      enableSparkBucketLedger: true,
      rateLimitSeconds: 0,
      endpoint: 'http_chat',
      isAdminEmailFn: () => false,
      sandboxNamespace
    });
    assert(
      preMixed.preAuthFreeSparks === 5 && preMixed.preAuthPaidSparks === 5,
      `Expected preAuth split 5 free + 5 paid, got ${preMixed.preAuthFreeSparks} free + ${preMixed.preAuthPaidSparks} paid`
    );
    state = await assertUserBucketInvariant(db, sandboxNamespace, testUid, 'After mixed PRE_AUTH(10)');
    assert(state.free_sparks === 0 && state.paid_sparks === 15 && state.ai_sparks === 15, 'Expected free=0, paid=15');

    // Settle tokMixed with actualCost = 7 -> consumes 5 free + 2 paid, refunds 0 free + 3 paid -> free=0, paid=18, ai=18
    const settleMixed = await executeSparkSettle({
      app: app!,
      uid: testUid,
      userEmail: `${testUid}@uniace.test`,
      idempotencyToken: tokMixed,
      isFreeUser: true,
      fallbackPreAuthDeduction: 10,
      actualCost: 7,
      totalTokens: 1200,
      complexity: 'standard',
      endpoint: 'http_chat',
      providerUsed: 'groq',
      planType: 'free',
      role: 'student',
      sandboxNamespace
    });
    assert(
      settleMixed.freeSparksUsed === 5 && settleMixed.paidSparksUsed === 2,
      `Expected settle usage 5 free + 2 paid, got ${settleMixed.freeSparksUsed} free + ${settleMixed.paidSparksUsed} paid`
    );
    state = await assertUserBucketInvariant(db, sandboxNamespace, testUid, 'After mixed SETTLE(7)');
    assert(state.free_sparks === 0 && state.paid_sparks === 18 && state.ai_sparks === 18, 'Expected free=0, paid=18');

    // Award QUALITY_BOUNTY on tokMixed with bonusSparks=5 -> restores 5 free + 2 paid, plus +5 bonus into free -> free=10, paid=20, ai=30
    const bountyMixed = await executeQualityBountyRefund({
      app: app!,
      uid: testUid,
      userEmail: `${testUid}@uniace.test`,
      idempotencyToken: tokMixed,
      fallbackSparksCharged: 7,
      isFirstReporter: true,
      bonusSparks: 5,
      reportId: `rep_${runId}`,
      reviewerNotes: 'Verified derivation bug',
      sandboxNamespace
    });
    assert(
      bountyMixed.freeSparksRefunded === 5 &&
        bountyMixed.paidSparksRefunded === 2 &&
        bountyMixed.bonusSparksAwarded === 5,
      'QUALITY_BOUNTY must restore exact free/paid buckets and award bonus to free bucket'
    );
    state = await assertUserBucketInvariant(db, sandboxNamespace, testUid, 'After mixed QUALITY_BOUNTY');
    assert(state.free_sparks === 10 && state.paid_sparks === 20 && state.ai_sparks === 30, 'Expected free=10, paid=20');
    console.log('[PASS] 3/6 Deterministic bucket split across PRE_AUTH -> SETTLE -> QUALITY_BOUNTY (zero Spark laundering)');

    // 4. Test Abort Refund with attemptFee=1 across mixed buckets
    await usersCol.doc(testUid).set(
      {
        free_sparks: 3,
        paid_sparks: 10,
        ai_sparks: 13
      },
      { merge: true }
    );
    const tokAbort = trackToken(`${testUid}_abort`);
    await executeSparkPreAuth({
      app: app!,
      uid: testUid,
      userEmail: `${testUid}@uniace.test`,
      idempotencyToken: tokAbort,
      complexity: 'standard',
      maxPreAuth: 8,
      dailyFreeSparks: 5,
      enableSparkBucketLedger: true,
      rateLimitSeconds: 0,
      endpoint: 'ws_chat',
      isAdminEmailFn: () => false,
      sandboxNamespace
    });
    const refAbort = await executeSparkRefund({
      app: app!,
      uid: testUid,
      userEmail: `${testUid}@uniace.test`,
      idempotencyToken: tokAbort,
      isFreeUser: true,
      fallbackPreAuthDeduction: 8,
      attemptFee: 1,
      complexity: 'standard',
      endpoint: 'ws_chat',
      planType: 'free',
      role: 'student',
      reason: 'Abort with 1 spark attempt fee',
      sandboxNamespace
    });
    assert(
      refAbort.freeSparksRefunded === 2 && refAbort.paidSparksRefunded === 5,
      `Expected abort refund 2 free + 5 paid, got ${refAbort.freeSparksRefunded} free + ${refAbort.paidSparksRefunded} paid`
    );
    state = await assertUserBucketInvariant(db, sandboxNamespace, testUid, 'After abort REFUND with attemptFee=1');
    assert(state.free_sparks === 2 && state.paid_sparks === 10 && state.ai_sparks === 12, 'Expected free=2, paid=10');
    console.log('[PASS] 4/6 Mixed-bucket abort REFUND restores exact paid_sparks and free_sparks');

    // 5. Multi-Seed Randomized Sequence Fuzzing (5 PRNG seeds x 20 steps = 100 randomized transitions)
    const FUZZ_SEEDS = [0x133742, 0x2026a1, 0x9988c3, 0x4242d5, 0x7777e9];
    const STEPS_PER_SEED = 20;

    for (const seed of FUZZ_SEEDS) {
      let prngSeed = seed;
      const nextRand = () => {
        prngSeed = (prngSeed * 1664525 + 1013904223) % 4294967296;
        return prngSeed / 4294967296;
      };

      for (let step = 1; step <= STEPS_PER_SEED; step++) {
        try {
          const cur = await assertUserBucketInvariant(db, sandboxNamespace, testUid, `Fuzz seed=0x${seed.toString(16)} pre-step ${step}`);
          if (cur.ai_sparks < 15) {
            const addPaid = 20;
            await usersCol.doc(testUid).set(
              {
                paid_sparks: cur.paid_sparks + addPaid,
                ai_sparks: cur.free_sparks + cur.paid_sparks + addPaid
              },
              { merge: true }
            );
            await assertUserBucketInvariant(db, sandboxNamespace, testUid, `Fuzz seed=0x${seed.toString(16)} topup ${step}`);
          }

          const roll = nextRand();
          if (roll < 0.15) {
            await usersCol.doc(testUid).set({ last_spark_reset: '2020-01-01' }, { merge: true });
          }

          const tok = trackToken(`${testUid}_fuzz_${seed.toString(16)}_${step}`);
          const maxPreAuth = Math.floor(nextRand() * 12) + 2; // 2..13
          await executeSparkPreAuth({
            app: app!,
            uid: testUid,
            userEmail: `${testUid}@uniace.test`,
            idempotencyToken: tok,
            complexity: 'standard',
            maxPreAuth,
            dailyFreeSparks: 10,
            enableSparkBucketLedger: true,
            rateLimitSeconds: 0,
            endpoint: 'ws_chat',
            isAdminEmailFn: () => false,
            sandboxNamespace
          });
          await assertUserBucketInvariant(db, sandboxNamespace, testUid, `Fuzz seed=0x${seed.toString(16)} step ${step} after PRE_AUTH`);

          const outcomeRoll = nextRand();
          if (outcomeRoll < 0.65) {
            const actualCost = Math.floor(nextRand() * (maxPreAuth + 2));
            await executeSparkSettle({
              app: app!,
              uid: testUid,
              userEmail: `${testUid}@uniace.test`,
              idempotencyToken: tok,
              isFreeUser: true,
              fallbackPreAuthDeduction: maxPreAuth,
              actualCost,
              totalTokens: nextRand() < 0.3 ? null : 800,
              complexity: 'standard',
              endpoint: 'ws_chat',
              providerUsed: 'groq',
              planType: 'free',
              role: 'student',
              sandboxNamespace
            });
            await assertUserBucketInvariant(db, sandboxNamespace, testUid, `Fuzz seed=0x${seed.toString(16)} step ${step} after SETTLE`);

            if (nextRand() < 0.35) {
              await executeQualityBountyRefund({
                app: app!,
                uid: testUid,
                userEmail: `${testUid}@uniace.test`,
                idempotencyToken: tok,
                fallbackSparksCharged: actualCost,
                isFirstReporter: nextRand() < 0.5,
                bonusSparks: 4,
                reportId: `fuzz_rep_${seed.toString(16)}_${step}`,
                reviewerNotes: 'Fuzz bounty',
                sandboxNamespace
              });
              await assertUserBucketInvariant(db, sandboxNamespace, testUid, `Fuzz seed=0x${seed.toString(16)} step ${step} after QUALITY_BOUNTY`);
            }
          } else {
            const attemptFee = nextRand() < 0.4 ? 1 : 0;
            await executeSparkRefund({
              app: app!,
              uid: testUid,
              userEmail: `${testUid}@uniace.test`,
              idempotencyToken: tok,
              isFreeUser: true,
              fallbackPreAuthDeduction: maxPreAuth,
              attemptFee,
              complexity: 'standard',
              endpoint: 'ws_chat',
              planType: 'free',
              role: 'student',
              reason: `Fuzz abort seed=0x${seed.toString(16)} step ${step}`,
              sandboxNamespace
            });
            await assertUserBucketInvariant(db, sandboxNamespace, testUid, `Fuzz seed=0x${seed.toString(16)} step ${step} after REFUND`);
          }
        } catch (fuzzErr: any) {
          console.error(`[FUZZ FAILURE] Repro seed=0x${seed.toString(16)} (${seed}) at step=${step}: ${fuzzErr?.message}`);
          throw fuzzErr;
        }
      }
    }
    console.log(`[PASS] 5/6 Multi-seed randomized state-machine fuzzing (${FUZZ_SEEDS.length} seeds x ${STEPS_PER_SEED} steps = ${FUZZ_SEEDS.length * STEPS_PER_SEED} transitions; ai_sparks === free_sparks + paid_sparks held on every step)`);

    // 6. Concurrent Race Torture Tests (Concurrent PRE_AUTH + Refill, Concurrent SETTLE vs REFUND, Concurrent QUALITY_BOUNTY)
    await usersCol.doc(testUid).set(
      {
        free_sparks: 2,
        paid_sparks: 30,
        ai_sparks: 32,
        last_spark_reset: '2020-01-01'
      },
      { merge: true }
    );

    const raceTokA = trackToken(`${testUid}_raceA`);
    const raceTokB = trackToken(`${testUid}_raceB`);

    await Promise.all([
      executeSparkPreAuth({
        app: app!,
        uid: testUid,
        userEmail: `${testUid}@uniace.test`,
        idempotencyToken: raceTokA,
        complexity: 'standard',
        maxPreAuth: 6,
        dailyFreeSparks: 10,
        enableSparkBucketLedger: true,
        rateLimitSeconds: 0,
        endpoint: 'ws_chat',
        isAdminEmailFn: () => false,
        sandboxNamespace
      }),
      executeSparkPreAuth({
        app: app!,
        uid: testUid,
        userEmail: `${testUid}@uniace.test`,
        idempotencyToken: raceTokB,
        complexity: 'standard',
        maxPreAuth: 6,
        dailyFreeSparks: 10,
        enableSparkBucketLedger: true,
        rateLimitSeconds: 0,
        endpoint: 'ws_chat',
        isAdminEmailFn: () => false,
        sandboxNamespace
      })
    ]);

    state = await assertUserBucketInvariant(db, sandboxNamespace, testUid, 'After concurrent refill + PRE_AUTH x2');
    assert(
      state.free_sparks === 0 && state.paid_sparks === 28 && state.ai_sparks === 28,
      `Concurrent refill + PRE_AUTH x2 must top up once and deduct 12: expected free=0, paid=28, ai=28, got ${JSON.stringify(state)}`
    );

    await Promise.all([
      executeSparkSettle({
        app: app!,
        uid: testUid,
        userEmail: `${testUid}@uniace.test`,
        idempotencyToken: raceTokA,
        isFreeUser: true,
        fallbackPreAuthDeduction: 6,
        actualCost: 2,
        totalTokens: 500,
        complexity: 'standard',
        endpoint: 'ws_chat',
        providerUsed: 'groq',
        planType: 'free',
        role: 'student',
        sandboxNamespace
      }),
      executeSparkRefund({
        app: app!,
        uid: testUid,
        userEmail: `${testUid}@uniace.test`,
        idempotencyToken: raceTokA,
        isFreeUser: true,
        fallbackPreAuthDeduction: 6,
        attemptFee: 0,
        complexity: 'standard',
        endpoint: 'ws_chat',
        planType: 'free',
        role: 'student',
        reason: 'Concurrent race refund',
        sandboxNamespace
      })
    ]);
    await assertUserBucketInvariant(db, sandboxNamespace, testUid, 'After concurrent SETTLE vs REFUND race on raceTokA');

    await executeSparkSettle({
      app: app!,
      uid: testUid,
      userEmail: `${testUid}@uniace.test`,
      idempotencyToken: raceTokB,
      isFreeUser: true,
      fallbackPreAuthDeduction: 6,
      actualCost: 4,
      totalTokens: 900,
      complexity: 'standard',
      endpoint: 'ws_chat',
      providerUsed: 'groq',
      planType: 'free',
      role: 'student',
      sandboxNamespace
    });
    const beforeBountyRace = await assertUserBucketInvariant(db, sandboxNamespace, testUid, 'Before concurrent QUALITY_BOUNTY race');

    await Promise.all([
      executeQualityBountyRefund({
        app: app!,
        uid: testUid,
        userEmail: `${testUid}@uniace.test`,
        idempotencyToken: raceTokB,
        fallbackSparksCharged: 4,
        isFirstReporter: true,
        bonusSparks: 5,
        reportId: `race_bounty_1`,
        reviewerNotes: 'Concurrent bounty 1',
        sandboxNamespace
      }),
      executeQualityBountyRefund({
        app: app!,
        uid: testUid,
        userEmail: `${testUid}@uniace.test`,
        idempotencyToken: raceTokB,
        fallbackSparksCharged: 4,
        isFirstReporter: true,
        bonusSparks: 5,
        reportId: `race_bounty_2`,
        reviewerNotes: 'Concurrent bounty 2',
        sandboxNamespace
      }),
      executeQualityBountyRefund({
        app: app!,
        uid: testUid,
        userEmail: `${testUid}@uniace.test`,
        idempotencyToken: raceTokB,
        fallbackSparksCharged: 4,
        isFirstReporter: true,
        bonusSparks: 5,
        reportId: `race_bounty_3`,
        reviewerNotes: 'Concurrent bounty 3',
        sandboxNamespace
      })
    ]);
    const afterBountyRace = await assertUserBucketInvariant(db, sandboxNamespace, testUid, 'After concurrent QUALITY_BOUNTY x3 race');
    assert(
      afterBountyRace.ai_sparks === beforeBountyRace.ai_sparks + 9,
      `Concurrent QUALITY_BOUNTY x3 must credit exactly once (+4 refund +5 bonus = +9): expected ${beforeBountyRace.ai_sparks + 9}, got ${afterBountyRace.ai_sparks}`
    );

    // Verify top-level production collections were NEVER written to (exact count & doc check)
    const afterSnaps = await Promise.all(PROD_COLLECTIONS.map((c) => db.collection(c).get()));
    const prodCountsAfter: Record<string, number> = {};
    PROD_COLLECTIONS.forEach((c, idx) => {
      prodCountsAfter[c] = afterSnaps[idx].size;
    });
    const [prodUserLeak1, prodUserLeak2] = await Promise.all([
      db.collection('users').doc(testUid).get(),
      db.collection('users').doc(legacyUid).get()
    ]);
    assert(
      !prodUserLeak1.exists &&
        !prodUserLeak2.exists &&
        JSON.stringify(prodCountsBefore) === JSON.stringify(prodCountsAfter),
      `Production top-level collections must remain 100% untouched: before=${JSON.stringify(prodCountsBefore)}, after=${JSON.stringify(prodCountsAfter)}`
    );
    console.log(`[PASS] 6/6 Concurrent race torture tests + Verified zero writes to top-level production collections (${JSON.stringify(prodCountsAfter)})`);
    console.log('=== ALL STAGE 2 SPARK BUCKET STATE-MACHINE & INVARIANT TESTS PASSED ===');
  } finally {
    const cleanupBatch = db.batch();
    cleanupBatch.delete(usersCol.doc(testUid));
    cleanupBatch.delete(usersCol.doc(legacyUid));
    cleanupBatch.delete(db.collection('_ci_test_sandboxes').doc(sandboxNamespace));
    await cleanupBatch.commit().catch(() => {});

    const ledgerIds = Array.from(createdLedgerDocIds);
    for (let i = 0; i < ledgerIds.length; i += 400) {
      const slice = ledgerIds.slice(i, i + 400);
      const b = db.batch();
      for (const id of slice) {
        b.delete(ledgerCol.doc(id));
      }
      await b.commit().catch(() => {});
    }
    console.log(`[CLEANUP] Deleted isolated sandbox ${sandboxNamespace} (${ledgerIds.length} ledger test keys).`);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Stage 2 State-Machine Test Failed]:', err);
    process.exit(1);
  });
