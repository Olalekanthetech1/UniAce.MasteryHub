/**
 * UniAce Mastery Hub: Maintenance Sweeps & Scale-To-Zero Background Jobs
 *
 * Implements scale-to-zero friendly maintenance tasks using SELECT FOR UPDATE SKIP LOCKED:
 * 1. Expire stale spark escrow locks and atomically refund user balances with ledger entries
 * 2. Prune expired SSE single-use stream tickets
 * 3. Prune old system logs (>90 days retention policy)
 */

import { getPostgresPool } from '../postgresPool';
import { logger } from '../logger';

export interface SweepResults {
  expiredEscrowsCount: number;
  prunedTicketsCount: number;
  prunedLogsCount: number;
}

export class MaintenanceSweeps {
  /**
   * Sweeps expired escrow locks, refunds sparks atomically using aggregated user SUMs,
   * inserts idempotent ledger records, and updates user spark balances.
   */
  static async expireEscrowLocksWithRefund(): Promise<number> {
    const pool = getPostgresPool();
    if (!pool) return 0;

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
      await client.query('ROLLBACK');
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
    if (!pool) return 0;

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
    if (!pool) return 0;

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
   * Runs all maintenance sweeps in sequence
   */
  static async runMaintenanceSweep(): Promise<SweepResults> {
    const expiredEscrowsCount = await this.expireEscrowLocksWithRefund();
    const prunedTicketsCount = await this.pruneSseTickets();
    const prunedLogsCount = await this.pruneOldLogs();

    return {
      expiredEscrowsCount,
      prunedTicketsCount,
      prunedLogsCount
    };
  }
}
