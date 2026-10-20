/**
 * UniAce Mastery Hub: Stage 3 Sparks Escrow & Ledger DDL Deployment
 * Creates relational tables for AI Spark Wallets, Escrow Locks, and Append-Only Audit Ledger
 * with strict non-negative balance constraints, foreign keys, and indexes.
 */

import { queryPostgres, checkPostgresHealth } from '../server/postgresPool';

export async function deploySparksEscrowDDL() {
  console.log('================================================================');
  console.log('🚀 Phase 3 Stage 3: Deploying Sparks Escrow & Ledger Relational DDL');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL is not reachable: ${health.error}`);
  }
  console.log(`✅ Connected to Neon PostgreSQL (${health.latencyMs}ms).\n`);

  // 1. Table: user_sparks_wallets
  const createWalletsSql = `
    CREATE TABLE IF NOT EXISTS user_sparks_wallets (
      uid VARCHAR(128) PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 50 CHECK (balance >= 0),
      plan_type VARCHAR(32) NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free', 'scholar', 'admin')),
      last_spark_reset TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await queryPostgres(createWalletsSql);
  console.log('✅ Table `user_sparks_wallets` verified/created.');

  // 2. Table: spark_escrow_locks
  const createEscrowSql = `
    CREATE TABLE IF NOT EXISTS spark_escrow_locks (
      escrow_id VARCHAR(64) PRIMARY KEY,
      uid VARCHAR(128) NOT NULL REFERENCES user_sparks_wallets(uid) ON DELETE CASCADE,
      amount_locked INTEGER NOT NULL CHECK (amount_locked > 0),
      status VARCHAR(32) NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'settled', 'refunded', 'expired')),
      model_id VARCHAR(64) NOT NULL,
      task_type VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      settled_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_escrow_uid_status ON spark_escrow_locks (uid, status);
  `;
  await queryPostgres(createEscrowSql);
  console.log('✅ Table `spark_escrow_locks` and index `idx_escrow_uid_status` verified/created.');

  // 3. Table: spark_transactions_ledger
  const createLedgerSql = `
    CREATE TABLE IF NOT EXISTS spark_transactions_ledger (
      seq BIGSERIAL,
      transaction_id VARCHAR(64) PRIMARY KEY,
      uid VARCHAR(128) NOT NULL REFERENCES user_sparks_wallets(uid) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
      type VARCHAR(32) NOT NULL CHECK (type IN ('pre_auth_lock', 'settlement_refund', 'settlement_charge', 'monthly_refill', 'bonus_grant', 'admin_adjustment')),
      reason TEXT,
      escrow_id VARCHAR(64) REFERENCES spark_escrow_locks(escrow_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_spark_ledger_uid_created ON spark_transactions_ledger (uid, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spark_ledger_uid_seq ON spark_transactions_ledger (uid, seq ASC);
  `;
  await queryPostgres(createLedgerSql);
  console.log('✅ Table `spark_transactions_ledger` and index `idx_spark_ledger_uid_created` verified/created.');

  console.log('\n✨ Stage 3 Sparks Escrow & Ledger DDL deployment completed successfully.');
}

if (process.argv[1] && process.argv[1].includes('deploy-sparks-escrow-ddl')) {
  deploySparksEscrowDDL()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ DDL Deployment failed:', err);
      process.exit(1);
    });
}
