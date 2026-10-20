/**
 * UniAce Mastery Hub: Phase 2 Progress & Quiz DDL Deployment
 * Deploys the hardened relational schema for student progress, heartbeats,
 * lesson completions, server-verified quiz attempts, and monotonic audit logs.
 */

import { queryPostgres, checkPostgresHealth } from '../server/postgresPool';

async function deployDDL() {
  console.log('================================================================');
  console.log('🚀 Phase 2 DDL Deployment: Student Progress & Quiz Attempts');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL is not reachable: ${health.error}`);
  }
  console.log(`✅ Connected to Neon PostgreSQL (${health.latencyMs}ms).\n`);

  const statements = [
    // 1. User Course Progress
    `CREATE TABLE IF NOT EXISTS user_course_progress (
      uid VARCHAR(128) NOT NULL,
      course_id VARCHAR(64) NOT NULL,
      total_study_seconds INTEGER NOT NULL DEFAULT 0 CHECK (total_study_seconds >= 0),
      last_studied_lesson_id VARCHAR(128),
      last_studied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_lessons_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_lessons_count >= 0),
      completed_modules_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_modules_count >= 0),
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (uid, course_id)
    );`,

    `CREATE INDEX IF NOT EXISTS idx_ucp_uid_updated ON user_course_progress (uid, updated_at DESC);`,

    // 2. User Study Batches
    `CREATE TABLE IF NOT EXISTS user_study_batches (
      uid VARCHAR(128) NOT NULL,
      course_id VARCHAR(64) NOT NULL,
      batch_id VARCHAR(64) NOT NULL,
      delta_seconds INTEGER NOT NULL CHECK (delta_seconds > 0 AND delta_seconds <= 120),
      client_timestamp TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (uid, course_id, batch_id),
      FOREIGN KEY (uid, course_id) REFERENCES user_course_progress (uid, course_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    );`,

    `CREATE INDEX IF NOT EXISTS idx_usb_uid_recorded ON user_study_batches (uid, recorded_at DESC);`,

    // 3. User Lesson Completions
    `CREATE TABLE IF NOT EXISTS user_lesson_completions (
      uid VARCHAR(128) NOT NULL,
      lesson_id VARCHAR(128) NOT NULL,
      course_id VARCHAR(64) NOT NULL,
      module_id VARCHAR(64) NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      time_spent_seconds INTEGER NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0),
      PRIMARY KEY (uid, lesson_id),
      FOREIGN KEY (uid, course_id) REFERENCES user_course_progress (uid, course_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    );`,

    `CREATE INDEX IF NOT EXISTS idx_ulc_uid_course ON user_lesson_completions (uid, course_id);`,

    // 4. User Quiz Attempts
    `CREATE TABLE IF NOT EXISTS user_quiz_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uid VARCHAR(128) NOT NULL,
      course_id VARCHAR(64) NOT NULL,
      module_id VARCHAR(64) NOT NULL,
      quiz_id VARCHAR(64) NOT NULL,
      attempt_idempotency_key VARCHAR(128) NOT NULL,
      score_pct NUMERIC(5, 2) NOT NULL CHECK (score_pct >= 0 AND score_pct <= 100),
      passed BOOLEAN NOT NULL,
      time_spent_seconds INTEGER NOT NULL CHECK (time_spent_seconds >= 0),
      questions_snapshot_hash CHAR(64) NOT NULL,
      answers_breakdown JSONB NOT NULL CHECK (jsonb_typeof(answers_breakdown) = 'array'),
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_quiz_attempt_idempotency UNIQUE (uid, quiz_id, attempt_idempotency_key)
    );`,

    `CREATE INDEX IF NOT EXISTS idx_uqa_uid_course_quiz ON user_quiz_attempts (uid, course_id, quiz_id, attempted_at DESC);`,

    // 5. Entity Change Log
    `CREATE TABLE IF NOT EXISTS entity_change_log (
      seq_id BIGSERIAL PRIMARY KEY,
      uid VARCHAR(128) NOT NULL,
      entity_type VARCHAR(64) NOT NULL,
      entity_key VARCHAR(256) NOT NULL,
      operation VARCHAR(32) NOT NULL,
      payload_hash CHAR(64) NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    `CREATE INDEX IF NOT EXISTS idx_ecl_uid_seq ON entity_change_log (uid, seq_id DESC);`
  ];

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.trim().split('\n')[0];
    console.log(`Executing [${i + 1}/${statements.length}]: ${preview}...`);
    await queryPostgres(stmt);
  }

  console.log('\n================================================================');
  console.log('🎉 PHASE 2 DDL DEPLOYED SUCCESSFULLY TO NEON POSTGRESQL');
  console.log('================================================================\n');
}

deployDDL()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ DDL deployment failed:', err);
    process.exit(1);
  });
