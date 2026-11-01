import express from 'express';
import crypto from 'crypto';
import { getPostgresPool } from '../postgresPool';
import { logger } from '../logger';
import { arenaRealtime } from '../arenaRealtime';
import { validateRecordedHumanReplay } from '../services/arenaReplay';

// In-memory UID-keyed cache for bootstrap payloads (60-second TTL)
interface BootstrapCacheEntry {
  data: any;
  cachedAt: number;
}
const bootstrapCache = new Map<string, BootstrapCacheEntry>();
const BOOTSTRAP_TTL_MS = 60 * 1000;

export function invalidateBootstrapCache(uid: string) {
  bootstrapCache.delete(uid);
}

export function clearBootstrapCache() {
  bootstrapCache.clear();
}

// In-memory cache for system config (5-minute TTL)
const systemConfigCache = new Map<string, { data: any; cachedAt: number }>();
const SYSTEM_CONFIG_TTL_MS = 5 * 60 * 1000;

export function setupStudentRoutes(app: express.Application, verifyAuth: any) {
  /**
   * GET /api/user/bootstrap
   * Consolidated bootstrap endpoint:
   * Returns profile, quota, course progress, unread notifications, and system configs.
   * Keyed by UID with 60s in-memory cache and SWR cache headers.
   */
  app.get('/api/user/bootstrap', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const uid = user.uid;

    try {
      const pool = getPostgresPool();
      if (!pool) {
        return res.status(503).json({
          error: 'Database service unavailable',
          message: 'PostgreSQL connection pool unavailable. Bootstrap requests involving live sparks and progress cannot be served in degraded state to prevent balance divergence.'
        });
      }

      // 1. Check in-memory cache: if valid, overlay fresh live sparks AND live progress so state is NEVER stale
      const cached = bootstrapCache.get(uid);
      if (cached && (Date.now() - cached.cachedAt < BOOTSTRAP_TTL_MS)) {
        // Overlay latest sparks and subscription state directly from users table (<1ms)
        const liveSparksRes = await pool.query(
          'SELECT ai_sparks, plan_type, role, subscription_status, subscription_expiry, subscription_start_date, created_at FROM users WHERE uid = $1',
          [uid]
        );
        if (liveSparksRes.rows.length > 0) {
          const u = liveSparksRes.rows[0];
          let livePlan = u.plan_type || 'free';
          let liveStatus = u.subscription_status || 'none';
          const liveExpiry = u.subscription_expiry ? new Date(u.subscription_expiry) : null;
          if (u.role !== 'admin' && livePlan !== 'free') {
            if (liveStatus === 'expired' || (liveExpiry && !isNaN(liveExpiry.getTime()) && Date.now() > liveExpiry.getTime()) || !liveExpiry) {
              livePlan = 'free';
              liveStatus = 'expired';
              await pool.query(
                "UPDATE users SET plan_type = 'free', subscription_status = 'expired', updated_at = NOW() WHERE uid = $1",
                [uid]
              ).catch(() => {});
            }
          }
          cached.data.quota.ai_sparks = u.ai_sparks ?? 0;
          cached.data.quota.plan_type = livePlan;
          cached.data.quota.subscription_status = liveStatus;
          cached.data.quota.subscription_expiry = liveExpiry ? liveExpiry.toISOString() : undefined;
          cached.data.profile.ai_sparks = u.ai_sparks ?? 0;
          cached.data.profile.plan_type = livePlan;
          cached.data.profile.subscription_status = liveStatus;
          cached.data.profile.subscription_expiry = liveExpiry ? liveExpiry.toISOString() : undefined;
          if (u.created_at) cached.data.profile.created_at = new Date(u.created_at).toISOString();
        }

        // Overlay latest progress directly from user_course_progress (<1ms)
        const progressRes = await pool.query(
          'SELECT course_id, total_study_seconds, last_studied_lesson_id, last_studied_at, completed_lessons_count, completed_modules_count, version ' +
          'FROM user_course_progress WHERE uid = $1',
          [uid]
        );
        const progressByCourse: Record<string, any> = {};
        for (const row of progressRes.rows) {
          progressByCourse[row.course_id] = row;
        }
        cached.data.progress = progressByCourse;

        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        return res.json({ ...cached.data, fromCache: true });
      }

      // 2. Fetch User Profile from Neon
      let profile: any = null;
      const userRes = await pool.query('SELECT * FROM users WHERE uid = $1', [uid]);
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0];
        let effectivePlan = u.plan_type || 'free';
        let effectiveStatus = u.subscription_status || 'none';
        const expDate = u.subscription_expiry ? new Date(u.subscription_expiry) : null;

        if (u.role !== 'admin' && effectivePlan !== 'free') {
          if (effectiveStatus === 'expired' || (expDate && !isNaN(expDate.getTime()) && Date.now() > expDate.getTime()) || !expDate) {
            effectivePlan = 'free';
            effectiveStatus = 'expired';
            await pool.query(
              "UPDATE users SET plan_type = 'free', subscription_status = 'expired', updated_at = NOW() WHERE uid = $1",
              [uid]
            ).catch(() => {});
            await pool.query(
              "UPDATE user_sparks_wallets SET plan_type = 'free', updated_at = NOW() WHERE uid = $1",
              [uid]
            ).catch(() => {});
          }
        }

        const lp = u.learning_profile || {};
        const userXp = Number(lp.xp ?? 0);
        const rankSql = [
          "SELECT COUNT(*)::int + 1 AS rank",
          "FROM users",
          "WHERE (role = 'student' OR role IS NULL)",
          "AND learning_profile->>'xp' ~ '^[0-9]+$'",
          "AND (learning_profile->>'xp')::int > $1"
        ].join(' ');
        const rankRes = await pool.query(rankSql, [userXp]);
        const rank = Number(rankRes.rows[0]?.rank);
        if (!Number.isInteger(rank) || rank < 1) {
          throw new Error('The persisted student rank could not be verified.');
        }

        profile = {
          uid: u.uid,
          email: u.email,
          displayName: u.display_name,
          role: u.role || 'student',
          plan_type: effectivePlan,
          subscription_status: effectiveStatus,
          subscription_expiry: expDate && !isNaN(expDate.getTime()) ? expDate.toISOString() : undefined,
          subscription_start_date: u.subscription_start_date ? new Date(u.subscription_start_date).toISOString() : undefined,
          created_at: u.created_at ? new Date(u.created_at).toISOString() : undefined,
          ai_sparks: u.ai_sparks ?? 0,
          learningProfile: lp,
          xp: userXp,
          level: Number(lp.level ?? Math.max(1, Math.floor(userXp / 1000) + 1)),
          streak: Number(lp.streak ?? 0),
          arenaWins: Number(lp.arenaWins ?? 0),
          arenaLosses: Number(lp.arenaLosses ?? 0),
          arenaWinStreak: Number(lp.arenaWinStreak ?? 0),
          rank,
          department: lp.department || undefined,
          academic_level: lp.academic_level || undefined,
          semester: lp.semester || undefined,
          sessionId: u.session_id || null,
          sessionVersion: u.session_version || 1,
          updatedAt: u.updated_at
        };
      } else {
        const policyResult = await pool.query(
          'SELECT data FROM system_config WHERE key = $1 LIMIT 1',
          ['evaluation_policy']
        );
        const policyData = policyResult.rows[0]?.data;
        const dailyFreeSparks = policyData?.dailyFreeSparks;
        if (typeof dailyFreeSparks !== 'number' || !Number.isFinite(dailyFreeSparks) || dailyFreeSparks < 0) {
          return res.status(503).json({
            error: 'Account provisioning is unavailable because the authoritative evaluation_policy.dailyFreeSparks value is missing or invalid.'
          });
        }

        const email = typeof user.email === 'string' && user.email.trim() ? user.email.trim() : null;
        const displayName = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : null;
        const inserted = await pool.query(
          'INSERT INTO users (uid, email, display_name, role, plan_type, ai_sparks, learning_profile, created_at, updated_at) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) ' +
          'ON CONFLICT (uid) DO NOTHING ' +
          'RETURNING uid, email, display_name, role, plan_type, ai_sparks, learning_profile, created_at, updated_at',
          [
            uid,
            email,
            displayName,
            'student',
            'free',
            dailyFreeSparks,
            JSON.stringify({})
          ]
        );
        if (inserted.rows.length === 0) {
          // Another request may have provisioned this user between the initial read
          // and insert. Re-read the authoritative row rather than manufacturing values.
          const concurrentUser = await pool.query(
            'SELECT uid, email, display_name, role, plan_type, ai_sparks, learning_profile, created_at, updated_at FROM users WHERE uid = $1',
            [uid]
          );
          if (concurrentUser.rows.length === 0) {
            throw new Error('User provisioning did not return an authoritative persisted account record.');
          }
          const row = concurrentUser.rows[0];
          profile = {
            uid: row.uid,
            email: row.email,
            displayName: row.display_name,
            role: row.role,
            plan_type: row.plan_type,
            subscription_status: 'none',
            created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
            ai_sparks: row.ai_sparks,
            learningProfile: typeof row.learning_profile === 'string' ? JSON.parse(row.learning_profile) : row.learning_profile,
            sessionId: null,
            sessionVersion: 1,
            updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
          };
        } else {
          const row = inserted.rows[0];
          profile = {
            uid: row.uid,
            email: row.email,
            displayName: row.display_name,
            role: row.role,
            plan_type: row.plan_type,
            subscription_status: 'none',
            created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
            ai_sparks: row.ai_sparks,
            learningProfile: typeof row.learning_profile === 'string' ? JSON.parse(row.learning_profile) : row.learning_profile,
            sessionId: null,
            sessionVersion: 1,
            updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
          };
        }
      }

      // 3. Fetch Course Progress from Neon
      const progressRes = await pool.query(
        'SELECT course_id, total_study_seconds, last_studied_lesson_id, last_studied_at, completed_lessons_count, completed_modules_count, version ' +
        'FROM user_course_progress WHERE uid = $1',
        [uid]
      );

      const progressByCourse: Record<string, any> = {};
      for (const row of progressRes.rows) {
        progressByCourse[row.course_id] = row;
      }

      // 4. Fetch Unread Notifications Count from Neon
      const notifRes = await pool.query(
        'SELECT COUNT(*)::int as unread_count FROM user_notifications WHERE uid = $1 AND read = FALSE',
        [uid]
      );
      const unreadNotificationsCount = notifRes.rows[0]?.unread_count || 0;

      // 5. Fetch Key System Configs (Community, Institution, Pricing, Challenges, Feature Switches)
      const configRes = await pool.query(
        "SELECT key, data FROM system_config WHERE key IN ('community', 'institution', 'pricing', 'challenges', 'feature_switches')"
      );
      const systemConfig: Record<string, any> = {};
      for (const row of configRes.rows) {
        systemConfig[row.key] = row.data;
      }
      systemConfig.feature_switches = {
        arena: true,
        tutor_dashboard: false,
        ...(systemConfig.feature_switches || {})
      };

      const payload = {
        success: true,
        uid,
        profile: profile || {
          uid,
          email: user.email,
          role: 'student',
          plan_type: 'free',
          ai_sparks: 100
        },
        quota: {
          ai_sparks: profile?.ai_sparks ?? 100,
          plan_type: profile?.plan_type || 'free',
          role: profile?.role || 'student',
          subscription_status: profile?.subscription_status || 'none',
          subscription_expiry: profile?.subscription_expiry,
          subscription_start_date: profile?.subscription_start_date
        },
        progress: progressByCourse,
        unreadNotificationsCount,
        systemConfig,
        sessionVersion: profile?.sessionVersion || 1,
        sessionId: profile?.sessionId || null,
        timestamp: new Date().toISOString()
      };

      // Cache the result
      bootstrapCache.set(uid, { data: payload, cachedAt: Date.now() });

      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      return res.json(payload);
    } catch (err: any) {
      logger.error({ uid, err: err.message }, '[StudentRoutes] Error in bootstrap');
      return res.status(500).json({ error: 'Failed to bootstrap student state', details: err.message });
    }
  });

  /**
   * GET /api/user/notifications
   * Returns user notifications from Neon
   */
  app.get('/api/user/notifications', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const result = await pool.query(
        "SELECT id, uid, title, message, type, read, created_at FROM user_notifications WHERE uid = $1 OR uid = '*' ORDER BY created_at DESC LIMIT 50",
        [user.uid]
      );

      return res.json({ notifications: result.rows });
    } catch (err: any) {

      logger.error({ uid: user.uid, err: err.message }, '[StudentRoutes] Failed to fetch notifications');
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  /**
   * POST /api/user/notifications/mark-read
   */
  app.post('/api/user/notifications/mark-read', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const { notificationId } = req.body;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      if (notificationId === 'all') {
        await pool.query('UPDATE user_notifications SET read = TRUE WHERE uid = $1', [user.uid]);
      } else {
        await pool.query('UPDATE user_notifications SET read = TRUE WHERE uid = $1 AND id = $2', [user.uid, notificationId]);
      }
      invalidateBootstrapCache(user.uid);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  });

  /**
   * DELETE /api/user/notifications/:id
   */
  app.delete('/api/user/notifications/:id', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const { id } = req.params;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      await pool.query('DELETE FROM user_notifications WHERE uid = $1 AND id = $2', [user.uid, id]);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to delete notification' });
    }
  });

  /**
   * DELETE /api/user/notifications (Clear all)
   */
  app.delete('/api/user/notifications', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      await pool.query('DELETE FROM user_notifications WHERE uid = $1', [user.uid]);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to clear notifications' });
    }
  });

  /**
   * POST /api/user/notifications (Create notification)
   */
  app.post('/api/user/notifications', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const { title, message, type, customId } = req.body || {};
    if (typeof title !== 'string' || !title.trim() ||
        typeof message !== 'string' || !message.trim() ||
        typeof type !== 'string' || !type.trim()) {
      return res.status(400).json({ error: 'Non-empty title, message, and type are required to create a notification.' });
    }
    if (customId !== undefined && (typeof customId !== 'string' || !customId.trim())) {
      return res.status(400).json({ error: 'customId must be a non-empty string when supplied.' });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const id = customId ? customId.trim() : 'notif_' + Date.now().toString() + '_' + crypto.randomUUID();
      await pool.query(
        `INSERT INTO user_notifications (id, uid, title, message, type, read, created_at)
         VALUES ($1, $2, $3, $4, $5, FALSE, NOW())
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, message = EXCLUDED.message, type = EXCLUDED.type`,
        [id, user.uid, title.trim(), message.trim(), type.trim()]
      );
      return res.json({ success: true, id });
    } catch (err: any) {
      logger.error({ uid: user.uid, error: err?.message || String(err) }, '[StudentRoutes] Notification write failed');
      return res.status(503).json({ error: 'Notification could not be persisted to the authoritative database.' });
    }
  });

  /**
   * GET /api/system/config/:key
   * Returns public system configuration from Neon
   */
  app.get('/api/system/config/:key', async (req, res) => {
    const key = req.params.key;
    const cached = systemConfigCache.get(key);
    if (cached && (Date.now() - cached.cachedAt < SYSTEM_CONFIG_TTL_MS)) {
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
      return res.json({ key, data: cached.data });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const result = await pool.query('SELECT data FROM system_config WHERE key = $1', [key]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Config ' + key + ' not found' });
      }
      const data = result.rows[0].data;
      systemConfigCache.set(key, { data, cachedAt: Date.now() });

      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
      return res.json({ key, data });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to fetch system config' });
    }
  });

  /**
   * GET /api/leaderboard
   * Returns only stored, verified student XP and level metrics from Neon.
   */
  app.get('/api/leaderboard', async (req, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Leaderboard service unavailable.' });

    try {
      const result = await pool.query(
        `SELECT uid, display_name, learning_profile
         FROM users
         WHERE role = 'student'
           AND NULLIF(BTRIM(display_name), '') IS NOT NULL
           AND learning_profile->>'xp' ~ '^[0-9]+$'
           AND learning_profile->>'level' ~ '^[0-9]+$'
         ORDER BY (learning_profile->>'xp')::int DESC, uid ASC
         LIMIT 25`
      );

      const leaders = result.rows.map((row: any, index: number) => {
        const profile = row.learning_profile && typeof row.learning_profile === 'object'
          ? row.learning_profile
          : {};
        const photoURL = typeof profile.avatar === 'string' && profile.avatar.trim()
          ? profile.avatar
          : (typeof profile.photoURL === 'string' && profile.photoURL.trim() ? profile.photoURL : null);
        const streak = Number.isInteger(profile.streak) && profile.streak >= 0
          ? profile.streak
          : null;
        return {
          uid: row.uid,
          displayName: row.display_name,
          photoURL,
          xp: Number(profile.xp),
          level: Number(profile.level),
          streak,
          rank: index + 1
        };
      });

      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      return res.json({ leaderboard: leaders, leaders });
    } catch (error: any) {
      console.error('[Leaderboard] Failed to read recorded student metrics:', error);
      return res.status(503).json({ error: 'Recorded leaderboard metrics could not be verified.' });
    }
  });

  /**
   * GET /api/user/srs
   * Spaced repetition cards for the user from Neon PostgreSQL
   */
  app.get('/api/user/srs', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const courseId = typeof req.query.courseId === 'string' ? req.query.courseId.trim() : '';
      const params: any[] = [user.uid];
      let sql =
        'SELECT id, card_id, course_id, box, next_review_at, review_count, ease_factor, COALESCE(card_data, \'{}\'::jsonb) AS card_data, updated_at ' +
        'FROM user_spaced_repetition WHERE uid = $1';
      if (courseId) {
        params.push(courseId);
        sql += ' AND course_id = $2';
      }
      sql += ' ORDER BY next_review_at ASC';

      const result = await pool.query(sql, params);
      return res.json({ cards: result.rows });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to fetch SRS records', details: err.message });
    }
  });

  /**
   * Shared handler for POST /api/user/srs and POST /api/user/srs/record
   * Computes SM-2 interval/easeFactor dynamically if rating (0..5) is provided, and persists card_data JSONB.
   */
  const handleRecordSrsReview = async (req: express.Request, res: express.Response) => {
    const user = (req as any).user;
    const {
      cardId,
      courseId,
      box,
      rating,
      nextReviewAt,
      easeFactor,
      cardData,
      front,
      back,
      topicTitle,
      explanation,
      source
    } = req.body || {};

    if (typeof cardId !== 'string' || !cardId.trim()) {
      return res.status(400).json({ error: 'A valid cardId is required.' });
    }
    if (rating === undefined && nextReviewAt === undefined) {
      return res.status(400).json({ error: 'A recorded review rating or explicit next-review timestamp is required.' });
    }
    if (rating !== undefined && (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 0 || rating > 5)) {
      return res.status(400).json({ error: 'Review rating must be an integer from 0 to 5.' });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const cleanCardId = cardId.trim();
      const id = cleanCardId.startsWith(`${user.uid}_`) ? cleanCardId : `${user.uid}_${cleanCardId}`;

      const existingRes = await pool.query(
        'SELECT box, review_count, ease_factor, next_review_at, course_id, card_data FROM user_spaced_repetition WHERE id = $1 LIMIT 1',
        [id]
      );
      const existing = existingRes.rows[0] || null;
      const effectiveCourseId = typeof courseId === 'string' && courseId.trim()
        ? courseId.trim()
        : (typeof existing?.course_id === 'string' && existing.course_id.trim() ? existing.course_id : null);
      if (!effectiveCourseId) {
        return res.status(400).json({ error: 'A real courseId is required for a new spaced-repetition card.' });
      }

      const initialBox = existing ? Number(existing.box) : 1;
      const initialEase = existing ? Number(existing.ease_factor) : 2.5;
      let computedBox = typeof box === 'number' ? box : initialBox;
      let computedEase = typeof easeFactor === 'number' ? easeFactor : initialEase;
      if (!Number.isInteger(computedBox) || computedBox < 1 || computedBox > 5 ||
          !Number.isFinite(computedEase) || computedEase < 1.3) {
        return res.status(400).json({ error: 'Persisted or supplied spaced-repetition scheduling state is invalid.' });
      }

      let computedNextReview: Date;
      if (nextReviewAt !== undefined) {
        computedNextReview = new Date(nextReviewAt);
        if (Number.isNaN(computedNextReview.getTime())) {
          return res.status(400).json({ error: 'nextReviewAt must be a valid timestamp.' });
        }
      } else {
        const q = rating as number;
        const previousReviewCount = existing ? Number(existing.review_count) : 0;
        if (!Number.isInteger(previousReviewCount) || previousReviewCount < 0) {
          throw new Error('Persisted spaced-repetition review count is invalid.');
        }
        let intervalDays = 1;
        if (q >= 3) {
          if (previousReviewCount === 0) intervalDays = 1;
          else if (previousReviewCount === 1) intervalDays = 4;
          else intervalDays = Math.max(1, Math.round(previousReviewCount * computedEase));
          computedBox = Math.min(5, computedBox + 1);
        } else {
          computedBox = 1;
        }
        computedEase = Math.max(1.3, computedEase + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
        computedNextReview = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);
      }

      const existingCardData = existing?.card_data && typeof existing.card_data === 'object'
        ? existing.card_data
        : {};
      const suppliedCardData = cardData && typeof cardData === 'object' && !Array.isArray(cardData)
        ? cardData
        : {};
      const mergedCardData = {
        ...existingCardData,
        ...suppliedCardData,
        ...(typeof front === 'string' && front.trim() ? { front } : {}),
        ...(typeof back === 'string' && back.trim() ? { back } : {}),
        ...(typeof topicTitle === 'string' && topicTitle.trim() ? { topicTitle } : {}),
        ...(typeof explanation === 'string' && explanation.trim() ? { explanation } : {}),
        ...(typeof source === 'string' && source.trim() ? { source } : {})
      };

      const upserted = await pool.query(
        `INSERT INTO user_spaced_repetition (id, uid, card_id, course_id, box, next_review_at, review_count, ease_factor, card_data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8::jsonb, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           course_id = EXCLUDED.course_id,
           box = EXCLUDED.box,
           next_review_at = EXCLUDED.next_review_at,
           review_count = user_spaced_repetition.review_count + 1,
           ease_factor = EXCLUDED.ease_factor,
           card_data = COALESCE(user_spaced_repetition.card_data, '{}'::jsonb) || EXCLUDED.card_data,
           updated_at = NOW()
         RETURNING id, card_id, course_id, box, next_review_at, review_count, ease_factor, card_data, updated_at`,
        [
          id,
          user.uid,
          cleanCardId,
          effectiveCourseId,
          computedBox,
          computedNextReview,
          Number(computedEase.toFixed(2)),
          JSON.stringify(mergedCardData)
        ]
      );

      if (!upserted.rows[0]) {
        throw new Error('The database did not return the persisted spaced-repetition record.');
      }
      return res.json({ success: true, card: upserted.rows[0] });
    } catch (err: any) {
      logger.error({ uid: user.uid, cardId, error: err?.message || String(err) }, '[StudentRoutes] Failed to record SRS review');
      return res.status(503).json({ error: 'The spaced-repetition update could not be persisted to the authoritative database.' });
    }
  };

  app.post('/api/user/srs', verifyAuth, handleRecordSrsReview);
  app.post('/api/user/srs/record', verifyAuth, handleRecordSrsReview);

  /**
   * POST /api/user/srs/batch-schedule
   * Automatically schedules missed CBT exam or practice questions into the student's Spaced Repetition deck in Neon PostgreSQL.
   */
  app.post('/api/user/srs/batch-schedule', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const { courseId, paperId, paperTitle, missedQuestions } = req.body || {};

    if (typeof courseId !== 'string' || !courseId.trim()) {
      return res.status(400).json({ error: 'A real courseId is required to schedule missed questions.' });
    }
    if (!Array.isArray(missedQuestions)) {
      return res.status(400).json({ error: 'missedQuestions must be an array from the recorded exam attempt.' });
    }
    if (missedQuestions.length === 0) {
      return res.json({ success: true, scheduledCount: 0, scheduledCards: [] });
    }
    if (missedQuestions.some((question: any) =>
      !question || typeof question.question !== 'string' || !question.question.trim() ||
      typeof question.correctAnswer !== 'string' || !question.correctAnswer.trim()
    )) {
      return res.status(400).json({ error: 'Every missed question must include its actual question text and correct answer.' });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const scheduledCards: any[] = [];
      const effectiveCourseId = courseId.trim();

      for (const question of missedQuestions) {
        const rawQuestionId = String(question.id || crypto.createHash('sha256').update(question.question).digest('hex').slice(0, 16))
          .replace(/[^a-zA-Z0-9_-]/g, '_');
        const cardId = `exam_${effectiveCourseId}_${rawQuestionId}`;
        const rowId = `${user.uid}_${cardId}`;

        const cardDataPayload: Record<string, any> = {
          front: question.question,
          correctAnswer: question.correctAnswer,
          source: 'cbt_exam'
        };
        if (typeof question.topic === 'string' && question.topic.trim()) {
          cardDataPayload.topicTitle = question.topic.trim();
        } else if (typeof paperTitle === 'string' && paperTitle.trim()) {
          cardDataPayload.topicTitle = paperTitle.trim();
        }
        if (typeof question.explanation === 'string' && question.explanation.trim()) {
          cardDataPayload.explanation = question.explanation.trim();
          cardDataPayload.back = `**Correct Answer:** ${question.correctAnswer}\n\n**Explanation:**\n${question.explanation}`;
        } else {
          cardDataPayload.back = `**Correct Answer:** ${question.correctAnswer}`;
        }
        if (typeof question.userAnswer === 'string') {
          cardDataPayload.lastMissedAnswer = question.userAnswer;
        }
        if (typeof paperId === 'string' && paperId.trim()) cardDataPayload.paperId = paperId.trim();
        if (typeof paperTitle === 'string' && paperTitle.trim()) cardDataPayload.paperTitle = paperTitle.trim();

        const upsertRes = await client.query(
          `INSERT INTO user_spaced_repetition (id, uid, card_id, course_id, box, next_review_at, review_count, ease_factor, card_data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 1, NOW(), 0, 2.5, $5::jsonb, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET
             box = 1,
             next_review_at = NOW(),
             ease_factor = GREATEST(1.3, user_spaced_repetition.ease_factor - 0.2),
             card_data = COALESCE(user_spaced_repetition.card_data, '{}'::jsonb) || EXCLUDED.card_data,
             updated_at = NOW()
           RETURNING id, card_id, course_id, box, next_review_at, review_count, ease_factor, card_data`,
          [rowId, user.uid, cardId, effectiveCourseId, JSON.stringify(cardDataPayload)]
        );

        if (!upsertRes.rows[0]) {
          throw new Error(`The missed question ${rawQuestionId} was not persisted to the spaced-repetition table.`);
        }
        scheduledCards.push(upsertRes.rows[0]);
      }

      await client.query('COMMIT');
      return res.json({
        success: true,
        scheduledCount: scheduledCards.length,
        scheduledCards
      });
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError: any) {
        logger.error({ uid: user.uid, error: rollbackError?.message || String(rollbackError) }, '[StudentRoutes] SRS batch rollback failed');
      }
      logger.error({ uid: user.uid, err: err.message }, '[StudentRoutes] Failed to batch-schedule missed exam questions into SRS');
      return res.status(503).json({ error: 'Missed questions could not be scheduled in the authoritative spaced-repetition database.' });
    } finally {
      client.release();
    }
  });

  /**
   * GET /api/user/payments
   * User payment history from Neon PostgreSQL payments table
   */
  app.get('/api/user/payments', verifyAuth, async (req, res) => {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: 'Authenticated user session required.' });

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Payment history unavailable: PostgreSQL is not connected.' });

    try {
      const result = await pool.query(
        `SELECT reference, amount_ngn, plan_type, status, sparks_added, created_at
         FROM payments
         WHERE uid = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [uid]
      );
      const payments = result.rows.map((row: any, index: number) => {
        const amount = Number(row.amount_ngn);
        const sparksAdded = Number(row.sparks_added);
        const createdAt = row.created_at instanceof Date
          ? row.created_at
          : (typeof row.created_at === 'string' && row.created_at.trim() ? new Date(row.created_at) : null);
        if (typeof row.reference !== 'string' || !row.reference.trim() ||
            typeof row.plan_type !== 'string' || !row.plan_type.trim() ||
            typeof row.status !== 'string' || !row.status.trim() ||
            !Number.isFinite(amount) || !Number.isFinite(sparksAdded) ||
            !createdAt || Number.isNaN(createdAt.getTime())) {
          throw new Error(`Persisted payment record ${index + 1} is incomplete or invalid.`);
        }

        return {
          id: row.reference,
          reference: row.reference,
          amount,
          plan_type: row.plan_type,
          status: row.status,
          sparks_added: sparksAdded,
          createdAt: createdAt.toISOString()
        };
      });
      return res.json({ payments });
    } catch (err: any) {
      logger.error({ uid, error: err?.message || String(err) }, '[StudentRoutes] Payment history could not be verified');
      return res.status(503).json({ error: 'Payment history could not be verified from the authoritative database.' });
    }
  });

  /**
   * POST /api/curriculum-requests
   * Student course curriculum request submission into Neon PostgreSQL
   */
  app.post('/api/curriculum-requests', verifyAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const pool = getPostgresPool();
      if (!pool) {
        return res.status(503).json({ error: 'Database unavailable' });
      }
      const { department, level, semester, courseCode, courseTitle } = req.body || {};
      const requiredFields = { department, level, semester, courseCode, courseTitle };
      const missingFields = Object.entries(requiredFields)
        .filter(([, value]) => typeof value !== 'string' || !value.trim())
        .map(([key]) => key);
      if (missingFields.length > 0) {
        return res.status(400).json({ error: 'Required curriculum request fields are missing.', fields: missingFields });
      }
      if (typeof user.email !== 'string' || !user.email.trim()) {
        return res.status(400).json({ error: 'A verified account email is required for a curriculum request.' });
      }

      const id = `creq_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const normalized = {
        department: department.trim(),
        level: level.trim(),
        semester: semester.trim(),
        courseCode: courseCode.trim(),
        courseTitle: courseTitle.trim()
      };
      const payload = {
        id,
        userId: user.uid,
        email: user.email,
        ...normalized,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      await pool.query(
        `INSERT INTO curriculum_requests (id, user_id, user_email, course_code, course_title, department, level, status, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8::jsonb, NOW())`,
        [id, user.uid, user.email, normalized.courseCode, normalized.courseTitle, normalized.department, normalized.level, JSON.stringify(payload)]
      );
      return res.json({ success: true, request: payload });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to submit curriculum request' });
    }
  });

  /**
   * GET /api/affiliate/me
   * Tutor/Affiliate personal metrics & payout history from Neon PostgreSQL
   */
  app.get('/api/affiliate/me', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const pool = getPostgresPool();
    if (!pool) {
      return res.status(503).json({ error: 'Affiliate data unavailable: PostgreSQL is not connected.' });
    }

    const optionalNumeric = (value: unknown, field: string): number | null => {
      if (value === null || value === undefined) return null;
      const parsed = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
      if (!Number.isFinite(parsed)) throw new Error(`Persisted affiliate field ${field} is not a valid number.`);
      return parsed;
    };
    const optionalIso = (value: unknown, field: string): string | null => {
      if (value === null || value === undefined) return null;
      const date = value instanceof Date ? value : (typeof value === 'string' && value.trim() ? new Date(value) : null);
      if (!date || Number.isNaN(date.getTime())) throw new Error(`Persisted affiliate field ${field} is not a valid timestamp.`);
      return date.toISOString();
    };

    try {
      const [affiliateResult, payoutsResult] = await Promise.all([
        pool.query(
          `SELECT code, user_id, email, display_name, total_earned, pending_payout, referral_count, bank_details, status, data
           FROM affiliates
           WHERE user_id = $1
           LIMIT 1`,
          [user.uid]
        ),
        pool.query(
          `SELECT id, amount, status, bank_details, data, created_at
           FROM payout_requests
           WHERE user_id = $1
           ORDER BY created_at DESC`,
          [user.uid]
        )
      ]);

      let affiliate: any = null;
      if (affiliateResult.rows.length > 0) {
        const row = affiliateResult.rows[0];
        const rawData = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
        if (typeof row.code !== 'string' || !row.code.trim() ||
            typeof row.user_id !== 'string' || row.user_id !== user.uid) {
          throw new Error('Persisted affiliate identity is incomplete or inconsistent.');
        }
        const displayName = typeof row.display_name === 'string' && row.display_name.trim()
          ? row.display_name
          : (typeof rawData.name === 'string' && rawData.name.trim() ? rawData.name : null);
        const email = typeof row.email === 'string' && row.email.trim()
          ? row.email
          : (typeof rawData.email === 'string' && rawData.email.trim() ? rawData.email : (typeof user.email === 'string' ? user.email : null));

        affiliate = {
          ...rawData,
          id: row.code,
          userId: row.user_id,
          name: displayName,
          email,
          totalEarned: optionalNumeric(row.total_earned ?? rawData.totalEarned, 'totalEarned'),
          pendingBalance: optionalNumeric(row.pending_payout ?? rawData.pendingBalance, 'pendingBalance'),
          signups: optionalNumeric(rawData.signups ?? row.referral_count, 'signups'),
          clicks: optionalNumeric(rawData.clicks, 'clicks'),
          paidConversions: optionalNumeric(rawData.paidConversions ?? row.referral_count, 'paidConversions'),
          status: typeof row.status === 'string' ? row.status : (typeof rawData.status === 'string' ? rawData.status : null),
          payoutDetails: row.bank_details && typeof row.bank_details === 'object' && Object.keys(row.bank_details).length > 0
            ? row.bank_details
            : (rawData.payoutDetails && typeof rawData.payoutDetails === 'object' ? rawData.payoutDetails : null)
        };
      }

      const payouts = payoutsResult.rows.map((row: any, index: number) => {
        if (typeof row.id !== 'string' || !row.id.trim()) {
          throw new Error(`Persisted payout record ${index + 1} is missing its identifier.`);
        }
        const rawData = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
        return {
          ...rawData,
          id: row.id,
          amount: optionalNumeric(row.amount, `payout[${index}].amount`),
          status: typeof row.status === 'string' ? row.status : null,
          bankDetails: row.bank_details && typeof row.bank_details === 'object' ? row.bank_details : null,
          createdAt: optionalIso(row.created_at, `payout[${index}].created_at`)
        };
      });

      return res.json({ affiliate, payouts });
    } catch (err: any) {
      logger.error({ uid: user.uid, error: err?.message || String(err) }, '[StudentRoutes] Affiliate data could not be verified');
      return res.status(503).json({ error: 'Affiliate and payout data could not be verified from the authoritative database.' });
    }
  });

  /**
   * GET /api/support/chats/:chatId/messages
   * Fetch live support chat messages from Neon PostgreSQL
   */
  app.get('/api/support/chats/:chatId/messages', verifyAuth, async (req, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Support chat history unavailable: PostgreSQL is not connected.' });
    try {
      const user = (req as any).user;
      const chatRes = await pool.query(
        `SELECT messages FROM support_chats WHERE id = $1 AND user_id = $2`,
        [req.params.chatId, user.uid]
      );
      if (chatRes.rows.length === 0) {
        return res.status(404).json({ error: 'Support chat was not found for the authenticated user.' });
      }
      if (!Array.isArray(chatRes.rows[0].messages)) {
        return res.status(503).json({ error: 'Stored support chat history is incomplete and could not be verified.' });
      }
      return res.json({ messages: chatRes.rows[0].messages });
    } catch (err: any) {
      logger.error({ chatId: req.params.chatId, error: err?.message || String(err) }, '[StudentRoutes] Support chat history lookup failed');
      return res.status(503).json({ error: 'Support chat history could not be verified from the authoritative database.' });
    }
  });

  /**
   * POST /api/support/chats/:chatId/messages
   * Append a support chat message in Neon PostgreSQL
   */
  app.post('/api/support/chats/:chatId/messages', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const chatId = typeof req.params.chatId === 'string' ? req.params.chatId.trim() : '';
    const messageText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!chatId) return res.status(400).json({ error: 'A valid chatId is required.' });
    if (!messageText) return res.status(400).json({ error: 'A non-empty message is required.' });

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Support messaging unavailable: PostgreSQL is not connected.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT user_id, user_name, user_email, messages
         FROM support_chats
         WHERE id = $1
         FOR UPDATE`,
        [chatId]
      );
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Support chat does not exist.' });
      }
      const chat = existing.rows[0];
      if (chat.user_id !== user.uid) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Support chat does not exist for the authenticated user.' });
      }
      if (!Array.isArray(chat.messages)) {
        throw new Error('Persisted support chat messages are missing or invalid.');
      }
      const senderName = typeof chat.user_name === 'string' && chat.user_name.trim()
        ? chat.user_name
        : (typeof user.name === 'string' && user.name.trim()
          ? user.name
          : (typeof user.email === 'string' && user.email.trim() ? user.email : null));
      if (!senderName) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A verified sender identity is required to send a support message.' });
      }

      const newMessage = {
        id: `msg_${Date.now()}_${crypto.randomUUID()}`,
        senderId: user.uid,
        senderName,
        text: messageText,
        timestamp: new Date().toISOString()
      };
      const updatedMessages = [...chat.messages, newMessage];
      const updated = await client.query(
        `UPDATE support_chats
         SET last_message = $1, messages = $2::jsonb, status = 'active', updated_at = NOW()
         WHERE id = $3 AND user_id = $4
         RETURNING id`,
        [messageText, JSON.stringify(updatedMessages), chatId, user.uid]
      );
      if (updated.rowCount !== 1) {
        throw new Error('The support message update did not persist to the owned chat.');
      }
      await client.query('COMMIT');
      return res.json({ success: true, message: newMessage, messages: updatedMessages });
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError: any) {
        logger.error({ chatId, error: rollbackError?.message || String(rollbackError) }, '[StudentRoutes] Support chat rollback failed');
      }
      logger.error({ uid: user.uid, chatId, error: err?.message || String(err) }, '[StudentRoutes] Support message could not be persisted');
      return res.status(503).json({ error: 'Support message could not be persisted to the authoritative database.' });
    } finally {
      client.release();
    }
  });

  /**
   * POST /api/support/tickets
   * Create a support ticket in Neon PostgreSQL
   */
  app.post('/api/support/tickets', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Support ticket service unavailable: PostgreSQL is not connected.' });

    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const requestedName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const name = requestedName ||
      (typeof user.name === 'string' && user.name.trim() ? user.name : '') ||
      (typeof user.email === 'string' && user.email.trim() ? user.email : '');
    const email = typeof req.body?.email === 'string' && req.body.email.trim()
      ? req.body.email.trim()
      : (typeof user.email === 'string' && user.email.trim() ? user.email : null);

    if (!subject || !message) {
      return res.status(400).json({ error: 'A non-empty support subject and message are required.' });
    }
    if (!name) {
      return res.status(400).json({ error: 'A verified name or account email is required for the support ticket.' });
    }

    try {
      const id = `tkt_${Date.now()}_${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const payload = {
        id,
        userId: user.uid,
        name,
        email,
        subject,
        message,
        status: 'open',
        createdAt
      };
      const inserted = await pool.query(
        `INSERT INTO support_tickets (id, user_id, user_email, user_name, subject, message, status, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7::jsonb, NOW(), NOW())
         RETURNING id`,
        [id, user.uid, email, name, subject, message, JSON.stringify(payload)]
      );
      if (inserted.rowCount !== 1 || inserted.rows[0]?.id !== id) {
        throw new Error('Support ticket insert was not confirmed by the database.');
      }
      return res.json({ success: true, ticket: payload });
    } catch (err: any) {
      logger.error({ uid: user.uid, error: err?.message || String(err) }, '[StudentRoutes] Support ticket write failed');
      return res.status(503).json({ error: 'Support ticket could not be persisted to the authoritative database.' });
    }
  });

  /**
   * Helper: Fetch current waiting lobbies from Neon PostgreSQL
   */
  const fetchWaitingArenaBattles = async (pool: any) => {
    await pool.query(
      `DELETE FROM arena_battles WHERE status = 'waiting' AND created_at < NOW() - INTERVAL '10 minutes'`
    );

    const waitingRes = await pool.query(
      `SELECT id, topic, created_at, data
       FROM arena_battles
       WHERE status = 'waiting'
         AND data->'player1'->>'opponentType' = 'human'
         AND jsonb_typeof(data->'questions') = 'array'
         AND jsonb_array_length(data->'questions') > 0
       ORDER BY created_at ASC
       LIMIT 20`
    );

    return waitingRes.rows.flatMap((row: any) => {
      const host = row.data?.player1;
      const questions = row.data?.questions;
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      const hostName = typeof host?.name === 'string' ? host.name.trim() : '';
      const hostUid = typeof host?.uid === 'string' ? host.uid.trim() : '';
      const topicId = typeof row.topic === 'string' ? row.topic.trim() : '';

      if (
        typeof row.id !== 'string' ||
        !topicId ||
        !hostUid ||
        !hostName ||
        ['gladiator', 'scholar'].includes(hostName.toLowerCase()) ||
        !createdAt ||
        !Number.isFinite(createdAt.getTime()) ||
        !Array.isArray(questions) ||
        questions.length === 0
      ) {
        return [];
      }

      return [{
        id: row.id,
        topicId,
        hostUid,
        hostName,
        hostAvatar: typeof host.avatar === 'string' && host.avatar.trim() ? host.avatar : '',
        questionCount: questions.length,
        createdAt: createdAt.toISOString()
      }];
    });
  };

  /**
   * Helper: Execute a server-scheduled opponent step from a validated recorded human replay.
   */  /**
   * Helper: Execute a server-scheduled opponent step (for recorded Ghost Replay or Telemetry-Calibrated Challenger)
   */
  const executeServerScheduledOpponentMove = async (
    battleId: string,
    questionIndex: number,
    selectedOption: string,
    isCorrect: boolean,
    elapsedMs: number
  ) => {
    const pool = getPostgresPool();
    if (!pool) throw new Error('PostgreSQL is unavailable; recorded replay step was not executed.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(`SELECT id, data FROM arena_battles WHERE id = $1 FOR UPDATE`, [battleId]);
      if ((res.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return;
      }
      const data = { ...(res.rows[0].data || {}), id: battleId };
      if (data.status !== 'active' || !data.player2) {
        await client.query('COMMIT');
        return;
      }

      const nowMs = Date.now();
      if (data.expiresAtEpochMs && nowMs >= data.expiresAtEpochMs) {
        await client.query('ROLLBACK');
        await arenaRealtime.settleExpiredBattle(battleId, nowMs);
        return;
      }

      const p2 = { ...data.player2 };
      const p1 = { ...data.player1 };
      if (p2.currentQuestionIndex !== questionIndex) {
        await client.query('COMMIT');
        return;
      }

      const actionLog = Array.isArray(p2.actionLog) ? [...p2.actionLog] : [];
      actionLog.push({
        questionIndex,
        selectedOption,
        correct: isCorrect,
        elapsedMs,
        timestamp: new Date(nowMs).toISOString()
      });
      p2.actionLog = actionLog;
      p2.currentQuestionIndex = questionIndex + 1;

      const DAMAGE_PER_HIT = 20;
      if (isCorrect) {
        p2.score = Number(p2.score || 0) + 100;
        p1.health = Math.max(0, Number(p1.health ?? 100) - DAMAGE_PER_HIT);
      } else {
        p2.health = Math.max(0, Number(p2.health ?? 100) - DAMAGE_PER_HIT);
      }

      data.player1 = p1;
      data.player2 = p2;

      const totalQuestions = Array.isArray(data.questions) ? data.questions.length : 0;
      if (totalQuestions === 0) throw new Error('Recorded replay has no verified question set.');
      const bothFinishedQuestions =
        p1.currentQuestionIndex >= totalQuestions && p2.currentQuestionIndex >= totalQuestions;

      if (p1.health <= 0 || p2.health <= 0 || bothFinishedQuestions) {
        let winnerId = 'draw';
        if (p1.health <= 0 && p2.health > 0) winnerId = p2.uid;
        else if (p2.health <= 0 && p1.health > 0) winnerId = p1.uid;
        else if (p1.score > p2.score) winnerId = p1.uid;
        else if (p2.score > p1.score) winnerId = p2.uid;
        else if (p1.health > p2.health) winnerId = p1.uid;
        else if (p2.health > p1.health) winnerId = p2.uid;

        data.status = 'finished';
        data.winner = winnerId;
        data.finishedAt = new Date(nowMs).toISOString();
        data.finishedAtEpochMs = nowMs;
        arenaRealtime.clearBattleSchedule(battleId);

        if (!data.statsSettled) {
          await arenaRealtime.settlePlayersArenaStatsInTx(client, data);
          data.statsSettled = true;
          invalidateBootstrapCache(p1.uid);
        }
      }

      await client.query(
        `UPDATE arena_battles
         SET status = $1, winner_id = $2, data = $3::jsonb, updated_at = NOW()
         WHERE id = $4`,
        [data.status, data.winner || null, JSON.stringify(data), battleId]
      );

      await client.query('COMMIT');
      arenaRealtime.broadcastToBattle(
        battleId,
        data.status === 'finished' ? 'battle:finished' : 'battle:state',
        data
      );
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      logger.warn({ battleId, err: err.message }, '[Arena] Scheduled opponent move failed');
    } finally {
      client.release();
    }
  };

  const findVerifiedGhostRecording = async (db: any, topicId: string, excludedBattleId?: string) => {
    const candidates = await db.query(
      `SELECT b.id,
              b.updated_at,
              b.data,
              p1.uid AS verified_player1_uid,
              p2.uid AS verified_player2_uid
       FROM arena_battles AS b
       JOIN users AS p1
         ON p1.uid = b.data->'player1'->>'uid'
       JOIN users AS p2
         ON p2.uid = b.data->'player2'->>'uid'
       WHERE b.status = 'finished'
         AND b.topic = $1
         AND ($2::text IS NULL OR b.id <> $2)
         AND b.data->>'opponentType' = 'human'
         AND b.data->'player1'->>'opponentType' = 'human'
         AND b.data->'player2'->>'opponentType' = 'human'
         AND (
           CASE
             WHEN jsonb_typeof(b.data->'player1'->'actionLog') = 'array'
             THEN jsonb_array_length(b.data->'player1'->'actionLog') > 0
             ELSE FALSE
           END
           OR
           CASE
             WHEN jsonb_typeof(b.data->'player2'->'actionLog') = 'array'
             THEN jsonb_array_length(b.data->'player2'->'actionLog') > 0
             ELSE FALSE
           END
         )
       ORDER BY b.updated_at DESC`,
      [topicId, excludedBattleId || null]
    );

    for (const row of candidates.rows) {
      const verified = validateRecordedHumanReplay(row);
      if (verified) return verified;
    }
    return null;
  };

  /**
   * GET /api/arena/lobby-telemetry
   * Returns live presence, valid waiting human matches, and verified historical replay availability.
   */
  app.get('/api/arena/lobby-telemetry', verifyAuth, async (req, res) => {
    try {
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });

      const user = (req as any).user;
      const topicId = typeof req.query.topicId === 'string' ? req.query.topicId.trim() : '';
      const waitingBattles = await fetchWaitingArenaBattles(pool);
      const presence = arenaRealtime.getOnlinePresenceSummary();
      const latestGhost = topicId ? await findVerifiedGhostRecording(pool, topicId) : null;

      return res.json({
        serverNow: Date.now(),
        serverIsoTime: new Date().toISOString(),
        onlineCount: presence.onlineCount,
        onlineUsers: presence.users,
        waitingBattles,
        ghostReplayAvailable: Boolean(latestGhost),
        latestGhostMeta: latestGhost
          ? {
              battleId: latestGhost.id,
              playerName: latestGhost.sourcePlayer.name,
              recordedAt: latestGhost.recordedAt
            }
          : null
      });
    } catch (err: any) {
      logger.error({ uid: (req as any).user?.uid, error: err?.message || String(err) }, '[Arena] Failed to resolve live lobby telemetry');
      return res.status(503).json({ error: 'Arena lobby telemetry could not be verified from live records.' });
    }
  });

  app.post('/api/arena/matchmake', verifyAuth, async (req: any, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });

    const user = req.user;
    const body = req.body || {};
    const topicId = typeof body.topicId === 'string' ? body.topicId.trim() : '';
    const player = body.player;
    const questions = body.questions;
    const targetBattleId = typeof body.targetBattleId === 'string' ? body.targetBattleId.trim() : '';
    const skipQueueJoin = body.skipQueueJoin === true;

    if (!topicId || !player || typeof player.name !== 'string' || !player.name.trim() ||
        ['gladiator', 'scholar'].includes(player.name.trim().toLowerCase())) {
      return res.status(400).json({ error: 'A live course reference and verified student display name are required.' });
    }
    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: 'A question array is required; missing question data is not replaced with defaults.' });
    }

    const hasVerifiedQuestionSet = questions.length > 0 && questions.every((question: any) =>
      question &&
      typeof question.question === 'string' &&
      question.question.trim().length > 0 &&
      Array.isArray(question.options) &&
      question.options.length >= 2 &&
      question.options.every((option: unknown) => typeof option === 'string' && option.trim().length > 0) &&
      typeof question.correctAnswer === 'string' &&
      question.options.includes(question.correctAnswer)
    );

    if (!skipQueueJoin && !targetBattleId && !hasVerifiedQuestionSet) {
      return res.status(400).json({ error: 'A complete question set with answer choices and matching correct answers is required to open a human match.' });
    }
    if (skipQueueJoin && targetBattleId) {
      return res.status(400).json({ error: 'A direct replay room cannot also target another waiting battle.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let validRow: any = null;
      if (!skipQueueJoin) {
        const waitingQuery = targetBattleId
          ? `
              SELECT id, topic, data
              FROM arena_battles
              WHERE status = 'waiting'
                AND id = $1
                AND topic = $2
                AND CASE
                  WHEN jsonb_typeof(data->'questions') = 'array'
                  THEN jsonb_array_length(data->'questions') > 0
                  ELSE FALSE
                END
              FOR UPDATE SKIP LOCKED
            `
          : `
              SELECT id, topic, data
              FROM arena_battles
              WHERE status = 'waiting'
                AND topic = $1
                AND CASE
                  WHEN jsonb_typeof(data->'questions') = 'array'
                  THEN jsonb_array_length(data->'questions') > 0
                  ELSE FALSE
                END
              ORDER BY created_at ASC
              LIMIT 5
              FOR UPDATE SKIP LOCKED
            `;
        const queryParams = targetBattleId ? [targetBattleId, topicId] : [topicId];
        const waitingRes = await client.query(waitingQuery, queryParams);
        validRow = waitingRes.rows.find(
          (row: any) => typeof row.data?.player1?.uid === 'string' && row.data.player1.uid !== user.uid
        );

        if (targetBattleId && !validRow) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'The selected waiting human battle is no longer available for this course.' });
        }
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      if (validRow) {
        const questionList = validRow.data?.questions;
        const existingQuestionSetIsValid = Array.isArray(questionList) && questionList.length > 0 &&
          questionList.every((question: any) =>
            question &&
            typeof question.question === 'string' &&
            question.question.trim().length > 0 &&
            Array.isArray(question.options) &&
            question.options.length >= 2 &&
            question.options.every((option: unknown) => typeof option === 'string' && option.trim().length > 0) &&
            typeof question.correctAnswer === 'string' &&
            question.options.includes(question.correctAnswer)
          );
        if (!existingQuestionSetIsValid) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'The waiting battle does not contain a verifiable question set.' });
        }

        const durationSeconds = 60;
        const expiresAtEpochMs = nowMs + durationSeconds * 1000;
        const expiresAt = new Date(expiresAtEpochMs).toISOString();
        const sanitizedPlayer2 = {
          ...player,
          uid: user.uid,
          health: 100,
          score: 0,
          currentQuestionIndex: 0,
          status: 'playing',
          opponentType: 'human',
          actionLog: []
        };

        const updatedBattle = {
          ...validRow.data,
          id: validRow.id,
          topicId: validRow.topic,
          player1: {
            ...validRow.data.player1,
            status: 'playing',
            opponentType: 'human',
            actionLog: Array.isArray(validRow.data.player1?.actionLog) ? validRow.data.player1.actionLog : []
          },
          player2: sanitizedPlayer2,
          questions: questionList,
          status: 'active',
          opponentType: 'human',
          startedAt: nowIso,
          startedAtEpochMs: nowMs,
          durationSeconds,
          expiresAt,
          expiresAtEpochMs
        };

        await client.query(
          `UPDATE arena_battles
           SET status = 'active', data = $1::jsonb, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(updatedBattle), validRow.id]
        );
        await client.query('COMMIT');

        arenaRealtime.registerActiveBattleSchedule(validRow.id, expiresAtEpochMs, []);
        arenaRealtime.broadcastToBattle(validRow.id, 'battle:started', updatedBattle);
        const remainingWaiting = await fetchWaitingArenaBattles(pool);
        arenaRealtime.broadcastLobbyQueueUpdate(remainingWaiting);

        return res.json({
          joined: true,
          battleId: validRow.id,
          battle: updatedBattle,
          serverNow: Date.now()
        });
      }

      const battleId = `battle_${nowMs}_${crypto.randomUUID().slice(0, 6)}`;
      const newBattle = {
        id: battleId,
        status: 'waiting',
        opponentType: 'human',
        player1: {
          ...player,
          uid: user.uid,
          health: 100,
          score: 0,
          currentQuestionIndex: 0,
          status: 'ready',
          opponentType: 'human',
          actionLog: []
        },
        player2: null,
        questions,
        winner: null,
        createdAt: nowIso,
        createdAtEpochMs: nowMs,
        topicId
      };

      await client.query(
        `INSERT INTO arena_battles (id, topic, status, questions, data, created_at, updated_at)
         VALUES ($1, $2, 'waiting', $3::jsonb, $4::jsonb, NOW(), NOW())`,
        [battleId, topicId, JSON.stringify(questions), JSON.stringify(newBattle)]
      );
      await client.query('COMMIT');

      const updatedWaiting = await fetchWaitingArenaBattles(pool);
      arenaRealtime.broadcastLobbyQueueUpdate(updatedWaiting);

      return res.json({
        joined: false,
        battleId,
        battle: newBattle,
        serverNow: Date.now()
      });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ uid: user?.uid, topicId, error: err?.message || String(err) }, '[Arena] Matchmaking failed');
      return res.status(500).json({ error: 'Failed to create or join the requested human battle.' });
    } finally {
      client.release();
    }
  });

  /**
   * POST /api/arena/battles/:battleId/spar
   * Starts only a validated replay of real historical human answers.
   * Synthetic or algorithmically simulated challengers are not available.
   */
  app.post('/api/arena/battles/:battleId/spar', verifyAuth, async (req, res) => {
    if (req.body?.mode !== 'ghost_replay') {
      return res.status(409).json({
        error: 'Only verified historical human replays are available. Synthetic challenger responses are disabled.',
        code: 'SYNTHETIC_CHALLENGER_DISABLED'
      });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });

    const user = (req as any).user;
    const { battleId } = req.params;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const existingRes = await client.query(
        `SELECT id, topic, data FROM arena_battles WHERE id = $1 FOR UPDATE`,
        [battleId]
      );
      if ((existingRes.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Waiting battle not found' });
      }

      const battleData = { ...(existingRes.rows[0].data || {}), id: battleId };
      if (battleData.player1?.uid !== user.uid) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Only the owner of this waiting battle can launch its replay.' });
      }

      if (battleData.status !== 'waiting') {
        await client.query('COMMIT');
        return res.json({ success: true, battle: battleData, serverNow: Date.now() });
      }

      const topicId = typeof existingRes.rows[0].topic === 'string'
        ? existingRes.rows[0].topic.trim()
        : '';
      if (!topicId) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The waiting battle has no verified course reference.' });
      }

      const replay = await findVerifiedGhostRecording(client, topicId, battleId);
      if (!replay) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'No complete, internally consistent human recording is available for this course.',
          code: 'NO_VERIFIED_GHOST_RECORDING'
        });
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const durationSeconds = replay.durationSeconds;
      const expiresAtEpochMs = nowMs + durationSeconds * 1000;
      const expiresAt = new Date(expiresAtEpochMs).toISOString();

      const scheduledActions: Array<{ delayMs: number; execute: () => Promise<void> }> =
        replay.actions.map(action => ({
          delayMs: action.elapsedMs,
          execute: async () => {
            await executeServerScheduledOpponentMove(
              battleId,
              action.questionIndex,
              action.selectedOption,
              action.correct,
              action.elapsedMs
            );
          }
        }));

      battleData.questions = replay.questions;
      battleData.opponentType = 'ghost_replay';
      battleData.recordedFromBattleId = replay.id;
      battleData.recordedBattleTimestamp = replay.recordedAt;
      battleData.player2 = {
        uid: `ghost_replay:${replay.id}:${replay.sourcePlayer.uid}`,
        name: `${replay.sourcePlayer.name} (Recorded Replay)`,
        avatar: replay.sourcePlayer.avatar || '',
        score: 0,
        currentQuestionIndex: 0,
        health: 100,
        status: 'playing',
        opponentType: 'ghost_replay',
        recordedFromBattleId: replay.id,
        recordedAt: replay.recordedAt,
        actionLog: []
      };

      battleData.player1 = {
        ...battleData.player1,
        status: 'playing',
        actionLog: Array.isArray(battleData.player1.actionLog) ? battleData.player1.actionLog : []
      };
      battleData.status = 'active';
      battleData.startedAt = nowIso;
      battleData.startedAtEpochMs = nowMs;
      battleData.durationSeconds = durationSeconds;
      battleData.expiresAt = expiresAt;
      battleData.expiresAtEpochMs = expiresAtEpochMs;

      await client.query(
        `UPDATE arena_battles
         SET status = 'active', questions = $1::jsonb, data = $2::jsonb, updated_at = NOW()
         WHERE id = $3`,
        [JSON.stringify(replay.questions), JSON.stringify(battleData), battleId]
      );
      await client.query('COMMIT');

      arenaRealtime.registerActiveBattleSchedule(battleId, expiresAtEpochMs, scheduledActions);
      arenaRealtime.broadcastToBattle(battleId, 'battle:started', battleData);
      const remainingWaiting = await fetchWaitingArenaBattles(pool);
      arenaRealtime.broadcastLobbyQueueUpdate(remainingWaiting);

      return res.json({ success: true, battle: battleData, serverNow: Date.now() });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ battleId, uid: user.uid, error: err?.message || String(err) }, '[Arena] Failed to launch verified replay');
      return res.status(500).json({ error: 'The verified replay could not be started.' });
    } finally {
      client.release();
    }
  });

  app.post('/api/arena/battles/:battleId/answer', verifyAuth, async (req, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });

    const user = (req as any).user;
    const { battleId } = req.params;
    const { selectedOption } = req.body || {};
    if (typeof selectedOption !== 'string') {
      return res.status(400).json({ error: 'selectedOption is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT id, data FROM arena_battles WHERE id = $1 FOR UPDATE`,
        [battleId]
      );
      if ((existing.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Battle not found' });
      }

      const data = { ...(existing.rows[0].data || {}), id: battleId };
      const nowMs = Date.now();

      if (data.status === 'finished') {
        await client.query('COMMIT');
        return res.json({ success: true, battle: data, serverNow: nowMs });
      }

      if (data.status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The battle is not in an active answerable state.' });
      }

      const durationSeconds = data.durationSeconds;
      const startedAtMs = data.startedAtEpochMs;
      const expiresAtEpochMs = data.expiresAtEpochMs;
      if (
        typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0 ||
        typeof startedAtMs !== 'number' || !Number.isFinite(startedAtMs) || startedAtMs <= 0 ||
        typeof expiresAtEpochMs !== 'number' || !Number.isFinite(expiresAtEpochMs) ||
        expiresAtEpochMs <= startedAtMs || startedAtMs > nowMs
      ) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The persisted battle timing data is incomplete or invalid.' });
      }

      if (nowMs >= expiresAtEpochMs) {
        await client.query('ROLLBACK');
        const settled = await arenaRealtime.settleExpiredBattle(battleId, nowMs);
        return res.json({ success: true, battle: settled, serverNow: nowMs });
      }

      const isPlayer1 = data.player1?.uid === user.uid;
      const isPlayer2 = data.player2?.uid === user.uid;
      if (!isPlayer1 && !isPlayer2) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not a participant in this battle' });
      }

      const activePlayer = isPlayer1 ? { ...data.player1 } : { ...data.player2 };
      const opponentPlayer = isPlayer1 ? { ...data.player2 } : { ...data.player1 };
      const questions = data.questions;
      if (!Array.isArray(questions) || questions.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The battle has no verified question set.' });
      }

      const qIndex = activePlayer.currentQuestionIndex;
      const opponentQuestionIndex = opponentPlayer.currentQuestionIndex;
      if (
        typeof qIndex !== 'number' || !Number.isSafeInteger(qIndex) || qIndex < 0 || qIndex >= questions.length ||
        typeof opponentQuestionIndex !== 'number' || !Number.isSafeInteger(opponentQuestionIndex) ||
        opponentQuestionIndex < 0 || opponentQuestionIndex > questions.length
      ) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The persisted participant question progress is invalid.' });
      }

      const currentQuestion = questions[qIndex];
      if (
        !currentQuestion || typeof currentQuestion !== 'object' || Array.isArray(currentQuestion) ||
        !Array.isArray(currentQuestion.options) ||
        !currentQuestion.options.every((option: unknown) => typeof option === 'string') ||
        typeof currentQuestion.correctAnswer !== 'string' ||
        !currentQuestion.options.includes(currentQuestion.correctAnswer)
      ) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The current question is not verifiable.' });
      }
      if (!currentQuestion.options.includes(selectedOption)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'The selected answer is not one of the verified question options.' });
      }

      if (
        typeof activePlayer.score !== 'number' || !Number.isFinite(activePlayer.score) ||
        typeof opponentPlayer.score !== 'number' || !Number.isFinite(opponentPlayer.score) ||
        typeof activePlayer.health !== 'number' || !Number.isFinite(activePlayer.health) ||
        typeof opponentPlayer.health !== 'number' || !Number.isFinite(opponentPlayer.health)
      ) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The persisted participant score or health state is invalid.' });
      }

      const isCorrect = selectedOption === currentQuestion.correctAnswer;
      const elapsedMs = nowMs - startedAtMs;
      if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs > durationSeconds * 1000) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The answer timestamp is outside the verified battle duration.' });
      }

      const actionLog = Array.isArray(activePlayer.actionLog) ? [...activePlayer.actionLog] : [];
      actionLog.push({
        questionIndex: qIndex,
        selectedOption,
        correct: isCorrect,
        elapsedMs,
        timestamp: new Date(nowMs).toISOString()
      });

      activePlayer.actionLog = actionLog;
      activePlayer.currentQuestionIndex = qIndex + 1;

      const DAMAGE_PER_HIT = 20;
      if (isCorrect) {
        activePlayer.score = activePlayer.score + 100;
        opponentPlayer.health = Math.max(0, opponentPlayer.health - DAMAGE_PER_HIT);
      } else {
        activePlayer.health = Math.max(0, activePlayer.health - DAMAGE_PER_HIT);
      }

      if (isPlayer1) {
        data.player1 = activePlayer;
        data.player2 = opponentPlayer;
      } else {
        data.player2 = activePlayer;
        data.player1 = opponentPlayer;
      }

      const totalQuestions = questions.length;
      const bothFinishedQuestions =
        data.player1.currentQuestionIndex >= totalQuestions &&
        data.player2.currentQuestionIndex >= totalQuestions;

      if (
        data.player1.health <= 0 ||
        data.player2.health <= 0 ||
        bothFinishedQuestions
      ) {
        const p1 = data.player1;
        const p2 = data.player2;
        let winnerId = 'draw';
        if (p1.health <= 0 && p2.health > 0) winnerId = p2.uid;
        else if (p2.health <= 0 && p1.health > 0) winnerId = p1.uid;
        else if (p1.score > p2.score) winnerId = p1.uid;
        else if (p2.score > p1.score) winnerId = p2.uid;
        else if (p1.health > p2.health) winnerId = p1.uid;
        else if (p2.health > p1.health) winnerId = p2.uid;

        data.status = 'finished';
        data.winner = winnerId;
        data.finishedAt = new Date(nowMs).toISOString();
        data.finishedAtEpochMs = nowMs;
        arenaRealtime.clearBattleSchedule(battleId);

        if (!data.statsSettled) {
          await arenaRealtime.settlePlayersArenaStatsInTx(client, data);
          data.statsSettled = true;
          invalidateBootstrapCache(user.uid);
          if (opponentPlayer?.uid) invalidateBootstrapCache(opponentPlayer.uid);
        }
      }

      await client.query(
        `UPDATE arena_battles
         SET status = $1, winner_id = $2, data = $3::jsonb, updated_at = NOW()
         WHERE id = $4`,
        [data.status, data.winner || null, JSON.stringify(data), battleId]
      );

      await client.query('COMMIT');

      arenaRealtime.broadcastToBattle(
        battleId,
        data.status === 'finished' ? 'battle:finished' : 'battle:state',
        data
      );

      return res.json({
        success: true,
        correct: isCorrect,
        battle: data,
        serverNow: Date.now()
      });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(500).json({ error: err.message || 'Failed to record battle answer' });
    } finally {
      client.release();
    }
  });

  app.get('/api/arena/battles/:battleId', verifyAuth, async (req: any, res) => {
    try {
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });
      const battleId = req.params.battleId;
      const result = await pool.query(`SELECT id, data FROM arena_battles WHERE id = $1`, [battleId]);
      if ((result.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'Battle not found' });
      }

      const stored = result.rows[0].data || {};
      const uid = req.user?.uid;
      if (stored.player1?.uid !== uid && stored.player2?.uid !== uid) {
        return res.status(403).json({ error: 'Only battle participants can read this battle.' });
      }

      let battle = { ...stored, id: result.rows[0].id };
      const nowMs = Date.now();
      if (battle.status === 'active' && battle.expiresAtEpochMs && nowMs >= battle.expiresAtEpochMs) {
        const settled = await arenaRealtime.settleExpiredBattle(battleId, nowMs);
        if (settled) battle = settled;
      }
      return res.json({ battle, serverNow: nowMs });
    } catch (err: any) {
      logger.error({ uid: req.user?.uid, battleId: req.params.battleId, error: err?.message || String(err) }, '[Arena] Failed to load battle');
      return res.status(500).json({ error: 'Failed to load battle.' });
    }
  });

  app.patch('/api/arena/battles/:battleId', verifyAuth, async (_req, res) => {
    return res.status(405).json({
      error: 'Battle state is server-owned. Submit answers through the authenticated answer endpoint.',
      code: 'BATTLE_STATE_SERVER_OWNED'
    });
  });

  app.delete('/api/arena/battles/:battleId', verifyAuth, async (req: any, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });

    const battleId = req.params.battleId;
    const uid = req.user?.uid;

    try {
      const existing = await pool.query(
        `SELECT status, data FROM arena_battles WHERE id = $1`,
        [battleId]
      );
      if ((existing.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'Battle not found' });
      }

      const data = existing.rows[0].data || {};
      if (data.player1?.uid !== uid && data.player2?.uid !== uid) {
        return res.status(403).json({ error: 'Only battle participants can delete this battle.' });
      }
      if (existing.rows[0].status !== 'waiting') {
        return res.status(409).json({ error: 'Only a waiting battle can be cancelled.' });
      }

      const deleted = await pool.query(
        `DELETE FROM arena_battles WHERE id = $1 AND status = 'waiting' RETURNING id`,
        [battleId]
      );
      if ((deleted.rowCount ?? 0) !== 1) {
        return res.status(409).json({ error: 'Battle state changed before cancellation completed.' });
      }

      arenaRealtime.clearBattleSchedule(battleId);
      const waitingBattles = await fetchWaitingArenaBattles(pool);
      arenaRealtime.broadcastLobbyQueueUpdate(waitingBattles);
      return res.json({ success: true, serverNow: Date.now() });
    } catch (err: any) {
      logger.error({ uid, battleId, error: err?.message || String(err) }, '[Arena] Failed to cancel waiting battle');
      return res.status(500).json({ error: 'Failed to cancel waiting battle.' });
    }
  });

  /**
   * GET /api/arena/challenges/live
   * Dynamically resolves personalized & global Arena challenges with real-time progress from Neon PostgreSQL
   */
  app.get('/api/arena/challenges/live', verifyAuth, async (req, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const user = (req as any).user;
    const uid = user.uid;

    try {
      const todayKey = new Date().toISOString().slice(0, 10);

      const [
        userRowRes,
        battlesTodayRes,
        highScoreQuizzesRes,
        weakCourseRes,
        srsReviewedTodayRes,
        srsDueRes,
        configRes
      ] = await Promise.all([
        pool.query(`SELECT learning_profile, ai_sparks FROM users WHERE uid = $1`, [uid]),
        pool.query(
          `SELECT COUNT(*)::int AS total_finished,
                  COUNT(*) FILTER (WHERE winner_id = $1)::int AS wins_today
           FROM arena_battles
           WHERE status = 'finished'
             AND updated_at >= CURRENT_DATE
             AND (data->'player1'->>'uid' = $1 OR data->'player2'->>'uid' = $1)`,
          [uid]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS high_score_count
           FROM user_quiz_attempts
           WHERE uid = $1 AND score_pct >= 80 AND attempted_at >= CURRENT_DATE - INTERVAL '7 days'`,
          [uid]
        ),
        pool.query(
          `SELECT course_id, MIN(score_pct)::float AS lowest_score
           FROM user_quiz_attempts
           WHERE uid = $1 AND score_pct < 75
           GROUP BY course_id
           ORDER BY lowest_score ASC
           LIMIT 1`,
          [uid]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS reviewed_today
           FROM user_spaced_repetition
           WHERE uid = $1 AND review_count > 0 AND updated_at >= CURRENT_DATE`,
          [uid]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS due_count, MIN(course_id) AS sample_course
           FROM user_spaced_repetition
           WHERE uid = $1 AND next_review_at <= NOW()`,
          [uid]
        ),
        pool.query(`SELECT data FROM system_config WHERE key = 'challenges'`)
      ]);

      const lp = userRowRes.rows[0]?.learning_profile || {};
      const claimedMap: Record<string, string> = lp.claimedChallenges || {};
      const totalArenaWins = Number(lp.arenaWins ?? 0);
      const arenaWinStreak = Number(lp.arenaWinStreak ?? 0);
      const studyStreak = Number(lp.streak ?? 0);
      const winsToday = Number(battlesTodayRes.rows[0]?.wins_today ?? 0);
      const battlesFinishedToday = Number(battlesTodayRes.rows[0]?.total_finished ?? 0);
      const highQuizzesCount = Number(highScoreQuizzesRes.rows[0]?.high_score_count ?? 0);
      const srsReviewedToday = Number(srsReviewedTodayRes.rows[0]?.reviewed_today ?? 0);
      const srsDueCount = Number(srsDueRes.rows[0]?.due_count ?? 0);
      const weakCourse = weakCourseRes.rows[0]?.course_id || null;
      const weakCourseScore = weakCourseRes.rows[0]?.lowest_score
        ? Math.round(Number(weakCourseRes.rows[0].lowest_score))
        : null;

      // 1. Start with any admin-configured challenges in system_config
      const configuredChallenges: any[] = Array.isArray(configRes.rows[0]?.data?.challenges)
        ? configRes.rows[0].data.challenges.filter((c: any) => c && c.active !== false)
        : [];

      const evaluateChallengeProgress = (c: any) => {
        const target = Math.max(1, Number(c.targetCount || 1));
        let current = 0;
        if (c.id === 'daily_battle_participate') {
          current = battlesFinishedToday;
        } else if (c.id?.startsWith('remediate_course_') && c.courseId) {
          current = winsToday;
        } else if (c.id === 'srs_daily_review') {
          current = srsReviewedToday;
        } else if (c.category === 'battle') {
          current = c.scope === 'daily' ? winsToday : totalArenaWins;
        } else if (c.category === 'streak') {
          current = Math.max(arenaWinStreak, studyStreak);
        } else if (c.category === 'quiz') {
          current = highQuizzesCount;
        } else if (c.category === 'study') {
          current = srsReviewedToday;
        }
        const claimScopeKey = c.scope === 'daily' ? `${c.id}_${todayKey}` : c.id;
        const isClaimed = Boolean(claimedMap[claimScopeKey]);
        return {
          ...c,
          targetCount: target,
          currentCount: Math.min(target, current),
          completed: current >= target,
          claimed: isClaimed,
          claimScopeKey,
          updatedAt: new Date().toISOString()
        };
      };

      // 2. Dynamically construct telemetry-driven adaptive challenges based on the student's live PostgreSQL records
      const adaptiveChallenges: any[] = [
        {
          id: 'daily_arena_victory',
          title: 'Daily Arena Victor',
          description: 'Win 1 live or sparring battle in the Academic Arena today',
          reward: 25,
          rewardType: 'sparks',
          iconType: 'swords',
          targetCount: 1,
          category: 'battle',
          scope: 'daily',
          active: true
        },
        {
          id: 'arena_win_streak_2',
          title: 'Momentum Builder',
          description: 'Maintain a 2-win combat streak or 2-day study streak',
          reward: 100,
          rewardType: 'xp',
          iconType: 'flame',
          targetCount: 2,
          category: 'streak',
          scope: 'daily',
          active: true
        },
        {
          id: 'high_accuracy_scholar',
          title: 'Precision Mastery',
          description: 'Score 80%+ on 2 practice quizzes in the last 7 days',
          reward: 30,
          rewardType: 'sparks',
          iconType: 'star',
          targetCount: 2,
          category: 'quiz',
          scope: 'daily',
          active: true
        }
      ];

      if (weakCourse && weakCourseScore !== null) {
        adaptiveChallenges.unshift({
          id: `remediate_course_${weakCourse}`,
          title: `${weakCourse} Mastery Recovery`,
          description: `Win 1 Arena battle today to reinforce ${weakCourse} (recent quiz: ${weakCourseScore}%)`,
          reward: 35,
          rewardType: 'sparks',
          iconType: 'target',
          targetCount: 1,
          category: 'battle',
          courseId: weakCourse,
          scope: 'daily',
          active: true
        });
      }

      if (srsDueCount > 0 || srsReviewedToday > 0) {
        adaptiveChallenges.push({
          id: 'srs_daily_review',
          title: 'Memory Consolidation',
          description: `Review ${Math.min(5, Math.max(1, srsDueCount + srsReviewedToday))} Spaced Repetition flashcards today`,
          reward: 20,
          rewardType: 'sparks',
          iconType: 'zap',
          targetCount: Math.min(5, Math.max(1, srsDueCount + srsReviewedToday)),
          category: 'study',
          scope: 'daily',
          active: true
        });
      }

      const mergedById = new Map<string, any>();
      for (const item of [...adaptiveChallenges, ...configuredChallenges]) {
        if (item && item.id) {
          mergedById.set(item.id, evaluateChallengeProgress(item));
        }
      }

      return res.json({
        challenges: Array.from(mergedById.values()),
        serverNow: Date.now(),
        serverIsoTime: new Date().toISOString()
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to compute live challenges' });
    }
  });

  /**
   * POST /api/arena/challenges/claim
   * Atomically verifies challenge completion against Neon PostgreSQL and credits Sparks or XP
   */
  app.post('/api/arena/challenges/claim', verifyAuth, async (req, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const user = (req as any).user;
    const uid = user.uid;
    const { challengeId } = req.body || {};

    if (!challengeId || typeof challengeId !== 'string') {
      return res.status(400).json({ error: 'challengeId is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userRes = await client.query(
        `SELECT ai_sparks, learning_profile FROM users WHERE uid = $1 FOR UPDATE`,
        [uid]
      );
      if ((userRes.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found' });
      }

      const lp = { ...(userRes.rows[0].learning_profile || {}) };
      const claimedMap: Record<string, string> = { ...(lp.claimedChallenges || {}) };
      const todayKey = new Date().toISOString().slice(0, 10);
      const claimKey = `${challengeId}_${todayKey}`;

      if (claimedMap[claimKey] || claimedMap[challengeId]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Challenge reward already claimed' });
      }

      // Re-verify live telemetry counts inside transaction
      const [battlesTodayRes, highQuizzesRes, srsReviewedRes, configRes] = await Promise.all([
        client.query(
          `SELECT COUNT(*) FILTER (WHERE winner_id = $1)::int AS wins_today
           FROM arena_battles
           WHERE status = 'finished'
             AND updated_at >= CURRENT_DATE
             AND (data->'player1'->>'uid' = $1 OR data->'player2'->>'uid' = $1)`,
          [uid]
        ),
        client.query(
          `SELECT COUNT(*)::int AS high_score_count
           FROM user_quiz_attempts
           WHERE uid = $1 AND score_pct >= 80 AND attempted_at >= CURRENT_DATE - INTERVAL '7 days'`,
          [uid]
        ),
        client.query(
          `SELECT COUNT(*)::int AS reviewed_today
           FROM user_spaced_repetition
           WHERE uid = $1 AND review_count > 0 AND updated_at >= CURRENT_DATE`,
          [uid]
        ),
        client.query(`SELECT data FROM system_config WHERE key = 'challenges'`)
      ]);

      const winsToday = Number(battlesTodayRes.rows[0]?.wins_today ?? 0);
      const totalWins = Number(lp.arenaWins ?? 0);
      const winStreak = Math.max(Number(lp.arenaWinStreak ?? 0), Number(lp.streak ?? 0));
      const highQuizzes = Number(highQuizzesRes.rows[0]?.high_score_count ?? 0);
      const srsReviewed = Number(srsReviewedRes.rows[0]?.reviewed_today ?? 0);

      let reward = 25;
      let rewardType: 'sparks' | 'xp' = 'sparks';
      let verifiedCompleted = false;

      if (challengeId === 'daily_arena_victory' || challengeId.startsWith('remediate_course_')) {
        reward = challengeId.startsWith('remediate_course_') ? 35 : 25;
        rewardType = 'sparks';
        verifiedCompleted = winsToday >= 1;
      } else if (challengeId === 'arena_win_streak_2') {
        reward = 100;
        rewardType = 'xp';
        verifiedCompleted = winStreak >= 2;
      } else if (challengeId === 'high_accuracy_scholar') {
        reward = 30;
        rewardType = 'sparks';
        verifiedCompleted = highQuizzes >= 2;
      } else if (challengeId === 'srs_daily_review') {
        reward = 20;
        rewardType = 'sparks';
        verifiedCompleted = srsReviewed >= 1;
      } else {
        const customList: any[] = Array.isArray(configRes.rows[0]?.data?.challenges)
          ? configRes.rows[0].data.challenges
          : [];
        const matched = customList.find((c: any) => c && c.id === challengeId);
        if (matched) {
          reward = Number(matched.reward || 25);
          rewardType = matched.rewardType === 'xp' ? 'xp' : 'sparks';
          const target = Math.max(1, Number(matched.targetCount || 1));
          const progressVal =
            matched.category === 'battle'
              ? totalWins
              : matched.category === 'streak'
              ? winStreak
              : matched.category === 'quiz'
              ? highQuizzes
              : srsReviewed;
          verifiedCompleted = progressVal >= target;
        }
      }

      if (!verifiedCompleted) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Challenge requirements have not been met yet' });
      }

      claimedMap[claimKey] = new Date().toISOString();
      lp.claimedChallenges = claimedMap;

      let nextSparks = Number(userRes.rows[0].ai_sparks ?? 0);
      let nextXp = Number(lp.xp ?? 0);

      if (rewardType === 'sparks') {
        nextSparks += reward;
        await client.query(
          `UPDATE users SET ai_sparks = $1, learning_profile = $2::jsonb, updated_at = NOW() WHERE uid = $3`,
          [nextSparks, JSON.stringify(lp), uid]
        );
        await client.query(
          `UPDATE user_sparks_wallets
           SET free_sparks = COALESCE(free_sparks, 0) + $1,
               total_sparks = COALESCE(total_sparks, 0) + $1,
               updated_at = NOW()
           WHERE uid = $2`,
          [reward, uid]
        ).catch(() => {});
      } else {
        nextXp += reward;
        lp.xp = nextXp;
        lp.level = Math.max(1, Math.floor(nextXp / 1000) + 1);
        await client.query(
          `UPDATE users SET learning_profile = $1::jsonb, updated_at = NOW() WHERE uid = $2`,
          [JSON.stringify(lp), uid]
        );
      }

      await client.query('COMMIT');
      invalidateBootstrapCache(uid);

      return res.json({
        success: true,
        challengeId,
        reward,
        rewardType,
        ai_sparks: nextSparks,
        xp: nextXp,
        claimedAt: claimedMap[claimKey],
        serverNow: Date.now()
      });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(500).json({ error: err.message || 'Failed to claim challenge reward' });
    } finally {
      client.release();
    }
  });

}

