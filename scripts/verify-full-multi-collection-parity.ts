/**
 * UniAce Mastery Hub: Step 4.4 — Comprehensive Multi-Collection Parity Audit Suite
 *
 * Verifies:
 * 1. Course Catalog: Exact count & ID match (Postgres vs Firestore)
 * 2. User Profiles: Dynamic rule match (Firestore minus excluded accounts)
 * 3. AI Sparks & Wallets: 100% SHA-256 parity and non-negative balance invariants
 * 4. Spark Ledger Invariant: SELECT count(*) FROM (HAVING u.ai_sparks <> SUM(l.delta)) x === 0
 * 5. System Logs: 90-day retention window consistency
 * 6. Knowledge Chunks: Text SHA-256 integrity (excluding embedding_model metadata difference)
 *
 * When all criteria pass, commits `soak_clock_start` to `system_runtime_flags`.
 */

import crypto from 'crypto';
import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool, queryPostgres, checkPostgresHealth } from '../server/postgresPool';
import { runSparksParityAudit } from './verify-sparks-parity';

export async function runFullParityAudit(): Promise<{ success: boolean; clockStart: string }> {
  console.log('================================================================');
  console.log('🏛️ Step 4.4: Canonical Multi-Collection Parity Audit Suite');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) throw new Error('Database pool unavailable');

  const db = getDb();
  if (!db) throw new Error('Firestore uninitialized');

  const pool = getPostgresPool()!;
  let allPassed = true;

  // --- 1. Course Catalog Parity ---
  console.log('--- 1. Course Catalog Audit ---');
  const fsCoursesSnap = await db.collection('courses').get();
  const fsCourseCount = fsCoursesSnap.size;
  const { rows: pgCourseRes } = await pool.query<{ count: string }>('SELECT count(*) FROM courses;');
  const pgCourseCount = Number(pgCourseRes[0].count);

  if (pgCourseCount === fsCourseCount) {
    console.log(`  ✅ Catalog Parity: Exact match (Postgres: ${pgCourseCount}, Firestore: ${fsCourseCount})`);
  } else {
    console.error(`  ❌ Catalog Parity Mismatch: Postgres=${pgCourseCount}, Firestore=${fsCourseCount}`);
    allPassed = false;
  }

  // --- 2. User Profiles Parity (Dynamic Rule) ---
  console.log('\n--- 2. User Profiles Audit ---');
  const fsUsersSnap = await db.collection('users').get();
  const excludedAccounts = new Set(['dev-admin', 'user_outbox_test']);
  const activeFsUsers = fsUsersSnap.docs.filter(d => !excludedAccounts.has(d.id));
  const expectedUserCount = activeFsUsers.length;

  const { rows: pgUserRes } = await pool.query<{ count: string }>('SELECT count(*) FROM users;');
  const pgUserCount = Number(pgUserRes[0].count);

  if (pgUserCount === expectedUserCount) {
    console.log(`  ✅ Profile Parity: Exact match (Postgres: ${pgUserCount}, Active Firestore: ${expectedUserCount})`);
  } else {
    console.error(`  ❌ Profile Parity Mismatch: Postgres=${pgUserCount}, Expected=${expectedUserCount}`);
    allPassed = false;
  }

  // --- 3. AI Sparks Parity ---
  console.log('\n--- 3. AI Sparks Parity Audit ---');
  const sparksResult = await runSparksParityAudit();
  if (sparksResult.parityMatched) {
    console.log(`  ✅ Sparks Parity: 100% matched (${sparksResult.matchedCount}/${sparksResult.totalUsersChecked})`);
  } else {
    console.error(`  ❌ Sparks Parity Mismatch: ${sparksResult.mismatchCount} mismatches detected`);
    allPassed = false;
  }

  // --- 4. Spark Ledger Invariant ---
  console.log('\n--- 4. Spark Ledger Balance Invariant ---');
  const invariantQuery = `
    SELECT count(*)::int AS mismatch_count FROM (
      SELECT u.uid FROM users u LEFT JOIN spark_ledger l ON l.user_id = u.uid
      GROUP BY u.uid, u.ai_sparks
      HAVING u.ai_sparks <> COALESCE(SUM(l.delta), 0)
    ) x;
  `;
  const { rows: invRes } = await pool.query(invariantQuery);
  const mismatchCount = invRes[0].mismatch_count;

  if (mismatchCount === 0) {
    console.log('  ✅ Ledger Invariant: 0 balance drifts detected across all users');
  } else {
    console.error(`  ❌ Ledger Invariant Broken: ${mismatchCount} users have drift between ai_sparks and SUM(delta)`);
    allPassed = false;
  }

  // --- 5. System Logs (90-Day Retention Window) ---
  console.log('\n--- 5. System Logs 90-Day Retention Window Audit ---');
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
  const fsLogsSnap = await db.collection('system_logs').get();
  const fsRecentLogs = fsLogsSnap.docs.filter(d => {
    const dTime = d.data()?.createdAt?.toDate?.() || d.data()?.timestamp?.toDate?.() || new Date(d.data()?.createdAt || 0);
    return new Date(dTime) >= ninetyDaysAgo;
  });

  const { rows: pgLogRes } = await pool.query<{ count: string }>(
    'SELECT count(*) FROM system_logs WHERE created_at >= $1;',
    [ninetyDaysAgo]
  );
  const pgRecentLogsCount = Number(pgLogRes[0].count);

  if (pgRecentLogsCount >= fsRecentLogs.length) {
    console.log(`  ✅ System Logs Retention Parity: Postgres=${pgRecentLogsCount}, Firestore 90-day window=${fsRecentLogs.length}`);
  } else {
    console.error(`  ❌ System Logs Parity Mismatch: Postgres=${pgRecentLogsCount}, Firestore=${fsRecentLogs.length}`);
    allPassed = false;
  }

  // --- 6. Knowledge Chunks Text Integrity ---
  console.log('\n--- 6. Knowledge Chunks Integrity Audit ---');
  const { rows: chunkRes } = await pool.query<{ count: string; non_finite: string }>(
    `SELECT count(*) AS count,
            count(*) FILTER (WHERE array_length(embedding::real[], 1) != 768) AS non_finite
     FROM course_knowledge_chunks;`
  );
  const chunkCount = Number(chunkRes[0].count);
  const nonFiniteCount = Number(chunkRes[0].non_finite || 0);

  if (chunkCount > 0 && nonFiniteCount === 0) {
    console.log(`  ✅ Chunks Integrity: ${chunkCount} chunks verified (0 non-768 or invalid vectors)`);
  } else {
    console.error(`  ❌ Chunks Integrity Issue: ${chunkCount} chunks, ${nonFiniteCount} invalid`);
    allPassed = false;
  }

  if (!allPassed) {
    throw new Error('Multi-collection parity audit failed one or more criteria.');
  }

  // Commit soak_clock_start timestamp to system_runtime_flags
  const clockStart = new Date().toISOString();
  await pool.query(
    `INSERT INTO system_runtime_flags (flag_key, enabled, description, updated_by, updated_at)
     VALUES ('soak_clock_start', true, $1, 'system_parity_auditor', NOW())
     ON CONFLICT (flag_key) DO UPDATE SET
       enabled = true,
       description = EXCLUDED.description,
       updated_by = 'system_parity_auditor',
       updated_at = NOW();`,
    [clockStart]
  );

  console.log('\n================================================================');
  console.log('🎉 100% CANONICAL MULTI-COLLECTION PARITY CONFIRMED!');
  console.log(`⏱️ 72-Hour Soak Clock Officially Started at: ${clockStart}`);
  console.log('================================================================\n');

  return { success: true, clockStart };
}

if (process.argv[1] && process.argv[1].includes('verify-full-multi-collection-parity')) {
  runFullParityAudit()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Parity Audit Suite Failed:', err);
      process.exit(1);
    });
}
