/**
 * UniAce Mastery Hub: PostgreSQL Connection Pooler
 * 
 * Manages connection pooling, query telemetry, and health status for
 * Neon PostgreSQL relational catalog and pilot tables.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

let pool: pg.Pool | null = null;
let lastKnownHealth: { connected: boolean; checkedAt: number; error?: string } = {
  connected: false,
  checkedAt: 0
};

function normalizePostgresConnectionString(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const sslMode = parsed.searchParams.get('sslmode');
    if (sslMode && ['prefer', 'require', 'verify-ca'].includes(sslMode.toLowerCase())) {
      if (!parsed.searchParams.has('uselibpqcompat')) {
        parsed.searchParams.set('uselibpqcompat', 'true');
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

interface PostgresQuerySample {
  acquireMs: number;
  execMs: number;
  totalMs: number;
  timestamp: number;
}

const MAX_QUERY_SAMPLES = 200;
const recentQuerySamples: PostgresQuerySample[] = [];
let totalQueryCount = 0;
let totalFailedQueryCount = 0;

function recordQuerySample(acquireMs: number, execMs: number) {
  totalQueryCount += 1;
  recentQuerySamples.push({
    acquireMs,
    execMs,
    totalMs: acquireMs + execMs,
    timestamp: Date.now()
  });
  if (recentQuerySamples.length > MAX_QUERY_SAMPLES) {
    recentQuerySamples.shift();
  }
}

function computePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1)
  );
  return Number(sortedValues[idx].toFixed(2));
}

export function getPostgresPoolTelemetry() {
  const totalSorted = recentQuerySamples.map(s => s.totalMs).sort((a, b) => a - b);
  const acquireSorted = recentQuerySamples.map(s => s.acquireMs).sort((a, b) => a - b);
  const execSorted = recentQuerySamples.map(s => s.execMs).sort((a, b) => a - b);

  return {
    totalQueryCount,
    totalFailedQueryCount,
    sampleCount: recentQuerySamples.length,
    poolState: pool
      ? {
          totalClients: pool.totalCount,
          idleClients: pool.idleCount,
          waitingClients: pool.waitingCount
        }
      : null,
    totalLatencyMs: {
      p50: computePercentile(totalSorted, 50),
      p95: computePercentile(totalSorted, 95),
      p99: computePercentile(totalSorted, 99)
    },
    poolAcquisitionMs: {
      p50: computePercentile(acquireSorted, 50),
      p95: computePercentile(acquireSorted, 95),
      p99: computePercentile(acquireSorted, 99)
    },
    dbExecutionMs: {
      p50: computePercentile(execSorted, 50),
      p95: computePercentile(execSorted, 95),
      p99: computePercentile(execSorted, 99)
    },
    lastKnownHealth
  };
}

export function getPostgresPool(): pg.Pool | null {
  const rawConnectionString = process.env.DATABASE_URL;
  if (!rawConnectionString) {
    return null;
  }

  if (!pool) {
    try {
      const connectionString = normalizePostgresConnectionString(rawConnectionString);
      pool = new pg.Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
        max: 10,
        idleTimeoutMillis: 30000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000
      });

      pool.on('error', (err) => {
        logger.warn({ err: err.message }, '[PostgresPool] Unexpected client error on idle pool');
        lastKnownHealth = { connected: false, checkedAt: Date.now(), error: err.message };
      });
    } catch (err: any) {
      logger.error({ err: err.message }, '[PostgresPool] Failed to instantiate pg.Pool');
      pool = null;
    }
  }

  return pool;
}

/**
 * Checks whether PostgreSQL is configured and responsive.
 * Releases acquired client inside a finally block to prevent pool leaks on query errors.
 */
export async function checkPostgresHealth(): Promise<{ connected: boolean; latencyMs: number; acquireMs?: number; execMs?: number; error?: string }> {
  const p = getPostgresPool();
  if (!p) {
    return { connected: false, latencyMs: 0, error: 'DATABASE_URL is not configured' };
  }

  const start = Date.now();
  let client: pg.PoolClient | null = null;
  try {
    client = await p.connect();
    const acquireMs = Date.now() - start;
    const execStart = Date.now();
    await client.query('SELECT 1');
    const execMs = Date.now() - execStart;
    const latencyMs = Date.now() - start;
    recordQuerySample(acquireMs, execMs);
    lastKnownHealth = { connected: true, checkedAt: Date.now() };
    return { connected: true, latencyMs, acquireMs, execMs };
  } catch (err: any) {
    totalFailedQueryCount += 1;
    const latencyMs = Date.now() - start;
    lastKnownHealth = { connected: false, checkedAt: Date.now(), error: err.message };
    return { connected: false, latencyMs, error: err.message || String(err) };
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Explicitly warms up the PostgreSQL connection pool at startup by establishing
 * a live connection, executing a lightweight health query, and releasing it cleanly.
 */
export async function warmupPostgresPool(): Promise<{ connected: boolean; latencyMs: number; acquireMs?: number; execMs?: number; error?: string }> {
  return checkPostgresHealth();
}

/**
 * Executes a PostgreSQL query with pool acquisition and execution latency tracking
 */
export async function queryPostgres<T = any>(
  sql: string,
  params: any[] = []
): Promise<pg.QueryResult<T>> {
  const p = getPostgresPool();
  if (!p) {
    throw new Error('PostgreSQL pool unavailable: DATABASE_URL not configured');
  }

  const t0 = Date.now();
  let client: pg.PoolClient | null = null;
  try {
    client = await p.connect();
    const acquireMs = Date.now() - t0;
    const execStart = Date.now();
    const result = await client.query<T>(sql, params);
    const execMs = Date.now() - execStart;
    const durationMs = acquireMs + execMs;
    recordQuerySample(acquireMs, execMs);
    if (durationMs > 200) {
      logger.warn({ durationMs, acquireMs, execMs, rows: result.rowCount }, '[Postgres] Slow query executed');
    }
    return result;
  } catch (err: any) {
    totalFailedQueryCount += 1;
    const durationMs = Date.now() - t0;
    logger.warn({ durationMs, error: err.message }, '[Postgres] Query failed');
    throw err;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export interface NeonHealthStatus {
  connected: boolean;
  latencyMs: number;
  host: string;
  database: string;
  error?: string;
}

export async function probeNeonConnection(timeoutMs = 5000): Promise<NeonHealthStatus> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return {
      connected: false,
      latencyMs: 0,
      host: 'UNCONFIGURED',
      database: 'UNCONFIGURED',
      error: 'DATABASE_URL environment variable is not set.'
    };
  }

  let host = 'unknown';
  let database = 'unknown';
  try {
    const u = new URL(connectionString);
    host = u.hostname;
    database = u.pathname.replace(/^\//, '');
  } catch {
    host = 'invalid-url';
  }

  const p = getPostgresPool();
  if (!p) {
    return {
      connected: false,
      latencyMs: 0,
      host,
      database,
      error: 'Failed to obtain PostgreSQL pool'
    };
  }

  const t0 = Date.now();
  let client: pg.PoolClient | null = null;
  try {
    client = await p.connect();
    const acquireMs = Date.now() - t0;
    const execStart = Date.now();
    const res = await client.query('SELECT NOW() as now, current_database() as db;');
    const execMs = Date.now() - execStart;
    recordQuerySample(acquireMs, execMs);
    const latencyMs = Date.now() - t0;
    return {
      connected: true,
      latencyMs,
      host,
      database: res.rows[0]?.db || database
    };
  } catch (err: any) {
    totalFailedQueryCount += 1;
    return {
      connected: false,
      latencyMs: Date.now() - t0,
      host,
      database,
      error: err?.message || String(err)
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}


