import admin from 'firebase-admin';
import crypto from 'crypto';
import { getLedgerScopedCollection } from './sparkLedger';

export interface SparkLedgerRollupDocument {
  id: string; // 'all_time' | 'daily_YYYY-MM-DD'
  period: 'all_time' | 'daily';
  date: string | null;
  totalEvents: number;
  totalPreAuthSparks: number;
  totalSettledSparks: number;
  totalRefundedSparks: number;
  settledPaidSparks: number;
  settledFreeSparks: number;
  qualityBountiesAwarded: number;
  clawbacksCount: number;
  clawbackSparksRecovered: number;
  clawbackShortfallSparks: number;
  grossPaymentRevenueKobo: number;
  grossPaymentRevenueNgn: number;
  refundedPaymentRevenueKobo: number;
  refundedPaymentRevenueNgn: number;
  disputesLostKobo: number;
  disputesLostNgn: number;
  netCashRevenueNgn: number;
  cacheHitSettleCount: number;
  cacheTokensSaved: number;
  cacheHitSparksSaved: number;
  externalLlmTokenCostUsd: number;
  estimatedModelValueUsd: number; // Benchmark valuation of settled paid Sparks at $0.01/Spark
  grossLlmMarginUsd: number;
  grossLlmMarginPct: number;
  lastEventTimestamp: string | null;
  updatedAtIso: string;
}

export interface SparkReconcileLock {
  lock_owner_id: string;
  lock_acquired_at: string;
  lock_expires_at: string;
  batch_id: string;
  status: 'ACQUIRED' | 'RELEASED';
}

export interface ReconcileDiscrepancy {
  field: string;
  storedValue: any;
  recomputedValue: any;
  delta: any;
  reason: string;
}

export interface ReconcileReport {
  batchId: string;
  runAt: string;
  cutoffWatermark: string;
  dryRun: boolean;
  lockOwnerId: string;
  totalPaymentsScanned: number;
  totalLedgerEventsScanned: number;
  discrepancies: ReconcileDiscrepancy[];
  storedRollupBefore: SparkLedgerRollupDocument | null;
  recomputedRollup: SparkLedgerRollupDocument;
  status: 'CLEAN' | 'DISCREPANCIES_DETECTED';
  userBalancesAuditedCount: number;
  conservationViolations: Array<{
    uid: string;
    aiSparks: number;
    freeSparks: number;
    paidSparks: number;
    frozenSparks: number;
    activeLeaseSparks: number;
    totalEquity: number;
    reason: string;
  }>;
}

/**
 * Converts Nigerian Naira (NGN) to integer minor units (Kobo).
 * 1 NGN = 100 Kobo. Guaranteed integer with no floating-point pennies.
 */
export function toKobo(ngn: number | null | undefined): number {
  if (typeof ngn !== 'number' || !Number.isFinite(ngn) || isNaN(ngn)) return 0;
  return Math.round(ngn * 100);
}

/**
 * Converts integer minor units (Kobo) back to NGN decimal.
 */
export function toNgn(kobo: number | null | undefined): number {
  if (typeof kobo !== 'number' || !Number.isFinite(kobo) || isNaN(kobo)) return 0;
  return Number((kobo / 100).toFixed(2));
}

/**
 * Formats a Date object to UTC 'YYYY-MM-DD'.
 */
export function getUtcDateString(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

/**
 * Default empty rollup structure.
 */
export function createEmptyRollup(
  id: string,
  period: 'all_time' | 'daily',
  date: string | null = null
): SparkLedgerRollupDocument {
  const nowIso = new Date().toISOString();
  return {
    id,
    period,
    date,
    totalEvents: 0,
    totalPreAuthSparks: 0,
    totalSettledSparks: 0,
    totalRefundedSparks: 0,
    settledPaidSparks: 0,
    settledFreeSparks: 0,
    qualityBountiesAwarded: 0,
    clawbacksCount: 0,
    clawbackSparksRecovered: 0,
    clawbackShortfallSparks: 0,
    grossPaymentRevenueKobo: 0,
    grossPaymentRevenueNgn: 0,
    refundedPaymentRevenueKobo: 0,
    refundedPaymentRevenueNgn: 0,
    disputesLostKobo: 0,
    disputesLostNgn: 0,
    netCashRevenueNgn: 0,
    cacheHitSettleCount: 0,
    cacheTokensSaved: 0,
    cacheHitSparksSaved: 0,
    externalLlmTokenCostUsd: 0,
    estimatedModelValueUsd: 0,
    grossLlmMarginUsd: 0,
    grossLlmMarginPct: 0,
    lastEventTimestamp: null,
    updatedAtIso: nowIso
  };
}

/**
 * Acquires a fail-safe cutoff lock for rollup reconciliation.
 * Uses a 15-minute TTL to automatically recover from crashed or abandoned processes.
 */
export async function acquireCutoffLock(
  db: admin.firestore.Firestore,
  workerId: string,
  batchId: string,
  sandboxNamespace?: string
): Promise<{ acquired: boolean; lock?: SparkReconcileLock; error?: string }> {
  const rollupsCol = getLedgerScopedCollection(db, 'spark_ledger_rollups', sandboxNamespace);
  const lockRef = rollupsCol.doc('_reconcile_cutoff_lock');

  return await db.runTransaction(async (t) => {
    const snap = await t.get(lockRef);
    const now = new Date();
    const nowMs = now.getTime();
    const lockTtlMs = 15 * 60 * 1000; // 15 minutes TTL

    if (snap.exists) {
      const lockData = snap.data() as SparkReconcileLock;
      const expiresMs = new Date(lockData.lock_expires_at).getTime();

      // If active and not expired, another worker is holding the lock
      if (lockData.status === 'ACQUIRED' && nowMs < expiresMs) {
        return {
          acquired: false,
          lock: lockData,
          error: `Reconciliation lock is held by worker ${lockData.lock_owner_id} until ${lockData.lock_expires_at}`
        };
      }
    }

    const newLock: SparkReconcileLock = {
      lock_owner_id: workerId,
      lock_acquired_at: now.toISOString(),
      lock_expires_at: new Date(nowMs + lockTtlMs).toISOString(),
      batch_id: batchId,
      status: 'ACQUIRED'
    };

    t.set(lockRef, newLock);
    return { acquired: true, lock: newLock };
  });
}

/**
 * Releases the cutoff lock once reconciliation concludes.
 */
export async function releaseCutoffLock(
  db: admin.firestore.Firestore,
  workerId: string,
  batchId: string,
  sandboxNamespace?: string
): Promise<void> {
  const rollupsCol = getLedgerScopedCollection(db, 'spark_ledger_rollups', sandboxNamespace);
  const lockRef = rollupsCol.doc('_reconcile_cutoff_lock');

  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(lockRef);
      if (snap.exists) {
        const lock = snap.data() as SparkReconcileLock;
        if (lock.batch_id === batchId && lock.lock_owner_id === workerId) {
          t.update(lockRef, {
            status: 'RELEASED',
            lock_released_at: new Date().toISOString()
          });
        }
      }
    });
  } catch (err) {
    console.warn(`[sparkRollups] Failed to cleanly release lock ${batchId}:`, err);
  }
}

/**
 * Executes a Paystack reversal or dispute transition idempotently with exact integer kobo math.
 * Handles:
 * - charge.refunded / refund.processed (multiple partial refunds per payment reference)
 * - dispute.create (quarantine spendable paid balance to frozen_disputed_paid_sparks)
 * - dispute.resolved (won -> unfreeze to paid_sparks; lost -> claw back permanently from frozen)
 */
export async function executePaystackReversalOrDispute(params: {
  app: admin.app.App;
  eventId: string; // Unique Paystack event or refund identifier (e.g. evt_123 or rfnd_456)
  eventType: 'charge.refunded' | 'refund.processed' | 'dispute.create' | 'dispute.resolved';
  reference: string;
  refundAmountNgn?: number;
  disputeStatus?: 'under_review' | 'won' | 'lost';
  disputeAmountNgn?: number;
  reason?: string;
  sandboxNamespace?: string;
}): Promise<{
  success: boolean;
  alreadyProcessed: boolean;
  clawedBackSparks: number;
  shortfallSparks: number;
  unfrozenSparks: number;
  refundedAmountKobo: number;
  paymentDoc: any;
  userDoc: any;
}> {
  const {
    app,
    eventId,
    eventType,
    reference,
    refundAmountNgn,
    disputeStatus,
    disputeAmountNgn,
    reason,
    sandboxNamespace
  } = params;

  const db = app.firestore();
  const eventsCol = getLedgerScopedCollection(db, 'paystack_webhook_events', sandboxNamespace);
  const paymentsCol = getLedgerScopedCollection(db, 'payments', sandboxNamespace);
  const usersCol = getLedgerScopedCollection(db, 'users', sandboxNamespace);
  const ledgerCol = getLedgerScopedCollection(db, 'spark_ledger', sandboxNamespace);

  const eventDocRef = eventsCol.doc(eventId);
  const paymentDocRef = paymentsCol.doc(reference);

  return await db.runTransaction(async (t) => {
    const [eventSnap, paymentSnap] = await Promise.all([
      t.get(eventDocRef),
      t.get(paymentDocRef)
    ]);

    // 1. Event Idempotency Check: Each unique refund or dispute event is executed exactly once
    if (eventSnap.exists && eventSnap.data()?.status === 'PROCESSED') {
      const pData = paymentSnap.exists ? paymentSnap.data() : null;
      return {
        success: true,
        alreadyProcessed: true,
        clawedBackSparks: eventSnap.data()?.clawedBackSparks ?? 0,
        shortfallSparks: eventSnap.data()?.shortfallSparks ?? 0,
        unfrozenSparks: eventSnap.data()?.unfrozenSparks ?? 0,
        refundedAmountKobo: eventSnap.data()?.refundedAmountKobo ?? 0,
        paymentDoc: pData,
        userDoc: null
      };
    }

    if (!paymentSnap.exists) {
      throw new Error(`Original payment with reference "${reference}" not found in payments collection`);
    }

    const pData = paymentSnap.data()!;
    const uid = pData.uid;
    const userDocRef = usersCol.doc(uid);
    const userSnap = await t.get(userDocRef);

    if (!userSnap.exists) {
      throw new Error(`User "${uid}" associated with payment "${reference}" does not exist`);
    }

    const uData = userSnap.data()!;
    const nowIso = new Date().toISOString();

    // Integer kobo math for payments
    const originalPaymentAmountKobo =
      typeof pData.amountKobo === 'number'
        ? pData.amountKobo
        : toKobo(pData.amountNgn ?? pData.amount ?? 0);
    const previouslyRefundedKobo =
      typeof pData.refundedAmountKobo === 'number'
        ? pData.refundedAmountKobo
        : toKobo(pData.refundedAmountNgn ?? 0);
    const sparksOriginallyAdded = Number(pData.sparks_added ?? 0);
    const previouslyClawedBack = Number(pData.sparks_clawed_back ?? 0);
    const previousShortfall = Number(pData.sparks_shortfall_unrecovered ?? 0);

    let clawedBackSparks = 0;
    let shortfallSparks = 0;
    let unfrozenSparks = 0;
    let newRefundAmountKobo = 0;

    const currentPaidSparks = Math.max(0, Number(uData.paid_sparks ?? 0));
    const currentFreeSparks = Math.max(0, Number(uData.free_sparks ?? 0));
    const currentFrozenDisputed = Math.max(0, Number(uData.frozen_disputed_paid_sparks ?? 0));

    let updatedPaidSparks = currentPaidSparks;
    let updatedFrozenDisputed = currentFrozenDisputed;

    // --- CASE A: Refund (Partial or Full) ---
    if (eventType === 'charge.refunded' || eventType === 'refund.processed') {
      newRefundAmountKobo =
        refundAmountNgn !== undefined
          ? toKobo(refundAmountNgn)
          : originalPaymentAmountKobo - previouslyRefundedKobo;

      if (newRefundAmountKobo <= 0) {
        // Zero or negative delta refund - acknowledge without mutation
        t.set(eventDocRef, {
          eventId,
          reference,
          eventType,
          status: 'PROCESSED',
          processedAt: nowIso,
          clawedBackSparks: 0,
          shortfallSparks: 0,
          unfrozenSparks: 0,
          refundedAmountKobo: 0,
          note: 'Zero delta refund'
        });
        return {
          success: true,
          alreadyProcessed: false,
          clawedBackSparks: 0,
          shortfallSparks: 0,
          unfrozenSparks: 0,
          refundedAmountKobo: 0,
          paymentDoc: pData,
          userDoc: uData
        };
      }

      // Enforce cumulative refund ceiling: cumulative refunds cannot exceed payment amount
      const totalRefundedKobo = Math.min(
        originalPaymentAmountKobo,
        previouslyRefundedKobo + newRefundAmountKobo
      );
      const effectiveNewRefundKobo = totalRefundedKobo - previouslyRefundedKobo;

      // Integer proportional clawback target:
      // targetClawback = floor(sparks_added * totalRefundedKobo / paymentAmountKobo)
      const targetCumulativeClawback =
        originalPaymentAmountKobo > 0
          ? Math.floor((sparksOriginallyAdded * totalRefundedKobo) / originalPaymentAmountKobo)
          : 0;

      const accountedSoFar = previouslyClawedBack + previousShortfall;
      const marginalTarget = Math.max(0, targetCumulativeClawback - accountedSoFar);

      // Available spendable balance clawback up to available paid_sparks
      const recoverable = Math.min(updatedPaidSparks, marginalTarget);
      const shortfall = marginalTarget - recoverable;

      clawedBackSparks = recoverable;
      shortfallSparks = shortfall;
      updatedPaidSparks -= recoverable;

      // Update user balances
      const updatedAiSparks = currentFreeSparks + updatedPaidSparks;
      t.update(userDocRef, {
        paid_sparks: updatedPaidSparks,
        ai_sparks: updatedAiSparks,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });

      // Update payment record with cumulative integers
      t.update(paymentDocRef, {
        amountKobo: originalPaymentAmountKobo,
        refundedAmountKobo: totalRefundedKobo,
        refundedAmountNgn: toNgn(totalRefundedKobo),
        sparks_clawed_back: previouslyClawedBack + recoverable,
        sparks_shortfall_unrecovered: previousShortfall + shortfall,
        lastRefundEventId: eventId,
        lastRefundAt: nowIso,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });

      // Append immutable ledger entry for clawback
      const ledgerEntryId = `CLAWBACK_${eventId}`;
      t.set(ledgerCol.doc(ledgerEntryId), {
        id: ledgerEntryId,
        idempotency_token: eventId,
        uid,
        userEmail: uData.email || null,
        action: 'PAYMENT_REFUND_CLAWBACK',
        delta: -recoverable,
        shortfallSparks: shortfall,
        marginalTarget,
        balanceBefore: currentFreeSparks + currentPaidSparks,
        balanceAfter: updatedAiSparks,
        freeBalanceBefore: currentFreeSparks,
        freeBalanceAfter: currentFreeSparks,
        paidBalanceBefore: currentPaidSparks,
        paidBalanceAfter: updatedPaidSparks,
        paymentReference: reference,
        endpoint: 'paystack_webhook',
        reason: reason || `Paystack refund ${eventId}`,
        createdAtIso: nowIso,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // --- CASE B: Dispute Created (Quarantine spendable Sparks to frozen_disputed_paid_sparks) ---
    else if (eventType === 'dispute.create') {
      const disputeAmountKobo =
        disputeAmountNgn !== undefined
          ? toKobo(disputeAmountNgn)
          : originalPaymentAmountKobo;

      const targetDisputeSparks =
        originalPaymentAmountKobo > 0
          ? Math.floor((sparksOriginallyAdded * disputeAmountKobo) / originalPaymentAmountKobo)
          : 0;

      // Quarantine up to available paid_sparks
      const quarantineAmount = Math.min(updatedPaidSparks, targetDisputeSparks);
      updatedPaidSparks -= quarantineAmount;
      updatedFrozenDisputed += quarantineAmount;

      const updatedAiSparks = currentFreeSparks + updatedPaidSparks;

      t.update(userDocRef, {
        paid_sparks: updatedPaidSparks,
        frozen_disputed_paid_sparks: updatedFrozenDisputed,
        ai_sparks: updatedAiSparks,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });

      t.update(paymentDocRef, {
        disputeStatus: 'under_review',
        disputeAmountKobo,
        disputeAmountNgn: toNgn(disputeAmountKobo),
        frozen_sparks: quarantineAmount,
        lastDisputeEventId: eventId,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // --- CASE C: Dispute Resolved (Won vs. Lost) ---
    else if (eventType === 'dispute.resolved') {
      const previouslyFrozen = Number(pData.frozen_sparks ?? 0);

      if (disputeStatus === 'won') {
        // Dispute WON: unfreeze quarantined Sparks back to spendable paid_sparks
        unfrozenSparks = Math.min(updatedFrozenDisputed, previouslyFrozen);
        updatedFrozenDisputed -= unfrozenSparks;
        updatedPaidSparks += unfrozenSparks;

        const updatedAiSparks = currentFreeSparks + updatedPaidSparks;
        t.update(userDocRef, {
          paid_sparks: updatedPaidSparks,
          frozen_disputed_paid_sparks: updatedFrozenDisputed,
          ai_sparks: updatedAiSparks,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        t.update(paymentDocRef, {
          disputeStatus: 'won',
          frozen_sparks: 0,
          lastDisputeEventId: eventId,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // Dispute LOST: permanent clawback from frozen funds
        const clawbackFromFrozen = Math.min(updatedFrozenDisputed, previouslyFrozen);
        updatedFrozenDisputed -= clawbackFromFrozen;
        clawedBackSparks = clawbackFromFrozen;

        const disputeAmountKobo =
          typeof pData.disputeAmountKobo === 'number'
            ? pData.disputeAmountKobo
            : toKobo(pData.disputeAmountNgn ?? pData.amountNgn ?? 0);

        t.update(userDocRef, {
          frozen_disputed_paid_sparks: updatedFrozenDisputed,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        t.update(paymentDocRef, {
          disputeStatus: 'lost',
          frozen_sparks: 0,
          disputesLostKobo: disputeAmountKobo,
          disputesLostNgn: toNgn(disputeAmountKobo),
          sparks_clawed_back: previouslyClawedBack + clawbackFromFrozen,
          lastDisputeEventId: eventId,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        const ledgerEntryId = `DISPUTE_LOST_${eventId}`;
        t.set(ledgerCol.doc(ledgerEntryId), {
          id: ledgerEntryId,
          idempotency_token: eventId,
          uid,
          userEmail: uData.email || null,
          action: 'PAYMENT_REFUND_CLAWBACK',
          delta: -clawbackFromFrozen,
          shortfallSparks: 0,
          balanceBefore: currentFreeSparks + currentPaidSparks,
          balanceAfter: currentFreeSparks + updatedPaidSparks,
          freeBalanceBefore: currentFreeSparks,
          freeBalanceAfter: currentFreeSparks,
          paidBalanceBefore: currentPaidSparks,
          paidBalanceAfter: updatedPaidSparks,
          paymentReference: reference,
          endpoint: 'paystack_webhook',
          reason: `Paystack lost dispute ${eventId}`,
          createdAtIso: nowIso,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    // Mark event as PROCESSED atomically
    t.set(eventDocRef, {
      eventId,
      reference,
      eventType,
      status: 'PROCESSED',
      processedAt: nowIso,
      clawedBackSparks,
      shortfallSparks,
      unfrozenSparks,
      refundedAmountKobo: newRefundAmountKobo,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      success: true,
      alreadyProcessed: false,
      clawedBackSparks,
      shortfallSparks,
      unfrozenSparks,
      refundedAmountKobo: newRefundAmountKobo,
      paymentDoc: pData,
      userDoc: uData
    };
  });
}

/**
 * Executes a full double-entry reconciliation between payments, spark_ledger, and stored rollups.
 * Strictly bounded by cutoffWatermark to isolate concurrent in-flight writes.
 * In dry-run mode: strictly read-only, reports diffs.
 * In live mode: updates stored rollup documents only (NEVER silently alters user balances!).
 */
export async function reconcileSparkRollups(params: {
  db: admin.firestore.Firestore;
  workerId: string;
  dryRun: boolean;
  cutoffTimestamp?: Date;
  adminUid?: string;
  sandboxNamespace?: string;
}): Promise<ReconcileReport> {
  const { db, workerId, dryRun, cutoffTimestamp, adminUid, sandboxNamespace } = params;

  const batchId = crypto.randomUUID();
  const runAt = new Date().toISOString();
  const cutoffWatermark = (cutoffTimestamp || new Date()).toISOString();

  // 1. Acquire cutoff lock with 15-minute TTL
  const lockResult = await acquireCutoffLock(db, workerId, batchId, sandboxNamespace);
  if (!lockResult.acquired) {
    throw new Error(`Failed to acquire reconciliation cutoff lock: ${lockResult.error}`);
  }

  const rollupsCol = getLedgerScopedCollection(db, 'spark_ledger_rollups', sandboxNamespace);
  const ledgerCol = getLedgerScopedCollection(db, 'spark_ledger', sandboxNamespace);
  const paymentsCol = getLedgerScopedCollection(db, 'payments', sandboxNamespace);
  const usersCol = getLedgerScopedCollection(db, 'users', sandboxNamespace);
  const auditCol = getLedgerScopedCollection(db, 'spark_ledger_reconciliations', sandboxNamespace);
  const logsCol = getLedgerScopedCollection(db, 'system_logs', sandboxNamespace);

  try {
    // 2. Fetch current stored all_time rollup document
    const storedRollupSnap = await rollupsCol.doc('all_time').get();
    const storedRollupBefore = storedRollupSnap.exists
      ? (storedRollupSnap.data() as SparkLedgerRollupDocument)
      : null;

    // 3. Scan payments bounded by cutoffWatermark
    // Note: documents must satisfy createdAtIso < cutoffWatermark
    const paymentsSnap = await paymentsCol.get();
    let totalPaymentsScanned = 0;
    let grossPaymentRevenueKobo = 0;
    let refundedPaymentRevenueKobo = 0;
    let disputesLostKobo = 0;

    paymentsSnap.docs.forEach((doc) => {
      const data = doc.data();
      const createdIso = data.createdAtIso || (data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : null);
      if (createdIso && createdIso >= cutoffWatermark) {
        // Discard write that occurred after the cutoff watermark
        return;
      }
      totalPaymentsScanned++;

      const pKobo =
        typeof data.amountKobo === 'number'
          ? data.amountKobo
          : toKobo(data.amountNgn ?? data.amount ?? 0);
      const rKobo =
        typeof data.refundedAmountKobo === 'number'
          ? data.refundedAmountKobo
          : toKobo(data.refundedAmountNgn ?? 0);
      const dKobo =
        typeof data.disputesLostKobo === 'number'
          ? data.disputesLostKobo
          : toKobo(data.disputesLostNgn ?? 0);

      grossPaymentRevenueKobo += pKobo;
      refundedPaymentRevenueKobo += rKobo;
      disputesLostKobo += dKobo;
    });

    // 4. Scan spark_ledger bounded by cutoffWatermark
    const ledgerSnap = await ledgerCol.get();
    let totalLedgerEventsScanned = 0;

    let totalPreAuthSparks = 0;
    let totalSettledSparks = 0;
    let totalRefundedSparks = 0;
    let settledPaidSparks = 0;
    let settledFreeSparks = 0;
    let qualityBountiesAwarded = 0;
    let clawbacksCount = 0;
    let clawbackSparksRecovered = 0;
    let clawbackShortfallSparks = 0;
    let cacheHitSettleCount = 0;
    let cacheTokensSaved = 0;
    let cacheHitSparksSaved = 0;
    let externalLlmTokenCostUsd = 0;

    ledgerSnap.docs.forEach((doc) => {
      const data = doc.data();
      const createdIso = data.createdAtIso || (data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : null);
      if (createdIso && createdIso >= cutoffWatermark) {
        // Skip event committed after cutoff watermark
        return;
      }
      totalLedgerEventsScanned++;

      const action = data.action;
      if (action === 'PRE_AUTH') {
        totalPreAuthSparks += Number(data.preAuthAmount ?? 0);
      } else if (action === 'SETTLE') {
        totalSettledSparks += Number(data.actualCost ?? 0);
        settledFreeSparks += Number(data.freeSparksUsed ?? 0);
        settledPaidSparks += Number(data.paidSparksUsed ?? 0);

        if (data.costStatus === 'CACHE_HIT') {
          cacheHitSettleCount++;
          cacheTokensSaved += Number(data.tokens ?? 0);
          cacheHitSparksSaved += Number(data.actualCost ?? 0);
        } else if (typeof data.estimatedCostUsd === 'number') {
          externalLlmTokenCostUsd += data.estimatedCostUsd;
        }
      } else if (action === 'REFUND') {
        totalRefundedSparks += Math.abs(Number(data.delta ?? 0));
      } else if (action === 'QUALITY_BOUNTY') {
        qualityBountiesAwarded += Math.abs(Number(data.delta ?? 0));
      } else if (action === 'PAYMENT_REFUND_CLAWBACK') {
        clawbacksCount++;
        clawbackSparksRecovered += Math.abs(Number(data.delta ?? 0));
        clawbackShortfallSparks += Number(data.shortfallSparks ?? 0);
      }
    });

    externalLlmTokenCostUsd = Number(externalLlmTokenCostUsd.toFixed(6));
    const grossPaymentRevenueNgn = toNgn(grossPaymentRevenueKobo);
    const refundedPaymentRevenueNgn = toNgn(refundedPaymentRevenueKobo);
    const disputesLostNgn = toNgn(disputesLostKobo);
    const netCashRevenueNgn = Number((grossPaymentRevenueNgn - refundedPaymentRevenueNgn - disputesLostNgn).toFixed(2));

    // Estimated Model Value benchmark at $0.01/Spark
    const estimatedModelValueUsd = Number((settledPaidSparks * 0.01).toFixed(6));
    const grossLlmMarginUsd = Number((estimatedModelValueUsd - externalLlmTokenCostUsd).toFixed(6));
    const grossLlmMarginPct =
      estimatedModelValueUsd > 0
        ? Number(((grossLlmMarginUsd / estimatedModelValueUsd) * 100).toFixed(2))
        : 0;

    const recomputedRollup: SparkLedgerRollupDocument = {
      id: 'all_time',
      period: 'all_time',
      date: null,
      totalEvents: totalLedgerEventsScanned,
      totalPreAuthSparks,
      totalSettledSparks,
      totalRefundedSparks,
      settledPaidSparks,
      settledFreeSparks,
      qualityBountiesAwarded,
      clawbacksCount,
      clawbackSparksRecovered,
      clawbackShortfallSparks,
      grossPaymentRevenueKobo,
      grossPaymentRevenueNgn,
      refundedPaymentRevenueKobo,
      refundedPaymentRevenueNgn,
      disputesLostKobo,
      disputesLostNgn,
      netCashRevenueNgn,
      cacheHitSettleCount,
      cacheTokensSaved,
      cacheHitSparksSaved,
      externalLlmTokenCostUsd,
      estimatedModelValueUsd,
      grossLlmMarginUsd,
      grossLlmMarginPct,
      lastEventTimestamp: cutoffWatermark,
      updatedAtIso: runAt
    };

    // 5. Compare with stored rollup and identify discrepancies
    const discrepancies: ReconcileDiscrepancy[] = [];
    if (storedRollupBefore) {
      const keysToCompare: Array<keyof SparkLedgerRollupDocument> = [
        'totalEvents',
        'settledPaidSparks',
        'settledFreeSparks',
        'grossPaymentRevenueKobo',
        'refundedPaymentRevenueKobo',
        'disputesLostKobo',
        'clawbackSparksRecovered',
        'clawbackShortfallSparks',
        'cacheHitSettleCount',
        'externalLlmTokenCostUsd'
      ];

      keysToCompare.forEach((k) => {
        const stored = storedRollupBefore[k];
        const recomputed = recomputedRollup[k];
        if (stored !== recomputed) {
          discrepancies.push({
            field: String(k),
            storedValue: stored,
            recomputedValue: recomputed,
            delta: typeof recomputed === 'number' && typeof stored === 'number' ? recomputed - stored : null,
            reason: `Discrepancy detected between stored rollup ${stored} and recomputed ${recomputed}`
          });
        }
      });
    }

    // 6. User Equity Conservation Verification (Zero silent repair!)
    const usersSnap = await usersCol.get();
    const conservationViolations: ReconcileReport['conservationViolations'] = [];

    usersSnap.docs.forEach((uDoc) => {
      const u = uDoc.data();
      const aiSparks = Math.max(0, Number(u.ai_sparks ?? 0));
      const freeSparks = Math.max(0, Number(u.free_sparks ?? 0));
      const paidSparks = Math.max(0, Number(u.paid_sparks ?? 0));
      const frozenSparks = Math.max(0, Number(u.frozen_disputed_paid_sparks ?? 0));
      const activeLeases = 0; // Pre-auths are already decremented from paidSparks

      // Invariant: ai_sparks must equal free_sparks + paid_sparks when bucket tracking is enabled
      if (u.bucket_tracking_initialized === true) {
        if (aiSparks !== freeSparks + paidSparks) {
          conservationViolations.push({
            uid: uDoc.id,
            aiSparks,
            freeSparks,
            paidSparks,
            frozenSparks,
            activeLeaseSparks: activeLeases,
            totalEquity: paidSparks + frozenSparks,
            reason: `Bucket sum violation: ai_sparks (${aiSparks}) !== free_sparks (${freeSparks}) + paid_sparks (${paidSparks})`
          });
        }
      }
    });

    const status: ReconcileReport['status'] =
      discrepancies.length > 0 || conservationViolations.length > 0
        ? 'DISCREPANCIES_DETECTED'
        : 'CLEAN';

    const report: ReconcileReport = {
      batchId,
      runAt,
      cutoffWatermark,
      dryRun,
      lockOwnerId: workerId,
      totalPaymentsScanned,
      totalLedgerEventsScanned,
      discrepancies,
      storedRollupBefore,
      recomputedRollup,
      status,
      userBalancesAuditedCount: usersSnap.size,
      conservationViolations
    };

    // 7. If live run (!dryRun): Update rollup document (rollups only, NEVER user balances!)
    if (!dryRun) {
      await rollupsCol.doc('all_time').set(recomputedRollup, { merge: true });
      const todayStr = getUtcDateString(new Date());
      await rollupsCol.doc(`daily_${todayStr}`).set(
        {
          ...recomputedRollup,
          id: `daily_${todayStr}`,
          period: 'daily',
          date: todayStr
        },
        { merge: true }
      );
    }

    // 8. Write immutable audit report to spark_ledger_reconciliations/{batchId}
    await auditCol.doc(batchId).set(report);

    // 9. Write audit record to system_logs
    await logsCol.add({
      type: 'RECONCILIATION_RUN',
      batchId,
      dryRun,
      adminUid: adminUid || 'system',
      status,
      discrepanciesCount: discrepancies.length,
      conservationViolationsCount: conservationViolations.length,
      createdAtIso: runAt,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return report;
  } finally {
    // 10. Always release the cutoff lock cleanly
    await releaseCutoffLock(db, workerId, batchId, sandboxNamespace);
  }
}
