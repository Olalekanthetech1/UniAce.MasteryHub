/**
 * UniAce Mastery Hub: Core Users Relational Repository
 *
 * Manages core user profile attributes, fenced upserts (where EXCLUDED.updated_at > users.updated_at),
 * seeded spark ledger invariants, and role authorization lookups in Neon PostgreSQL.
 */

import { getPostgresPool } from '../postgresPool';
import { logger } from '../logger';

export interface UserRecord {
  uid: string;
  email: string | null;
  display_name: string | null;
  role: 'student' | 'admin';
  plan_type: 'free' | 'scholar';
  ai_sparks: number;
  learning_profile: Record<string, any>;
  last_spark_reset: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class UserRepository {
  /**
   * Fetches user profile record by UID
   */
  static async getUserByUid(uid: string): Promise<UserRecord | null> {
    const pool = getPostgresPool();
    if (!pool) throw new Error('[UserRepository] Database pool unavailable');

    const sql = `
      SELECT uid, email, display_name, role, plan_type, ai_sparks, learning_profile, last_spark_reset, created_at, updated_at
      FROM users
      WHERE uid = $1;
    `;
    const res = await pool.query<UserRecord>(sql, [uid]);
    if (res.rows.length === 0) return null;
    return {
      ...res.rows[0],
      learning_profile: typeof res.rows[0].learning_profile === 'string'
        ? JSON.parse(res.rows[0].learning_profile)
        : (res.rows[0].learning_profile || {})
    };
  }

  /**
   * Fenced upsert for user profiles during backfill or synchronization.
   * Note: 'role' and 'ai_sparks' are set on INSERT ONLY.
   */
  static async fencedUpsertUser(params: {
    uid: string;
    email?: string | null;
    display_name?: string | null;
    role?: 'student' | 'admin';
    plan_type?: 'free' | 'scholar';
    ai_sparks: number; // Must be supplied from balance source
    learning_profile?: Record<string, any>;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    seedReason?: string;
  }): Promise<{ inserted: boolean; updated: boolean }> {
    const pool = getPostgresPool();
    if (!pool) throw new Error('[UserRepository] Database pool unavailable');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const uid = params.uid;
      const email = params.email || null;
      const displayName = params.display_name || null;
      const role = params.role === 'admin' ? 'admin' : 'student';
      const planType = params.plan_type === 'scholar' ? 'scholar' : 'free';
      const aiSparks = params.ai_sparks;
      const learningProfile = JSON.stringify(params.learning_profile || {});
      const createdAt = params.createdAt ? new Date(params.createdAt) : new Date();
      const updatedAt = params.updatedAt ? new Date(params.updatedAt) : new Date();
      const seedReason = params.seedReason || 'migration_seed';

      // Check if user already exists
      const existingRes = await client.query('SELECT uid, updated_at FROM users WHERE uid = $1 FOR UPDATE;', [uid]);
      const exists = existingRes.rows.length > 0;

      const upsertSql = `
        INSERT INTO users (
          uid, email, display_name, role, plan_type, ai_sparks, learning_profile, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (uid) DO UPDATE SET
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          plan_type = EXCLUDED.plan_type,
          learning_profile = EXCLUDED.learning_profile,
          updated_at = EXCLUDED.updated_at
        WHERE EXCLUDED.updated_at > users.updated_at;
      `;

      const res = await client.query(upsertSql, [
        uid, email, displayName, role, planType, aiSparks, learningProfile, createdAt, updatedAt
      ]);

      let inserted = !exists && res.rowCount! > 0;
      let updated = exists && res.rowCount! > 0;

      // If newly inserted, seed ledger row for balance invariant
      if (inserted) {
        const ledgerId = `ledger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        await client.query(
          `INSERT INTO spark_ledger (ledger_id, user_id, delta, reason, ref_lock_id, created_at)
           VALUES ($1, $2, $3, $4, NULL, NOW())
           ON CONFLICT DO NOTHING;`,
          [ledgerId, uid, aiSparks, seedReason]
        );
      }

      await client.query('COMMIT');
      return { inserted, updated };
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error({ uid: params.uid, err: err.message }, '[UserRepository] Fenced upsert failed');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Returns total users count for parity audits
   */
  static async getUsersCount(): Promise<number> {
    const pool = getPostgresPool();
    if (!pool) throw new Error('[UserRepository] Database pool unavailable');
    const res = await pool.query('SELECT count(*)::int AS cnt FROM users;');
    return res.rows[0]?.cnt || 0;
  }
}
