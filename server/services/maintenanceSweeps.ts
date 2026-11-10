/**
 * UniAce Mastery Hub: Maintenance Sweeps & Scale-To-Zero Background Jobs
 *
 * Implements scale-to-zero friendly maintenance tasks using SELECT FOR UPDATE SKIP LOCKED:
 * 1. Expire stale spark escrow locks and atomically refund user balances with ledger entries
 * 2. Prune expired SSE single-use stream tickets
 * 3. Prune old system logs (>90 days retention policy)
 */

import { getPostgresPool, getLastPostgresActivityAt, isPostgresQuotaExceeded } from '../postgresPool';
import { logger } from '../logger';

export interface SweepResults {
  expiredEscrowsCount: number;
  prunedTicketsCount: number;
  prunedLogsCount: number;
}

let lastSweepCompletedAt = 0;
let lastRetentionPruneAt = 0;
const RETENTION_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // Run 90-day table prunes at most once per 24 hours
const ACTIVE_WINDOW_MS = 4 * 60 * 1000; // Only run scheduled sweep if DB was already active within the last 4 minutes (never wake a sleeping Neon instance)

export class MaintenanceSweeps {
  /**
   * Sweeps expired escrow locks, refunds sparks atomically using aggregated user SUMs,
   * inserts idempotent ledger records, and updates user spark balances.
   */
  static async expireEscrowLocksWithRefund(): Promise<number> {
    const pool = getPostgresPool();
    if (!pool || isPostgresQuotaExceeded()) return 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. CTE: Pick expired locked escrows with SKIP LOCKED, mark expired, insert refund ledger, update users
      const sql = `
        WITH picked AS (
          SELECT escrow_id FROM spark_escrow_locks
          WHERE status = 'locked' AND created_at < NOW() - INTERVAL '15 minutes'
          ORDER BY created_at LIMIT 500
          FOR UPDATE SKIP LOCKED
        ),
        expired AS (
          UPDATE spark_escrow_locks l
          SET status = 'expired'
          FROM picked p WHERE l.escrow_id = p.escrow_id
          RETURNING l.escrow_id, l.uid, l.amount_locked
        ),
        refunds AS (
          INSERT INTO spark_ledger (ledger_id, user_id, delta, reason, ref_lock_id, created_at)
          SELECT md5(random()::text || clock_timestamp()::text), uid, amount_locked, 'escrow_refund', escrow_id, NOW()
          FROM expired
          ON CONFLICT (ref_lock_id, reason) WHERE ref_lock_id IS NOT NULL DO NOTHING
          RETURNING user_id, delta
        )
        UPDATE users u
        SET ai_sparks = u.ai_sparks + r.total
        FROM (SELECT user_id, SUM(delta) AS total FROM refunds GROUP BY user_id) r
        WHERE u.uid = r.user_id;
      `;

      const res = await client.query(sql);

      // 2. Also keep user_sparks_wallets updated if wallet table exists
      try {
        await client.query(`
          UPDATE user_sparks_wallets w
          SET balance = w.balance + r.total
          FROM (
            SELECT user_id, SUM(delta) AS total FROM spark_ledger
            WHERE reason = 'escrow_refund' AND created_at > NOW() - INTERVAL '1 minute'
            GROUP BY user_id
          ) r
          WHERE w.uid = r.user_id;
        `);
      } catch (e) {
        // Ignore if user_sparks_wallets table is dropped or unpopulated
      }

      await client.query('COMMIT');
      return res.rowCount || 0;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err: err.message }, '[MaintenanceSweeps] Escrow expiry sweep failed');
      return 0;
    } finally {
      client.release();
    }
  }

  /**
   * Prunes expired SSE single-use stream tickets using SKIP LOCKED batching
   */
  static async pruneSseTickets(): Promise<number> {
    const pool = getPostgresPool();
    if (!pool || isPostgresQuotaExceeded()) return 0;

    try {
      const sql = `
        DELETE FROM sse_stream_tickets WHERE ticket_id IN (
          SELECT ticket_id FROM sse_stream_tickets
          WHERE expires_at < NOW() LIMIT 1000 FOR UPDATE SKIP LOCKED
        );
      `;
      const res = await pool.query(sql);
      return res.rowCount || 0;
    } catch (err: any) {
      logger.error({ err: err.message }, '[MaintenanceSweeps] SSE ticket prune failed');
      return 0;
    }
  }

  /**
   * Prunes system logs older than 90 days retention window using SKIP LOCKED batching
   */
  static async pruneOldLogs(): Promise<number> {
    const pool = getPostgresPool();
    if (!pool || isPostgresQuotaExceeded()) return 0;

    try {
      const sql = `
        DELETE FROM system_logs WHERE log_id IN (
          SELECT log_id FROM system_logs
          WHERE created_at < NOW() - INTERVAL '90 days'
          LIMIT 5000 FOR UPDATE SKIP LOCKED
        );
      `;
      const res = await pool.query(sql);
      return res.rowCount || 0;
    } catch (err: any) {
      logger.error({ err: err.message }, '[MaintenanceSweeps] System log prune failed');
      return 0;
    }
  }

  /**
   * Prunes chat analytics older than 90 days retention window using subquery batching
   */
  static async pruneOldChatAnalytics(limit = 1000): Promise<number> {
    const pool = getPostgresPool();
    if (!pool || isPostgresQuotaExceeded()) return 0;
    try {
      const sql = `
        DELETE FROM chat_analytics WHERE id IN (
          SELECT id FROM chat_analytics
          WHERE created_at < NOW() - INTERVAL '90 days'
          LIMIT $1
        );
      `;
      const res = await pool.query(sql, [limit]);
      return res.rowCount || 0;
    } catch (err: any) {
      logger.error({ err: err.message }, '[MaintenanceSweeps] Chat analytics prune failed');
      return 0;
    }
  }

  /**
   * Prunes struggle analytics older than 90 days retention window using subquery batching
   */
  static async pruneOldStruggleAnalytics(limit = 1000): Promise<number> {
    const pool = getPostgresPool();
    if (!pool || isPostgresQuotaExceeded()) return 0;
    try {
      const sql = `
        DELETE FROM struggle_analytics WHERE id IN (
          SELECT id FROM struggle_analytics
          WHERE created_at < NOW() - INTERVAL '90 days'
          LIMIT $1
        );
      `;
      const res = await pool.query(sql, [limit]);
      return res.rowCount || 0;
    } catch (err: any) {
      logger.error({ err: err.message }, '[MaintenanceSweeps] Struggle analytics prune failed');
      return 0;
    }
  }

  /**
   * Prunes resolved system alerts older than 90 days retention window using subquery batching
   */
  static async pruneOldSystemAlerts(limit = 1000): Promise<number> {
    const pool = getPostgresPool();
    if (!pool || isPostgresQuotaExceeded()) return 0;
    try {
      const sql = `
        DELETE FROM system_alerts WHERE id IN (
          SELECT id FROM system_alerts
          WHERE status = 'resolved' AND created_at < NOW() - INTERVAL '90 days'
          LIMIT $1
        );
      `;
      const res = await pool.query(sql, [limit]);
      return res.rowCount || 0;
    } catch (err: any) {
      logger.error({ err: err.message }, '[MaintenanceSweeps] System alerts prune failed');
      return 0;
    }
  }

  /**
   * Prunes message reaction feedback older than 90 days retention window using subquery batching
   */
  static async pruneOldMessageReactions(limit = 1000): Promise<number> {
    const pool = getPostgresPool();
    if (!pool || isPostgresQuotaExceeded()) return 0;
    try {
      const sql = `
        DELETE FROM message_reactions WHERE id IN (
          SELECT id FROM message_reactions
          WHERE created_at < NOW() - INTERVAL '90 days'
          LIMIT $1
        );
      `;
      const res = await pool.query(sql, [limit]);
      return res.rowCount || 0;
    } catch (err: any) {
      logger.error({ err: err.message }, '[MaintenanceSweeps] Message reactions prune failed');
      return 0;
    }
  }

  /**
   * Runs maintenance sweeps only when the database is already awake from recent user activity
   * (unless force=true is passed by an explicit admin action), preserving Neon Scale-to-Zero.
   */
  static async runMaintenanceSweep(force: boolean = false): Promise<SweepResults & {
    prunedChatAnalyticsCount: number;
    prunedStruggleAnalyticsCount: number;
    prunedAlertsCount: number;
    prunedReactionsCount: number;
  }> {
    const emptyResult = {
      expiredEscrowsCount: 0,
      prunedTicketsCount: 0,
      prunedLogsCount: 0,
      prunedChatAnalyticsCount: 0,
      prunedStruggleAnalyticsCount: 0,
      prunedAlertsCount: 0,
      prunedReactionsCount: 0
    };

    if (isPostgresQuotaExceeded()) {
      return emptyResult;
    }

    const now = Date.now();
    const lastActivity = getLastPostgresActivityAt();

    // Scale-to-Zero Guard: Never wake up a sleeping Neon database for background maintenance.
    // Only execute if there was user query activity since the last sweep AND within the last 4 minutes.
    if (!force) {
      if (!lastActivity || lastActivity <= lastSweepCompletedAt || (now - lastActivity > ACTIVE_WINDOW_MS)) {
        return emptyResult;
      }
    }

    const expiredEscrowsCount = await this.expireEscrowLocksWithRefund();
    const prunedTicketsCount = await this.pruneSseTickets();

    let prunedLogsCount = 0;
    let prunedChatAnalyticsCount = 0;
    let prunedStruggleAnalyticsCount = 0;
    let prunedAlertsCount = 0;
    let prunedReactionsCount = 0;

    if (force || now - lastRetentionPruneAt >= RETENTION_PRUNE_INTERVAL_MS) {
      prunedLogsCount = await this.pruneOldLogs();
      prunedChatAnalyticsCount = await this.pruneOldChatAnalytics();
      prunedStruggleAnalyticsCount = await this.pruneOldStruggleAnalytics();
      prunedAlertsCount = await this.pruneOldSystemAlerts();
      prunedReactionsCount = await this.pruneOldMessageReactions();
      lastRetentionPruneAt = Date.now();
    }

    lastSweepCompletedAt = Date.now();

    return {
      expiredEscrowsCount,
      prunedTicketsCount,
      prunedLogsCount,
      prunedChatAnalyticsCount,
      prunedStruggleAnalyticsCount,
      prunedAlertsCount,
      prunedReactionsCount
    };
  }
}

