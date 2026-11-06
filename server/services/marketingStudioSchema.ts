import { getPostgresPool } from '../postgresPool';

let marketingStudioSchemaPromise: Promise<void> | null = null;

/**
 * Additive, idempotent schema for administrator-owned marketing asset versions.
 * The snapshot is private to authenticated administrators and does not mix with
 * student profiles, chat history, Sparks or student analytics.
 */
export async function ensureMarketingStudioSchema(): Promise<void> {
  if (!marketingStudioSchemaPromise) {
    marketingStudioSchemaPromise = (async () => {
      const pool = getPostgresPool();
      if (!pool) {
        throw new Error('Marketing asset history is unavailable: Neon PostgreSQL is not connected.');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          ['uniace-admin-marketing-studio-schema-v1']
        );
        await client.query(`
          CREATE TABLE IF NOT EXISTS admin_marketing_asset_versions (
            id TEXT PRIMARY KEY,
            asset_key TEXT NOT NULL,
            asset_name TEXT NOT NULL,
            target_scope TEXT NOT NULL CHECK (
              target_scope IN ('full_ecosystem', 'faculty', 'department', 'course', 'exam_readiness')
            ),
            version INTEGER NOT NULL CHECK (version > 0),
            snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
            created_by TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (asset_key, version)
          )
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_admin_marketing_asset_versions_history
          ON admin_marketing_asset_versions (asset_key, version DESC, created_at DESC)
        `);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    })().catch((error: any) => {
      marketingStudioSchemaPromise = null;
      throw new Error(`Marketing Studio schema migration failed: ${error?.message || String(error)}`);
    });
  }
  await marketingStudioSchemaPromise;
}
