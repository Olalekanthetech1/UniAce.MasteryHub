/**
 * UniAce Mastery Hub: Stage 4 AI Sparks Parity Verification Service
 */

import crypto from 'crypto';
import { getAdminApp } from '../firebaseAdmin';
import { queryPostgres, checkPostgresHealth } from '../postgresPool';

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

export interface SparksParityAuditResult {
  success: boolean;
  parityMatched: boolean;
  totalUsersChecked: number;
  matchedCount: number;
  mismatchCount: number;
  mismatches: Array<{
    uid: string;
    firestoreBalance: number;
    postgresBalance: number;
    firestorePlan: string;
    postgresPlan: string;
  }>;
  auditedAt: string;
}

export async function runSparksParityAudit(cutoverTimestamp?: string): Promise<SparksParityAuditResult> {
  console.log('================================================================');
  console.log('🔍 Running Canonical AI Sparks Parity Audit (Firestore vs Neon)');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL is not reachable: ${health.error}`);
  }

  const app = getAdminApp();
  if (!app) {
    throw new Error('Firebase Admin App unavailable');
  }
  const db = app.firestore();

  // 1. Fetch all Neon PostgreSQL wallets
  const pgRes = await queryPostgres<{
    uid: string;
    balance: number;
    plan_type: string;
  }>('SELECT uid, balance, plan_type FROM user_sparks_wallets;');

  const pgWalletsMap = new Map<string, { balance: number; planType: string; hash: string }>();
  for (const row of pgRes.rows) {
    const normPlan = row.plan_type.toLowerCase();
    const hash = sha256(`${row.uid}:${row.balance}:${normPlan}`);
    pgWalletsMap.set(row.uid, {
      balance: Number(row.balance),
      planType: normPlan,
      hash
    });
  }
  console.log(`Loaded ${pgWalletsMap.size} user wallets from Neon PostgreSQL.`);

  // 2. Fetch all Firestore users
  const fsUsersSnap = await db.collection('users').get();
  console.log(`Loaded ${fsUsersSnap.size} user profiles from Firestore.`);

  let matchedCount = 0;
  const mismatches: SparksParityAuditResult['mismatches'] = [];

  for (const doc of fsUsersSnap.docs) {
    const d = doc.data();
    const uid = doc.id;
    const fsBalance = Math.max(0, Number(d.ai_sparks ?? d.sparks ?? 50));
    const rawPlan = (d.plan_type || d.plan || 'free').toLowerCase();
    const fsPlan = d.role === 'admin' || rawPlan === 'admin' ? 'admin' : (rawPlan === 'scholar' || rawPlan === 'pro') ? 'scholar' : 'free';

    const pgWallet = pgWalletsMap.get(uid);

    if (!pgWallet) {
      mismatches.push({
        uid,
        firestoreBalance: fsBalance,
        postgresBalance: -1,
        firestorePlan: fsPlan,
        postgresPlan: 'MISSING'
      });
      continue;
    }

    const fsHash = sha256(`${uid}:${fsBalance}:${fsPlan}`);
    if (fsHash === pgWallet.hash) {
      matchedCount++;
    } else {
      mismatches.push({
        uid,
        firestoreBalance: fsBalance,
        postgresBalance: pgWallet.balance,
        firestorePlan: fsPlan,
        postgresPlan: pgWallet.planType
      });
    }
  }

  const parityMatched = mismatches.length === 0;
  const auditedAt = new Date().toISOString();

  console.log(`\nAudit Summary:`);
  console.log(`   - Total Checked: ${fsUsersSnap.size}`);
  console.log(`   - Matched: ${matchedCount}`);
  console.log(`   - Mismatches: ${mismatches.length}`);
  console.log(`   - Parity Status: ${parityMatched ? '✅ 100% PARITY CONFIRMED' : '❌ DRIFT DETECTED'}`);

  return {
    success: true,
    parityMatched,
    totalUsersChecked: fsUsersSnap.size,
    matchedCount,
    mismatchCount: mismatches.length,
    mismatches,
    auditedAt
  };
}
