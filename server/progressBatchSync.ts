import admin from 'firebase-admin';
import { dbTelemetry } from './dbTelemetry';

const PROTECTED_USER_FIELDS = new Set([
  'uid',
  'role',
  'plan_type',
  'ai_sparks',
  'free_sparks',
  'paid_sparks',
  'frozen_disputed_sparks',
  'frozen_sparks',
  'bucket_tracking_initialized',
  'bucketSource',
  'financial_status',
  'subscription_expiry',
  'subscription_status',
  'subscription_start_date',
  'last_spark_reset',
  'last_payment_ref',
  'admin_pin_verified_until'
]);

function getScopedCollection(
  db: admin.firestore.Firestore,
  collectionName: string,
  sandboxNamespace?: string
): admin.firestore.CollectionReference {
  if (sandboxNamespace && typeof sandboxNamespace === 'string' && sandboxNamespace.trim().length > 0) {
    return db
      .collection('_ci_test_sandboxes')
      .doc(sandboxNamespace.trim())
      .collection(collectionName);
  }
  return db.collection(collectionName);
}

function stableJson(val: any): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(stableJson).join(',')}]`;
  const keys = Object.keys(val).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableJson(val[k])}`).join(',')}}`;
}

export interface ProgressBatchSyncInput {
  db: admin.firestore.Firestore;
  uid: string;
  syncBatchId?: string | null;
  clientSequence?: number | null;
  payload: Record<string, any>;
  sandboxNamespace?: string;
}

export interface ProgressBatchSyncResult {
  success: boolean;
  deduplicated: boolean;
  userModified: boolean;
  syncBatchId: string | null;
  profile: Record<string, any>;
}

/**
 * Applies student progress & study-time updates idempotently inside an atomic transaction.
 * - Uses `user_progress_batches/{syncBatchId}` to retain every applied batch ID so out-of-order
 *   or retried older batches are recognized as no-ops (Essential Safeguard #2).
 * - Enforces cumulative monotonic rules on `studyTime`, `topicLastStudied`, and `quizzesCompleted`.
 * - Skips writing to `users/{uid}` when incoming fields are identical to stored state.
 */
export async function executeIdempotentProgressBatchSync(
  input: ProgressBatchSyncInput
): Promise<ProgressBatchSyncResult> {
  const { db, uid, syncBatchId, clientSequence, payload, sandboxNamespace } = input;
  if (!uid || typeof uid !== 'string') {
    throw Object.assign(new Error('Authenticated user uid is required'), { statusCode: 401 });
  }

  const normalizedBatchId = typeof syncBatchId === 'string' && syncBatchId.trim().length > 0
    ? syncBatchId.trim()
    : null;

  if (normalizedBatchId) {
    if (!normalizedBatchId.startsWith(`${uid}_`) || normalizedBatchId.length > 196) {
      throw Object.assign(
        new Error('Forbidden: syncBatchId does not belong to the authenticated user or is malformed'),
        { statusCode: 403 }
      );
    }
  }

  const usersCol = getScopedCollection(db, 'users', sandboxNamespace);
  const batchesCol = getScopedCollection(db, 'user_progress_batches', sandboxNamespace);
  const userRef = usersCol.doc(uid);

  return await db.runTransaction(async (tx) => {
    const batchRef = normalizedBatchId ? batchesCol.doc(normalizedBatchId) : null;
    const [userSnap, batchSnap] = await Promise.all([
      tx.get(userRef),
      batchRef ? tx.get(batchRef) : Promise.resolve(null)
    ]);

    const existingUser = userSnap.exists ? (userSnap.data() || {}) : {};

    // 1. If this syncBatchId was already applied (even if an older batch retried out of order), treat as a no-op
    if (batchSnap && batchSnap.exists) {
      dbTelemetry.recordSuppressedWrite('users', 'idempotent_duplicate_progress_batch', 1);
      return {
        success: true,
        deduplicated: true,
        userModified: false,
        syncBatchId: normalizedBatchId,
        profile: existingUser
      };
    }

    // 2. Build sanitized, cumulative updates
    const cleanUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(payload || {})) {
      if (key === 'syncBatchId' || key === 'clientSequence') continue;
      if (!PROTECTED_USER_FIELDS.has(key) && value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    // Monotonic cumulative studyTime per topic
    if (cleanUpdates.studyTime && typeof cleanUpdates.studyTime === 'object') {
      const existingStudyTime =
        existingUser.studyTime && typeof existingUser.studyTime === 'object'
          ? existingUser.studyTime
          : {};
      const mergedStudyTime: Record<string, number> = { ...existingStudyTime };
      for (const [topicId, mins] of Object.entries(cleanUpdates.studyTime)) {
        const incVal = Number(mins);
        const curVal = Number(existingStudyTime[topicId] || 0);
        if (Number.isFinite(incVal) && incVal >= 0) {
          mergedStudyTime[topicId] = Math.max(curVal, incVal);
        }
      }
      cleanUpdates.studyTime = mergedStudyTime;
    }

    // Monotonic latest timestamp per topic in topicLastStudied
    if (cleanUpdates.topicLastStudied && typeof cleanUpdates.topicLastStudied === 'object') {
      const existingDates =
        existingUser.topicLastStudied && typeof existingUser.topicLastStudied === 'object'
          ? existingUser.topicLastStudied
          : {};
      const mergedDates: Record<string, string> = { ...existingDates };
      for (const [topicId, isoStr] of Object.entries(cleanUpdates.topicLastStudied)) {
        if (typeof isoStr === 'string') {
          const incMs = Date.parse(isoStr);
          const curMs = existingDates[topicId] ? Date.parse(existingDates[topicId]) : 0;
          if (!Number.isNaN(incMs) && (Number.isNaN(curMs) || incMs >= curMs)) {
            mergedDates[topicId] = isoStr;
          }
        }
      }
      cleanUpdates.topicLastStudied = mergedDates;
    }

    // Monotonic quizzesCompleted
    if (cleanUpdates.quizzesCompleted !== undefined) {
      const incQ = Number(cleanUpdates.quizzesCompleted);
      const curQ = Number(existingUser.quizzesCompleted || 0);
      if (Number.isFinite(incQ) && incQ >= 0) {
        cleanUpdates.quizzesCompleted = Math.max(curQ, incQ);
      } else {
        delete cleanUpdates.quizzesCompleted;
      }
    }

    // Check if any field actually changed compared to existingUser
    let hasActualChange = !userSnap.exists;
    for (const [k, v] of Object.entries(cleanUpdates)) {
      if (stableJson(existingUser[k]) !== stableJson(v)) {
        hasActualChange = true;
        break;
      }
    }

    const nowIso = new Date().toISOString();

    if (batchRef && normalizedBatchId) {
      tx.set(batchRef, {
        syncBatchId: normalizedBatchId,
        uid,
        clientSequence: typeof clientSequence === 'number' && Number.isFinite(clientSequence) ? clientSequence : 0,
        userModified: hasActualChange,
        appliedAtIso: nowIso,
        appliedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    if (hasActualChange) {
      const finalWritePayload = {
        ...cleanUpdates,
        uid,
        updatedAt: nowIso
      };
      tx.set(userRef, finalWritePayload, { merge: true });
      return {
        success: true,
        deduplicated: false,
        userModified: true,
        syncBatchId: normalizedBatchId,
        profile: { ...existingUser, ...finalWritePayload }
      };
    } else {
      dbTelemetry.recordSuppressedWrite('users', 'unchanged_user_profile_or_progress_sync', 1);
      return {
        success: true,
        deduplicated: false,
        userModified: false,
        syncBatchId: normalizedBatchId,
        profile: existingUser
      };
    }
  });
}
