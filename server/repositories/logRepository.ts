/**
 * UniAce Mastery Hub: System Logs Relational Repository
 *
 * Persists administrative audit logs, system errors, parity mismatches,
 * and break-glass security events to Neon PostgreSQL.
 */

import { getPostgresPool } from '../postgresPool';
import { logger } from '../logger';

export interface SystemLogRecord {
  log_id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  message: string;
  details: Record<string, any>;
  user_id: string | null;
  created_at: Date;
}

export class LogRepository {
  /**
   * Persists a system log entry into Neon PostgreSQL
   */
  static async createLog(
    level: 'debug' | 'info' | 'warn' | 'error',
    category: string,
    message: string,
    details: Record<string, any> = {},
    userId: string | null = null,
    customLogId?: string,
    createdAt?: Date | string
  ): Promise<SystemLogRecord> {
    const pool = getPostgresPool();
    if (!pool) {
      // Non-blocking fallback if pool is unavailable
      logger.warn({ level, category, message }, '[LogRepository] Database pool unavailable; log skipped');
      return {
        log_id: customLogId || 'skipped',
        level,
        category,
        message,
        details,
        user_id: userId,
        created_at: new Date()
      };
    }

    const logId = customLogId || `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const detailsJson = JSON.stringify(details);
    const logDate = createdAt ? new Date(createdAt) : new Date();

    const sql = `
      INSERT INTO system_logs (log_id, level, category, message, details, user_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (log_id) DO NOTHING
      RETURNING log_id, level, category, message, details, user_id, created_at;
    `;

    try {
      const res = await pool.query(sql, [logId, level, category, message, detailsJson, userId, logDate]);
      return res.rows[0] || {
        log_id: logId,
        level,
        category,
        message,
        details,
        user_id: userId,
        created_at: logDate
      };
    } catch (err: any) {
      logger.error({ err: err.message }, '[LogRepository] Failed to insert system log');
      return {
        log_id: logId,
        level,
        category,
        message,
        details,
        user_id: userId,
        created_at: logDate
      };
    }
  }

  /**
   * Returns total system logs count
   */
  static async getLogsCount(): Promise<number> {
    const pool = getPostgresPool();
    if (!pool) return 0;
    const res = await pool.query('SELECT count(*)::int AS cnt FROM system_logs;');
    return res.rows[0]?.cnt || 0;
  }
}
