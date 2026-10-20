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

export function getPostgresPool(): pg.Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    try {
      pool = new pg.Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
        max: 10,
        idleTimeoutMillis: 30000
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
 * Checks whether PostgreSQL is configured and responsive
 */
export async function checkPostgresHealth(): Promise<{ connected: boolean; latencyMs: number; error?: string }> {
  const p = getPostgresPool();
  if (!p) {
    return { connected: false, latencyMs: 0, error: 'DATABASE_URL is not configured' };
  }

  const start = Date.now();
  try {
    const client = await p.connect();
    await client.query('SELECT 1');
    client.release();
    const latencyMs = Date.now() - start;
    lastKnownHealth = { connected: true, checkedAt: Date.now() };
    return { connected: true, latencyMs };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    lastKnownHealth = { connected: false, checkedAt: Date.now(), error: err.message };
    return { connected: false, latencyMs, error: err.message || String(err) };
  }
}

/**
 * Executes a PostgreSQL query with latency tracking
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
  try {
    const result = await p.query<T>(sql, params);
    const durationMs = Date.now() - t0;
    if (durationMs > 200) {
      logger.warn({ durationMs, rows: result.rowCount }, '[Postgres] Slow query executed');
    }
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    logger.warn({ durationMs, error: err.message }, '[Postgres] Query failed');
    throw err;
  }
}
