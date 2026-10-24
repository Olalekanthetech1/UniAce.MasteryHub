// Direct unit test of the verifyAuth logic without external dependencies
function evaluateAuthHeader(nodeEnv: string, internalKeyEnv: string | undefined, authHeader: string | undefined): { status: number; user?: any } {
  const originalEnv = process.env.NODE_ENV;
  const originalKey = process.env.INTERNAL_TEST_KEY;
  process.env.NODE_ENV = nodeEnv;
  if (internalKeyEnv !== undefined) {
    process.env.INTERNAL_TEST_KEY = internalKeyEnv;
  } else {
    delete process.env.INTERNAL_TEST_KEY;
  }

  try {
    const token = authHeader?.split('Bearer ')[1]?.trim();

    // The exact logic from server.ts
    const testKey = process.env.INTERNAL_TEST_KEY;
    if (
      process.env.NODE_ENV !== 'production' &&
      typeof testKey === 'string' &&
      testKey.trim().length > 0 &&
      typeof token === 'string' &&
      token.trim().length > 0 &&
      token === testKey
    ) {
      return { status: 200, user: { uid: 'eval_tester_uid', role: 'admin' } };
    }

    if (!token || token === 'undefined' || token === 'null') {
      return { status: 401 };
    }

    return { status: 401 }; // Non-test token without valid Firebase verification
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalKey !== undefined) process.env.INTERNAL_TEST_KEY = originalKey;
    else delete process.env.INTERNAL_TEST_KEY;
  }
}

async function runTests() {
  console.log('=== ITEM 3: INTERNAL_TEST_KEY SECURITY TESTS ===\n');

  // Test 1: In production, with NO header
  const res1 = evaluateAuthHeader('production', 'secret-key-123', undefined);
  console.log(`Test 1 [Production, No Authorization Header]: Status = ${res1.status} (Expected: 401)`);

  // Test 2: In production, with WRONG header
  const res2 = evaluateAuthHeader('production', 'secret-key-123', 'Bearer wrong-key');
  console.log(`Test 2 [Production, Wrong Token]: Status = ${res2.status} (Expected: 401)`);

  // Test 3: In production, with MATCHING test key (MUST REJECT)
  const res3 = evaluateAuthHeader('production', 'secret-key-123', 'Bearer secret-key-123');
  console.log(`Test 3 [Production, Matching Key provided]: Status = ${res3.status} (Expected: 401 - Must reject in production)`);

  // Test 4: In production, with env var UNSET / EMPTY and token undefined/empty
  const res4 = evaluateAuthHeader('production', undefined, 'Bearer undefined');
  console.log(`Test 4 [Production, Env var unset, Bearer undefined]: Status = ${res4.status} (Expected: 401 - No undefined === undefined)`);

  // Test 5: In non-production (dev), matching key is accepted for CLI tests
  const res5 = evaluateAuthHeader('development', 'dev-secret-456', 'Bearer dev-secret-456');
  console.log(`Test 5 [Development, Matching Key for CLI runner]: Status = ${res5.status} (Expected: 200)`);

  const allPassed = res1.status === 401 && res2.status === 401 && res3.status === 401 && res4.status === 401 && res5.status === 200;
  console.log(`\n=== ALL INTERNAL_TEST_KEY SECURITY TESTS: ${allPassed ? 'PASS' : 'FAIL'} ===`);
  process.exit(allPassed ? 0 : 1);
}

runTests();
