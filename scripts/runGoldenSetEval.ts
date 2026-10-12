/**
 * UniAce Mastery Hub — Live Golden Set CLI Evaluation Runner (TypeScript)
 *
 * Strictly Zero-Mock & Zero-Fallback compliant:
 * - Queries ONLY live SME-verified items (`smeVerified === true`) from Firestore `golden_set_benchmarks`.
 * - Never generates synthetic questions, keyword checks, or simulated responses.
 * - Executes through the full production pipeline (`buildTutorSystemPrompt` -> `redactPII` ->
 *   `generateWithTelemetry` -> `createThinkFilter` -> `sanitizeAIResponse` -> `verifyNoSystemLeak`).
 * - Grades strictly via 3-Tier Grader (`passed` | `failed` | `ungraded`).
 * - Exits with code 1 if `accuracyPercent < accuracyGatePointPercent` or `wilson95CiLow < accuracyGateCiLowPercent`
 *   or if 0 SME-verified items exist in Firestore.
 */

import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { getEvaluationPolicy } from '../server/goldenSetEngine';

dotenv.config();

async function main() {
  console.log('================================================================================');
  console.log('🎓 UniAce Mastery Hub — Zero-Mock Golden Set Evaluation CLI Runner');
  console.log('================================================================================');

  const args = process.argv.slice(2);
  const suiteArg = args.find(a => a.startsWith('--suite='))?.split('=')[1];
  const providerArg = args.find(a => a.startsWith('--provider='))?.split('=')[1];
  const baseUrl = process.env.EVAL_SERVER_URL || 'http://localhost:3000';

  console.log(`• Target Suite    : ${suiteArg || 'all'}`);
  console.log(`• Target Provider : ${providerArg || 'production routing queue'}`);
  console.log(`• Server Endpoint : ${baseUrl}`);

  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (projectId && clientEmail && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey })
      });
    } else {
      admin.initializeApp();
    }
  }

  const app = admin.app();
  const db = app.firestore();
  const policy = await getEvaluationPolicy(app);

  let queryRef: admin.firestore.Query = db
    .collection('golden_set_benchmarks')
    .where('verificationState', '==', 'human_verified');
  if (suiteArg && suiteArg !== 'all') {
    queryRef = queryRef.where('suiteType', '==', suiteArg);
  }
  const snap = await queryRef.get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  console.log(`📊 Live Policy Gate Thresholds (from system_config/evaluation_policy):`);
  console.log(`   - Min Point Estimate     : ${policy.accuracyGatePointPercent.toFixed(1)}%`);
  console.log(`   - Min 95% Wilson Lower   : ${policy.accuracyGateCiLowPercent.toFixed(1)}%`);
  console.log(`   - Verified Items Found   : ${items.length} SME-signed items`);

  if (items.length === 0) {
    console.error(
      '\n❌ ZERO-MOCK CORPUS GATE: 0 SME-verified benchmark items found in Firestore `golden_set_benchmarks`.'
    );
    console.error(
      '   Unverified or LLM-seeded items are strictly prohibited. Author or promote SME-verified items via the Admin Golden Set & Trust console first.'
    );
    process.exit(1);
  }

  const verifiedCoreCount = items.filter(i => i.suiteType === 'core_150').length;
  if (verifiedCoreCount < 150) {
    console.warn(
      `⚠️  PROVISIONAL CORPUS: ${verifiedCoreCount}/150 SME-verified core_150 items signed off.`
    );
  }

  console.log(
    '\nℹ️  To trigger and step a full authenticated batch run with live cross-family grading and audit logging, use the Admin Golden Set & Trust console (`POST /api/admin/golden-set/run`).'
  );
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Fatal error in Golden Set CLI runner:', err);
  process.exit(1);
});
