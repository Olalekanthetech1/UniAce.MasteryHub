/**
 * UniAce Mastery Hub: Neon PostgreSQL Connection Probe
 * Tests TCP connection, SSL handshake, and pooler latency for Stage 5B.
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

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

  // Parse connection info safely
  let host = 'unknown';
  let database = 'unknown';
  try {
    const u = new URL(connectionString);
    host = u.hostname;
    database = u.pathname.replace(/^\//, '');
  } catch {
    host = 'invalid-url';
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: timeoutMs
  });

  const t0 = Date.now();
  try {
    const client = await pool.connect();
    const res = await client.query('SELECT NOW() as now, current_database() as db;');
    client.release();
    await pool.end();

    const latencyMs = Date.now() - t0;
    return {
      connected: true,
      latencyMs,
      host,
      database: res.rows[0]?.db || database
    };
  } catch (err: any) {
    try {
      await pool.end().catch(() => {});
    } catch {}

    return {
      connected: false,
      latencyMs: Date.now() - t0,
      host,
      database,
      error: err?.message || String(err)
    };
  }
}

// Standalone CLI probe execution if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Probing Neon PostgreSQL Connection...');
  probeNeonConnection().then((res) => {
    console.log('Probe Result:', JSON.stringify(res, null, 2));
    process.exit(res.connected ? 0 : 1);
  });
}
