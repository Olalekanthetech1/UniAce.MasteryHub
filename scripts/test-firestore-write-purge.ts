import assert from 'assert';
import crypto from 'crypto';
import { getAdminApp } from '../server/firebaseAdmin';
import { dbTelemetry } from '../server/dbTelemetry';
import { executeIdempotentProgressBatchSync } from '../server/progressBatchSync';
import { recordBackendSystemLog, getBufferedBackendSystemLogs } from '../server/memoryMonitor';
import { telemetry } from '../server/telemetry';

const TOP_LEVEL_COLLECTIONS = [
  'users',
  'payments',
  'affiliates',
  'affiliate_earnings',
  'spark_ledger',
  'spark_ledger_rollups',
  'system_config'
] as const;

async function getTopLevelCounts(db: FirebaseFirestore.Firestore): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const col of TOP_LEVEL_COLLECTIONS) {
    const snap = await db.collection(col).count().get();
    counts[col] = snap.data().count;
  }
  return counts;
}

async function deleteSandbox(db: FirebaseFirestore.Firestore, sandboxNamespace: string) {
  const sandboxRoot = db.collection('_ci_test_sandboxes').doc(sandboxNamespace);
  const subcollections = ['users', 'user_progress_batches'];
  for (const sub of subcollections) {
    const snap = await sandboxRoot.collection(sub).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  await sandboxRoot.delete().catch(() => {});
}

async function runStage4BTests() {
  const app = getAdminApp();
  assert(app, 'Firebase Admin app must be initialized');
  const db = app.firestore();

  const countsBefore = await getTopLevelCounts(db);
  console.log('[Stage 4B Test] Production 7-collection count snapshot BEFORE:', JSON.stringify(countsBefore));

  const sandboxNamespace = `stage4b_purge_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const testUid = `u_stage4b_${crypto.randomBytes(3).toString('hex')}`;

  dbTelemetry.resetWindow();

  try {
    // 1. First progress batch write -> creates user & batch doc
    const batch1Id = `${testUid}_sess1_1`;
    const res1 = await executeIdempotentProgressBatchSync({
      db,
      uid: testUid,
      syncBatchId: batch1Id,
      clientSequence: 1,
      sandboxNamespace,
      payload: {
        studyTime: { 'csc101-m1': 15 },
        topicLastStudied: { 'csc101-m1': '2026-10-12T08:00:00.000Z' },
        quizzesCompleted: 1,
        ai_sparks: 999999, // Protected field — must be stripped
        role: 'admin'      // Protected field — must be stripped
      }
    });

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.deduplicated, false);
    assert.strictEqual(res1.userModified, true);
    assert.strictEqual(res1.profile.ai_sparks, undefined, 'Protected ai_sparks must not be written via progress sync');
    assert.strictEqual(res1.profile.role, undefined, 'Protected role must not be written via progress sync');
    assert.strictEqual(res1.profile.studyTime['csc101-m1'], 15);

    // 2. Retry identical syncBatchId -> 100% deduplicated, 0 user writes
    const res1Retry = await executeIdempotentProgressBatchSync({
      db,
      uid: testUid,
      syncBatchId: batch1Id,
      clientSequence: 1,
      sandboxNamespace,
      payload: {
        studyTime: { 'csc101-m1': 15 },
        topicLastStudied: { 'csc101-m1': '2026-10-12T08:00:00.000Z' },
        quizzesCompleted: 1
      }
    });
    assert.strictEqual(res1Retry.deduplicated, true, 'Duplicate syncBatchId retry must be deduplicated');
    assert.strictEqual(res1Retry.userModified, false, 'Duplicate syncBatchId retry must not modify user doc');

    // 3. New batch with higher cumulative studyTime & quizzesCompleted
    const batch2Id = `${testUid}_sess1_2`;
    const res2 = await executeIdempotentProgressBatchSync({
      db,
      uid: testUid,
      syncBatchId: batch2Id,
      clientSequence: 2,
      sandboxNamespace,
      payload: {
        studyTime: { 'csc101-m1': 35, 'csc101-m2': 10 },
        topicLastStudied: { 'csc101-m1': '2026-10-12T08:25:00.000Z' },
        quizzesCompleted: 3
      }
    });
    assert.strictEqual(res2.deduplicated, false);
    assert.strictEqual(res2.userModified, true);
    assert.strictEqual(res2.profile.studyTime['csc101-m1'], 35);
    assert.strictEqual(res2.profile.quizzesCompleted, 3);

    // 4. Out-of-order / stale batch arrival with lower studyTime & quizzesCompleted -> monotonic protection + batch1 retry check
    const batch1OutOfOrderRetry = await executeIdempotentProgressBatchSync({
      db,
      uid: testUid,
      syncBatchId: batch1Id,
      clientSequence: 1,
      sandboxNamespace,
      payload: {
        studyTime: { 'csc101-m1': 15 },
        quizzesCompleted: 1
      }
    });
    assert.strictEqual(batch1OutOfOrderRetry.deduplicated, true, 'Older syncBatchId retried after newer batch must still be deduplicated');
    assert.strictEqual(batch1OutOfOrderRetry.userModified, false);

    // 5. Batch 3 with stale/lower values and no new changes -> monotonic merge keeps 35 mins and 3 quizzes, skips user write!
    const batch3Id = `${testUid}_sess1_3`;
    const res3 = await executeIdempotentProgressBatchSync({
      db,
      uid: testUid,
      syncBatchId: batch3Id,
      clientSequence: 3,
      sandboxNamespace,
      payload: {
        studyTime: { 'csc101-m1': 20, 'csc101-m2': 10 }, // 20 < 35, so monotonic max keeps 35
        topicLastStudied: { 'csc101-m1': '2026-10-12T08:10:00.000Z' }, // older than 08:25, monotonic max keeps 08:25
        quizzesCompleted: 2 // 2 < 3, monotonic max keeps 3
      }
    });
    assert.strictEqual(res3.deduplicated, false);
    assert.strictEqual(res3.userModified, false, 'Unchanged/regressive state after monotonic merge must suppress user doc write');
    assert.strictEqual(res3.profile.studyTime['csc101-m1'], 35);
    assert.strictEqual(res3.profile.quizzesCompleted, 3);

    // 6. Cross-user syncBatchId spoofing rejection
    let spoofRejected = false;
    try {
      await executeIdempotentProgressBatchSync({
        db,
        uid: testUid,
        syncBatchId: `otherUser_sess1_1`,
        clientSequence: 1,
        sandboxNamespace,
        payload: { quizzesCompleted: 5 }
      });
    } catch (err: any) {
      if (err?.statusCode === 403) {
        spoofRejected = true;
      }
    }
    assert.strictEqual(spoofRejected, true, 'Cross-user syncBatchId must be rejected with 403');

    // 7. Routine backend log buffering (0 Firestore writes for routine info/warning logs)
    await recordBackendSystemLog('info', 'ai', '[Stage4B Test] Routine info log buffered in memory', { test: true });
    await recordBackendSystemLog('warning', 'system', '[Stage4B Test] Routine warning log buffered in memory', { test: true });
    const bufferedLogs = getBufferedBackendSystemLogs(10);
    assert(bufferedLogs.some((l) => l.message.includes('[Stage4B Test] Routine info log')), 'Routine log must be stored in ring buffer');

    // 8. Idle telemetry flush suppression
    await telemetry.flushToFirestore();

    // 9. Verify dbTelemetry counters and local checkpoint persistence
    dbTelemetry.persistCheckpointToDisk();
    const snap = dbTelemetry.getSnapshot();
    console.log('[Stage 4B Test] Telemetry Totals:', JSON.stringify(snap.totals));
    console.log('[Stage 4B Test] Suppressed Writes By Reason:', JSON.stringify(snap.suppressedByReason));

    assert(snap.totals.totalSuppressedWrites >= 5, `Expected >= 5 suppressed writes, got ${snap.totals.totalSuppressedWrites}`);
    assert(
      (snap.suppressedByReason['idempotent_duplicate_progress_batch'] || 0) >= 2,
      'Must record idempotent_duplicate_progress_batch suppressions'
    );
    assert(
      (snap.suppressedByReason['unchanged_user_profile_or_progress_sync'] || 0) >= 1,
      'Must record unchanged_user_profile_or_progress_sync suppression'
    );
    assert(
      (snap.suppressedByReason['buffered_routine_info_or_warning_log'] || 0) >= 2,
      'Must record buffered_routine_info_or_warning_log suppressions'
    );
    assert(
      (snap.suppressedByReason['unchanged_ai_telemetry_periodic_flush'] || 0) >= 1,
      'Must record unchanged_ai_telemetry_periodic_flush suppression'
    );
    assert(snap.persistedHistorySummary.persistedSnapshotsCount >= 1, 'Must persist NDJSON telemetry checkpoint to disk');
  } finally {
    await deleteSandbox(db, sandboxNamespace);
  }

  const countsAfter = await getTopLevelCounts(db);
  console.log('[Stage 4B Test] Production 7-collection count snapshot AFTER:', JSON.stringify(countsAfter));
  assert.deepStrictEqual(countsAfter, countsBefore, 'Production top-level collection counts must remain 100% unchanged');
  console.log('PASSED: Stage 4B Firestore write-purge, idempotent progress batch sync, and telemetry suite.');
}

runStage4BTests().catch((err) => {
  console.error('FAILED Stage 4B test suite:', err);
  process.exit(1);
});
