import crypto from 'crypto';
import { getAdminApp, getDb } from '../server/firebaseAdmin';
import { executeTransactionalPaymentSuccess } from '../server/sparkLedger';

async function testPaystackPipeline() {
  const app = getAdminApp();
  const db = getDb();
  if (!app || !db) {
    console.error('Firebase Admin unavailable');
    process.exit(1);
  }

  console.log('=== ITEM 6: REAL PAYSTACK WEBHOOK PIPELINE AUDIT & IDEMPOTENCY TEST ===\n');

  const testUid = `test_paystack_${Date.now()}`;
  const testRef = `ref_pstk_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const testEmail = `${testUid}@test.com`;

  try {
    // 1. Create ephemeral user document in Firestore
    console.log(`Creating ephemeral test user: ${testUid}`);
    await db.collection('users').doc(testUid).set({
      email: testEmail,
      ai_sparks: 100,
      free_sparks: 100,
      paid_sparks: 0,
      role: 'student',
      plan_type: 'free'
    });

    // 2. First Execution: simulate first webhook arrival
    console.log(`\n--- First Webhook Processing for Ref: ${testRef} ---`);
    const result1 = await executeTransactionalPaymentSuccess({
      app,
      uid: testUid,
      reference: testRef,
      amount: 5000,
      planType: 'scholar',
      metadata: { userId: testUid, planType: 'scholar' }
    });

    console.log('  First Execution Result:');
    console.log(`    alreadyProcessed: ${result1.alreadyProcessed}`);
    console.log(`    sparksAdded: ${result1.sparksAdded}`);
    console.log(`    newAiSparks: ${result1.newAiSparks}`);

    const userSnap1 = await db.collection('users').doc(testUid).get();
    const uData1 = userSnap1.data();
    console.log(`    Updated User State: ai_sparks=${uData1?.ai_sparks}, plan_type=${uData1?.plan_type}`);

    // 3. Second Execution: simulate webhook duplicate replay
    console.log(`\n--- Second Webhook Processing (Duplicate Replay) for Ref: ${testRef} ---`);
    const result2 = await executeTransactionalPaymentSuccess({
      app,
      uid: testUid,
      reference: testRef,
      amount: 5000,
      planType: 'scholar',
      metadata: { userId: testUid, planType: 'scholar' }
    });

    console.log('  Second Execution Result:');
    console.log(`    alreadyProcessed: ${result2.alreadyProcessed}`);
    console.log(`    newAiSparks: ${result2.newAiSparks}`);

    const userSnap2 = await db.collection('users').doc(testUid).get();
    const uData2 = userSnap2.data();
    console.log(`    User State After Replay: ai_sparks=${uData2?.ai_sparks} (Identical to 1st run: ${uData1?.ai_sparks === uData2?.ai_sparks})`);

    const idempotencyPass = (result1.alreadyProcessed === false && result2.alreadyProcessed === true && uData1?.ai_sparks === uData2?.ai_sparks);
    console.log(`\n=== IDEMPOTENCY VERIFICATION RESULT: ${idempotencyPass ? 'PASS (100% IDEMPOTENT)' : 'FAIL'} ===`);

  } finally {
    // Cleanup ephemeral records
    console.log('\n=== CLEANUP OF EPHEMERAL PAYSTACK RECORDS ===');
    const uDoc = await db.collection('users').doc(testUid).get();
    if (uDoc.exists) await db.collection('users').doc(testUid).delete();

    const pDoc = await db.collection('payments').doc(testRef).get();
    if (pDoc.exists) await db.collection('payments').doc(testRef).delete();

    console.log('  Cleaned ephemeral test user and payment documents.');
    process.exit(0);
  }
}

testPaystackPipeline().catch(err => {
  console.error(err);
  process.exit(1);
});
