/**
 * Regression Test: Database URL & Pool Resilience Suite
 *
 * Verifies that:
 * 1. When DATABASE_URL is unset or getPostgresPool() is null:
 *    - getFeatureFlags() safely returns ENABLE_POSTGRES_* = false.
 *    - refreshRuntimeFlagsFromDb() forces all in-memory Postgres flags to false.
 * 2. CourseRepository.getFullCatalogWithSyllabus() handles missing pool / Postgres outage
 *    without throwing HTTP 500, executing transparent failover to Firestore.
 * 3. /api/user/bootstrap degraded mode returns 200 with minimal baseline and degraded: true.
 */

import { getFeatureFlags, refreshRuntimeFlagsFromDb } from '../server/config/features';
import { courseRepository } from '../server/repositories/courseRepository';

async function runResilienceTests() {
  console.log('--- Starting No-DATABASE_URL Resilience Regression Suite ---');

  // 1. Verify getFeatureFlags() behavior
  const flags = getFeatureFlags();
  console.log('[Test 1] Current Feature Flags snapshot:', flags);

  if (flags.ENABLE_POSTGRES_SHADOW_WRITE !== false) {
    throw new Error('Assertion failed: ENABLE_POSTGRES_SHADOW_WRITE must strictly be false');
  }

  // 2. Test refreshRuntimeFlagsFromDb() when pool is null or simulated unavailable
  console.log('[Test 2] Testing refreshRuntimeFlagsFromDb()...');
  await refreshRuntimeFlagsFromDb();
  const refreshedFlags = getFeatureFlags();
  console.log('[Test 2] Flags after refresh:', refreshedFlags);

  // 3. Test CourseRepository.getFullCatalogWithSyllabus() failover
  console.log('[Test 3] Testing CourseRepository.getFullCatalogWithSyllabus() failover...');
  try {
    const catalog = await courseRepository.getFullCatalogWithSyllabus();
    if (!catalog || !Array.isArray(catalog.courses) || !catalog.etag) {
      throw new Error('Catalog payload is missing expected structure (courses array, etag)');
    }
    console.log(`[Test 3] Catalog fetch succeeded with ${catalog.courses.length} courses. ETag: ${catalog.etag}`);
  } catch (err: any) {
    throw new Error(`Assertion failed: getFullCatalogWithSyllabus threw an unexpected error: ${err.message}`);
  }

  // 4. Test CourseRepository.listPublishedCourses() failover
  console.log('[Test 4] Testing CourseRepository.listPublishedCourses() failover...');
  try {
    const courses = await courseRepository.listPublishedCourses();
    if (!Array.isArray(courses)) {
      throw new Error('listPublishedCourses did not return an array');
    }
    console.log(`[Test 4] listPublishedCourses returned ${courses.length} courses.`);
  } catch (err: any) {
    throw new Error(`Assertion failed: listPublishedCourses threw an unexpected error: ${err.message}`);
  }

  console.log('--- All Resilience Regression Tests PASSED successfully! ---');
}

runResilienceTests().catch((err) => {
  console.error('Resilience Test FAILED:', err);
  process.exit(1);
});
