import admin from 'firebase-admin';
import { dbTelemetry } from './dbTelemetry';
import { getPostgresPool } from './postgresPool';

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
  db?: admin.firestore.Firestore | null;
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

const appliedNeonProgressBatches = new Set<string>();

/**
 * Applies student progress & study-time updates idempotently inside an atomic transaction.
 * Uses Neon PostgreSQL (`users` table) in production, and only uses Firestore if `sandboxNamespace` is provided for CLI test sandboxes.
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

  const pool = getPostgresPool();
  if (!sandboxNamespace && pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userRes = await client.query(`SELECT * FROM users WHERE uid = $1 FOR UPDATE`, [uid]);
      const row = userRes.rows[0] || {};
      const existingProfile = typeof row.learning_profile === 'object' && row.learning_profile ? row.learning_profile : {};
      const existingUser: Record<string, any> = {
        ...existingProfile,
        uid,
        email: row.email || existingProfile.email,
        displayName: row.display_name || existingProfile.displayName,
        role: row.role || existingProfile.role || 'student',
        plan_type: row.plan_type || existingProfile.plan_type || 'free',
        ai_sparks: row.ai_sparks ?? existingProfile.ai_sparks ?? 50
      };

      const persistedBatches: string[] = Array.isArray(existingProfile._appliedSyncBatches)
        ? existingProfile._appliedSyncBatches
        : [];

      if (normalizedBatchId && (appliedNeonProgressBatches.has(normalizedBatchId) || persistedBatches.includes(normalizedBatchId))) {
        await client.query('COMMIT');
        dbTelemetry.recordSuppressedWrite('users', 'idempotent_duplicate_progress_batch', 1);
        return {
          success: true,
          deduplicated: true,
          userModified: false,
          syncBatchId: normalizedBatchId,
          profile: existingUser
        };
      }

      const cleanUpdates: Record<string, any> = {};
      for (const [key, value] of Object.entries(payload || {})) {
        if (key === 'syncBatchId' || key === 'clientSequence') continue;
        if (!PROTECTED_USER_FIELDS.has(key) && value !== undefined) {
          cleanUpdates[key] = value;
        }
      }

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

      if (cleanUpdates.quizzesCompleted !== undefined) {
        const incQ = Number(cleanUpdates.quizzesCompleted);
        const curQ = Number(existingUser.quizzesCompleted || 0);
        if (Number.isFinite(incQ) && incQ >= 0) {
          cleanUpdates.quizzesCompleted = Math.max(curQ, incQ);
        } else {
          delete cleanUpdates.quizzesCompleted;
        }
      }

      let hasActualChange = userRes.rows.length === 0;
      for (const [k, v] of Object.entries(cleanUpdates)) {
        if (stableJson(existingUser[k]) !== stableJson(v)) {
          hasActualChange = true;
          break;
        }
      }

      const nowIso = new Date().toISOString();
      if (normalizedBatchId) {
        appliedNeonProgressBatches.add(normalizedBatchId);
      }
      const nextBatches = normalizedBatchId
        ? [...persistedBatches.slice(-49), normalizedBatchId]
        : persistedBatches;

      if (hasActualChange || normalizedBatchId) {
        const mergedProfile = {
          ...existingProfile,
          ...cleanUpdates,
          _appliedSyncBatches: nextBatches,
          updatedAt: nowIso
        };
        const displayName = cleanUpdates.displayName || row.display_name || 'Student';
        const email = cleanUpdates.email || row.email || null;
        await client.query(
          `INSERT INTO users (uid, email, display_name, learning_profile, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, NOW())
           ON CONFLICT (uid) DO UPDATE SET
             display_name = COALESCE($3, users.display_name),
             learning_profile = $4::jsonb,
             updated_at = NOW()`,
          [uid, email, displayName, JSON.stringify(mergedProfile)]
        );
        await client.query('COMMIT');
        return {
          success: true,
          deduplicated: false,
          userModified: hasActualChange,
          syncBatchId: normalizedBatchId,
          profile: { ...existingUser, ...cleanUpdates, uid, updatedAt: nowIso }
        };
      } else {
        await client.query('COMMIT');
        dbTelemetry.recordSuppressedWrite('users', 'unchanged_user_profile_or_progress_sync', 1);
        return {
          success: true,
          deduplicated: false,
          userModified: false,
          syncBatchId: normalizedBatchId,
          profile: existingUser
        };
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  if (!db) {
    throw new Error('Database not initialized for progress batch sync');
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
