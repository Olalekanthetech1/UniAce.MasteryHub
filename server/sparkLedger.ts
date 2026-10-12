import admin from 'firebase-admin';
import crypto from 'crypto';

export type SparkLedgerAction =
  | 'PRE_AUTH'
  | 'SETTLE'
  | 'REFUND'
  | 'QUALITY_BOUNTY'
  | 'PAYMENT_REFUND_CLAWBACK'
  | 'HINT_DEDUCT'
  | 'REWARD'
  | 'ADMIN_ADJUST';

export type SparkLedgerEndpoint =
  | 'http_chat'
  | 'ws_chat'
  | 'hint'
  | 'reward'
  | 'quality_bounty'
  | 'paystack_webhook'
  | 'admin';

export type SparkEscrowState =
  | 'PRE_AUTHORIZED'
  | 'SETTLED'
  | 'REFUNDED'
  | 'BOUNTY_CREDITED'
  | 'DIRECT';

export type SparkBucketSource =
  | 'tracked'
  | 'backfilled_estimate'
  | 'derived'
  | 'legacy_off';

export type SparkCostStatus =
  | 'VERIFIED'
  | 'COST_UNKNOWN'
  | 'UNCONFIGURED_PRICING'
  | 'CACHE_HIT';

export interface TokenPricingRateEntry {
  standardUsdPer1k: number;
  highUsdPer1k: number;
  sourceUrl: string;
  lastVerifiedAt: string | null;
  verifiedBy: string | null;
}

export interface SparkLedgerEntry {
  id: string;
  idempotency_token: string;
  uid: string;
  userEmail: string;
  action: SparkLedgerAction;
  state?: SparkEscrowState;
  delta: number;
  preAuthAmount: number;
  actualCost: number | null;
  balanceBefore: number;
  balanceAfter: number;
  bucketAccountingEnabled?: boolean;
  bucketSource?: SparkBucketSource;
  freeBalanceBefore?: number | null;
  freeBalanceAfter?: number | null;
  paidBalanceBefore?: number | null;
  paidBalanceAfter?: number | null;
  preAuthFreeSparks?: number;
  preAuthPaidSparks?: number;
  freeSparksUsed?: number;
  paidSparksUsed?: number;
  freeSparksRefunded?: number;
  paidSparksRefunded?: number;
  bonusSparksAwarded?: number;
  complexity: string;
  endpoint: SparkLedgerEndpoint;
  providerUsed: string | null;
  tokens: number | null;
  costStatus?: SparkCostStatus;
  pricingVersion?: number | null;
  snapshotStandardUsdPer1k?: number | null;
  snapshotHighUsdPer1k?: number | null;
  appliedRateUsdPer1k?: number | null;
  snapshotImpliedRevenuePerSparkUsd?: number | null;
  estimatedCostUsd?: number | null;
  estimatedRevenueUsd?: number | null;
  grossMarginUsd?: number | null;
  pricingStale?: boolean;
  pricingSourceUrl?: string | null;
  pricingLastVerifiedAt?: string | null;
  planType: string;
  role: string;
  reason: string;
  createdAtIso: string;
  timestamp: admin.firestore.FieldValue | admin.firestore.Timestamp;
}

export interface ComputedSparkMarginMetrics {
  costStatus: SparkCostStatus;
  pricingVersion: number | null;
  snapshotStandardUsdPer1k: number | null;
  snapshotHighUsdPer1k: number | null;
  appliedRateUsdPer1k: number | null;
  snapshotImpliedRevenuePerSparkUsd: number | null;
  estimatedCostUsd: number | null;
  estimatedRevenueUsd: number | null;
  grossMarginUsd: number | null;
  pricingStale: boolean;
  pricingSourceUrl: string | null;
  pricingLastVerifiedAt: string | null;
}

/**
 * Computes immutable USD cost, tracked paid-Spark revenue, and gross margin at settlement time.
 * ZeroMock Policy:
 * - No default `impliedRevenuePerSparkUsd` or provider rates.
 * - Missing or <= 0 token usage (outside `semantic_cache`) is marked `COST_UNKNOWN` (never $0).
 * - Only `bucketSource === 'tracked'` contributes to `estimatedRevenueUsd`; `'backfilled_estimate'`,
 *   `'derived'`, and `'legacy_off'` produce `estimatedRevenueUsd: null` so estimates never inflate tracked KPIs.
 */
export function computeSparkMarginMetrics(
  providerUsed: string,
  totalTokens: number | null | undefined,
  sparksCharged: number,
  complexity: string,
  pricingEntry?: TokenPricingRateEntry | null,
  pricingStaleAfterDays: number | null = null,
  impliedRevenuePerSparkUsd: number | null = null,
  options?: {
    paidSparksUsed?: number;
    bucketSource?: SparkBucketSource;
    pricingVersion?: number | null;
  }
): ComputedSparkMarginMetrics {
  const bucketSource: SparkBucketSource = options?.bucketSource || 'legacy_off';
  const paidSparksUsed =
    typeof options?.paidSparksUsed === 'number'
      ? Math.max(0, options.paidSparksUsed)
      : bucketSource === 'tracked'
        ? Math.max(0, sparksCharged)
        : 0;
  const pricingVersion =
    typeof options?.pricingVersion === 'number' ? options.pricingVersion : null;
  const validImpliedRate =
    typeof impliedRevenuePerSparkUsd === 'number' && impliedRevenuePerSparkUsd > 0
      ? impliedRevenuePerSparkUsd
      : null;

  // Tracked paid-Spark revenue is ONLY computed when bucketSource === 'tracked'
  // and impliedRevenuePerSparkUsd is configured (or when paidSparksUsed === 0 on a tracked bucket, which is $0).
  let estimatedRevenueUsd: number | null = null;
  if (bucketSource === 'tracked') {
    if (paidSparksUsed === 0) {
      estimatedRevenueUsd = 0;
    } else if (validImpliedRate !== null) {
      estimatedRevenueUsd = Number((paidSparksUsed * validImpliedRate).toFixed(6));
    }
  }

  // Semantic cache hit incurs 0 upstream provider tokens and $0 upstream cost
  if (providerUsed === 'semantic_cache') {
    const grossMarginUsd =
      estimatedRevenueUsd !== null ? Number((estimatedRevenueUsd - 0).toFixed(6)) : null;
    return {
      costStatus: 'CACHE_HIT',
      pricingVersion,
      snapshotStandardUsdPer1k: 0,
      snapshotHighUsdPer1k: 0,
      appliedRateUsdPer1k: 0,
      snapshotImpliedRevenuePerSparkUsd: validImpliedRate,
      estimatedCostUsd: 0,
      estimatedRevenueUsd,
      grossMarginUsd,
      pricingStale: false,
      pricingSourceUrl: null,
      pricingLastVerifiedAt: null
    };
  }

  let pricingStale = true;
  const staleWindowDays =
    typeof pricingStaleAfterDays === 'number' && pricingStaleAfterDays > 0
      ? pricingStaleAfterDays
      : 14;
  if (pricingEntry?.lastVerifiedAt) {
    const verifiedMs = Date.parse(pricingEntry.lastVerifiedAt);
    if (!Number.isNaN(verifiedMs)) {
      const ageDays = (Date.now() - verifiedMs) / (1000 * 60 * 60 * 24);
      pricingStale = ageDays > staleWindowDays;
    }
  }

  const hasValidPricing =
    Boolean(pricingEntry) &&
    typeof pricingEntry!.standardUsdPer1k === 'number' &&
    typeof pricingEntry!.highUsdPer1k === 'number';

  const snapshotStandardUsdPer1k = hasValidPricing ? Number(pricingEntry!.standardUsdPer1k) : null;
  const snapshotHighUsdPer1k = hasValidPricing ? Number(pricingEntry!.highUsdPer1k) : null;
  const appliedRateUsdPer1k = hasValidPricing
    ? complexity === 'high'
      ? snapshotHighUsdPer1k
      : snapshotStandardUsdPer1k
    : null;

  // Missing or zero token usage on a non-cache provider call -> COST_UNKNOWN (never $0)
  if (typeof totalTokens !== 'number' || !Number.isFinite(totalTokens) || totalTokens <= 0) {
    return {
      costStatus: 'COST_UNKNOWN',
      pricingVersion,
      snapshotStandardUsdPer1k,
      snapshotHighUsdPer1k,
      appliedRateUsdPer1k,
      snapshotImpliedRevenuePerSparkUsd: validImpliedRate,
      estimatedCostUsd: null,
      estimatedRevenueUsd,
      grossMarginUsd: null,
      pricingStale,
      pricingSourceUrl: pricingEntry?.sourceUrl || null,
      pricingLastVerifiedAt: pricingEntry?.lastVerifiedAt || null
    };
  }

  // Missing provider rate card -> UNCONFIGURED_PRICING
  if (!hasValidPricing || appliedRateUsdPer1k === null) {
    return {
      costStatus: 'UNCONFIGURED_PRICING',
      pricingVersion,
      snapshotStandardUsdPer1k: null,
      snapshotHighUsdPer1k: null,
      appliedRateUsdPer1k: null,
      snapshotImpliedRevenuePerSparkUsd: validImpliedRate,
      estimatedCostUsd: null,
      estimatedRevenueUsd,
      grossMarginUsd: null,
      pricingStale: true,
      pricingSourceUrl: pricingEntry?.sourceUrl || null,
      pricingLastVerifiedAt: pricingEntry?.lastVerifiedAt || null
    };
  }

  const estimatedCostUsd = Number(((totalTokens / 1000) * appliedRateUsdPer1k).toFixed(6));
  const grossMarginUsd =
    estimatedRevenueUsd !== null
      ? Number((estimatedRevenueUsd - estimatedCostUsd).toFixed(6))
      : null;

  return {
    costStatus: 'VERIFIED',
    pricingVersion,
    snapshotStandardUsdPer1k,
    snapshotHighUsdPer1k,
    appliedRateUsdPer1k,
    snapshotImpliedRevenuePerSparkUsd: validImpliedRate,
    estimatedCostUsd,
    estimatedRevenueUsd,
    grossMarginUsd,
    pricingStale,
    pricingSourceUrl: pricingEntry?.sourceUrl || null,
    pricingLastVerifiedAt: pricingEntry?.lastVerifiedAt || null
  };
}

/**
 * Generates or sanitizes a deterministic user-scoped idempotency token.
 * Ensures the token conforms to safe Firestore document ID constraints: ^[a-zA-Z0-9_-]{8,128}$
 */
export function resolveScopedIdempotencyToken(
  rawToken: string | undefined | null,
  uid: string
): string {
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 36) || 'anon';
  if (rawToken && typeof rawToken === 'string') {
    const cleaned = rawToken.trim().replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 64);
    if (cleaned.length >= 6) {
      return `${safeUid}_${cleaned}`;
    }
  }
  const randomSuffix = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  return `${safeUid}_${Date.now()}_${randomSuffix}`;
}

/**
 * Resolves a Firestore collection either at the root (production) or inside an isolated
 * test sandbox (`_ci_test_sandboxes/{sandboxNamespace}/{collectionName}`) so automated
 * concurrency and state-machine tests never read, write, or mutate live production collections.
 */
export function getLedgerScopedCollection(
  db: admin.firestore.Firestore,
  collectionName: string,
  sandboxNamespace?: string
): admin.firestore.CollectionReference {
  if (sandboxNamespace && sandboxNamespace.trim()) {
    const safeNs = sandboxNamespace.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    return db.collection('_ci_test_sandboxes').doc(safeNs).collection(collectionName);
  }
  return db.collection(collectionName);
}

export interface PreAuthParams {
  app: admin.app.App;
  uid: string;
  userEmail?: string | null;
  idempotencyToken: string;
  complexity: 'standard' | 'high' | 'quiz';
  maxPreAuth: number;
  dailyFreeSparks?: number | null;
  enableSparkBucketLedger?: boolean;
  rateLimitSeconds: number;
  endpoint: SparkLedgerEndpoint;
  isAdminEmailFn: (email: string | undefined | null) => boolean;
  sandboxNamespace?: string;
}

export interface PreAuthTransactionResult {
  sparks: number;
  freeSparks: number | null;
  paidSparks: number | null;
  bucketAccountingEnabled: boolean;
  bucketSource: SparkBucketSource;
  plan: string;
  role: string;
  displayName: string;
  learningProfile: any;
  isFreeUser: boolean;
  preAuthDeduction: number;
  preAuthFreeSparks: number;
  preAuthPaidSparks: number;
  isNewUser: boolean;
  alreadyPreAuthorized: boolean;
  idempotencyToken: string;
}

/**
 * STEP 1: Atomic Pre-Authorization with Append-Only Spark Ledger (`PRE_AUTH`).
 * - Evaluates `enableSparkBucketLedger` and `dailyFreeSparks` from audited `system_config/evaluation_policy`
 *   inside the transaction (unless explicitly overridden in `params`).
 * - Snapshots `bucketAccountingEnabled` onto `${idempotencyToken}_PRE_AUTH` so `SETTLE` and `REFUND`
 *   never break if the flag is toggled mid-flight.
 * - Executes daily free-Spark refill atomically inside the transaction ONLY when `dailyFreeSparks` is configured (`> 0`),
 *   respecting `bucketAccountingEnabled` so legacy users without buckets are never rewritten when the flag is off.
 */
export async function executeSparkPreAuth(
  params: PreAuthParams
): Promise<PreAuthTransactionResult> {
  const {
    app,
    uid,
    userEmail,
    idempotencyToken,
    complexity,
    maxPreAuth,
    rateLimitSeconds,
    endpoint,
    isAdminEmailFn
  } = params;

  const db = app.firestore();
  const ns = params.sandboxNamespace;
  const userRef = getLedgerScopedCollection(db, 'users', ns).doc(uid);
  const preAuthDocId = `${idempotencyToken}_PRE_AUTH`;
  const preAuthLedgerRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(preAuthDocId);
  const policyRef = getLedgerScopedCollection(db, 'system_config', ns).doc('evaluation_policy');

  let isNewUser = false;

  const txResult = await db.runTransaction(async (t) => {
    isNewUser = false;
    const [existingLedgerSnap, doc, policySnap] = await Promise.all([
      t.get(preAuthLedgerRef),
      t.get(userRef),
      t.get(policyRef)
    ]);

    const policyData = policySnap.exists ? policySnap.data() || {} : {};
    const configuredDailyFreeSparks: number | null =
      params.dailyFreeSparks !== undefined
        ? params.dailyFreeSparks
        : typeof policyData.dailyFreeSparks === 'number' && policyData.dailyFreeSparks >= 0
          ? policyData.dailyFreeSparks
          : null;

    const bucketAccountingEnabled: boolean =
      params.enableSparkBucketLedger !== undefined
        ? Boolean(params.enableSparkBucketLedger)
        : Boolean(policyData.enableSparkBucketLedger);

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Idempotency Check: If this token was already pre-authorized, return cached ledger state without re-deducting
    if (existingLedgerSnap.exists) {
      const ledgerData = existingLedgerSnap.data()!;
      const userData = doc.exists ? doc.data() : null;
      const plan = userData?.plan_type || ledgerData.planType || 'free';
      const role = userData?.role || ledgerData.role || 'student';
      const isFreeUser = plan === 'free' && role !== 'admin';
      const currentSparks = isFreeUser
        ? (userData?.ai_sparks ?? ledgerData.balanceAfter ?? 0)
        : 999999;

      return {
        sparks: currentSparks,
        freeSparks: ledgerData.freeBalanceAfter ?? userData?.free_sparks ?? null,
        paidSparks: ledgerData.paidBalanceAfter ?? userData?.paid_sparks ?? null,
        bucketAccountingEnabled: Boolean(ledgerData.bucketAccountingEnabled),
        bucketSource: (ledgerData.bucketSource as SparkBucketSource) || 'legacy_off',
        plan,
        role,
        displayName: userData?.displayName || 'Student',
        learningProfile: userData?.learningProfile || null,
        isFreeUser,
        preAuthDeduction: ledgerData.preAuthAmount ?? 0,
        preAuthFreeSparks: ledgerData.preAuthFreeSparks ?? 0,
        preAuthPaidSparks: ledgerData.preAuthPaidSparks ?? 0,
        isNewUser: false,
        alreadyPreAuthorized: true,
        idempotencyToken
      };
    }

    const minRequiredSparks = complexity === 'high' ? 100 : 1;

    if (!doc.exists) {
      const initialRole = isAdminEmailFn(userEmail) ? 'admin' : 'student';
      const isFreeUser = initialRole !== 'admin';
      const initialFreeAllowance =
        typeof configuredDailyFreeSparks === 'number' && configuredDailyFreeSparks > 0
          ? configuredDailyFreeSparks
          : 0;

      if (isFreeUser && initialFreeAllowance < minRequiredSparks) {
        throw new Error(
          complexity === 'high'
            ? 'Insufficient sparks. Pro Mode requires at least 100 sparks.'
            : 'Insufficient sparks. You need at least 1 spark to start a query.'
        );
      }

      const preAuthDeduction = isFreeUser ? Math.min(initialFreeAllowance, maxPreAuth) : 0;
      const balanceAfter = isFreeUser ? initialFreeAllowance - preAuthDeduction : initialFreeAllowance;

      const initialData: Record<string, any> = {
        uid,
        email: userEmail || null,
        ai_sparks: balanceAfter,
        plan_type: 'free',
        role: initialRole,
        last_request_at: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (typeof configuredDailyFreeSparks === 'number' && configuredDailyFreeSparks > 0) {
        initialData.last_spark_reset = todayStr;
      }

      let preAuthFreeSparks = 0;
      let preAuthPaidSparks = 0;
      let freeBalanceBefore: number | null = null;
      let freeBalanceAfter: number | null = null;
      let paidBalanceBefore: number | null = null;
      let paidBalanceAfter: number | null = null;
      let bucketSource: SparkBucketSource = 'legacy_off';

      if (bucketAccountingEnabled) {
        preAuthFreeSparks = preAuthDeduction;
        preAuthPaidSparks = 0;
        freeBalanceBefore = initialFreeAllowance;
        freeBalanceAfter = balanceAfter;
        paidBalanceBefore = 0;
        paidBalanceAfter = 0;
        bucketSource = 'tracked';

        if (balanceAfter !== freeBalanceAfter + paidBalanceAfter) {
          throw new Error('Bucket sum invariant violation during new user PRE_AUTH.');
        }

        initialData.free_sparks = freeBalanceAfter;
        initialData.paid_sparks = paidBalanceAfter;
        initialData.bucket_tracking_initialized = true;
        initialData.bucketSource = 'tracked';
      }

      t.set(userRef, initialData);

      const ledgerEntry: SparkLedgerEntry = {
        id: preAuthDocId,
        idempotency_token: idempotencyToken,
        uid,
        userEmail: userEmail || 'unknown@uniace.edu',
        action: 'PRE_AUTH',
        state: 'PRE_AUTHORIZED',
        delta: -preAuthDeduction,
        preAuthAmount: preAuthDeduction,
        actualCost: null,
        balanceBefore: initialFreeAllowance,
        balanceAfter,
        bucketAccountingEnabled,
        bucketSource,
        freeBalanceBefore,
        freeBalanceAfter,
        paidBalanceBefore,
        paidBalanceAfter,
        preAuthFreeSparks,
        preAuthPaidSparks,
        complexity,
        endpoint,
        providerUsed: null,
        tokens: null,
        planType: 'free',
        role: initialRole,
        reason: `Escrow pre-authorization (${complexity} complexity)`,
        createdAtIso: now.toISOString(),
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };
      t.set(preAuthLedgerRef, ledgerEntry);

      isNewUser = true;
      return {
        sparks: isFreeUser ? balanceAfter : 999999,
        freeSparks: freeBalanceAfter,
        paidSparks: paidBalanceAfter,
        bucketAccountingEnabled,
        bucketSource,
        plan: 'free',
        role: initialRole,
        displayName: 'Student',
        learningProfile: null,
        isFreeUser,
        preAuthDeduction,
        preAuthFreeSparks,
        preAuthPaidSparks,
        isNewUser: true,
        alreadyPreAuthorized: false,
        idempotencyToken
      };
    }

    const userData = doc.data()!;
    const displayName = userData.displayName || 'Student';
    const learningProfile = userData.learningProfile || null;
    let role = userData.role || 'student';
    const plan = userData.plan_type || 'free';
    const lastRequestAt = userData.last_request_at?.toDate
      ? userData.last_request_at.toDate()
      : new Date(0);
    const lastReset = userData.last_spark_reset;

    const updates: Record<string, any> = {};

    if (isAdminEmailFn(userEmail) && role !== 'admin') {
      updates.role = 'admin';
      role = 'admin';
    }

    const isFreeUser = plan === 'free' && role !== 'admin';

    // Concurrency / Rate Limit check
    const secondsSinceLast = (now.getTime() - lastRequestAt.getTime()) / 1000;
    const isInitialMessage = !userData.last_request_at || lastRequestAt.getTime() === 0;
    if (
      role !== 'admin' &&
      !isAdminEmailFn(userEmail) &&
      !isInitialMessage &&
      rateLimitSeconds > 0 &&
      secondsSinceLast < rateLimitSeconds
    ) {
      throw new Error('Rate limit exceeded. Please wait a few seconds.');
    }

    const shouldRefillToday =
      lastReset !== todayStr &&
      role !== 'admin' &&
      plan === 'free' &&
      typeof configuredDailyFreeSparks === 'number' &&
      configuredDailyFreeSparks > 0;

    if (!bucketAccountingEnabled) {
      // LEGACY SINGLE-BALANCE MODE:
      // Never rewrite ai_sparks = free_sparks + paid_sparks or touch bucket fields when flag is OFF.
      let sparks = Math.max(0, Number(userData.ai_sparks ?? 0));
      if (shouldRefillToday && configuredDailyFreeSparks !== null) {
        sparks = Math.max(sparks, configuredDailyFreeSparks);
        updates.last_spark_reset = todayStr;
        updates.ai_sparks = sparks;
      }

      if (isFreeUser && sparks < minRequiredSparks) {
        throw new Error(
          complexity === 'high'
            ? 'Insufficient sparks. Pro Mode requires at least 100 sparks.'
            : 'Insufficient sparks. You need at least 1 spark to start a query.'
        );
      }

      const preAuthDeduction = isFreeUser ? Math.min(sparks, maxPreAuth) : 0;
      const balanceBefore = sparks;
      const balanceAfter = isFreeUser ? sparks - preAuthDeduction : sparks;

      if (isFreeUser) {
        updates.ai_sparks = balanceAfter;
      }
      updates.last_request_at = admin.firestore.FieldValue.serverTimestamp();
      t.set(userRef, updates, { merge: true });

      const ledgerEntry: SparkLedgerEntry = {
        id: preAuthDocId,
        idempotency_token: idempotencyToken,
        uid,
        userEmail: userData.email || userEmail || 'unknown@uniace.edu',
        action: 'PRE_AUTH',
        state: 'PRE_AUTHORIZED',
        delta: -preAuthDeduction,
        preAuthAmount: preAuthDeduction,
        actualCost: null,
        balanceBefore,
        balanceAfter,
        bucketAccountingEnabled: false,
        bucketSource: 'legacy_off',
        freeBalanceBefore: null,
        freeBalanceAfter: null,
        paidBalanceBefore: null,
        paidBalanceAfter: null,
        preAuthFreeSparks: 0,
        preAuthPaidSparks: 0,
        complexity,
        endpoint,
        providerUsed: null,
        tokens: null,
        planType: plan,
        role,
        reason: `Escrow pre-authorization (${complexity} complexity)`,
        createdAtIso: now.toISOString(),
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };
      t.set(preAuthLedgerRef, ledgerEntry);

      return {
        sparks: isFreeUser ? balanceAfter : 999999,
        freeSparks: null,
        paidSparks: null,
        bucketAccountingEnabled: false,
        bucketSource: 'legacy_off' as SparkBucketSource,
        plan,
        role,
        displayName,
        learningProfile,
        isFreeUser,
        preAuthDeduction,
        preAuthFreeSparks: 0,
        preAuthPaidSparks: 0,
        isNewUser: false,
        alreadyPreAuthorized: false,
        idempotencyToken
      };
    }

    // BUCKET ACCOUNTING ENABLED MODE (`bucketAccountingEnabled === true`):
    let freeSparks: number;
    let paidSparks: number;
    let bucketSource: SparkBucketSource;

    if (userData.bucket_tracking_initialized === true) {
      freeSparks = Math.max(0, Number(userData.free_sparks ?? 0));
      paidSparks = Math.max(0, Number(userData.paid_sparks ?? 0));
      const existingSource = userData.bucketSource as SparkBucketSource | undefined;
      bucketSource =
        existingSource === 'tracked' ||
        existingSource === 'backfilled_estimate' ||
        existingSource === 'derived'
          ? existingSource
          : 'derived';
    } else {
      // Unmigrated legacy user encountered while bucket accounting is ON:
      // Initialize buckets conservatively and mark `bucketSource: 'derived'` so they are excluded from tracked revenue KPIs.
      const legacyTotal = Math.max(0, Number(userData.ai_sparks ?? 0));
      paidSparks = Math.max(0, Math.min(legacyTotal, Number(userData.paid_sparks ?? 0)));
      freeSparks = Math.max(0, legacyTotal - paidSparks);
      bucketSource = 'derived';
      updates.bucket_tracking_initialized = true;
      updates.bucketSource = 'derived';
    }

    // Daily Free-Spark Refill inside the same transaction:
    // Tops up ONLY `free_sparks` to `Math.max(free_sparks, configuredDailyFreeSparks)` while leaving `paid_sparks` untouched.
    if (shouldRefillToday && configuredDailyFreeSparks !== null) {
      freeSparks = Math.max(freeSparks, configuredDailyFreeSparks);
      updates.last_spark_reset = todayStr;
    }

    const totalBefore = freeSparks + paidSparks;
    if (isFreeUser && totalBefore < minRequiredSparks) {
      throw new Error(
        complexity === 'high'
          ? 'Insufficient sparks. Pro Mode requires at least 100 sparks.'
          : 'Insufficient sparks. You need at least 1 spark to start a query.'
      );
    }

    const preAuthDeduction = isFreeUser ? Math.min(totalBefore, maxPreAuth) : 0;
    const preAuthFreeSparks = isFreeUser ? Math.min(freeSparks, preAuthDeduction) : 0;
    const preAuthPaidSparks = isFreeUser ? preAuthDeduction - preAuthFreeSparks : 0;

    const freeBalanceBefore = freeSparks;
    const paidBalanceBefore = paidSparks;
    const freeBalanceAfter = isFreeUser ? freeSparks - preAuthFreeSparks : freeSparks;
    const paidBalanceAfter = isFreeUser ? paidSparks - preAuthPaidSparks : paidSparks;
    const balanceBefore = totalBefore;
    const balanceAfter = freeBalanceAfter + paidBalanceAfter;

    if (
      freeBalanceAfter < 0 ||
      paidBalanceAfter < 0 ||
      balanceAfter !== freeBalanceAfter + paidBalanceAfter
    ) {
      throw new Error(
        `Bucket sum invariant violation in PRE_AUTH: ai_sparks (${balanceAfter}) !== free_sparks (${freeBalanceAfter}) + paid_sparks (${paidBalanceAfter})`
      );
    }

    updates.free_sparks = freeBalanceAfter;
    updates.paid_sparks = paidBalanceAfter;
    updates.ai_sparks = balanceAfter;
    updates.last_request_at = admin.firestore.FieldValue.serverTimestamp();
    t.set(userRef, updates, { merge: true });

    const ledgerEntry: SparkLedgerEntry = {
      id: preAuthDocId,
      idempotency_token: idempotencyToken,
      uid,
      userEmail: userData.email || userEmail || 'unknown@uniace.edu',
      action: 'PRE_AUTH',
      state: 'PRE_AUTHORIZED',
      delta: -preAuthDeduction,
      preAuthAmount: preAuthDeduction,
      actualCost: null,
      balanceBefore,
      balanceAfter,
      bucketAccountingEnabled: true,
      bucketSource,
      freeBalanceBefore,
      freeBalanceAfter,
      paidBalanceBefore,
      paidBalanceAfter,
      preAuthFreeSparks,
      preAuthPaidSparks,
      complexity,
      endpoint,
      providerUsed: null,
      tokens: null,
      planType: plan,
      role,
      reason: `Escrow pre-authorization (${complexity} complexity, free: -${preAuthFreeSparks}, paid: -${preAuthPaidSparks})`,
      createdAtIso: now.toISOString(),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    t.set(preAuthLedgerRef, ledgerEntry);

    return {
      sparks: isFreeUser ? balanceAfter : 999999,
      freeSparks: freeBalanceAfter,
      paidSparks: paidBalanceAfter,
      bucketAccountingEnabled: true,
      bucketSource,
      plan,
      role,
      displayName,
      learningProfile,
      isFreeUser,
      preAuthDeduction,
      preAuthFreeSparks,
      preAuthPaidSparks,
      isNewUser: false,
      alreadyPreAuthorized: false,
      idempotencyToken
    };
  });

  return { ...txResult, isNewUser };
}

export interface SettleParams {
  app: admin.app.App;
  uid: string;
  userEmail?: string | null;
  idempotencyToken: string;
  isFreeUser: boolean;
  fallbackPreAuthDeduction: number;
  actualCost: number;
  totalTokens: number | null;
  complexity: string;
  endpoint: SparkLedgerEndpoint;
  providerUsed: string;
  planType: string;
  role: string;
  sandboxNamespace?: string;
}

export interface SettleTransactionResult {
  finalSparks: number;
  freeSparks: number | null;
  paidSparks: number | null;
  actualCost: number;
  freeSparksUsed: number;
  paidSparksUsed: number;
  refundDelta: number;
  alreadySettled: boolean;
  bucketAccountingEnabled: boolean;
  bucketSource: SparkBucketSource;
  costStatus: SparkCostStatus;
  estimatedCostUsd: number | null;
  estimatedRevenueUsd: number | null;
  grossMarginUsd: number | null;
  pricingStale: boolean;
}

/**
 * STEP 2: Atomic Settlement with Append-Only Spark Ledger (`SETTLE`).
 * - Reads `bucketAccountingEnabled` from the parent `${idempotencyToken}_PRE_AUTH` document (NOT live config),
 *   preventing mid-flight flag flips from corrupting in-flight queries.
 * - Enforces `ai_sparks === free_sparks + paid_sparks` when `bucketAccountingEnabled === true`.
 * - Snapshots `UsdPer1k` rate cards and marks missing token usage as `COST_UNKNOWN` (never $0).
 */
export async function executeSparkSettle(
  params: SettleParams
): Promise<SettleTransactionResult> {
  const {
    app,
    uid,
    userEmail,
    idempotencyToken,
    isFreeUser,
    fallbackPreAuthDeduction,
    actualCost,
    totalTokens,
    complexity,
    endpoint,
    providerUsed,
    planType,
    role
  } = params;

  const db = app.firestore();
  const ns = params.sandboxNamespace;
  const userRef = getLedgerScopedCollection(db, 'users', ns).doc(uid);
  const preAuthDocId = `${idempotencyToken}_PRE_AUTH`;
  const settleDocId = `${idempotencyToken}_SETTLE`;
  const refundDocId = `${idempotencyToken}_REFUND`;

  const preAuthRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(preAuthDocId);
  const settleRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(settleDocId);
  const refundRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(refundDocId);
  const pricingRef = getLedgerScopedCollection(db, 'system_config', ns).doc('token_pricing');
  const policyRef = getLedgerScopedCollection(db, 'system_config', ns).doc('evaluation_policy');

  return await db.runTransaction(async (t) => {
    const [preAuthSnap, settleSnap, refundSnap, userSnap, pricingSnap, policySnap] = await Promise.all([
      t.get(preAuthRef),
      t.get(settleRef),
      t.get(refundRef),
      t.get(userRef),
      t.get(pricingRef),
      t.get(policyRef)
    ]);

    const preAuthData = preAuthSnap.exists ? preAuthSnap.data() || {} : {};
    const preAuthState = preAuthSnap.exists ? preAuthData.state : null;

    if (settleSnap.exists || preAuthState === 'SETTLED') {
      const data = settleSnap.data() || {};
      return {
        finalSparks: isFreeUser ? (data.balanceAfter ?? userSnap.data()?.ai_sparks ?? 0) : 999999,
        freeSparks: data.freeBalanceAfter ?? userSnap.data()?.free_sparks ?? null,
        paidSparks: data.paidBalanceAfter ?? userSnap.data()?.paid_sparks ?? null,
        actualCost: data.actualCost ?? actualCost,
        freeSparksUsed: data.freeSparksUsed ?? 0,
        paidSparksUsed: data.paidSparksUsed ?? 0,
        refundDelta: data.delta ?? 0,
        alreadySettled: true,
        bucketAccountingEnabled: Boolean(data.bucketAccountingEnabled),
        bucketSource: (data.bucketSource as SparkBucketSource) || 'legacy_off',
        costStatus: (data.costStatus as SparkCostStatus) || 'COST_UNKNOWN',
        estimatedCostUsd: data.estimatedCostUsd ?? null,
        estimatedRevenueUsd: data.estimatedRevenueUsd ?? null,
        grossMarginUsd: data.grossMarginUsd ?? null,
        pricingStale: Boolean(data.pricingStale)
      };
    }

    // Strict State-Machine Mutual Exclusion: If already refunded (or never pre-authorized), cannot transition to SETTLE
    if (refundSnap.exists || preAuthState === 'REFUNDED' || !preAuthSnap.exists) {
      const userData = userSnap.data() || {};
      const currentSparks = userData.ai_sparks ?? 0;
      return {
        finalSparks: isFreeUser ? currentSparks : 999999,
        freeSparks: userData.free_sparks ?? null,
        paidSparks: userData.paid_sparks ?? null,
        actualCost: 0,
        freeSparksUsed: 0,
        paidSparksUsed: 0,
        refundDelta: 0,
        alreadySettled: true,
        bucketAccountingEnabled: Boolean(preAuthData.bucketAccountingEnabled),
        bucketSource: (preAuthData.bucketSource as SparkBucketSource) || 'legacy_off',
        costStatus: 'COST_UNKNOWN',
        estimatedCostUsd: null,
        estimatedRevenueUsd: null,
        grossMarginUsd: null,
        pricingStale: true
      };
    }

    // Read mode strictly from the parent PRE_AUTH document so mid-flight config flips never break settlement
    const bucketAccountingEnabled = Boolean(preAuthData.bucketAccountingEnabled);
    const bucketSource: SparkBucketSource =
      bucketAccountingEnabled
        ? ((preAuthData.bucketSource as SparkBucketSource) ||
          (userSnap.data()?.bucketSource as SparkBucketSource) ||
          'derived')
        : 'legacy_off';

    const preAuthDeduction = Number(preAuthData.preAuthAmount ?? fallbackPreAuthDeduction);
    const userData = userSnap.data() || {};
    const currentSparks = Math.max(0, Number(userData.ai_sparks ?? 0));

    let effectiveCost = isFreeUser ? Math.max(0, actualCost) : 0;
    let refundDelta = 0;
    let newBalance = currentSparks;
    let freeBalanceBefore: number | null = null;
    let freeBalanceAfter: number | null = null;
    let paidBalanceBefore: number | null = null;
    let paidBalanceAfter: number | null = null;
    let freeSparksUsed = 0;
    let paidSparksUsed = 0;
    let freeSparksRefunded = 0;
    let paidSparksRefunded = 0;

    if (!bucketAccountingEnabled) {
      effectiveCost = isFreeUser ? Math.min(currentSparks + preAuthDeduction, Math.max(0, actualCost)) : 0;
      refundDelta = isFreeUser ? preAuthDeduction - effectiveCost : 0;
      newBalance = isFreeUser ? Math.max(0, currentSparks + refundDelta) : currentSparks;

      if (isFreeUser) {
        t.set(
          userRef,
          {
            ai_sparks: newBalance,
            total_sparks_used: admin.firestore.FieldValue.increment(effectiveCost)
          },
          { merge: true }
        );
      }
    } else {
      const preAuthFreeSparks = Math.max(0, Number(preAuthData.preAuthFreeSparks ?? 0));
      const preAuthPaidSparks = Math.max(0, Number(preAuthData.preAuthPaidSparks ?? 0));
      const currentFree = Math.max(0, Number(userData.free_sparks ?? 0));
      const currentPaid = Math.max(0, Number(userData.paid_sparks ?? 0));

      freeBalanceBefore = currentFree;
      paidBalanceBefore = currentPaid;

      // Reconstitute the pool available across current balances + escrowed pre-auth buckets
      const poolFree = currentFree + preAuthFreeSparks;
      const poolPaid = currentPaid + preAuthPaidSparks;
      const poolTotal = poolFree + poolPaid;

      effectiveCost = isFreeUser ? Math.min(poolTotal, Math.max(0, actualCost)) : 0;
      freeSparksUsed = isFreeUser ? Math.min(poolFree, effectiveCost) : 0;
      paidSparksUsed = isFreeUser ? effectiveCost - freeSparksUsed : 0;

      freeBalanceAfter = poolFree - freeSparksUsed;
      paidBalanceAfter = poolPaid - paidSparksUsed;
      newBalance = freeBalanceAfter + paidBalanceAfter;

      freeSparksRefunded = preAuthFreeSparks - freeSparksUsed;
      paidSparksRefunded = preAuthPaidSparks - paidSparksUsed;
      refundDelta = freeSparksRefunded + paidSparksRefunded;

      if (
        freeBalanceAfter < 0 ||
        paidBalanceAfter < 0 ||
        newBalance !== freeBalanceAfter + paidBalanceAfter
      ) {
        throw new Error(
          `Bucket sum invariant violation in SETTLE: ai_sparks (${newBalance}) !== free_sparks (${freeBalanceAfter}) + paid_sparks (${paidBalanceAfter})`
        );
      }

      if (isFreeUser) {
        t.set(
          userRef,
          {
            free_sparks: freeBalanceAfter,
            paid_sparks: paidBalanceAfter,
            ai_sparks: newBalance,
            total_sparks_used: admin.firestore.FieldValue.increment(effectiveCost)
          },
          { merge: true }
        );
      }
    }

    const pricingData = pricingSnap.exists ? pricingSnap.data() : null;
    const policyData = policySnap.exists ? policySnap.data() : null;
    const pricingStaleAfterDays =
      typeof policyData?.pricingStaleAfterDays === 'number' ? policyData.pricingStaleAfterDays : 14;
    const impliedRevenuePerSparkUsd =
      typeof pricingData?.impliedRevenuePerSparkUsd === 'number' && pricingData.impliedRevenuePerSparkUsd > 0
        ? pricingData.impliedRevenuePerSparkUsd
        : null;
    const pricingVersion =
      typeof pricingData?.pricingVersion === 'number' ? pricingData.pricingVersion : null;
    const providerPricingEntry: TokenPricingRateEntry | null = pricingData?.rates?.[providerUsed] || null;

    const marginMetrics = computeSparkMarginMetrics(
      providerUsed,
      totalTokens,
      effectiveCost,
      complexity,
      providerPricingEntry,
      pricingStaleAfterDays,
      impliedRevenuePerSparkUsd,
      {
        paidSparksUsed,
        bucketSource,
        pricingVersion
      }
    );

    const now = new Date();
    // Transition PRE_AUTH state machine node to SETTLED
    t.set(
      preAuthRef,
      {
        state: 'SETTLED',
        settledAtIso: now.toISOString()
      },
      { merge: true }
    );

    const costDesc =
      marginMetrics.estimatedCostUsd !== null
        ? `$${marginMetrics.estimatedCostUsd}`
        : marginMetrics.costStatus;

    const ledgerEntry: SparkLedgerEntry = {
      id: settleDocId,
      idempotency_token: idempotencyToken,
      uid,
      userEmail: userData.email || userEmail || 'unknown@uniace.edu',
      action: 'SETTLE',
      state: 'SETTLED',
      delta: refundDelta,
      preAuthAmount: preAuthDeduction,
      actualCost: effectiveCost,
      balanceBefore: currentSparks,
      balanceAfter: newBalance,
      bucketAccountingEnabled,
      bucketSource,
      freeBalanceBefore,
      freeBalanceAfter,
      paidBalanceBefore,
      paidBalanceAfter,
      preAuthFreeSparks: Number(preAuthData.preAuthFreeSparks ?? 0),
      preAuthPaidSparks: Number(preAuthData.preAuthPaidSparks ?? 0),
      freeSparksUsed,
      paidSparksUsed,
      freeSparksRefunded,
      paidSparksRefunded,
      complexity,
      endpoint,
      providerUsed,
      tokens: typeof totalTokens === 'number' && totalTokens > 0 ? totalTokens : null,
      costStatus: marginMetrics.costStatus,
      pricingVersion: marginMetrics.pricingVersion,
      snapshotStandardUsdPer1k: marginMetrics.snapshotStandardUsdPer1k,
      snapshotHighUsdPer1k: marginMetrics.snapshotHighUsdPer1k,
      appliedRateUsdPer1k: marginMetrics.appliedRateUsdPer1k,
      snapshotImpliedRevenuePerSparkUsd: marginMetrics.snapshotImpliedRevenuePerSparkUsd,
      estimatedCostUsd: marginMetrics.estimatedCostUsd,
      estimatedRevenueUsd: marginMetrics.estimatedRevenueUsd,
      grossMarginUsd: marginMetrics.grossMarginUsd,
      pricingStale: marginMetrics.pricingStale,
      pricingSourceUrl: marginMetrics.pricingSourceUrl,
      pricingLastVerifiedAt: marginMetrics.pricingLastVerifiedAt,
      planType,
      role,
      reason: `Escrow settlement (${totalTokens ?? 'COST_UNKNOWN'} tokens via ${providerUsed}, net cost: ${effectiveCost} sparks [free: ${freeSparksUsed}, paid: ${paidSparksUsed}], est USD cost: ${costDesc}${marginMetrics.pricingStale ? ' [STALE_PRICING_RATE]' : ''})`,
      createdAtIso: now.toISOString(),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    t.set(settleRef, ledgerEntry);

    return {
      finalSparks: isFreeUser ? newBalance : 999999,
      freeSparks: freeBalanceAfter,
      paidSparks: paidBalanceAfter,
      actualCost: effectiveCost,
      freeSparksUsed,
      paidSparksUsed,
      refundDelta,
      alreadySettled: false,
      bucketAccountingEnabled,
      bucketSource,
      costStatus: marginMetrics.costStatus,
      estimatedCostUsd: marginMetrics.estimatedCostUsd,
      estimatedRevenueUsd: marginMetrics.estimatedRevenueUsd,
      grossMarginUsd: marginMetrics.grossMarginUsd,
      pricingStale: marginMetrics.pricingStale
    };
  });
}

export interface RefundParams {
  app: admin.app.App;
  uid: string;
  userEmail?: string | null;
  idempotencyToken: string;
  isFreeUser: boolean;
  fallbackPreAuthDeduction: number;
  attemptFee?: number;
  complexity: string;
  endpoint: SparkLedgerEndpoint;
  planType: string;
  role: string;
  reason: string;
  sandboxNamespace?: string;
}

export interface RefundTransactionResult {
  refundedSparks: number;
  freeSparksRefunded: number;
  paidSparksRefunded: number;
  newBalance: number;
  freeSparks: number | null;
  paidSparks: number | null;
  bucketAccountingEnabled: boolean;
  alreadyProcessed: boolean;
}

/**
 * STEP 3: Atomic Error/Abort Refund with Append-Only Spark Ledger (`REFUND`).
 * - Reads `bucketAccountingEnabled` from `${idempotencyToken}_PRE_AUTH` (never live config).
 * - Restores unused `preAuthFreeSparks` and `preAuthPaidSparks` to the exact buckets they were deducted from
 *   so an abort refund can NEVER launder paid Sparks into free ones or vice versa.
 */
export async function executeSparkRefund(
  params: RefundParams
): Promise<RefundTransactionResult> {
  const {
    app,
    uid,
    userEmail,
    idempotencyToken,
    isFreeUser,
    fallbackPreAuthDeduction,
    attemptFee = 0,
    complexity,
    endpoint,
    planType,
    role,
    reason
  } = params;

  const db = app.firestore();
  const ns = params.sandboxNamespace;
  const userRef = getLedgerScopedCollection(db, 'users', ns).doc(uid);
  const preAuthDocId = `${idempotencyToken}_PRE_AUTH`;
  const settleDocId = `${idempotencyToken}_SETTLE`;
  const refundDocId = `${idempotencyToken}_REFUND`;

  const preAuthRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(preAuthDocId);
  const settleRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(settleDocId);
  const refundRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(refundDocId);

  return await db.runTransaction(async (t) => {
    const [preAuthSnap, settleSnap, refundSnap, userSnap] = await Promise.all([
      t.get(preAuthRef),
      t.get(settleRef),
      t.get(refundRef),
      t.get(userRef)
    ]);

    const userData = userSnap.data() || {};
    const currentSparks = Math.max(0, Number(userData.ai_sparks ?? 0));
    const preAuthData = preAuthSnap.exists ? preAuthSnap.data() || {} : {};
    const preAuthState = preAuthSnap.exists ? preAuthData.state : null;

    // Strict State-Machine Mutual Exclusion: Never refund if already refunded, already settled, or never pre-authorized
    if (refundSnap.exists || preAuthState === 'REFUNDED') {
      const existingRefund = refundSnap.data() || {};
      return {
        refundedSparks: existingRefund.delta ?? 0,
        freeSparksRefunded: existingRefund.freeSparksRefunded ?? 0,
        paidSparksRefunded: existingRefund.paidSparksRefunded ?? 0,
        newBalance: isFreeUser ? (existingRefund.balanceAfter ?? currentSparks) : 999999,
        freeSparks: existingRefund.freeBalanceAfter ?? userData.free_sparks ?? null,
        paidSparks: existingRefund.paidBalanceAfter ?? userData.paid_sparks ?? null,
        bucketAccountingEnabled: Boolean(existingRefund.bucketAccountingEnabled),
        alreadyProcessed: true
      };
    }

    if (settleSnap.exists || preAuthState === 'SETTLED' || !preAuthSnap.exists) {
      return {
        refundedSparks: 0,
        freeSparksRefunded: 0,
        paidSparksRefunded: 0,
        newBalance: isFreeUser ? currentSparks : 999999,
        freeSparks: userData.free_sparks ?? null,
        paidSparks: userData.paid_sparks ?? null,
        bucketAccountingEnabled: Boolean(preAuthData.bucketAccountingEnabled),
        alreadyProcessed: true
      };
    }

    const bucketAccountingEnabled = Boolean(preAuthData.bucketAccountingEnabled);
    const bucketSource: SparkBucketSource =
      bucketAccountingEnabled
        ? ((preAuthData.bucketSource as SparkBucketSource) ||
          (userData.bucketSource as SparkBucketSource) ||
          'derived')
        : 'legacy_off';

    const preAuthDeduction = Number(preAuthData.preAuthAmount ?? fallbackPreAuthDeduction);
    const feeCharged = isFreeUser ? Math.min(preAuthDeduction, Math.max(0, attemptFee)) : 0;
    const refundBack = isFreeUser ? Math.max(0, preAuthDeduction - feeCharged) : 0;

    let newBalance = isFreeUser ? currentSparks + refundBack : currentSparks;
    let freeBalanceBefore: number | null = null;
    let freeBalanceAfter: number | null = null;
    let paidBalanceBefore: number | null = null;
    let paidBalanceAfter: number | null = null;
    let freeSparksUsed = 0;
    let paidSparksUsed = 0;
    let freeSparksRefunded = 0;
    let paidSparksRefunded = 0;

    const userUpdates: Record<string, any> = {
      last_request_at: new Date(0)
    };

    if (!bucketAccountingEnabled) {
      if (isFreeUser && refundBack > 0) {
        userUpdates.ai_sparks = newBalance;
      }
    } else {
      const preAuthFreeSparks = Math.max(0, Number(preAuthData.preAuthFreeSparks ?? 0));
      const preAuthPaidSparks = Math.max(0, Number(preAuthData.preAuthPaidSparks ?? 0));
      const currentFree = Math.max(0, Number(userData.free_sparks ?? 0));
      const currentPaid = Math.max(0, Number(userData.paid_sparks ?? 0));

      freeBalanceBefore = currentFree;
      paidBalanceBefore = currentPaid;

      freeSparksUsed = isFreeUser ? Math.min(preAuthFreeSparks, feeCharged) : 0;
      paidSparksUsed = isFreeUser ? feeCharged - freeSparksUsed : 0;
      freeSparksRefunded = isFreeUser ? preAuthFreeSparks - freeSparksUsed : 0;
      paidSparksRefunded = isFreeUser ? preAuthPaidSparks - paidSparksUsed : 0;

      freeBalanceAfter = currentFree + freeSparksRefunded;
      paidBalanceAfter = currentPaid + paidSparksRefunded;
      newBalance = freeBalanceAfter + paidBalanceAfter;

      if (
        freeBalanceAfter < 0 ||
        paidBalanceAfter < 0 ||
        newBalance !== freeBalanceAfter + paidBalanceAfter
      ) {
        throw new Error(
          `Bucket sum invariant violation in REFUND: ai_sparks (${newBalance}) !== free_sparks (${freeBalanceAfter}) + paid_sparks (${paidBalanceAfter})`
        );
      }

      if (isFreeUser) {
        userUpdates.free_sparks = freeBalanceAfter;
        userUpdates.paid_sparks = paidBalanceAfter;
        userUpdates.ai_sparks = newBalance;
      }
    }

    t.set(userRef, userUpdates, { merge: true });

    const now = new Date();
    // Transition PRE_AUTH state machine node to REFUNDED
    t.set(
      preAuthRef,
      {
        state: 'REFUNDED',
        refundedAtIso: now.toISOString()
      },
      { merge: true }
    );

    const ledgerEntry: SparkLedgerEntry = {
      id: refundDocId,
      idempotency_token: idempotencyToken,
      uid,
      userEmail: userData.email || userEmail || 'unknown@uniace.edu',
      action: 'REFUND',
      state: 'REFUNDED',
      delta: refundBack,
      preAuthAmount: preAuthDeduction,
      actualCost: feeCharged,
      balanceBefore: currentSparks,
      balanceAfter: newBalance,
      bucketAccountingEnabled,
      bucketSource,
      freeBalanceBefore,
      freeBalanceAfter,
      paidBalanceBefore,
      paidBalanceAfter,
      preAuthFreeSparks: Number(preAuthData.preAuthFreeSparks ?? 0),
      preAuthPaidSparks: Number(preAuthData.preAuthPaidSparks ?? 0),
      freeSparksUsed,
      paidSparksUsed,
      freeSparksRefunded,
      paidSparksRefunded,
      complexity,
      endpoint,
      providerUsed: null,
      tokens: null,
      costStatus: 'COST_UNKNOWN',
      estimatedCostUsd: null,
      estimatedRevenueUsd: null,
      grossMarginUsd: null,
      planType,
      role,
      reason: `Escrow refund: ${reason}`,
      createdAtIso: now.toISOString(),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    t.set(refundRef, ledgerEntry);

    return {
      refundedSparks: refundBack,
      freeSparksRefunded,
      paidSparksRefunded,
      newBalance: isFreeUser ? newBalance : 999999,
      freeSparks: freeBalanceAfter,
      paidSparks: paidBalanceAfter,
      bucketAccountingEnabled,
      alreadyProcessed: false
    };
  });
}

export interface QualityBountyParams {
  app: admin.app.App;
  uid: string;
  userEmail?: string | null;
  idempotencyToken: string;
  fallbackSparksCharged: number;
  isFirstReporter: boolean;
  bonusSparks: number;
  reportId: string;
  reviewerNotes: string;
  sandboxNamespace?: string;
}

export interface QualityBountyResult {
  creditedSparks: number;
  queryRefundSparks: number;
  freeSparksRefunded: number;
  paidSparksRefunded: number;
  bonusSparksAwarded: number;
  newBalance: number;
  freeSparks: number | null;
  paidSparks: number | null;
  bucketAccountingEnabled: boolean;
  alreadyCredited: boolean;
}

/**
 * STEP 4: Atomic Post-Settle `QUALITY_BOUNTY` Restitution.
 * - Reads `bucketAccountingEnabled` from the parent `_SETTLE` / `_PRE_AUTH` document.
 * - Restores settled `freeSparksUsed` and `paidSparksUsed` to their respective buckets,
 *   and credits `bonusSparksAwarded` strictly to `free_sparks`.
 * - Enforces `ai_sparks === free_sparks + paid_sparks`.
 */
export async function executeQualityBountyRefund(
  params: QualityBountyParams
): Promise<QualityBountyResult> {
  const {
    app,
    uid,
    userEmail,
    idempotencyToken,
    fallbackSparksCharged,
    isFirstReporter,
    bonusSparks,
    reportId,
    reviewerNotes
  } = params;

  const db = app.firestore();
  const ns = params.sandboxNamespace;
  const userRef = getLedgerScopedCollection(db, 'users', ns).doc(uid);
  const safeToken = idempotencyToken && idempotencyToken.trim()
    ? idempotencyToken.trim()
    : `report_${reportId}`;

  const preAuthRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(`${safeToken}_PRE_AUTH`);
  const settleRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(`${safeToken}_SETTLE`);
  const refundRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(`${safeToken}_REFUND`);
  const bountyDocId = `${safeToken}_QUALITY_BOUNTY`;
  const bountyRef = getLedgerScopedCollection(db, 'spark_ledger', ns).doc(bountyDocId);

  return await db.runTransaction(async (t) => {
    const [preAuthSnap, settleSnap, refundSnap, bountySnap, userSnap] = await Promise.all([
      t.get(preAuthRef),
      t.get(settleRef),
      t.get(refundRef),
      t.get(bountyRef),
      t.get(userRef)
    ]);

    const userData = userSnap.data() || {};
    const currentSparks = Math.max(0, Number(userData.ai_sparks ?? 0));

    // Idempotency guard: if this token already received a QUALITY_BOUNTY, return existing state
    if (bountySnap.exists) {
      const existing = bountySnap.data() || {};
      return {
        creditedSparks: existing.delta ?? 0,
        queryRefundSparks: existing.actualCost ?? 0,
        freeSparksRefunded: existing.freeSparksRefunded ?? 0,
        paidSparksRefunded: existing.paidSparksRefunded ?? 0,
        bonusSparksAwarded: existing.bonusSparksAwarded ?? Math.max(0, (existing.delta ?? 0) - (existing.actualCost ?? 0)),
        newBalance: existing.balanceAfter ?? currentSparks,
        freeSparks: existing.freeBalanceAfter ?? userData.free_sparks ?? null,
        paidSparks: existing.paidBalanceAfter ?? userData.paid_sparks ?? null,
        bucketAccountingEnabled: Boolean(existing.bucketAccountingEnabled),
        alreadyCredited: true
      };
    }

    // State-Machine Guard: If the stream was aborted/refunded (`_REFUND` exists or `PRE_AUTH` state is `REFUNDED`),
    // reject stacking a second refund.
    const preAuthData = preAuthSnap.exists ? preAuthSnap.data() || {} : {};
    const preAuthState = preAuthSnap.exists ? preAuthData.state : null;
    if (refundSnap.exists || preAuthState === 'REFUNDED') {
      throw new Error('Cannot credit QUALITY_BOUNTY: the original query stream was aborted and already refunded.');
    }

    const settleData = settleSnap.exists ? settleSnap.data() || {} : {};

    // Determine exact query Sparks settled from `_SETTLE` ledger record
    let queryRefundSparks = 0;
    if (settleSnap.exists) {
      queryRefundSparks = typeof settleData.actualCost === 'number' ? Math.max(0, settleData.actualCost) : 0;
    } else if (!idempotencyToken) {
      queryRefundSparks = Math.max(0, fallbackSparksCharged);
    } else {
      throw new Error('Cannot credit QUALITY_BOUNTY: no settled Spark transaction found for this query.');
    }

    const bucketAccountingEnabled = Boolean(
      settleSnap.exists
        ? settleData.bucketAccountingEnabled
        : preAuthSnap.exists
          ? preAuthData.bucketAccountingEnabled
          : userData.bucket_tracking_initialized
    );
    const bucketSource: SparkBucketSource =
      bucketAccountingEnabled
        ? ((settleData.bucketSource as SparkBucketSource) ||
          (userData.bucketSource as SparkBucketSource) ||
          'derived')
        : 'legacy_off';

    const effectiveBonus = isFirstReporter ? Math.max(0, bonusSparks) : 0;
    const totalCredited = queryRefundSparks + effectiveBonus;
    let newBalance = currentSparks + totalCredited;

    let freeBalanceBefore: number | null = null;
    let freeBalanceAfter: number | null = null;
    let paidBalanceBefore: number | null = null;
    let paidBalanceAfter: number | null = null;
    let freeSparksRefunded = 0;
    let paidSparksRefunded = 0;

    if (!bucketAccountingEnabled) {
      if (totalCredited > 0) {
        t.set(
          userRef,
          {
            ai_sparks: newBalance
          },
          { merge: true }
        );
      }
    } else {
      const currentFree = Math.max(0, Number(userData.free_sparks ?? 0));
      const currentPaid = Math.max(0, Number(userData.paid_sparks ?? 0));
      freeBalanceBefore = currentFree;
      paidBalanceBefore = currentPaid;

      if (settleSnap.exists && (typeof settleData.freeSparksUsed === 'number' || typeof settleData.paidSparksUsed === 'number')) {
        freeSparksRefunded = Math.max(0, Number(settleData.freeSparksUsed ?? 0));
        paidSparksRefunded = Math.max(0, Number(settleData.paidSparksUsed ?? 0));
      } else {
        freeSparksRefunded = queryRefundSparks;
        paidSparksRefunded = 0;
      }

      // Bonus Sparks are always free promotional Sparks (never paid Sparks)
      freeBalanceAfter = currentFree + freeSparksRefunded + effectiveBonus;
      paidBalanceAfter = currentPaid + paidSparksRefunded;
      newBalance = freeBalanceAfter + paidBalanceAfter;

      if (
        freeBalanceAfter < 0 ||
        paidBalanceAfter < 0 ||
        newBalance !== freeBalanceAfter + paidBalanceAfter
      ) {
        throw new Error(
          `Bucket sum invariant violation in QUALITY_BOUNTY: ai_sparks (${newBalance}) !== free_sparks (${freeBalanceAfter}) + paid_sparks (${paidBalanceAfter})`
        );
      }

      if (totalCredited > 0) {
        t.set(
          userRef,
          {
            free_sparks: freeBalanceAfter,
            paid_sparks: paidBalanceAfter,
            ai_sparks: newBalance
          },
          { merge: true }
        );
      }
    }

    const now = new Date();
    if (settleSnap.exists) {
      t.set(
        settleRef,
        {
          state: 'BOUNTY_CREDITED',
          bountyCreditedAtIso: now.toISOString(),
          bountyReportId: reportId
        },
        { merge: true }
      );
    }

    const snapshotImpliedRate =
      typeof settleData.snapshotImpliedRevenuePerSparkUsd === 'number'
        ? settleData.snapshotImpliedRevenuePerSparkUsd
        : null;
    const refundedPaidRevenueUsd =
      bucketSource === 'tracked' && paidSparksRefunded > 0 && snapshotImpliedRate !== null
        ? -Number((paidSparksRefunded * snapshotImpliedRate).toFixed(6))
        : bucketSource === 'tracked' && paidSparksRefunded === 0
          ? 0
          : null;

    const ledgerEntry: SparkLedgerEntry = {
      id: bountyDocId,
      idempotency_token: safeToken,
      uid,
      userEmail: userData.email || userEmail || 'unknown@uniace.edu',
      action: 'QUALITY_BOUNTY',
      state: 'BOUNTY_CREDITED',
      delta: totalCredited,
      preAuthAmount: 0,
      actualCost: queryRefundSparks,
      balanceBefore: currentSparks,
      balanceAfter: newBalance,
      bucketAccountingEnabled,
      bucketSource,
      freeBalanceBefore,
      freeBalanceAfter,
      paidBalanceBefore,
      paidBalanceAfter,
      freeSparksRefunded,
      paidSparksRefunded,
      bonusSparksAwarded: effectiveBonus,
      complexity: settleData.complexity || 'standard',
      endpoint: 'quality_bounty',
      providerUsed: settleData.providerUsed || null,
      tokens: settleData.tokens || null,
      snapshotImpliedRevenuePerSparkUsd: snapshotImpliedRate,
      estimatedCostUsd: 0,
      estimatedRevenueUsd: refundedPaidRevenueUsd,
      grossMarginUsd: refundedPaidRevenueUsd,
      planType: userData.plan_type || 'free',
      role: userData.role || 'student',
      reason: `Verified wrong-answer report (${reportId}): +${queryRefundSparks} query refund [free: +${freeSparksRefunded}, paid: +${paidSparksRefunded}] + ${effectiveBonus} first-reporter bonus (free bucket). ${reviewerNotes || ''}`.trim(),
      createdAtIso: now.toISOString(),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    t.set(bountyRef, ledgerEntry);

    return {
      creditedSparks: totalCredited,
      queryRefundSparks,
      freeSparksRefunded,
      paidSparksRefunded,
      bonusSparksAwarded: effectiveBonus,
      newBalance,
      freeSparks: freeBalanceAfter,
      paidSparks: paidBalanceAfter,
      bucketAccountingEnabled,
      alreadyCredited: false
    };
  });
}

export interface LegacyBucketBackfillUserPreview {
  uid: string;
  email: string | null;
  aiSparks: number;
  totalPurchasedSparks: number;
  allocatedPaidSparks: number;
  allocatedFreeSparks: number;
  previousBucketSource: string | null;
  newBucketSource: 'backfilled_estimate';
}

export interface LegacyBucketBackfillResult {
  mode: 'dry_run' | 'commit';
  scannedUsers: number;
  eligibleLegacyUsers: number;
  migratedUsers: number;
  totalPaidSparksAllocated: number;
  totalFreeSparksAllocated: number;
  previews: LegacyBucketBackfillUserPreview[];
  auditedAt: string;
}

/**
 * One-Time Legacy User Bucket Backfill from verified `payments`.
 * Marks all backfilled users as `bucketSource: 'backfilled_estimate'` (NEVER `'tracked'`)
 * so heuristic payment allocations are kept strictly out of the tracked estimated-revenue KPI.
 */
export async function executeBackfillUserSparkBuckets(params: {
  app: admin.app.App;
  mode: 'dry_run' | 'commit';
  adminUid: string;
  adminEmail: string;
  reason?: string;
  sandboxNamespace?: string;
}): Promise<LegacyBucketBackfillResult> {
  const { app, mode, adminUid, adminEmail, reason, sandboxNamespace } = params;
  const db = app.firestore();
  const nowIso = new Date().toISOString();
  const usersCol = getLedgerScopedCollection(db, 'users', sandboxNamespace);
  const paymentsCol = getLedgerScopedCollection(db, 'payments', sandboxNamespace);
  const auditCol = getLedgerScopedCollection(db, 'system_config_audit', sandboxNamespace);

  const [usersSnap, paymentsSnap] = await Promise.all([
    usersCol.get(),
    paymentsCol.where('status', '==', 'success').get()
  ]);

  const purchasedByUid = new Map<string, number>();
  for (const pDoc of paymentsSnap.docs) {
    const p = pDoc.data();
    if (p.uid && typeof p.sparks_added === 'number' && p.sparks_added > 0 && p.disputeStatus !== 'lost') {
      const netSparks = Math.max(0, p.sparks_added - Number(p.sparks_clawed_back || 0));
      purchasedByUid.set(p.uid, (purchasedByUid.get(p.uid) || 0) + netSparks);
    }
  }

  const previews: LegacyBucketBackfillUserPreview[] = [];
  let totalPaidSparksAllocated = 0;
  let totalFreeSparksAllocated = 0;

  for (const uDoc of usersSnap.docs) {
    const u = uDoc.data();
    const isAlreadyTrackedOrBackfilled =
      u.bucket_tracking_initialized === true &&
      (u.bucketSource === 'tracked' || u.bucketSource === 'backfilled_estimate') &&
      typeof u.free_sparks === 'number' &&
      typeof u.paid_sparks === 'number' &&
      u.ai_sparks === u.free_sparks + u.paid_sparks;

    if (isAlreadyTrackedOrBackfilled) {
      continue;
    }

    const aiSparks = Math.max(0, Number(u.ai_sparks ?? 0));
    const totalPurchasedSparks = purchasedByUid.get(uDoc.id) || 0;
    const allocatedPaidSparks = Math.min(aiSparks, totalPurchasedSparks);
    const allocatedFreeSparks = Math.max(0, aiSparks - allocatedPaidSparks);

    if (aiSparks !== allocatedFreeSparks + allocatedPaidSparks) {
      throw new Error(`Backfill invariant check failed for user ${uDoc.id}`);
    }

    totalPaidSparksAllocated += allocatedPaidSparks;
    totalFreeSparksAllocated += allocatedFreeSparks;

    previews.push({
      uid: uDoc.id,
      email: u.email || null,
      aiSparks,
      totalPurchasedSparks,
      allocatedPaidSparks,
      allocatedFreeSparks,
      previousBucketSource: u.bucketSource || null,
      newBucketSource: 'backfilled_estimate'
    });
  }

  let migratedUsers = 0;
  if (mode === 'commit' && previews.length > 0) {
    const BATCH_LIMIT = 400;
    for (let i = 0; i < previews.length; i += BATCH_LIMIT) {
      const slice = previews.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      for (const item of slice) {
        const ref = usersCol.doc(item.uid);
        batch.set(
          ref,
          {
            free_sparks: item.allocatedFreeSparks,
            paid_sparks: item.allocatedPaidSparks,
            ai_sparks: item.allocatedFreeSparks + item.allocatedPaidSparks,
            bucket_tracking_initialized: true,
            bucketSource: 'backfilled_estimate',
            bucket_backfilled_at: nowIso
          },
          { merge: true }
        );
      }
      await batch.commit();
      migratedUsers += slice.length;
    }

    await auditCol.add({
      configType: 'spark_bucket_backfill',
      action: 'LEGACY_USER_BUCKET_BACKFILL',
      actorUid: adminUid,
      actorEmail: adminEmail || 'unknown@uniace.edu',
      reason: (reason || 'One-time legacy user Spark bucket backfill (marked backfilled_estimate)').trim(),
      summary: {
        scannedUsers: usersSnap.size,
        eligibleLegacyUsers: previews.length,
        migratedUsers,
        totalPaidSparksAllocated,
        totalFreeSparksAllocated
      },
      createdAtIso: nowIso,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  return {
    mode,
    scannedUsers: usersSnap.size,
    eligibleLegacyUsers: previews.length,
    migratedUsers,
    totalPaidSparksAllocated,
    totalFreeSparksAllocated,
    previews: previews.slice(0, 100),
    auditedAt: nowIso
  };
}

export interface TransactionalPaymentSuccessResult {
  alreadyProcessed: boolean;
  uid: string;
  reference: string;
  amountNgn: number;
  amountUsd: number | null;
  snapshotNgnPerUsdRate: number | null;
  fxVersion: number | null;
  fxStatus: 'VERIFIED' | 'FX_UNCONFIGURED';
  sparksAdded: number;
  newAiSparks: number;
  newFreeSparks: number | null;
  newPaidSparks: number | null;
  bucketAccountingEnabled: boolean;
  planName: string;
  isTopUp: boolean;
  durationDays: number;
  affiliateCredited: boolean;
  affiliateRefCode: string | null;
  commissionAmount: number;
}

/**
 * Helper to dynamically parse numeric sparks from plan data
 */
function parsePlanSparksValue(rawSparks: any, defaultSparks: number): number {
  if (typeof rawSparks === 'number' && !isNaN(rawSparks) && rawSparks > 0) {
    return rawSparks;
  }
  if (typeof rawSparks === 'string') {
    const parsed = parseInt(rawSparks.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return defaultSparks;
}

/**
 * Helper to dynamically determine duration in days and whether it is a top-up
 */
function parsePlanDurationValue(durationStr: string, planId: string): { durationDays: number; isTopUp: boolean } {
  const normPlanId = (planId || '').toLowerCase().trim();
  const normDuration = (durationStr || '').toLowerCase().trim();

  if (
    normPlanId === 'emergency_topup' ||
    normPlanId.includes('topup') ||
    normPlanId.includes('top_up') ||
    normDuration.includes('one-time') ||
    normDuration.includes('top-up')
  ) {
    return { durationDays: 0, isTopUp: true };
  }

  const daysMatch = normDuration.match(/(\d+)\s*(?:day|days)/);
  if (daysMatch && daysMatch[1]) {
    const days = parseInt(daysMatch[1], 10);
    if (!isNaN(days) && days > 0) {
      return { durationDays: days, isTopUp: false };
    }
  }

  if (normPlanId === 'semester' || normDuration.includes('semester')) {
    return { durationDays: 120, isTopUp: false };
  }

  if (normPlanId === 'scholar' || normDuration.includes('month') || normDuration.includes('30')) {
    return { durationDays: 30, isTopUp: false };
  }

  if (normDuration.includes('year') || normDuration.includes('annual')) {
    return { durationDays: 365, isTopUp: false };
  }

  return { durationDays: 30, isTopUp: false };
}

/**
 * Atomic, race-proof payment processor (`executeTransactionalPaymentSuccess`):
 * - Checks `payments/{reference}` idempotency INSIDE `db.runTransaction` so concurrent
 *   `/api/verify-payment` and `/api/paystack-webhook` calls cannot double-credit Sparks.
 * - Snapshots FX rate (`snapshotNgnPerUsdRate`, `fxVersion`, `fxSourceUrl`, `amountUsd`,
 *   `fxStatus: 'VERIFIED' | 'FX_UNCONFIGURED'`) from `system_config/token_pricing` at payment time.
 * - Credits `paid_sparks` + `ai_sparks` when `enableSparkBucketLedger` is enabled (enforcing
 *   `ai_sparks === free_sparks + paid_sparks`), or increments `ai_sparks` when disabled.
 * - Keeps affiliate commission resolution, affiliate earnings writes, and non-core side effects
 *   strictly OUTSIDE the core payment transaction (with their own idempotent transaction on
 *   `affiliate_earnings/${refCode}_${reference}`) so affiliate/email issues can never abort
 *   crediting a student's paid Sparks.
 */
export async function executeTransactionalPaymentSuccess(params: {
  app: admin.app.App;
  uid: string;
  reference: string;
  amount: number;
  planType: string;
  metadata?: any;
  commissionRateOverride?: number;
  simulateAffiliateFailureForTest?: boolean;
  sandboxNamespace?: string;
}): Promise<TransactionalPaymentSuccessResult> {
  const {
    app,
    uid,
    reference,
    amount,
    planType,
    metadata,
    commissionRateOverride,
    simulateAffiliateFailureForTest,
    sandboxNamespace
  } = params;

  const db = app.firestore();
  const paymentsCol = getLedgerScopedCollection(db, 'payments', sandboxNamespace);
  const usersCol = getLedgerScopedCollection(db, 'users', sandboxNamespace);
  const configCol = getLedgerScopedCollection(db, 'system_config', sandboxNamespace);
  const affiliatesCol = getLedgerScopedCollection(db, 'affiliates', sandboxNamespace);
  const earningsCol = getLedgerScopedCollection(db, 'affiliate_earnings', sandboxNamespace);
  const settingsCol = getLedgerScopedCollection(db, 'settings', sandboxNamespace);

  const paymentDocRef = paymentsCol.doc(reference);
  const userRef = usersCol.doc(uid);
  const policyRef = configCol.doc('evaluation_policy');
  const tokenPricingRef = configCol.doc('token_pricing');

  // 1. Read-only dynamic plan resolution outside transaction
  let matchedPlan: any = null;
  try {
    const pricingDoc = await configCol.doc('pricing').get();
    if (pricingDoc.exists) {
      const pricingData = pricingDoc.data();
      if (Array.isArray(pricingData?.plans)) {
        matchedPlan = pricingData.plans.find(
          (p: any) =>
            p.id === planType ||
            p.id?.toLowerCase() === planType?.toLowerCase() ||
            p.name?.toLowerCase() === planType?.toLowerCase()
        );
      }
    }
  } catch (err) {
    console.warn('Could not fetch dynamic pricing config from Firestore, falling back to canonical defaults:', err);
  }

  const CANONICAL_PLANS: Record<string, { sparks: number; duration: string; name: string }> = {
    emergency_topup: { sparks: 500, duration: 'One-Time', name: 'Emergency Top-Up' },
    scholar: { sparks: 2000, duration: '30 Days', name: 'Scholar' },
    semester: { sparks: 6000, duration: '120 Days', name: 'Semester Bundle' }
  };

  const normPlanType = (planType || 'scholar').toLowerCase().trim();
  const canonicalFallback =
    CANONICAL_PLANS[normPlanType] ||
    (normPlanType.includes('semester')
      ? CANONICAL_PLANS.semester
      : normPlanType.includes('topup') || normPlanType.includes('emergency')
      ? CANONICAL_PLANS.emergency_topup
      : CANONICAL_PLANS.scholar);

  const rawSparks = matchedPlan?.sparks ?? canonicalFallback.sparks;
  const rawDuration = matchedPlan?.duration ?? canonicalFallback.duration;
  const planName = matchedPlan?.name ?? canonicalFallback.name;

  const sparksToAdd = parsePlanSparksValue(rawSparks, canonicalFallback.sparks);
  const { durationDays, isTopUp } = parsePlanDurationValue(rawDuration, planType);

  // 2. Core Payment & User Spark Credit Transaction (strictly isolated from affiliate/email side effects)
  const coreResult = await db.runTransaction(async (transaction) => {
    const [paymentDoc, userDoc, policyDoc, tokenPricingDoc] = await Promise.all([
      transaction.get(paymentDocRef),
      transaction.get(userRef),
      transaction.get(policyRef),
      transaction.get(tokenPricingRef)
    ]);

    if (!userDoc.exists) {
      throw new Error(`User ${uid} not found during payment processing`);
    }
    const userData = userDoc.data() || {};

    // Atomic Idempotency Gate inside Transaction
    if (paymentDoc.exists) {
      const existingPayment = paymentDoc.data() || {};
      const currentAiSparks = Math.max(0, Number(userData.ai_sparks ?? 0));
      return {
        alreadyProcessed: true,
        affiliateStatus: (existingPayment.affiliate_status || 'pending') as string,
        existingReferredBy: (existingPayment.referred_by || null) as string | null,
        existingCommissionAmount: Number(existingPayment.commission_amount ?? 0),
        userEmail: (userData.email || userData.secondary_email || null) as string | null,
        userReferredBy: (userData.referredBy || null) as string | null,
        amountNgn: Number(existingPayment.amountNgn ?? existingPayment.amount ?? amount),
        amountUsd: (existingPayment.amountUsd ?? null) as number | null,
        snapshotNgnPerUsdRate: (existingPayment.snapshotNgnPerUsdRate ?? null) as number | null,
        fxVersion: (existingPayment.fxVersion ?? null) as number | null,
        fxStatus: (existingPayment.fxStatus === 'VERIFIED' ? 'VERIFIED' : 'FX_UNCONFIGURED') as
          | 'VERIFIED'
          | 'FX_UNCONFIGURED',
        sparksAdded: Number(existingPayment.sparks_added ?? sparksToAdd),
        newAiSparks: currentAiSparks,
        newFreeSparks: typeof userData.free_sparks === 'number' ? userData.free_sparks : null,
        newPaidSparks: typeof userData.paid_sparks === 'number' ? userData.paid_sparks : null,
        bucketAccountingEnabled: Boolean(userData.bucket_tracking_initialized)
      };
    }

    const policyData = policyDoc.exists ? policyDoc.data() || {} : {};
    const tokenPricingData = tokenPricingDoc.exists ? tokenPricingDoc.data() || {} : {};

    // FX Snapshot (ZeroMock — null if unconfigured)
    const snapshotNgnPerUsdRate: number | null =
      typeof tokenPricingData.ngnPerUsdRate === 'number' &&
      Number.isFinite(tokenPricingData.ngnPerUsdRate) &&
      tokenPricingData.ngnPerUsdRate > 0
        ? tokenPricingData.ngnPerUsdRate
        : null;
    const fxVersion: number | null =
      typeof tokenPricingData.version === 'number' && Number.isFinite(tokenPricingData.version)
        ? tokenPricingData.version
        : null;
    const fxSourceUrl: string | null =
      typeof tokenPricingData.fxSourceUrl === 'string' && tokenPricingData.fxSourceUrl.trim()
        ? tokenPricingData.fxSourceUrl.trim()
        : null;

    const amountNgn = Number(amount);
    const amountUsd: number | null =
      snapshotNgnPerUsdRate !== null ? Number((amountNgn / snapshotNgnPerUsdRate).toFixed(6)) : null;
    const fxStatus: 'VERIFIED' | 'FX_UNCONFIGURED' =
      snapshotNgnPerUsdRate !== null ? 'VERIFIED' : 'FX_UNCONFIGURED';

    const now = new Date();
    const nowIso = now.toISOString();

    let expiryDate: Date | null = null;
    if (!isTopUp && durationDays > 0) {
      const currentExpiry = userData.subscription_expiry ? new Date(userData.subscription_expiry) : null;
      const isCurrentlyActive =
        currentExpiry && !isNaN(currentExpiry.getTime()) && currentExpiry.getTime() > now.getTime();
      if (isCurrentlyActive && userData.plan_type === planType) {
        expiryDate = new Date(currentExpiry.getTime() + durationDays * 24 * 60 * 60 * 1000);
      } else {
        expiryDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
      }
    }

    const currentSparks = Math.max(0, Number(userData.ai_sparks ?? 0));
    const bucketAccountingEnabled =
      Boolean(policyData.enableSparkBucketLedger) || userData.bucket_tracking_initialized === true;

    let newAiSparks: number;
    let newFreeSparks: number | null = null;
    let newPaidSparks: number | null = null;

    const userUpdatePayload: Record<string, any> = {
      last_payment_ref: reference,
      last_payment_date: nowIso,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    if (!bucketAccountingEnabled) {
      newAiSparks = currentSparks + sparksToAdd;
      userUpdatePayload.ai_sparks = newAiSparks;
    } else {
      if (userData.bucket_tracking_initialized === true) {
        newFreeSparks = Math.max(0, Number(userData.free_sparks ?? 0));
        newPaidSparks = Math.max(0, Number(userData.paid_sparks ?? 0)) + sparksToAdd;
      } else {
        const existingPaid = Math.max(0, Math.min(currentSparks, Number(userData.paid_sparks ?? 0)));
        newFreeSparks = Math.max(0, currentSparks - existingPaid);
        newPaidSparks = existingPaid + sparksToAdd;
        userUpdatePayload.bucket_tracking_initialized = true;
        userUpdatePayload.bucketSource =
          currentSparks === 0 ? 'tracked' : (userData.bucketSource || 'derived');
      }
      newAiSparks = newFreeSparks + newPaidSparks;
      if (newAiSparks !== newFreeSparks + newPaidSparks) {
        throw new Error(
          `Bucket sum invariant violation in payment credit: ai_sparks (${newAiSparks}) !== free_sparks (${newFreeSparks}) + paid_sparks (${newPaidSparks})`
        );
      }
      userUpdatePayload.free_sparks = newFreeSparks;
      userUpdatePayload.paid_sparks = newPaidSparks;
      userUpdatePayload.ai_sparks = newAiSparks;
    }

    if (!isTopUp) {
      userUpdatePayload.plan_type = planType;
      userUpdatePayload.subscription_status = 'active';
      userUpdatePayload.subscription_start_date = userData.subscription_start_date || nowIso;
      if (expiryDate) {
        userUpdatePayload.subscription_expiry = expiryDate.toISOString();
      }
    } else if (!userData.plan_type) {
      userUpdatePayload.plan_type = 'free';
    }

    const amountKobo = Math.round(amountNgn * 100);

    transaction.set(paymentDocRef, {
      uid,
      email: userData.email || userData.secondary_email || null,
      amount: amountNgn,
      amountNgn,
      amountKobo,
      amountUsd,
      snapshotNgnPerUsdRate,
      fxVersion,
      fxSourceUrl,
      fxStatus,
      plan_type: planType,
      plan_name: planName,
      is_topup: isTopUp,
      duration_days: durationDays,
      reference,
      status: 'success',
      createdAtIso: nowIso,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      sparks_added: sparksToAdd,
      sparks_clawed_back: 0,
      sparks_shortfall_unrecovered: 0,
      frozen_sparks: 0,
      refundedAmountNgn: 0,
      refundedAmountKobo: 0,
      refundedAmountUsd: 0,
      disputeStatus: 'none',
      referred_by: null,
      commission_amount: 0,
      affiliate_status: 'pending'
    });

    transaction.update(userRef, userUpdatePayload);

    return {
      alreadyProcessed: false,
      affiliateStatus: 'pending' as string,
      existingReferredBy: null as string | null,
      existingCommissionAmount: 0,
      userEmail: (userData.email || userData.secondary_email || null) as string | null,
      userReferredBy: (userData.referredBy || null) as string | null,
      amountNgn,
      amountUsd,
      snapshotNgnPerUsdRate,
      fxVersion,
      fxStatus,
      sparksAdded: sparksToAdd,
      newAiSparks,
      newFreeSparks,
      newPaidSparks,
      bucketAccountingEnabled
    };
  });

  // 3. Post-Commit Side Effects: Affiliate Commission Resolution & Idempotent Recovery
  // Runs even if `coreResult.alreadyProcessed === true` whenever `affiliateStatus` is still `'pending'`,
  // so if the server crashed after committing `payments/{reference}`, a subsequent retry/webhook
  // recovers and pays the affiliate commission idempotently via `affiliate_earnings/${refCode}_${reference}`!
  let affiliateCredited = false;
  let resolvedRefCode: string | null = coreResult.existingReferredBy;
  let commissionAmount = coreResult.existingCommissionAmount;

  if (coreResult.affiliateStatus !== 'credited' && coreResult.affiliateStatus !== 'not_applicable') {
    try {
      if (simulateAffiliateFailureForTest) {
        throw new Error('Simulated affiliate failure after core payment commit');
      }

      if (!resolvedRefCode && typeof coreResult.userReferredBy === 'string' && coreResult.userReferredBy.trim()) {
        resolvedRefCode = coreResult.userReferredBy.trim().toUpperCase();
      }

      if (!resolvedRefCode && metadata) {
        const metaRef = metadata.referredBy || metadata.refCode || metadata.referred_by || metadata.ref_code;
        if (typeof metaRef === 'string' && metaRef.trim()) {
          resolvedRefCode = metaRef.trim().toUpperCase();
        }
      }

      if (!resolvedRefCode && coreResult.userEmail) {
        try {
          const cleanEmail = coreResult.userEmail.toLowerCase().trim();
          const affByEmailSnap = await affiliatesCol.where('email', '==', cleanEmail).limit(1).get();
          if (!affByEmailSnap.empty) {
            resolvedRefCode = affByEmailSnap.docs[0].id.toUpperCase();
          }
        } catch (e) {
          console.warn('Affiliate email matching fallback failed:', e);
        }
      }

      if (resolvedRefCode) {
        let commissionRate = 0.30;
        if (typeof commissionRateOverride === 'number' && commissionRateOverride >= 0 && commissionRateOverride <= 1) {
          commissionRate = commissionRateOverride;
        } else {
          try {
            const settingsDoc = await settingsCol.doc('commissions').get();
            if (settingsDoc.exists) {
              const data = settingsDoc.data();
              if (typeof data?.rate === 'number' && data.rate > 0 && data.rate <= 1) {
                commissionRate = data.rate;
              } else if (typeof data?.rate === 'number' && data.rate > 1) {
                commissionRate = data.rate / 100;
              }
            }
          } catch (err) {
            console.warn('Error fetching commission rate settings, using 30% default:', err);
          }
        }

        commissionAmount = Number((coreResult.amountNgn * commissionRate).toFixed(2));
        const affiliateRef = affiliatesCol.doc(resolvedRefCode);
        const earningRef = earningsCol.doc(`${resolvedRefCode}_${reference}`);

        affiliateCredited = await db.runTransaction(async (affTx) => {
          const earningSnap = await affTx.get(earningRef);
          if (earningSnap.exists) {
            affTx.set(paymentDocRef, { affiliate_status: 'credited' }, { merge: true });
            return false;
          }

          if (!coreResult.userReferredBy) {
            affTx.set(userRef, { referredBy: resolvedRefCode }, { merge: true });
          }

          affTx.set(
            paymentDocRef,
            {
              referred_by: resolvedRefCode,
              commission_amount: commissionAmount,
              affiliate_status: 'credited'
            },
            { merge: true }
          );

          affTx.set(
            affiliateRef,
            {
              paidConversions: admin.firestore.FieldValue.increment(1),
              totalEarned: admin.firestore.FieldValue.increment(commissionAmount),
              pendingBalance: admin.firestore.FieldValue.increment(commissionAmount),
              last_referral_at: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );

          affTx.set(earningRef, {
            affiliateId: resolvedRefCode,
            userId: uid,
            userEmail: coreResult.userEmail,
            paymentId: reference,
            amount: coreResult.amountNgn,
            commissionRate,
            commissionAmount,
            payoutStatus: 'unpaid',
            payoutId: null,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

          return true;
        });
      } else {
        await paymentDocRef.set({ affiliate_status: 'not_applicable' }, { merge: true });
      }
    } catch (affErr) {
      console.error(`[Payment Post-Commit Warning] Affiliate side-effect failed for ${reference} (student Sparks already committed):`, affErr);
    }
  }

  return {
    alreadyProcessed: coreResult.alreadyProcessed,
    uid,
    reference,
    amountNgn: coreResult.amountNgn,
    amountUsd: coreResult.amountUsd,
    snapshotNgnPerUsdRate: coreResult.snapshotNgnPerUsdRate,
    fxVersion: coreResult.fxVersion,
    fxStatus: coreResult.fxStatus,
    sparksAdded: coreResult.sparksAdded,
    newAiSparks: coreResult.newAiSparks,
    newFreeSparks: coreResult.newFreeSparks,
    newPaidSparks: coreResult.newPaidSparks,
    bucketAccountingEnabled: coreResult.bucketAccountingEnabled,
    planName,
    isTopUp,
    durationDays,
    affiliateCredited,
    affiliateRefCode: resolvedRefCode,
    commissionAmount
  };
}

/**
 * Bucket-aware transactional helper for direct Spark mutations (`HINT_DEDUCT`, `REWARD`, `ADMIN_ADJUST`).
 * Guarantees `ai_sparks === free_sparks + paid_sparks` is never desynchronized by non-chat endpoints.
 */
export async function executeBucketAwareSparkDelta(params: {
  app: admin.app.App;
  uid: string;
  delta: number;
  action: 'HINT_DEDUCT' | 'REWARD' | 'ADMIN_ADJUST';
  endpoint: SparkLedgerEndpoint;
  reason: string;
  idempotencyToken?: string;
  targetBucketForPositiveDelta?: 'free' | 'paid';
  bypassDeductionIfStaffOrPaid?: boolean;
  isAdminEmailFn?: (email: string | undefined | null) => boolean;
  sandboxNamespace?: string;
}): Promise<{
  alreadyProcessed: boolean;
  appliedDelta: number;
  newBalance: number;
  freeSparks: number | null;
  paidSparks: number | null;
  idempotencyToken: string;
}> {
  const {
    app,
    uid,
    delta,
    action,
    endpoint,
    reason,
    idempotencyToken,
    targetBucketForPositiveDelta = 'free',
    bypassDeductionIfStaffOrPaid = false,
    isAdminEmailFn,
    sandboxNamespace
  } = params;

  const db = app.firestore();
  const scopedToken = resolveScopedIdempotencyToken(idempotencyToken, uid);
  const ledgerDocId = `${scopedToken}_${action}`;
  const usersCol = getLedgerScopedCollection(db, 'users', sandboxNamespace);
  const ledgerCol = getLedgerScopedCollection(db, 'spark_ledger', sandboxNamespace);
  const configCol = getLedgerScopedCollection(db, 'system_config', sandboxNamespace);

  const userRef = usersCol.doc(uid);
  const ledgerRef = ledgerCol.doc(ledgerDocId);
  const policyRef = configCol.doc('evaluation_policy');

  return await db.runTransaction(async (t) => {
    const [existingLedger, userDoc, policyDoc] = await Promise.all([
      t.get(ledgerRef),
      t.get(userRef),
      t.get(policyRef)
    ]);

    if (!userDoc.exists) {
      throw new Error('User profile not found');
    }

    const userData = userDoc.data() || {};
    if (existingLedger.exists) {
      const lData = existingLedger.data()!;
      return {
        alreadyProcessed: true,
        appliedDelta: Number(lData.delta ?? 0),
        newBalance: Number(lData.balanceAfter ?? userData.ai_sparks ?? 0),
        freeSparks: lData.freeBalanceAfter ?? userData.free_sparks ?? null,
        paidSparks: lData.paidBalanceAfter ?? userData.paid_sparks ?? null,
        idempotencyToken: scopedToken
      };
    }

    const role = userData.role || 'student';
    const plan = userData.plan_type || userData.plan || 'free';
    const userEmail = userData.email || 'unknown@uniace.edu';
    const isStaff =
      ['admin', 'tutor', 'moderator'].includes(role) ||
      Boolean(isAdminEmailFn && isAdminEmailFn(userEmail));
    const isPaidPlan = plan !== 'free';

    let effectiveDelta = Math.trunc(delta);
    if (effectiveDelta < 0 && bypassDeductionIfStaffOrPaid && (isStaff || isPaidPlan)) {
      effectiveDelta = 0;
    }

    const policyData = policyDoc.exists ? policyDoc.data() || {} : {};
    const bucketAccountingEnabled =
      Boolean(policyData.enableSparkBucketLedger) || userData.bucket_tracking_initialized === true;

    const currentSparks = Math.max(0, Number(userData.ai_sparks ?? 0));
    if (effectiveDelta < 0 && currentSparks < Math.abs(effectiveDelta)) {
      throw new Error('Insufficient sparks');
    }

    let newBalance = Math.max(0, currentSparks + effectiveDelta);
    let freeBalanceBefore: number | null = null;
    let freeBalanceAfter: number | null = null;
    let paidBalanceBefore: number | null = null;
    let paidBalanceAfter: number | null = null;
    let freeSparksUsed = 0;
    let paidSparksUsed = 0;

    const userUpdates: Record<string, any> = {};

    if (!bucketAccountingEnabled) {
      if (effectiveDelta !== 0) {
        userUpdates.ai_sparks = newBalance;
        if (effectiveDelta < 0) {
          userUpdates.total_sparks_used = admin.firestore.FieldValue.increment(Math.abs(effectiveDelta));
        }
      }
    } else {
      let currentFree: number;
      let currentPaid: number;
      if (userData.bucket_tracking_initialized === true) {
        currentFree = Math.max(0, Number(userData.free_sparks ?? 0));
        currentPaid = Math.max(0, Number(userData.paid_sparks ?? 0));
      } else {
        currentPaid = Math.max(0, Math.min(currentSparks, Number(userData.paid_sparks ?? 0)));
        currentFree = Math.max(0, currentSparks - currentPaid);
        userUpdates.bucket_tracking_initialized = true;
        userUpdates.bucketSource = currentSparks === 0 ? 'tracked' : (userData.bucketSource || 'derived');
      }

      freeBalanceBefore = currentFree;
      paidBalanceBefore = currentPaid;

      if (effectiveDelta >= 0) {
        if (targetBucketForPositiveDelta === 'paid') {
          freeBalanceAfter = currentFree;
          paidBalanceAfter = currentPaid + effectiveDelta;
        } else {
          freeBalanceAfter = currentFree + effectiveDelta;
          paidBalanceAfter = currentPaid;
        }
      } else {
        const deductAmount = Math.abs(effectiveDelta);
        const totalAvailable = currentFree + currentPaid;
        if (totalAvailable < deductAmount) {
          throw new Error('Insufficient sparks');
        }
        // Consume free_sparks first, then paid_sparks
        freeSparksUsed = Math.min(currentFree, deductAmount);
        paidSparksUsed = deductAmount - freeSparksUsed;
        freeBalanceAfter = currentFree - freeSparksUsed;
        paidBalanceAfter = currentPaid - paidSparksUsed;
      }

      newBalance = freeBalanceAfter + paidBalanceAfter;
      if (newBalance !== freeBalanceAfter + paidBalanceAfter) {
        throw new Error(
          `Bucket sum invariant violation in ${action}: ai_sparks (${newBalance}) !== free_sparks (${freeBalanceAfter}) + paid_sparks (${paidBalanceAfter})`
        );
      }

      userUpdates.free_sparks = freeBalanceAfter;
      userUpdates.paid_sparks = paidBalanceAfter;
      userUpdates.ai_sparks = newBalance;
      if (effectiveDelta < 0) {
        userUpdates.total_sparks_used = admin.firestore.FieldValue.increment(Math.abs(effectiveDelta));
      }
    }

    if (Object.keys(userUpdates).length > 0) {
      t.set(userRef, userUpdates, { merge: true });
    }

    const nowIso = new Date().toISOString();
    const ledgerEntry: SparkLedgerEntry = {
      id: ledgerDocId,
      idempotency_token: scopedToken,
      uid,
      userEmail,
      action,
      state: 'DIRECT',
      delta: effectiveDelta,
      preAuthAmount: effectiveDelta < 0 ? Math.abs(effectiveDelta) : 0,
      actualCost: effectiveDelta < 0 ? Math.abs(effectiveDelta) : 0,
      balanceBefore: currentSparks,
      balanceAfter: newBalance,
      bucketAccountingEnabled,
      bucketSource: bucketAccountingEnabled ? (userData.bucketSource || 'derived') : 'legacy_off',
      freeBalanceBefore,
      freeBalanceAfter,
      paidBalanceBefore,
      paidBalanceAfter,
      freeSparksUsed,
      paidSparksUsed,
      complexity: action === 'HINT_DEDUCT' ? 'quiz' : 'standard',
      endpoint,
      providerUsed: null,
      tokens: null,
      planType: plan,
      role,
      reason,
      createdAtIso: nowIso,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    t.set(ledgerRef, ledgerEntry);

    return {
      alreadyProcessed: false,
      appliedDelta: effectiveDelta,
      newBalance,
      freeSparks: freeBalanceAfter,
      paidSparks: paidBalanceAfter,
      idempotencyToken: scopedToken
    };
  });
}

