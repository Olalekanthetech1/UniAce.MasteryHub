import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { getAdminApp } from '../server/firebaseAdmin';

dotenv.config();

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

interface RouteCheckSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

const PROTECTED_ROUTES_TO_VERIFY: RouteCheckSpec[] = [
  { method: 'POST', path: '/api/verify-payment', body: { reference: 'ref_test_check' } },
  { method: 'GET', path: '/api/chat/report-allowance' },
  { method: 'POST', path: '/api/chat/report-wrong', body: {} },
  { method: 'GET', path: '/api/admin/evaluation-policy' },
  { method: 'PUT', path: '/api/admin/evaluation-policy', body: {} },
  { method: 'PUT', path: '/api/admin/token-pricing', body: {} },
  { method: 'GET', path: '/api/admin/answer-reports' },
  { method: 'POST', path: '/api/admin/answer-reports/verify-expression', body: {} },
  { method: 'POST', path: '/api/admin/answer-reports/test-id/triage', body: {} },
  { method: 'GET', path: '/api/admin/golden-set/items' },
  { method: 'POST', path: '/api/admin/golden-set/items', body: {} },
  { method: 'DELETE', path: '/api/admin/golden-set/items/test-id' },
  { method: 'GET', path: '/api/admin/golden-set/runs' },
  { method: 'POST', path: '/api/admin/golden-set/runs/start', body: {} },
  { method: 'POST', path: '/api/admin/golden-set/runs/test-id/step', body: {} },
  { method: 'POST', path: '/api/admin/golden-set/runs/test-id/pause', body: {} },
  { method: 'POST', path: '/api/admin/golden-set/runs/test-id/sync-routing', body: {} },
];

function verifyRouteOrderInServerSource(): void {
  const serverPath = path.resolve(process.cwd(), 'server.ts');
  const source = fs.readFileSync(serverPath, 'utf8');
  const lines = source.split('\n');

  const routeDeclarations: { line: number; method: string; routePath: string }[] = [];
  const wildcardCatchAlls: { line: number; pattern: string }[] = [];

  const routeRegex = /^\s*app\.(get|post|put|delete|all)\(\s*['"]([^'"]+)['"]/;

  lines.forEach((text, idx) => {
    const m = routeRegex.exec(text);
    if (!m) return;
    const method = m[1].toUpperCase();
    const routePath = m[2];
    const lineNum = idx + 1;
    if (method === 'ALL' && (routePath === '/api' || routePath === '/api/*')) {
      wildcardCatchAlls.push({ line: lineNum, pattern: routePath });
    } else if (routePath.startsWith('/api')) {
      routeDeclarations.push({ line: lineNum, method, routePath });
    }
  });

  console.log(`\n[1/4] Express Route Registration Table Order Check (${routeDeclarations.length} /api routes):`);
  for (const r of routeDeclarations.slice(-18)) {
    console.log(`  Line ${String(r.line).padStart(4, ' ')}: ${r.method.padEnd(6, ' ')} ${r.routePath}`);
  }
  for (const c of wildcardCatchAlls) {
    console.log(`  Line ${String(c.line).padStart(4, ' ')}: ALL    ${c.pattern}  [FINAL 404 CATCH-ALL]`);
  }

  if (wildcardCatchAlls.length === 0) {
    throw new Error('Missing final /api/* 404 catch-all handler in server.ts');
  }

  const firstCatchAllLine = Math.min(...wildcardCatchAlls.map((c) => c.line));
  const shadowedRoutes = routeDeclarations.filter((r) => r.line > firstCatchAllLine);
  if (shadowedRoutes.length > 0) {
    throw new Error(
      `Found ${shadowedRoutes.length} route(s) registered AFTER /api 404 catch-all (line ${firstCatchAllLine}): ` +
        shadowedRoutes.map((r) => `${r.method} ${r.routePath} (line ${r.line})`).join(', ')
    );
  }
  console.log(`  ✅ All ${routeDeclarations.length} /api routes are registered BEFORE the final 404 catch-all (line ${firstCatchAllLine}).`);
}

async function runLiveRouteTests(): Promise<void> {
  verifyRouteOrderInServerSource();

  console.log(`\n[2/4] Verifying Public Route & Final 404 JSON Catch-All on ${BASE_URL}:`);
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  if (healthRes.status !== 200) {
    throw new Error(`Expected GET /api/health to return 200, got ${healthRes.status}`);
  }
  console.log(`  ✅ GET /api/health -> ${healthRes.status} OK`);

  const notFoundRes = await fetch(`${BASE_URL}/api/does-not-exist-check`);
  const notFoundContentType = notFoundRes.headers.get('content-type') || '';
  if (notFoundRes.status !== 404 || !notFoundContentType.includes('application/json')) {
    throw new Error(
      `Expected GET /api/does-not-exist-check to return 404 JSON, got status=${notFoundRes.status} content-type=${notFoundContentType}`
    );
  }
  console.log(`  ✅ GET /api/does-not-exist-check -> ${notFoundRes.status} (${notFoundContentType})`);

  console.log(`\n[3/4] Verifying Unauthenticated Access Returns 401 (Not 404, Not Bypassed):`);
  for (const route of PROTECTED_ROUTES_TO_VERIFY) {
    const res = await fetch(`${BASE_URL}${route.path}`, {
      method: route.method,
      headers: route.body ? { 'Content-Type': 'application/json' } : undefined,
      body: route.body ? JSON.stringify(route.body) : undefined,
    });
    if (res.status !== 401) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Route ${route.method} ${route.path} returned ${res.status} instead of 401 Unauthorized. Body: ${text.slice(0, 180)}`
      );
    }
    console.log(`  ✅ ${route.method.padEnd(6, ' ')} ${route.path.padEnd(46, ' ')} -> 401 Unauthorized`);
  }

  console.log(`\n[4/4] Verifying Ephemeral Throwaway Admin Token Authentication (Mint -> 200 OK -> Delete):`);
  const app = getAdminApp();
  if (!app) {
    throw new Error('Firebase Admin app not initialized; cannot mint ephemeral admin token.');
  }

  const appletConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const appletConfig = JSON.parse(fs.readFileSync(appletConfigPath, 'utf8'));
  const firebaseWebApiKey = process.env.VITE_FIREBASE_API_KEY || appletConfig.apiKey;
  if (!firebaseWebApiKey) {
    throw new Error('Missing Firebase Web API key in firebase-applet-config.json');
  }

  const ephemeralUid = `ephemeral_admin_test_${crypto.randomBytes(8).toString('hex')}`;
  const ephemeralEmail = `${ephemeralUid}@ephemeral-test.uniace.local`;
  const db = app.firestore();

  try {
    // 1. Create throwaway Firebase Auth user and temporary Firestore admin profile
    await app.auth().createUser({
      uid: ephemeralUid,
      email: ephemeralEmail,
      emailVerified: true,
      displayName: 'Ephemeral Route Verifier',
    });

    await db.collection('users').doc(ephemeralUid).set({
      uid: ephemeralUid,
      email: ephemeralEmail,
      displayName: 'Ephemeral Route Verifier',
      role: 'admin',
      ephemeralTestAccount: true,
      createdAt: new Date().toISOString(),
    });

    // 2. Mint custom token via Firebase Admin SDK and exchange for a real signed Firebase ID token
    const customToken = await app.auth().createCustomToken(ephemeralUid);
    const tokenExchangeRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${firebaseWebApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      }
    );

    if (!tokenExchangeRes.ok) {
      const errText = await tokenExchangeRes.text();
      throw new Error(`Failed to exchange custom token via Firebase Auth REST API: ${tokenExchangeRes.status} ${errText}`);
    }

    const { idToken } = (await tokenExchangeRes.json()) as { idToken: string };
    if (!idToken) {
      throw new Error('Firebase Auth REST API did not return an idToken');
    }

    // 3. Verify authenticated admin endpoints return 200 OK
    for (const adminPath of ['/api/admin/evaluation-policy', '/api/admin/golden-set/items', '/api/admin/answer-reports']) {
      const authedRes = await fetch(`${BASE_URL}${adminPath}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (authedRes.status !== 200) {
        const bodyText = await authedRes.text().catch(() => '');
        throw new Error(`Authenticated GET ${adminPath} returned ${authedRes.status}: ${bodyText.slice(0, 200)}`);
      }
      console.log(`  ✅ Authenticated GET ${adminPath.padEnd(35, ' ')} -> 200 OK`);
    }
  } finally {
    // 4. Mandatory cleanup: delete both Firestore user doc and Firebase Auth user so zero standing credential remains
    await db.collection('users').doc(ephemeralUid).delete().catch(() => {});
    await app.auth().deleteUser(ephemeralUid).catch(() => {});

    let deletedConfirmed = false;
    try {
      await app.auth().getUser(ephemeralUid);
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        deletedConfirmed = true;
      }
    }
    if (!deletedConfirmed) {
      throw new Error(`Cleanup verification failed: ephemeral user ${ephemeralUid} still exists in Firebase Auth!`);
    }
    console.log(`  ✅ Ephemeral user ${ephemeralUid} deleted from Firestore & Firebase Auth (verified auth/user-not-found).`);
  }

  console.log('\n🎉 Stage 1 Route & Auth Verification Passed completely!');
}

runLiveRouteTests().catch((err) => {
  console.error('\n❌ Stage 1 Route Verification Failed:', err);
  process.exit(1);
});
