import fs from 'fs';
import { getAdminApp } from '../server/firebaseAdmin';

async function run() {
  const app = getAdminApp();
  if (!app) {
    console.error('Firebase admin not initialized');
    process.exit(1);
  }

  let apiKey = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
  if (!apiKey && fs.existsSync('./firebase-applet-config.json')) {
    const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
    apiKey = config.apiKey;
  }

  if (!apiKey) {
    console.error('FIREBASE_API_KEY missing');
    process.exit(1);
  }

  const customToken = await app.auth().createCustomToken('test-user-http-verify');
  const tokenRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });

  const tokenData = await tokenRes.json();
  const idToken = tokenData.idToken;

  if (!idToken) {
    console.error('Failed to obtain idToken:', tokenData);
    process.exit(1);
  }

  console.log('✅ Acquired valid Firebase ID token for HTTP verification');

  const baseUrl = 'http://localhost:3000';

  // 1. GET /api/catalog/full (First Request)
  const res1 = await fetch(`${baseUrl}/api/catalog/full`, {
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Accept-Encoding': 'gzip'
    }
  });

  const status1 = res1.status;
  const etag1 = res1.headers.get('etag');
  const encoding1 = res1.headers.get('content-encoding');
  const text1 = await res1.text();
  const json1 = JSON.parse(text1);
  const uncompressedSize1 = Buffer.byteLength(text1, 'utf8');

  console.log('\n--- 1. HTTP GET /api/catalog/full (Initial Request) ---');
  console.log(`Status Code: ${status1}`);
  console.log(`Content-Encoding Header: ${encoding1}`);
  console.log(`ETag: ${etag1}`);
  console.log(`Courses Returned: ${json1.total || json1.courses?.length}`);
  console.log(`Payload Size: ${(uncompressedSize1 / 1024).toFixed(2)} KB (${uncompressedSize1} bytes)`);

  // 2. GET /api/catalog/full (Repeat Request with If-None-Match)
  const res2 = await fetch(`${baseUrl}/api/catalog/full`, {
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'If-None-Match': etag1 || ''
    }
  });

  const status2 = res2.status;
  console.log('\n--- 2. HTTP GET /api/catalog/full (Repeat Request with ETag) ---');
  console.log(`If-None-Match Sent: ${etag1}`);
  console.log(`Status Code: ${status2} (${status2 === 304 ? 'PASSED 304 Not Modified' : 'FAILED'})`);

  // 3. GET /api/courses/BIO101/modules
  const res3 = await fetch(`${baseUrl}/api/courses/BIO101/modules`);
  const status3 = res3.status;
  const data3 = await res3.json();

  console.log('\n--- 3. HTTP GET /api/courses/BIO101/modules ---');
  console.log(`Status Code: ${status3}`);
  console.log(`Modules Count: ${data3.total || data3.modules?.length}`);

  // 4. GET /api/courses/BIO101/modules/m1/lessons
  const res4 = await fetch(`${baseUrl}/api/courses/BIO101/modules/m1/lessons`);
  const status4 = res4.status;
  const data4 = await res4.json();

  console.log('\n--- 4. HTTP GET /api/courses/BIO101/modules/m1/lessons ---');
  console.log(`Status Code: ${status4}`);
  console.log(`Lessons Count: ${data4.total || data4.lessons?.length}`);

  process.exit(0);
}

run().catch(err => {
  console.error('HTTP Verification Error:', err);
  process.exit(1);
});
