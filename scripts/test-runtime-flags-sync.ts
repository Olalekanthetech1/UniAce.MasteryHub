/**
 * UniAce Mastery Hub: Stage 1 Verification Gate
 * Tests system_runtime_flags sync engine, latency, invariants, and prohibited shadow-write guard.
 */

import {
  getFeatureFlags,
  getAllRuntimeFlagRecords,
  refreshRuntimeFlagsFromDb,
  updateRuntimeFlag,
  initRuntimeFlagsSync,
  stopRuntimeFlagsSync
} from '../server/config/features';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${msg}`);
  }
}

async function runStage1Verification() {
  console.log('================================================================');
  console.log('🧪 Stage 1 Verification Gate: Runtime Flags In-Memory Sync Engine');
  console.log('================================================================\n');

  // 1. Initial State & In-memory zero-latency reads
  console.log('--- Test 1: In-Memory Zero-Latency Reads ---');
  const t0 = performance.now();
  const initialFlags = getFeatureFlags();
  const readDurationMs = performance.now() - t0;
  console.log(`In-memory read duration: ${readDurationMs.toFixed(4)}ms`);
  console.log('Initial Flags:', initialFlags);
  assert(readDurationMs < 1.0, 'In-memory flag snapshot must be sub-millisecond');
  assert(typeof initialFlags.ENABLE_POSTGRES_CATALOG === 'boolean', 'ENABLE_POSTGRES_CATALOG must be boolean');
  assert(typeof initialFlags.ENABLE_POSTGRES_PROGRESS === 'boolean', 'ENABLE_POSTGRES_PROGRESS must be boolean');
  assert(initialFlags.ENABLE_POSTGRES_SHADOW_WRITE === false, 'ENABLE_POSTGRES_SHADOW_WRITE must be false');
  console.log('✅ Test 1 Passed: Fast in-memory read verified.\n');

  // 2. Database Sync from Neon PostgreSQL
  console.log('--- Test 2: Sync from Neon system_runtime_flags ---');
  await refreshRuntimeFlagsFromDb();
  const records = getAllRuntimeFlagRecords();
  console.log(`Retrieved ${records.length} runtime flag records from database.`);
  assert(records.length >= 4, 'Must have at least 4 registered flags');
  
  const catalogRecord = records.find(r => r.flag_key === 'ENABLE_POSTGRES_CATALOG');
  assert(Boolean(catalogRecord), 'ENABLE_POSTGRES_CATALOG record must exist');
  assert(catalogRecord!.enabled === true, 'ENABLE_POSTGRES_CATALOG must be enabled in Neon');
  assert(Boolean(catalogRecord!.cutover_at), 'ENABLE_POSTGRES_CATALOG must have cutover_at timestamp');
  console.log('✅ Test 2 Passed: Database sync verified.\n');

  // 3. Mutation Latency & Instant Local Cache Invalidation
  console.log('--- Test 3: Flag Mutation & Instant Memory Cache Update ---');
  const mutateStart = performance.now();
  const updatedRecord = await updateRuntimeFlag(
    'ENABLE_POSTGRES_GENERATION_JOBS',
    true,
    'verification_test_runner',
    'Stage 1 latency & mutation validation'
  );
  const mutateDurationMs = performance.now() - mutateStart;
  console.log(`Neon mutation & sync duration: ${mutateDurationMs.toFixed(2)}ms`);
  console.log('Updated Record:', updatedRecord);

  // Check instant local in-memory reflection
  const memFlagsAfter = getFeatureFlags();
  assert(memFlagsAfter.ENABLE_POSTGRES_GENERATION_JOBS === true, 'Cache must immediately reflect updated state');
  assert(updatedRecord.enabled === true, 'Record must be enabled');
  assert(Boolean(updatedRecord.cutover_at), 'Cutover timestamp must be set on transition to true');
  console.log('✅ Test 3 Passed: Mutation successfully updated database and cache immediately.\n');

  // 4. Revert Mutation & Verify Idempotency
  console.log('--- Test 4: Reverting Mutation ---');
  await updateRuntimeFlag(
    'ENABLE_POSTGRES_GENERATION_JOBS',
    false,
    'verification_test_runner',
    'Reverting test state'
  );
  const memFlagsReverted = getFeatureFlags();
  assert(memFlagsReverted.ENABLE_POSTGRES_GENERATION_JOBS === false, 'Flag must revert cleanly');
  console.log('✅ Test 4 Passed: Reversion verified.\n');

  // 5. Prohibited Shadow-Write Guard
  console.log('--- Test 5: Prohibited Shadow-Write Guard ---');
  let threwExpectedError = false;
  try {
    await updateRuntimeFlag('ENABLE_POSTGRES_SHADOW_WRITE', true, 'malicious_actor');
  } catch (err: any) {
    threwExpectedError = true;
    console.log(`Expected guard triggered: "${err.message}"`);
  }
  assert(threwExpectedError, 'Must throw error when attempting to enable ENABLE_POSTGRES_SHADOW_WRITE');
  assert(getFeatureFlags().ENABLE_POSTGRES_SHADOW_WRITE === false, 'Shadow write must remain strictly false');
  console.log('✅ Test 5 Passed: Shadow-write prohibition enforced.\n');

  // 6. Test Periodic Background Sync Initializer
  console.log('--- Test 6: Background Polling Lifecycle ---');
  await initRuntimeFlagsSync(2000);
  stopRuntimeFlagsSync();
  console.log('✅ Test 6 Passed: Sync engine background lifecycle verified.\n');

  console.log('================================================================');
  console.log('🎉 ALL STAGE 1 VERIFICATION TESTS PASSED SUCCESSFULLY');
  console.log('================================================================\n');
}

runStage1Verification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Stage 1 Verification Failed:', err);
    process.exit(1);
  });
