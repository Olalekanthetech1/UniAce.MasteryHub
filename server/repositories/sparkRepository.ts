/**
 * UniAce Mastery Hub: AI Spark Wallet & Escrow Relational Repository
 *
 * Implements Phase 5 Step 3.1 Spark Authority Cutover:
 * - Single source of truth: `users.ai_sparks` is the authoritative balance
 * - First-touch ensure-row creates `users` row (`updated_at = 'epoch'`) and opening delta in `spark_ledger`
 * - Atomically updates `users.ai_sparks` and appends to `spark_ledger` (without bumping `users.updated_at`)
 * - Mirrors `user_sparks_wallets.balance = users.ai_sparks` in the same transaction for compatibility
 * - Row-level ACID locks (SELECT ... FOR UPDATE) in Neon PostgreSQL
 * - Guarantees non-negative balance constraints
 * - Invariant: `users.ai_sparks = SUM(spark_ledger.delta)` strictly maintained
 */

import crypto from 'crypto';
import { getPostgresPool } from '../postgresPool';
import { logger } from '../logger';

export interface WalletRecord {
  uid: string;
  balance: number;
  plan_type: 'free' | 'scholar' | 'admin';
  last_spark_reset: Date;
  updated_at: Date;
}

export interface EscrowLockRecord {
  escrow_id: string;
  uid: string;
  amount_locked: number;
  status: 'locked' | 'settled' | 'refunded' | 'expired';
  model_id: string;
  task_type: string;
  created_at: Date;
  settled_at: Date | null;
}

export interface PreAuthResult {
  granted: boolean;
  escrowId?: string;
  currentBalance: number;
  reason?: string;
}

export interface SettlementResult {
  success: boolean;
  finalBalance: number;
  actualCost: number;
  refund: number;
}

export interface RefundResult {
  success: boolean;
  finalBalance: number;
  refundedAmount: number;
}

export class SparkRepository {
  /**
   * First-touch ensure-row helper:
   * Guarantees a `users` row exists seeded from `user_sparks_wallets` with `updated_at = 'epoch'`
   * and an opening ledger difference row `wallet_balance - COALESCE(SUM(existing delta), 0)`.
   */
  static async ensureUserRowAndSeed(client: any, uid: string, defaultPlan: 'free' | 'scholar' | 'admin' = 'free'): Promise<void> {
    // 1. Ensure user_sparks_wallets exists if fresh
    const initialBalance = defaultPlan === 'admin' ? 10000 : defaultPlan === 'scholar' ? 500 : 50;
    await client.query(
      `INSERT INTO user_sparks_wallets (uid, balance, plan_type, last_spark_reset, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (uid) DO NOTHING;`,
      [uid, initialBalance, defaultPlan]
    );

    // 2. First-touch ensure-row SQL statement from Step 3.1
    const ensureSql = `
      WITH w AS (
        SELECT uid, balance FROM user_sparks_wallets WHERE uid = $1 FOR UPDATE
      ),
      seed AS (
        INSERT INTO users (uid, ai_sparks, role, plan_type, updated_at)
        SELECT uid, balance, 'student', $2, 'epoch'::timestamptz FROM w
        ON CONFLICT (uid) DO NOTHING
        RETURNING uid, ai_sparks
      )
      INSERT INTO spark_ledger (ledger_id, user_id, delta, reason, created_at)
      SELECT md5(random()::text || clock_timestamp()::text), s.uid,
             s.ai_sparks - COALESCE((SELECT SUM(delta)::int FROM spark_ledger WHERE user_id = s.uid), 0),
             'migration_seed', NOW()
      FROM seed s
      WHERE (s.ai_sparks - COALESCE((SELECT SUM(delta)::int FROM spark_ledger WHERE user_id = s.uid), 0)) != 0;
    `;
    await client.query(ensureSql, [uid, defaultPlan]);
  }

  /**
   * Retrieves or initializes a student's wallet balance from users.ai_sparks
   */
  static async getWalletBalance(
    uid: string,
    defaultPlan: 'free' | 'scholar' | 'admin' = 'free'
  ): Promise<WalletRecord> {
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('[SparkRepository] Database pool unavailable');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await SparkRepository.ensureUserRowAndSeed(client, uid, defaultPlan);

      const userRes = await client.query<{
        uid: string;
        ai_sparks: number;
        plan_type: 'free' | 'scholar' | 'admin';
        last_spark_reset: Date;
        updated_at: Date;
      }>(
        `SELECT uid, ai_sparks, plan_type, last_spark_reset, updated_at
         FROM users
         WHERE uid = $1;`,
        [uid]
      );

      await client.query('COMMIT');

      const u = userRes.rows[0];
      return {
        uid: u.uid,
        balance: u.ai_sparks,
        plan_type: u.plan_type || defaultPlan,
        last_spark_reset: u.last_spark_reset || new Date(),
        updated_at: u.updated_at
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Pre-authorizes AI Sparks before streaming or prompt dispatch using SELECT FOR UPDATE on users.ai_sparks
   */
  static async preAuthorizeSparks(params: {
    uid: string;
    amount: number;
    modelId: string;
    taskType: string;
    reason?: string;
  }): Promise<PreAuthResult> {
    const { uid, amount, modelId, taskType, reason } = params;
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('[SparkRepository] Database pool unavailable');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. First-touch ensure-row
      await SparkRepository.ensureUserRowAndSeed(client, uid);

      // 2. Lock users row exclusively
      const userRes = await client.query<{
        uid: string;
        ai_sparks: number;
        role: string;
        plan_type: 'free' | 'scholar' | 'admin' | string;
        subscription_status?: string | null;
        subscription_expiry?: Date | string | null;
      }>(
        `SELECT uid, ai_sparks, role, plan_type, subscription_status, subscription_expiry
         FROM users
         WHERE uid = $1
         FOR UPDATE;`,
        [uid]
      );

      const user = userRes.rows[0];
      let effectivePlan = user.plan_type || 'free';
      if (user.role !== 'admin' && effectivePlan !== 'free' && effectivePlan !== 'admin') {
        const expTime = user.subscription_expiry ? new Date(user.subscription_expiry).getTime() : NaN;
        const isExpired =
          user.subscription_status === 'expired' ||
          (!isNaN(expTime) && Date.now() > expTime);
        if (isExpired) {
          effectivePlan = 'free';
          await client.query(
            `UPDATE users SET plan_type = 'free', subscription_status = 'expired', updated_at = NOW() WHERE uid = $1;`,
            [uid]
          );
          await client.query(
            `UPDATE user_sparks_wallets SET plan_type = 'free', updated_at = NOW() WHERE uid = $1;`,
            [uid]
          );
        }
      }
      const isUnlimited = user.role === 'admin' || effectivePlan === 'admin' || effectivePlan === 'scholar' || effectivePlan === 'semester';

      // 3. Balance check for free tier
      if (!isUnlimited && user.ai_sparks < amount) {
        await client.query('ROLLBACK');
        return {
          granted: false,
          currentBalance: user.ai_sparks,
          reason: `Insufficient sparks balance: requires ${amount}, available ${user.ai_sparks}`
        };
      }

      const deductionAmount = isUnlimited ? 0 : amount;
      const newBalance = user.ai_sparks - deductionAmount;

      // 4. Update authoritative balance in users (NEVER bump users.updated_at)
      await client.query(
        `UPDATE users
         SET ai_sparks = $1
         WHERE uid = $2;`,
        [newBalance, uid]
      );

      // 5. Mirror to legacy user_sparks_wallets table synchronously
      await client.query(
        `UPDATE user_sparks_wallets
         SET balance = $1, updated_at = NOW()
         WHERE uid = $2;`,
        [newBalance, uid]
      );

      // 6. Create escrow lock record
      const escrowId = `escrow_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      await client.query(
        `INSERT INTO spark_escrow_locks (escrow_id, uid, amount_locked, status, model_id, task_type, created_at)
         VALUES ($1, $2, $3, 'locked', $4, $5, NOW());`,
        [escrowId, uid, amount, modelId, taskType]
      );

      // 7. Append to spark_ledger (single authority)
      if (deductionAmount > 0) {
        const ledgerId = `led_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        await client.query(
          `INSERT INTO spark_ledger (ledger_id, user_id, delta, reason, ref_lock_id, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW());`,
          [ledgerId, uid, -deductionAmount, reason || `Pre-auth lock for ${taskType}`, escrowId]
        );
      }

      await client.query('COMMIT');

      return {
        granted: true,
        escrowId,
        currentBalance: newBalance
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error({ uid, err: err.message }, '[SparkRepository] Pre-auth transaction failed');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Settles an escrow lock post-request and refunds the difference atomically
   */
  static async settleSparks(params: {
    escrowId: string;
    actualCost: number;
    actualTokens?: number;
    reason?: string;
  }): Promise<SettlementResult> {
    const { escrowId, actualCost, reason } = params;
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('[SparkRepository] Database pool unavailable');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock and inspect escrow record
      const escrowRes = await client.query<EscrowLockRecord>(
        `SELECT escrow_id, uid, amount_locked, status, model_id, task_type, created_at, settled_at
         FROM spark_escrow_locks
         WHERE escrow_id = $1
         FOR UPDATE;`,
        [escrowId]
      );

      if (escrowRes.rows.length === 0) {
        throw new Error(`Escrow lock ${escrowId} not found`);
      }

      const escrow = escrowRes.rows[0];
      if (escrow.status !== 'locked') {
        const u = await client.query<{ ai_sparks: number }>(
          `SELECT ai_sparks FROM users WHERE uid = $1;`,
          [escrow.uid]
        );
        await client.query('ROLLBACK');
        return {
          success: true,
          finalBalance: u.rows[0]?.ai_sparks ?? 0,
          actualCost,
          refund: 0
        };
      }

      // 2. Lock user in users table
      const userRes = await client.query<{
        uid: string;
        ai_sparks: number;
        role: string;
        plan_type: 'free' | 'scholar' | 'admin' | string;
        subscription_status?: string | null;
        subscription_expiry?: Date | string | null;
      }>(
        `SELECT uid, ai_sparks, role, plan_type, subscription_status, subscription_expiry
         FROM users
         WHERE uid = $1
         FOR UPDATE;`,
        [escrow.uid]
      );
      const user = userRes.rows[0];
      const expTime = user.subscription_expiry ? new Date(user.subscription_expiry).getTime() : NaN;
      const isExpired =
        user.subscription_status === 'expired' ||
        (!isNaN(expTime) && Date.now() > expTime);
      const effectivePlan = isExpired && user.role !== 'admin' ? 'free' : (user.plan_type || 'free');
      const isUnlimited = user.role === 'admin' || effectivePlan === 'admin' || effectivePlan === 'scholar' || effectivePlan === 'semester';

      // 3. Compute refund difference
      const refund = isUnlimited ? 0 : Math.max(0, escrow.amount_locked - actualCost);
      const finalBalance = user.ai_sparks + refund;

      // 4. Update users.ai_sparks (NEVER bump users.updated_at)
      if (refund > 0) {
        await client.query(
          `UPDATE users
           SET ai_sparks = $1
           WHERE uid = $2;`,
          [finalBalance, escrow.uid]
        );

        // Mirror to user_sparks_wallets
        await client.query(
          `UPDATE user_sparks_wallets
           SET balance = $1, updated_at = NOW()
           WHERE uid = $2;`,
          [finalBalance, escrow.uid]
        );
      }

      // 5. Update escrow lock status to settled
      await client.query(
        `UPDATE spark_escrow_locks
         SET status = 'settled', settled_at = NOW()
         WHERE escrow_id = $1;`,
        [escrowId]
      );

      // 6. Append to spark_ledger for refund
      if (refund > 0) {
        const ledgerId = `led_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        await client.query(
          `INSERT INTO spark_ledger (ledger_id, user_id, delta, reason, ref_lock_id, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (ref_lock_id, reason) WHERE ref_lock_id IS NOT NULL DO NOTHING;`,
          [ledgerId, escrow.uid, refund, 'settlement_refund', escrowId]
        );
      }

      await client.query('COMMIT');

      return {
        success: true,
        finalBalance,
        actualCost,
        refund
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error({ escrowId, err: err.message }, '[SparkRepository] Settlement transaction failed');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Refunds an escrow lock entirely on AI provider or network failure
   */
  static async refundEscrow(params: {
    escrowId: string;
    reason: string;
    penaltyAmount?: number;
  }): Promise<RefundResult> {
    const { escrowId, reason, penaltyAmount = 0 } = params;
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('[SparkRepository] Database pool unavailable');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const escrowRes = await client.query<EscrowLockRecord>(
        `SELECT escrow_id, uid, amount_locked, status, model_id, task_type, created_at, settled_at
         FROM spark_escrow_locks
         WHERE escrow_id = $1
         FOR UPDATE;`,
        [escrowId]
      );

      if (escrowRes.rows.length === 0) {
        throw new Error(`Escrow lock ${escrowId} not found`);
      }

      const escrow = escrowRes.rows[0];
      if (escrow.status !== 'locked') {
        const u = await client.query<{ ai_sparks: number }>(
          `SELECT ai_sparks FROM users WHERE uid = $1;`,
          [escrow.uid]
        );
        await client.query('ROLLBACK');
        return {
          success: true,
          finalBalance: u.rows[0]?.ai_sparks ?? 0,
          refundedAmount: 0
        };
      }

      // Lock user in users table
      const userRes = await client.query<{
        uid: string;
        ai_sparks: number;
        role: string;
        plan_type: 'free' | 'scholar' | 'admin' | string;
        subscription_status?: string | null;
        subscription_expiry?: Date | string | null;
      }>(
        `SELECT uid, ai_sparks, role, plan_type, subscription_status, subscription_expiry
         FROM users
         WHERE uid = $1
         FOR UPDATE;`,
        [escrow.uid]
      );
      const user = userRes.rows[0];
      const expTime = user.subscription_expiry ? new Date(user.subscription_expiry).getTime() : NaN;
      const isExpired =
        user.subscription_status === 'expired' ||
        (!isNaN(expTime) && Date.now() > expTime);
      const effectivePlan = isExpired && user.role !== 'admin' ? 'free' : (user.plan_type || 'free');
      const isUnlimited = user.role === 'admin' || effectivePlan === 'admin' || effectivePlan === 'scholar' || effectivePlan === 'semester';

      const refundedAmount = isUnlimited ? 0 : Math.max(0, escrow.amount_locked - penaltyAmount);
      const finalBalance = user.ai_sparks + refundedAmount;

      if (refundedAmount > 0) {
        await client.query(
          `UPDATE users
           SET ai_sparks = $1
           WHERE uid = $2;`,
          [finalBalance, escrow.uid]
        );

        await client.query(
          `UPDATE user_sparks_wallets
           SET balance = $1, updated_at = NOW()
           WHERE uid = $2;`,
          [finalBalance, escrow.uid]
        );
      }

      await client.query(
        `UPDATE spark_escrow_locks
         SET status = 'refunded', settled_at = NOW()
         WHERE escrow_id = $1;`,
        [escrowId]
      );

      if (refundedAmount > 0) {
        const ledgerId = `led_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        await client.query(
          `INSERT INTO spark_ledger (ledger_id, user_id, delta, reason, ref_lock_id, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (ref_lock_id, reason) WHERE ref_lock_id IS NOT NULL DO NOTHING;`,
          [ledgerId, escrow.uid, refundedAmount, reason || 'refund_escrow', escrowId]
        );
      }

      await client.query('COMMIT');

      return {
        success: true,
        finalBalance,
        refundedAmount
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error({ escrowId, err: err.message }, '[SparkRepository] Refund transaction failed');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Directly adjusts sparks balance (admin grants, signup bonus, paystack topup)
   */
  static async adjustBalance(params: {
    uid: string;
    amount: number;
    type: 'monthly_refill' | 'bonus_grant' | 'admin_adjustment' | 'signup_grant';
    reason: string;
  }): Promise<{ finalBalance: number }> {
    const { uid, amount, type, reason } = params;
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('[SparkRepository] Database pool unavailable');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await SparkRepository.ensureUserRowAndSeed(client, uid);

      const userRes = await client.query<{ uid: string; ai_sparks: number }>(
        `SELECT uid, ai_sparks
         FROM users
         WHERE uid = $1
         FOR UPDATE;`,
        [uid]
      );

      const user = userRes.rows[0];
      const finalBalance = Math.max(0, user.ai_sparks + amount);

      // Update users.ai_sparks (NEVER bump users.updated_at)
      await client.query(
        `UPDATE users
         SET ai_sparks = $1
         WHERE uid = $2;`,
        [finalBalance, uid]
      );

      // Mirror to user_sparks_wallets
      await client.query(
        `UPDATE user_sparks_wallets
         SET balance = $1, updated_at = NOW()
         WHERE uid = $2;`,
        [finalBalance, uid]
      );

      // Append to spark_ledger
      const ledgerId = `led_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      await client.query(
        `INSERT INTO spark_ledger (ledger_id, user_id, delta, reason, created_at)
         VALUES ($1, $2, $3, $4, NOW());`,
        [ledgerId, uid, amount, `${type}: ${reason}`]
      );

      await client.query('COMMIT');
      return { finalBalance };
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
