/**
 * UniAce Mastery Hub: Database & Migration Feature Flags
 *
 * Persisted in Neon PostgreSQL table `system_runtime_flags` (Self-Contained Control Plane).
 * Express workers maintain a zero-latency in-memory cache updated via:
 * 1. Initial boot sync
 * 2. Background polling refresh (every 5 seconds)
 * 3. Instant local cache update upon administrative API mutations
 */

import { queryPostgres, getPostgresPool } from '../postgresPool';
import { logger } from '../logger';

export interface SystemFeatureFlags {
  /** Enables PostgreSQL for course catalog, modules, lessons, quizzes */
  ENABLE_POSTGRES_CATALOG: boolean;

  /** Enables PostgreSQL for student study progress, batches, lesson completions, quiz attempts */
  ENABLE_POSTGRES_PROGRESS: boolean;

  /** Enables PostgreSQL for background course generation jobs queue */
  ENABLE_POSTGRES_GENERATION_JOBS: boolean;

  /** Enables PostgreSQL for AI Spark wallet balances, escrow locks, and transaction ledger (Phase 3) */
  ENABLE_POSTGRES_SPARKS_ESCROW: boolean;

  /** Enables PostgreSQL for RAG vector embeddings (course_knowledge_chunks_v2) */
  ENABLE_POSTGRES_RAG_VECTORS: boolean;

  /** Enables PostgreSQL for users profiles, gamification, and system audit logs */
  ENABLE_POSTGRES_USERS_LOGS: boolean;

  /**
   * PROHIBITED: Permanent shadow-writes / dual-writes are strictly forbidden.
   * This flag must remain false to prevent split-brain states across databases.
   */
  ENABLE_POSTGRES_SHADOW_WRITE: boolean;
}


export interface RuntimeFlagRecord {
  flag_key: string;
  enabled: boolean;
  cutover_at: string | null;
  description: string;
  updated_by: string;
  updated_at: string;
}

// In-memory runtime cache with safe baseline defaults (strictly disabled if no PostgreSQL pool)
const initialHasPostgres = Boolean(process.env.DATABASE_URL && getPostgresPool() !== null);

let cachedFlags: SystemFeatureFlags = {
  ENABLE_POSTGRES_CATALOG: initialHasPostgres,
  ENABLE_POSTGRES_PROGRESS: initialHasPostgres,
  ENABLE_POSTGRES_GENERATION_JOBS: initialHasPostgres && process.env.ENABLE_POSTGRES_GENERATION_JOBS === 'true',
  ENABLE_POSTGRES_SPARKS_ESCROW: false,
  ENABLE_POSTGRES_RAG_VECTORS: initialHasPostgres,
  ENABLE_POSTGRES_USERS_LOGS: initialHasPostgres,
  ENABLE_POSTGRES_SHADOW_WRITE: false // Strictly prohibited
};


let cachedFlagRecords: Map<string, RuntimeFlagRecord> = new Map();
let syncIntervalId: NodeJS.Timeout | null = null;
let hasLoggedNoPool = false;

// Log startup backend status once
if (!initialHasPostgres) {
  logger.info('[RuntimeFlags] PostgreSQL pool unavailable at startup (DATABASE_URL unset or pool uninstantiated). All Postgres feature flags default to FALSE; running with Firestore/degraded fallbacks.');
  hasLoggedNoPool = true;
} else {
  logger.info('[RuntimeFlags] PostgreSQL pool detected at startup. Postgres feature flags enabled.');
}

/**
 * Returns the current runtime feature flag snapshot (0ms in-memory read).
 * Gates on pool availability as a defense-in-depth safety net.
 */
export function getFeatureFlags(): Readonly<SystemFeatureFlags> {
  const pool = getPostgresPool();
  if (!pool) {
    return Object.freeze({
      ENABLE_POSTGRES_CATALOG: false,
      ENABLE_POSTGRES_PROGRESS: false,
      ENABLE_POSTGRES_GENERATION_JOBS: false,
      ENABLE_POSTGRES_SPARKS_ESCROW: false,
      ENABLE_POSTGRES_RAG_VECTORS: false,
      ENABLE_POSTGRES_USERS_LOGS: false,
      ENABLE_POSTGRES_SHADOW_WRITE: false
    });

  }
  return Object.freeze({ ...cachedFlags });
}

/**
 * Returns the current migration mode persisted in system_runtime_flags.
 */
export function getMigrationMode(): string {
  const record = cachedFlagRecords.get('migration_mode');
  if (record && record.description) {
    return record.description;
  }
  return cachedFlags.ENABLE_POSTGRES_CATALOG ? 'postgres_cutover' : 'firestore_mirror';
}

/**
 * Returns all runtime flag records with metadata (cutover_at, updated_by, updated_at).
 */
export function getAllRuntimeFlagRecords(): RuntimeFlagRecord[] {
  if (cachedFlagRecords.size > 0) {
    return Array.from(cachedFlagRecords.values());
  }

  // Synthesize default records if cache hasn't loaded yet
  return [
    {
      flag_key: 'ENABLE_POSTGRES_CATALOG',
      enabled: cachedFlags.ENABLE_POSTGRES_CATALOG,
      cutover_at: null,
      description: 'Routes course catalog, modules, lessons, and quizzes to PostgreSQL',
      updated_by: 'system_default',
      updated_at: new Date().toISOString()
    },
    {
      flag_key: 'ENABLE_POSTGRES_PROGRESS',
      enabled: cachedFlags.ENABLE_POSTGRES_PROGRESS,
      cutover_at: null,
      description: 'Routes student study progress, batches, lesson completions, and quizzes to PostgreSQL',
      updated_by: 'system_default',
      updated_at: new Date().toISOString()
    },
    {
      flag_key: 'ENABLE_POSTGRES_GENERATION_JOBS',
      enabled: cachedFlags.ENABLE_POSTGRES_GENERATION_JOBS,
      cutover_at: null,
      description: 'Routes background AI course generation jobs to PostgreSQL',
      updated_by: 'system_default',
      updated_at: new Date().toISOString()
    },
    {
      flag_key: 'ENABLE_POSTGRES_SPARKS_ESCROW',
      enabled: cachedFlags.ENABLE_POSTGRES_SPARKS_ESCROW,
      cutover_at: null,
      description: 'Routes AI Spark wallet balances, escrow locks, and transaction ledger to PostgreSQL',
      updated_by: 'system_default',
      updated_at: new Date().toISOString()
    }
  ];
}

/**
 * Fetches and synchronizes all flags from Neon PostgreSQL into memory.
 */
export async function refreshRuntimeFlagsFromDb(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) {
    // When no pool is available, guarantee all Postgres flags in the cache are forced to false
    if (cachedFlags.ENABLE_POSTGRES_CATALOG || cachedFlags.ENABLE_POSTGRES_PROGRESS || cachedFlags.ENABLE_POSTGRES_GENERATION_JOBS || cachedFlags.ENABLE_POSTGRES_SPARKS_ESCROW) {
      cachedFlags = {
        ...cachedFlags,
        ENABLE_POSTGRES_CATALOG: false,
        ENABLE_POSTGRES_PROGRESS: false,
        ENABLE_POSTGRES_GENERATION_JOBS: false,
        ENABLE_POSTGRES_SPARKS_ESCROW: false,
        ENABLE_POSTGRES_SHADOW_WRITE: false
      };
    }
    if (!hasLoggedNoPool) {
      logger.info('[RuntimeFlags] PostgreSQL pool unavailable (DATABASE_URL unset or pool uninstantiated). Postgres flags forced to FALSE; running with Firestore/degraded fallbacks.');
      hasLoggedNoPool = true;
    }
    return;
  }

  try {
    const res = await queryPostgres<RuntimeFlagRecord>(
      `SELECT flag_key, enabled, cutover_at, description, updated_by, updated_at 
       FROM system_runtime_flags`
    );

    const newRecordsMap = new Map<string, RuntimeFlagRecord>();
    const updatedFlags: Partial<SystemFeatureFlags> = {};

    for (const row of res.rows) {
      newRecordsMap.set(row.flag_key, {
        ...row,
        cutover_at: row.cutover_at ? new Date(row.cutover_at).toISOString() : null,
        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
      });

      if (row.flag_key === 'ENABLE_POSTGRES_CATALOG') {
        updatedFlags.ENABLE_POSTGRES_CATALOG = Boolean(row.enabled);
      } else if (row.flag_key === 'ENABLE_POSTGRES_PROGRESS') {
        updatedFlags.ENABLE_POSTGRES_PROGRESS = Boolean(row.enabled);
      } else if (row.flag_key === 'ENABLE_POSTGRES_GENERATION_JOBS') {
        updatedFlags.ENABLE_POSTGRES_GENERATION_JOBS = Boolean(row.enabled);
      } else if (row.flag_key === 'ENABLE_POSTGRES_SPARKS_ESCROW') {
        updatedFlags.ENABLE_POSTGRES_SPARKS_ESCROW = Boolean(row.enabled);
      } else if (row.flag_key === 'ENABLE_POSTGRES_RAG_VECTORS' || row.flag_key === 'RAG_VECTORS') {
        updatedFlags.ENABLE_POSTGRES_RAG_VECTORS = Boolean(row.enabled);
      } else if (row.flag_key === 'ENABLE_POSTGRES_USERS_LOGS' || row.flag_key === 'USERS_LOGS') {
        updatedFlags.ENABLE_POSTGRES_USERS_LOGS = Boolean(row.enabled);
      }
    }


    cachedFlagRecords = newRecordsMap;
    cachedFlags = {
      ...cachedFlags,
      ...updatedFlags,
      ENABLE_POSTGRES_SHADOW_WRITE: false // Enforce hardcoded invariant
    };
  } catch (err: any) {
    logger.warn({ error: err.message }, '[RuntimeFlags] Failed to refresh flags from Neon PostgreSQL');
  }
}

/**
 * Updates a runtime flag in Neon PostgreSQL and immediately invalidates/updates local memory.
 */
export async function updateRuntimeFlag(
  flagKey: string,
  enabled: boolean,
  updatedBy: string,
  reason?: string
): Promise<RuntimeFlagRecord> {
  if (flagKey === 'ENABLE_POSTGRES_SHADOW_WRITE' && enabled) {
    throw new Error('Forbidden: ENABLE_POSTGRES_SHADOW_WRITE is strictly prohibited by architectural policy.');
  }

  const validKeys = [
    'ENABLE_POSTGRES_CATALOG',
    'ENABLE_POSTGRES_PROGRESS',
    'ENABLE_POSTGRES_GENERATION_JOBS',
    'ENABLE_POSTGRES_SPARKS_ESCROW'
  ];

  if (!validKeys.includes(flagKey)) {
    throw new Error(`Unknown runtime flag key: ${flagKey}`);
  }

  const updateSql = `
    INSERT INTO system_runtime_flags (flag_key, enabled, cutover_at, updated_by, updated_at)
    VALUES (
      $1,
      $2,
      CASE WHEN $2 = TRUE THEN NOW() ELSE NULL END,
      $3,
      NOW()
    )
    ON CONFLICT (flag_key) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      cutover_at = CASE 
        WHEN EXCLUDED.enabled = TRUE AND (system_runtime_flags.cutover_at IS NULL OR system_runtime_flags.enabled = FALSE) THEN NOW()
        WHEN EXCLUDED.enabled = FALSE THEN system_runtime_flags.cutover_at
        ELSE system_runtime_flags.cutover_at
      END,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING flag_key, enabled, cutover_at, description, updated_by, updated_at;
  `;

  const result = await queryPostgres<RuntimeFlagRecord>(updateSql, [flagKey, enabled, updatedBy]);
  if (!result.rows || result.rows.length === 0) {
    throw new Error(`Failed to update runtime flag ${flagKey}`);
  }

  const updatedRecord: RuntimeFlagRecord = {
    ...result.rows[0],
    cutover_at: result.rows[0].cutover_at ? new Date(result.rows[0].cutover_at).toISOString() : null,
    updated_at: new Date(result.rows[0].updated_at).toISOString()
  };

  // Instant local cache update (0ms delay for current worker)
  cachedFlagRecords.set(flagKey, updatedRecord);
  if (flagKey === 'ENABLE_POSTGRES_CATALOG') cachedFlags.ENABLE_POSTGRES_CATALOG = enabled;
  if (flagKey === 'ENABLE_POSTGRES_PROGRESS') cachedFlags.ENABLE_POSTGRES_PROGRESS = enabled;
  if (flagKey === 'ENABLE_POSTGRES_GENERATION_JOBS') cachedFlags.ENABLE_POSTGRES_GENERATION_JOBS = enabled;
  if (flagKey === 'ENABLE_POSTGRES_SPARKS_ESCROW') cachedFlags.ENABLE_POSTGRES_SPARKS_ESCROW = enabled;

  logger.info(
    { flagKey, enabled, updatedBy, reason, cutover_at: updatedRecord.cutover_at },
    '[RuntimeFlags] Flag state successfully mutated in PostgreSQL and synchronized to memory'
  );

  return updatedRecord;
}

/**
 * Initializes runtime flags synchronization on server start.
 * Starts background 5-second polling loop to propagate mutations across worker processes.
 */
export async function initRuntimeFlagsSync(pollIntervalMs = 5000): Promise<void> {
  // Initial sync attempt
  await refreshRuntimeFlagsFromDb();

  // Clear any existing timer
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }

  // Set background polling loop
  syncIntervalId = setInterval(() => {
    refreshRuntimeFlagsFromDb().catch((err) => {
      logger.warn({ error: err.message }, '[RuntimeFlags] Polling refresh error');
    });
  }, pollIntervalMs);

  // Allow process to terminate cleanly without timer hold
  if (syncIntervalId.unref) {
    syncIntervalId.unref();
  }

  logger.info('[RuntimeFlags] Sync engine initialized with 5s background poll.');
}

/**
 * Stops background polling (for test teardowns).
 */
export function stopRuntimeFlagsSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}
