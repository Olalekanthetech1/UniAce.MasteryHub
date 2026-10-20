/**
 * UniAce Mastery Hub: Stage 1 Course Generation Jobs & Background Workers DDL Deployment
 * Creates relational tables for:
 *   1. course_generation_jobs (with partial unique index on active course jobs)
 *   2. sse_stream_tickets (ephemeral single-use tokens for log-safe SSE streaming)
 *
 * Implements strict check constraints, foreign keys, and indexes for high-throughput
 * background worker coordination, heartbeat leasing, and incremental checkpointing.
 */

import { queryPostgres, checkPostgresHealth } from '../server/postgresPool';

export async function deployGenerationJobsDDL() {
  console.log('================================================================');
  console.log('🚀 Phase 4 Stage 1: Deploying Course Generation Jobs Relational DDL');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL is not reachable: ${health.error}`);
  }
  console.log(`✅ Connected to Neon PostgreSQL (${health.latencyMs}ms).\n`);

  // 1. Table: course_generation_jobs
  const createJobsTableSql = `
    CREATE TABLE IF NOT EXISTS course_generation_jobs (
      job_id VARCHAR(64) PRIMARY KEY,
      course_id VARCHAR(128) NOT NULL,
      user_id VARCHAR(128) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'queued' 
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      stage VARCHAR(64) NOT NULL DEFAULT 'initialized',
      progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
      status_message TEXT,
      generation_error TEXT,
      
      -- Distributed Worker Leasing & Resilience
      lease_owner VARCHAR(128),
      lease_heartbeat TIMESTAMPTZ,
      lease_expires_at TIMESTAMPTZ,
      attempts_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,

      -- Telemetry & Real-Time Coordinates
      current_module VARCHAR(255),
      current_lesson VARCHAR(255),
      completed_modules INTEGER NOT NULL DEFAULT 0,
      total_modules INTEGER NOT NULL DEFAULT 0,
      completed_lessons INTEGER NOT NULL DEFAULT 0,
      total_lessons INTEGER NOT NULL DEFAULT 0,
      active_provider VARCHAR(64),
      elapsed_seconds INTEGER NOT NULL DEFAULT 0,

      -- Structured Artifacts & Checkpoints
      request_payload JSONB NOT NULL DEFAULT '{}',
      syllabus_payload JSONB,
      checkpoint_logs JSONB NOT NULL DEFAULT '[]',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `;
  await queryPostgres(createJobsTableSql);
  console.log('✅ Table `course_generation_jobs` verified/created.');

  // 2. Critical Partial Unique Index: Guarantees at most ONE active job per course_id
  const createPartialUniqueIndexSql = `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_active_course_job
      ON course_generation_jobs (course_id)
      WHERE status IN ('queued', 'running');
  `;
  await queryPostgres(createPartialUniqueIndexSql);
  console.log('✅ Partial Unique Index `idx_uq_active_course_job` verified/created.');

  // 3. Supporting Indexes
  const createIndexesSql = `
    CREATE INDEX IF NOT EXISTS idx_gen_jobs_course_id ON course_generation_jobs (course_id);
    CREATE INDEX IF NOT EXISTS idx_gen_jobs_status_lease ON course_generation_jobs (status, lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_gen_jobs_user_created ON course_generation_jobs (user_id, created_at DESC);
  `;
  await queryPostgres(createIndexesSql);
  console.log('✅ Supporting indexes on `course_generation_jobs` verified/created.');

  // 4. Table: sse_stream_tickets (Ephemeral single-use tickets to prevent JWT leaks in URL queries)
  const createTicketsTableSql = `
    CREATE TABLE IF NOT EXISTS sse_stream_tickets (
      ticket_id VARCHAR(64) PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL REFERENCES course_generation_jobs(job_id) ON DELETE CASCADE,
      user_id VARCHAR(128) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 seconds'),
      consumed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sse_tickets_lookup ON sse_stream_tickets (ticket_id, expires_at, consumed);
  `;
  await queryPostgres(createTicketsTableSql);
  console.log('✅ Table `sse_stream_tickets` and index `idx_sse_tickets_lookup` verified/created.');

  console.log('\n✨ Stage 1 Course Generation Jobs DDL deployment completed successfully.');
}

if (process.argv[1] && process.argv[1].includes('deploy-generation-jobs-ddl')) {
  deployGenerationJobsDDL()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ DDL Deployment failed:', err);
      process.exit(1);
    });
}
