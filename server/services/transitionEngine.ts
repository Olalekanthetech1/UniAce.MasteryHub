/**
 * UniAce Mastery Hub: 4-Stage Migration Transition Engine & Outbox Mirror Worker
 *
 * Coordinates system cutover across 4 modes: 'off' | 'shadow' | 'pg_primary' | 'pg_only'.
 * Manages same-transaction outbox row creation, advisory-locked outbox draining,
 * and strict rollback guards.
 */

import { getPostgresPool, queryPostgres } from '../postgresPool';
import { getDb } from '../firebaseAdmin';
import { logger } from '../logger';

export type MigrationMode = 'off' | 'shadow' | 'pg_primary' | 'pg_only';

let cachedMode: MigrationMode = (process.env.MIGRATION_MODE_BOOT as MigrationMode) || 'off';
let lastCacheTime = 0;
const CACHE_TTL_MS = 5000;

/**
 * Returns current migration mode (5-second in-memory cache).
 */
export async function getMigrationMode(): Promise<MigrationMode> {
  const now = Date.now();
  if (now - lastCacheTime < CACHE_TTL_MS) {
    return cachedMode;
  }

  const pool = getPostgresPool();
  if (!pool) return cachedMode;

  try {
    const res = await queryPostgres<{ description: string; enabled: boolean }>(
      `SELECT description, enabled FROM system_runtime_flags WHERE flag_key = 'migration_mode';`
    );

    if (res.rows.length > 0) {
      const modeVal = res.rows[0].description as MigrationMode;
      if (['off', 'shadow', 'pg_primary', 'pg_only'].includes(modeVal)) {
        cachedMode = modeVal;
        lastCacheTime = now;
      }
    }
  } catch (err: any) {
    logger.warn({ error: err.message }, '[TransitionEngine] Failed to refresh migration mode from DB; keeping last known mode');
  }

  return cachedMode;
}

/**
 * Mutates migration mode with strict rollback guard checking
 */
export async function setMigrationMode(nextMode: MigrationMode, updatedBy: string): Promise<MigrationMode> {
  const pool = getPostgresPool();
  if (!pool) throw new Error('[TransitionEngine] Database pool unavailable');

  const currentMode = await getMigrationMode();

  // Rollback guard: pg_primary -> shadow requires empty pending outbox
  if (currentMode === 'pg_primary' && nextMode === 'shadow') {
    const { rows: [{ n }] } = await pool.query(
      'SELECT count(*)::int AS n FROM firestore_mirror_outbox WHERE delivered_at IS NULL;'
    );
    if (n > 0) {
      throw new Error(`Forbidden rollback: Drain outbox first (${n} pending rows remaining)`);
    }
  }

  const sql = `
    INSERT INTO system_runtime_flags (flag_key, enabled, description, updated_by, updated_at)
    VALUES ('migration_mode', $1, $2, $3, NOW())
    ON CONFLICT (flag_key) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      description = EXCLUDED.description,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW();
  `;

  await pool.query(sql, [nextMode !== 'off', nextMode, updatedBy]);
  cachedMode = nextMode;
  lastCacheTime = Date.now();

  logger.info({ currentMode, nextMode, updatedBy }, '[TransitionEngine] Migration mode successfully updated');
  return cachedMode;
}

/**
 * Helper to write document to Firestore if Firestore doc updated_at is older
 */
export async function firestoreSetIfNotNewer(collection: string, docId: string, payload: Record<string, any>): Promise<void> {
  const db = getDb();
  if (!db) return; // Firestore unconfigured or disabled

  const docRef = db.collection(collection).doc(docId);
  const snap = await docRef.get();

  if (snap.exists) {
    const data = snap.data();
    if (data && data.updated_at) {
      const existingTime = new Date(data.updated_at).getTime();
      const payloadTime = payload.updated_at ? new Date(payload.updated_at).getTime() : 0;
      if (existingTime >= payloadTime) {
        return; // Firestore has newer or equal data
      }
    }
  }

  // Strip ai_sparks from payload before mirroring to Firestore
  const safePayload = { ...payload };
  delete safePayload.ai_sparks;

  await docRef.set(safePayload, { merge: true });
}

/**
 * Drains pending outbox rows for pg_primary mode using advisory xact lock
 */
export async function drainOutbox(): Promise<number> {
  const pool = getPostgresPool();
  if (!pool) return 0;

  const client = await pool.connect();
  let processed = 0;
  try {
    await client.query('BEGIN');
    const { rows: [l] } = await client.query('SELECT pg_try_advisory_xact_lock(7005) AS ok;');
    if (!l.ok) {
      await client.query('ROLLBACK');
      return 0; // Another worker is draining
    }

    const { rows } = await client.query(
      `SELECT * FROM firestore_mirror_outbox
       WHERE delivered_at IS NULL ORDER BY id LIMIT 100;`
    );

    for (const r of rows) {
      try {
        const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
        await firestoreSetIfNotNewer(r.collection, r.doc_id, payload);
        await client.query('UPDATE firestore_mirror_outbox SET delivered_at = NOW() WHERE id = $1;', [r.id]);
        processed++;
      } catch (e: any) {
        await client.query(
          'UPDATE firestore_mirror_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1;',
          [r.id, String(e.message || e)]
        );
        break; // Preserve strict FIFO ordering
      }
    }
    await client.query('COMMIT');
    return processed;
  } catch (err: any) {
    await client.query('ROLLBACK');
    logger.error({ err: err.message }, '[TransitionEngine] Outbox drain failed');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Logs a dual write failure during shadow mode
 */
export async function logDualWriteFailure(collection: string, docId: string, error: string): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO dual_write_failures (collection, doc_id, error, created_at)
       VALUES ($1, $2, $3, NOW());`,
      [collection, docId, error]
    );
  } catch (e: any) {
    logger.error({ error: e.message }, '[TransitionEngine] Failed to log dual write failure');
  }
}
