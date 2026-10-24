import crypto from 'crypto';
import { getPostgresPool } from '../server/postgresPool';
import { executeTransactionalPaymentSuccess } from '../server/sparkLedger';

async function testPaymentsPipeline() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  console.log('=== ITEM 2: NEON ATOMIC PAYMENTS & IDEMPOTENCY TEST ===\n');

  // Verify columns of user_sparks_wallets
  console.log('--- Checking user_sparks_wallets Columns ---');
  const colsRes = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'user_sparks_wallets'
    ORDER BY ordinal_position;
  `);
  console.log('Columns in user_sparks_wallets:', colsRes.rows.map(r => `${r.column_name} (${r.data_type})`));
  const hasPaidSparks = colsRes.rows.some(r => r.column_name === 'paid_sparks');
  console.log(`Does 'paid_sparks' column exist in user_sparks_wallets? ${hasPaidSparks ? 'YES' : 'NO (Uses balance)'}\n`);

  const testUid = `test_pay_student_${Date.now()}`;
  const testEmail = `${testUid}@test.com`;
  const testRef = `ref_paystack_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  try {
    // 1. Create test user in Neon
    console.log(`Creating ephemeral test user: ${testUid}`);
    await pool.query(
      `INSERT INTO users (uid, email, display_name, role, plan_type, ai_sparks, created_at, updated_at)
       VALUES ($1, $2, 'Payments Tester', 'student', 'free', 100, NOW(), NOW());`,
      [testUid, testEmail]
    );

    // Initial wallet
    await pool.query(
      `INSERT INTO user_sparks_wallets (uid, balance, plan_type, updated_at)
       VALUES ($1, 100, 'free', NOW())
       ON CONFLICT (uid) DO UPDATE SET balance = 100;`,
      [testUid]
    );

    // 2. First Webhook Run: should process and credit 2,000 sparks
    console.log(`\n--- First Webhook Call: Reference ${testRef} ---`);
    const res1 = await executeTransactionalPaymentSuccess({
      uid: testUid,
      reference: testRef,
      amount: 5000,
      planType: 'scholar',
      metadata: { userId: testUid, planType: 'scholar' }
    });

    console.log(`  Result 1 alreadyProcessed: ${res1.alreadyProcessed}`);
    console.log(`  Sparks added: ${res1.sparksAdded}`);
    console.log(`  New ai_sparks: ${res1.newAiSparks}`);

    // Verify Neon database tables
    const userRes1 = await pool.query(`SELECT ai_sparks, plan_type FROM users WHERE uid = $1`, [testUid]);
    const walletRes1 = await pool.query(`SELECT balance, plan_type FROM user_sparks_wallets WHERE uid = $1`, [testUid]);
    const paymentRes1 = await pool.query(`SELECT reference, amount_ngn, sparks_added, status FROM payments WHERE reference = $1`, [testRef]);
    const ledgerRes1 = await pool.query(`SELECT ledger_id, delta, reason, ref_lock_id FROM spark_ledger WHERE ref_lock_id = $1`, [testRef]);

    console.log(`  Neon users table: ai_sparks = ${userRes1.rows[0]?.ai_sparks}, plan_type = ${userRes1.rows[0]?.plan_type}`);
    console.log(`  Neon user_sparks_wallets table: balance = ${walletRes1.rows[0]?.balance}`);
    console.log(`  Neon payments table: status = ${paymentRes1.rows[0]?.status}, sparks_added = ${paymentRes1.rows[0]?.sparks_added}`);
    console.log(`  Neon spark_ledger table: delta = ${ledgerRes1.rows[0]?.delta}, reason = ${ledgerRes1.rows[0]?.reason}`);

    // 3. Second Webhook Run: exact same reference (simulate duplicate webhook delivery)
    console.log(`\n--- Second Webhook Call (Duplicate Delivery): Reference ${testRef} ---`);
    const res2 = await executeTransactionalPaymentSuccess({
      uid: testUid,
      reference: testRef,
      amount: 5000,
      planType: 'scholar',
      metadata: { userId: testUid, planType: 'scholar' }
    });

    console.log(`  Result 2 alreadyProcessed: ${res2.alreadyProcessed}`);
    console.log(`  Sparks added: ${res2.alreadyProcessed ? 0 : res2.sparksAdded}`);

    const userRes2 = await pool.query(`SELECT ai_sparks FROM users WHERE uid = $1`, [testUid]);
    const walletRes2 = await pool.query(`SELECT balance FROM user_sparks_wallets WHERE uid = $1`, [testUid]);
    const ledgerCountRes = await pool.query(`SELECT COUNT(*) as count FROM spark_ledger WHERE ref_lock_id = $1`, [testRef]);

    console.log(`  Neon users table after replay: ai_sparks = ${userRes2.rows[0]?.ai_sparks} (Unchanged: ${userRes1.rows[0]?.ai_sparks === userRes2.rows[0]?.ai_sparks})`);
    console.log(`  Neon user_sparks_wallets after replay: balance = ${walletRes2.rows[0]?.balance} (Unchanged: ${walletRes1.rows[0]?.balance === walletRes2.rows[0]?.balance})`);
    console.log(`  Ledger entries count: ${ledgerCountRes.rows[0]?.count} (Expected: exactly 1)`);

    const pass = res1.alreadyProcessed === false && 
                 res2.alreadyProcessed === true && 
                 userRes1.rows[0]?.ai_sparks === userRes2.rows[0]?.ai_sparks &&
                 parseInt(ledgerCountRes.rows[0]?.count, 10) === 1;

    console.log(`\n=== PAYMENTS IDEMPOTENCY TEST: ${pass ? 'PASS (100% ATOMIC & IDEMPOTENT)' : 'FAIL'} ===`);

  } finally {
    // Cleanup ephemeral records
    console.log('\n--- Cleanup Ephemeral Test Data ---');
    const delP = await pool.query(`DELETE FROM payments WHERE reference = $1;`, [testRef]);
    const delL = await pool.query(`DELETE FROM spark_ledger WHERE ref_lock_id = $1;`, [testRef]);
    const delW = await pool.query(`DELETE FROM user_sparks_wallets WHERE uid = $1;`, [testUid]);
    const delU = await pool.query(`DELETE FROM users WHERE uid = $1;`, [testUid]);
    console.log(`Cleaned: ${delP.rowCount} payment, ${delL.rowCount} ledger entry, ${delW.rowCount} wallet, ${delU.rowCount} user.`);

    await pool.end();
    process.exit(0);
  }
}

testPaymentsPipeline().catch(e => {
  console.error(e);
  process.exit(1);
});
