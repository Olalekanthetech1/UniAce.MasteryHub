/**
 * UniAce Mastery Hub: Stage 1 Phase 5 DDL Deployment Script
 * Deploys relational schema for pgvector RAG store, core users, system logs,
 * 4-mode transition engine outbox, dual-write failure logging, and idempotent escrow refund ledger.
 */

import { queryPostgres, checkPostgresHealth, getPostgresPool } from '../server/postgresPool';

export async function deployPhase5DDL() {
  console.log('================================================================');
  console.log('🚀 Phase 5 Stage 1: Deploying RAG (pgvector), Users & Logs DDL');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL is not reachable: ${health.error}`);
  }
  console.log(`✅ Connected to Neon PostgreSQL (${health.latencyMs}ms).\n`);

  // 1. Enable pgvector extension
  await queryPostgres('CREATE EXTENSION IF NOT EXISTS vector;');
  console.log('✅ Extension `vector` verified/enabled.');

  // 2. Perform numeric pgvector version check (>= 0.8.0)
  const verRes = await queryPostgres<{ extversion: string }>(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
  );
  if (verRes.rows.length === 0) {
    throw new Error('pgvector extension is not properly installed');
  }
  const installedVer = verRes.rows[0].extversion;
  console.log(`ℹ️ Installed pgvector version: ${installedVer}`);

  const verParts = installedVer.split('.').map(p => parseInt(p, 10) || 0);
  const isAtLeast080 = (verParts[0] > 0) || (verParts[0] === 0 && verParts[1] >= 8);
  if (!isAtLeast080) {
    console.warn(`⚠️ Warning: pgvector version ${installedVer} is less than recommended 0.8.0. Strict order iterative scan may be limited.`);
  } else {
    console.log('✅ pgvector version >= 0.8.0 preflight check passed.');
  }

  // 3. Table: course_knowledge_chunks
  const createChunksSql = `
    CREATE TABLE IF NOT EXISTS course_knowledge_chunks (
      chunk_id VARCHAR(64) PRIMARY KEY,
      course_id VARCHAR(128) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      module_id VARCHAR(128),
      lesson_id VARCHAR(128),
      chunk_text TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}',
      embedding vector(768) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_vector
      ON course_knowledge_chunks USING hnsw (embedding vector_cosine_ops);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_course_mod
      ON course_knowledge_chunks (course_id, module_id);
  `;
  await queryPostgres(createChunksSql);
  console.log('✅ Table `course_knowledge_chunks` and HNSW/b-tree indexes created.');

  // 4. Table: users (No DEFAULT on ai_sparks - every insert must supply balance)
  const createUsersSql = `
    CREATE TABLE IF NOT EXISTS users (
      uid VARCHAR(128) PRIMARY KEY,
      email VARCHAR(255),
      display_name VARCHAR(255),
      role VARCHAR(32) NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin','tutor','moderator')),
      plan_type VARCHAR(32) NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free','scholar')),
      ai_sparks INTEGER NOT NULL,
      learning_profile JSONB NOT NULL DEFAULT '{}',
      last_spark_reset TIMESTAMPTZ,
      subscription_status VARCHAR(32) DEFAULT 'none',
      subscription_expiry TIMESTAMPTZ,
      subscription_start_date TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(32) DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS subscription_expiry TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_users_role_plan ON users (role, plan_type);
  `;
  await queryPostgres(createUsersSql);
  console.log('✅ Table `users` and index `idx_users_role_plan` created.');

  // 5. Table: system_logs
  const createLogsSql = `
    CREATE TABLE IF NOT EXISTS system_logs (
      log_id VARCHAR(64) PRIMARY KEY,
      level VARCHAR(16) NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error')),
      category VARCHAR(64) NOT NULL,
      message TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}',
      user_id VARCHAR(128),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs (created_at);
    CREATE INDEX IF NOT EXISTS idx_system_logs_level_created ON system_logs (level, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs (category);
  `;
  await queryPostgres(createLogsSql);
  console.log('✅ Table `system_logs` and operational indexes created.');

  // 6. Transition engine: system_runtime_flags
  const createFlagsSql = `
    CREATE TABLE IF NOT EXISTS system_runtime_flags (
      flag_key VARCHAR(64) PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      cutover_at TIMESTAMPTZ,
      description TEXT,
      updated_by VARCHAR(128) NOT NULL DEFAULT 'system',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO system_runtime_flags (flag_key, enabled, description, updated_by)
    VALUES 
      ('migration_mode', false, 'off', 'system_init'),
      ('ENABLE_POSTGRES_RAG_VECTORS', false, 'Routes course knowledge vector search to pgvector', 'system_init'),
      ('ENABLE_POSTGRES_USERS_LOGS', false, 'Routes users and system_logs to PostgreSQL', 'system_init')
    ON CONFLICT (flag_key) DO NOTHING;
  `;
  await queryPostgres(createFlagsSql);
  console.log('✅ Table `system_runtime_flags` verified with default migration_mode = off.');

  // 7. Outbox and dual write failures
  const createOutboxSql = `
    CREATE TABLE IF NOT EXISTS firestore_mirror_outbox (
      id BIGSERIAL PRIMARY KEY,
      collection VARCHAR(64) NOT NULL,
      doc_id VARCHAR(128) NOT NULL,
      payload JSONB NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delivered_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_pending
      ON firestore_mirror_outbox (id) WHERE delivered_at IS NULL;

    CREATE TABLE IF NOT EXISTS dual_write_failures (
      id BIGSERIAL PRIMARY KEY,
      collection VARCHAR(64),
      doc_id VARCHAR(128),
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await queryPostgres(createOutboxSql);
  console.log('✅ Tables `firestore_mirror_outbox` and `dual_write_failures` created.');

  // 8. Idempotent refund ledger: spark_ledger
  const createLedgerSql = `
    CREATE TABLE IF NOT EXISTS spark_ledger (
      ledger_id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(128) NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT,
      ref_lock_id VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await queryPostgres(createLedgerSql);

  // Pre-check for duplicate ref_lock_id, reason before index creation
  const dupCheckSql = `
    SELECT ref_lock_id, reason, count(*) AS cnt
    FROM spark_ledger
    WHERE ref_lock_id IS NOT NULL
    GROUP BY ref_lock_id, reason HAVING count(*) > 1;
  `;
  const dupRes = await queryPostgres(dupCheckSql);
  if (dupRes.rows.length > 0) {
    console.warn(`⚠️ Warning: Found ${dupRes.rows.length} duplicate ref_lock_id/reason entries in spark_ledger.`);
  }

  await queryPostgres(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_spark_ledger_ref
      ON spark_ledger (ref_lock_id, reason)
      WHERE ref_lock_id IS NOT NULL;
  `);
  console.log('✅ Table `spark_ledger` and unique index `uq_spark_ledger_ref` created.');

  console.log('\n✨ Phase 5 DDL deployment completed successfully.');
}

if (process.argv[1] && process.argv[1].includes('deploy-phase5-ddl')) {
  deployPhase5DDL()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ DDL Deployment failed:', err);
      process.exit(1);
    });
}
