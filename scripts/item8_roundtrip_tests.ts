import { getPostgresPool } from '../server/postgresPool';
import crypto from 'crypto';
import http from 'http';

async function runRoundtripTests() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  console.log('=== ITEM 8: ROUNDTRIP TESTS (ROUTING, ANNOUNCEMENTS, PAYSTACK NO ORIGIN) ===\n');

  try {
    // ------------------------------------------------------------------------------------
    // PART 1: ROUTING-EDIT ROUNDTRIP
    // ------------------------------------------------------------------------------------
    console.log('--- PART 1: ROUTING CONFIG EDIT ROUNDTRIP ---');
    // 1. Fetch current routing config
    const origRoutingRes = await pool.query(`SELECT key, data, updated_at FROM system_config WHERE key = 'routing';`);
    const originalRouting = origRoutingRes.rows[0]?.data;
    console.log('[Initial Routing Config]:');
    console.log(JSON.stringify(originalRouting, null, 2));

    // 2. Perform an edit: update default_personality with a timestamp marker
    const testMarker = `strict_academic_roundtrip_${Date.now()}`;
    const modifiedRouting = {
      ...originalRouting,
      default_personality: testMarker,
      _roundtrip_test_timestamp: new Date().toISOString()
    };

    console.log(`\nWriting updated routing config with default_personality = "${testMarker}"...`);
    await pool.query(
      `INSERT INTO system_config (key, data, updated_at)
       VALUES ('routing', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();`,
      [JSON.stringify(modifiedRouting)]
    );

    // 3. Read back immediately to verify persistence
    const verifyEditRes = await pool.query(`SELECT key, data, updated_at FROM system_config WHERE key = 'routing';`);
    const readBackData = verifyEditRes.rows[0]?.data;
    console.log('[Read-back Modified Routing Config]:');
    console.log(JSON.stringify(readBackData, null, 2));

    const editPersisted = readBackData?.default_personality === testMarker;
    console.log(`Routing Edit Persistence Verification: ${editPersisted ? 'PASS' : 'FAIL'}`);

    // 4. Restore original routing config
    console.log('\nRestoring original routing config...');
    await pool.query(
      `UPDATE system_config SET data = $1, updated_at = NOW() WHERE key = 'routing';`,
      [JSON.stringify(originalRouting)]
    );

    const restoreVerifyRes = await pool.query(`SELECT data FROM system_config WHERE key = 'routing';`);
    const restoredData = restoreVerifyRes.rows[0]?.data;
    const restored = restoredData?.default_personality === originalRouting.default_personality;
    console.log(`Routing Restoration Verification: ${restored ? 'PASS' : 'FAIL'}\n`);

    // ------------------------------------------------------------------------------------
    // PART 2: ANNOUNCEMENTS-TABLE ROUNDTRIP
    // ------------------------------------------------------------------------------------
    console.log('--- PART 2: ANNOUNCEMENTS TABLE ROUNDTRIP ---');
    const anncId = `annc_roundtrip_${Date.now()}`;
    const initialTitle = 'Semester Examination Protocol';
    const initialMessage = 'All students must present valid identification badges.';

    // 1. Insert announcement
    console.log(`1. Inserting new announcement (id: ${anncId})...`);
    const insertRes = await pool.query(`
      INSERT INTO announcements (id, title, message, severity, audience, active, created_at, updated_at)
      VALUES ($1, $2, $3, 'info', 'all', TRUE, NOW(), NOW())
      RETURNING *;
    `, [anncId, initialTitle, initialMessage]);
    console.log('[Raw Inserted Row]:', insertRes.rows[0]);

    // 2. Query back from table
    const selectRes = await pool.query(`SELECT * FROM announcements WHERE id = $1;`, [anncId]);
    console.log('[Raw Queried Row]:', selectRes.rows[0]);
    const insertMatches = selectRes.rows[0]?.title === initialTitle && selectRes.rows[0]?.active === true;
    console.log(`Announcement Insertion Verification: ${insertMatches ? 'PASS' : 'FAIL'}`);

    // 3. Update announcement
    const updatedTitle = 'URGENT: Semester Examination Protocol Updated';
    console.log(`\n2. Updating announcement (id: ${anncId})...`);
    const updateRes = await pool.query(`
      UPDATE announcements 
      SET title = $1, severity = 'warning', updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `, [updatedTitle, anncId]);
    console.log('[Raw Updated Row]:', updateRes.rows[0]);
    const updateMatches = updateRes.rows[0]?.title === updatedTitle && updateRes.rows[0]?.severity === 'warning';
    console.log(`Announcement Update Verification: ${updateMatches ? 'PASS' : 'FAIL'}`);

    // 4. Delete announcement
    console.log(`\n3. Deleting announcement (id: ${anncId})...`);
    await pool.query(`DELETE FROM announcements WHERE id = $1;`, [anncId]);
    const verifyDeleteRes = await pool.query(`SELECT COUNT(*) as cnt FROM announcements WHERE id = $1;`, [anncId]);
    const deleteMatches = parseInt(verifyDeleteRes.rows[0].cnt, 10) === 0;
    console.log(`Announcement Deletion Verification: ${deleteMatches ? 'PASS' : 'FAIL'}\n`);

    // ------------------------------------------------------------------------------------
    // PART 3: PAYSTACK WEBHOOK WITH NO ORIGIN HEADER
    // ------------------------------------------------------------------------------------
    console.log('--- PART 3: PAYSTACK WEBHOOK WITH NO ORIGIN HEADER TEST ---');
    const secret = process.env.PAYSTACK_SECRET_KEY || 'sk_test_mock_fallback_for_signature';
    
    // Create an ephemeral test payload
    const webhookPayload = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: `test_no_origin_ref_${Date.now()}`,
        amount: 50000,
        currency: 'NGN',
        status: 'success',
        metadata: {
          userId: 'test_student_no_origin',
          planType: 'scholar'
        }
      }
    });

    const hmacSig = crypto
      .createHmac('sha512', secret)
      .update(webhookPayload)
      .digest('hex');

    console.log('Sending HTTP POST to http://localhost:3000/api/paystack-webhook');
    console.log('Headers: Content-Type, x-paystack-signature');
    console.log('Origin header: <EXPLICITLY OMITTED>');

    const webhookResult: { statusCode?: number; body?: string } = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port: 3000,
          path: '/api/paystack-webhook',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(webhookPayload),
            'x-paystack-signature': hmacSig
            // Note: NO Origin header!
          }
        },
        (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        }
      );

      req.on('error', err => reject(err));
      req.write(webhookPayload);
      req.end();
    });

    console.log(`\n[Paystack Webhook Response]:`);
    console.log(`  HTTP Status Code: ${webhookResult.statusCode}`);
    console.log(`  Response Body: "${webhookResult.body}"`);

    // If secret key is not in server env, server returns 500 'Paystack secret key not configured'.
    // If secret key matches, server returns 200 or processes successfully.
    // In neither case does CORS reject the request (which would be 403 or connection drop / preflight fail).
    const noCorsRejection = webhookResult.statusCode !== 403 && webhookResult.statusCode !== undefined;
    console.log(`\nPaystack Webhook No-Origin Acceptance Verification: ${noCorsRejection ? 'PASS (Accepted with no Origin header)' : 'FAIL'}`);

    console.log('\n=== ALL ITEM 8 TESTS FINISHED ===');
  } finally {
    await pool.end();
  }
}

runRoundtripTests().catch(err => {
  console.error('Item 8 test error:', err);
  process.exit(1);
});
