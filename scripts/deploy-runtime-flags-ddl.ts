/**
 * UniAce Mastery Hub: Stage 1 Runtime Flag DDL Deployment
 * Creates the self-contained system_runtime_flags table in Neon PostgreSQL
 * and seeds initial routing flags for catalog, progress, course jobs, and sparks escrow.
 */

import { queryPostgres, checkPostgresHealth } from '../server/postgresPool';

export async function deployRuntimeFlagsDDL() {
  console.log('================================================================');
  console.log('🚀 Phase 3 Stage 1: Deploying system_runtime_flags DDL');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL is not reachable: ${health.error}`);
  }
  console.log(`✅ Connected to Neon PostgreSQL (${health.latencyMs}ms).\n`);

  // 1. Create system_runtime_flags table
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS system_runtime_flags (
      flag_key VARCHAR(64) PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      cutover_at TIMESTAMPTZ,
      description TEXT,
      updated_by VARCHAR(128) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await queryPostgres(createTableSql);
  console.log('✅ Table `system_runtime_flags` verified/created.');

  // 2. Seed initial flags
  const seedSql = `
    INSERT INTO system_runtime_flags (flag_key, enabled, description, updated_by, cutover_at)
    VALUES 
      ('ENABLE_POSTGRES_CATALOG', true, 'Routes course catalog, modules, lessons, and quizzes to PostgreSQL', 'system_init', NOW()),
      ('ENABLE_POSTGRES_PROGRESS', true, 'Routes student study progress, batches, lesson completions, and quizzes to PostgreSQL', 'system_init', NOW()),
      ('ENABLE_POSTGRES_GENERATION_JOBS', false, 'Routes background AI course generation jobs to PostgreSQL', 'system_init', NULL),
      ('ENABLE_POSTGRES_SPARKS_ESCROW', false, 'Routes AI Spark wallet balances, escrow locks, and transaction ledger to PostgreSQL', 'system_init', NULL)
    ON CONFLICT (flag_key) DO UPDATE SET
      description = EXCLUDED.description
    RETURNING flag_key, enabled, cutover_at, updated_by, updated_at;
  `;
  const result = await queryPostgres(seedSql);
  console.log(`✅ Seeded/verified ${result.rowCount} runtime flags:`);
  for (const row of result.rows) {
    console.log(`   - ${row.flag_key}: enabled=${row.enabled}, cutover_at=${row.cutover_at ? row.cutover_at.toISOString() : 'none'}`);
  }

  console.log('\n✨ Stage 1 Runtime Flag DDL deployment completed successfully.');
}

if (process.argv[1] && process.argv[1].includes('deploy-runtime-flags-ddl')) {
  deployRuntimeFlagsDDL()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ DDL Deployment failed:', err);
      process.exit(1);
    });
}
