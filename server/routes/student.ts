import express from 'express';
import { getPostgresPool } from '../postgresPool';
import { getAdminApp } from '../firebaseAdmin';
import { logger } from '../logger';

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
        return res.status(503).json({ error: 'Database service unavailable' });
      }

      // 1. Check in-memory cache: if valid, overlay fresh live sparks AND live progress so state is NEVER stale
      const cached = bootstrapCache.get(uid);
      if (cached && (Date.now() - cached.cachedAt < BOOTSTRAP_TTL_MS)) {
        // Overlay latest sparks directly from users table (<1ms)
        const liveSparksRes = await pool.query('SELECT ai_sparks, plan_type, role FROM users WHERE uid = $1', [uid]);
        if (liveSparksRes.rows.length > 0) {
          const u = liveSparksRes.rows[0];
          cached.data.quota.ai_sparks = u.ai_sparks ?? 0;
          cached.data.profile.ai_sparks = u.ai_sparks ?? 0;
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
        profile = {
          uid: u.uid,
          email: u.email,
          displayName: u.display_name,
          role: u.role || 'student',
          plan_type: u.plan_type || 'free',
          ai_sparks: u.ai_sparks ?? 0,
          learningProfile: u.learning_profile || {},
          sessionId: u.session_id || null,
          sessionVersion: u.session_version || 1,
          updatedAt: u.updated_at
        };
      } else {
        // Fallback to Firestore Admin if user not yet mirrored
        const adminApp = getAdminApp();
        if (adminApp) {
          const docSnap = await adminApp.firestore().collection('users').doc(uid).get();
          if (docSnap.exists) {
            profile = { uid, ...docSnap.data() };
            // Upsert into Neon users table
            await pool.query(
              'INSERT INTO users (uid, email, display_name, role, plan_type, ai_sparks, learning_profile, created_at, updated_at) ' +
              'VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) ' +
              'ON CONFLICT (uid) DO UPDATE SET ' +
              'display_name = EXCLUDED.display_name, role = EXCLUDED.role, plan_type = EXCLUDED.plan_type, ai_sparks = EXCLUDED.ai_sparks, updated_at = NOW()',
              [
                uid,
                profile.email || user.email || '',
                profile.displayName || user.name || 'Scholar',
                profile.role || 'student',
                profile.plan_type || 'free',
                profile.ai_sparks ?? 100,
                JSON.stringify(profile.learningProfile || {})
              ]
            ).catch(() => {});
          }
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
      if (!systemConfig.feature_switches) {
        systemConfig.feature_switches = { arena: false, tutor_dashboard: false };
      }

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
          role: profile?.role || 'student'
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
        'SELECT id, uid, title, message, type, read, created_at FROM user_notifications WHERE uid = $1 ORDER BY created_at DESC LIMIT 50',
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
    const { title, message, type, customId } = req.body;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const id = customId || `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      await pool.query(
        `INSERT INTO user_notifications (id, uid, title, message, type, read, created_at)
         VALUES ($1, $2, $3, $4, $5, FALSE, NOW())
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, message = EXCLUDED.message, type = EXCLUDED.type`,
        [id, user.uid, title || 'Notification', message || '', type || 'info']
      );
      return res.json({ success: true, id });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to create notification' });
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
   * Returns top learners by completed lessons / XP from Neon
   */
  app.get('/api/leaderboard', async (req, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const result = await pool.query(
        'SELECT u.uid, u.display_name, u.role, ' +
        'COALESCE(SUM(p.completed_lessons_count), 0)::int as completed_lessons, ' +
        'COALESCE(SUM(p.total_study_seconds), 0)::int as total_study_seconds, ' +
        '(COALESCE(SUM(p.completed_lessons_count), 0) * 50 + COALESCE(SUM(p.total_study_seconds), 0) / 60)::int as xp ' +
        'FROM users u ' +
        'LEFT JOIN user_course_progress p ON u.uid = p.uid ' +
        'GROUP BY u.uid, u.display_name, u.role ' +
        'ORDER BY xp DESC LIMIT 25'
      );

      const leaders = result.rows.map((r: any, i: number) => ({
        uid: r.uid,
        displayName: r.display_name || 'Scholar',
        xp: Number(r.xp || 0),
        rank: i + 1,
        level: Math.floor(Math.sqrt((r.xp || 0) / 100)) + 1,
        streak: 1
      }));

      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      return res.json({ leaderboard: leaders, leaders });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  });

  /**
   * GET /api/user/srs
   * Spaced repetition cards for the user from Neon
   */
  app.get('/api/user/srs', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const result = await pool.query(
        'SELECT card_id, course_id, box, next_review_at, review_count, ease_factor FROM user_spaced_repetition WHERE uid = $1 ORDER BY next_review_at ASC',
        [user.uid]
      );

      return res.json({ cards: result.rows });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to fetch SRS records' });
    }
  });

  /**
   * POST /api/user/srs/record
   */
  app.post('/api/user/srs/record', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const { cardId, courseId, box, nextReviewAt, easeFactor } = req.body;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const id = `${user.uid}_${cardId}`;
      await pool.query(
        'INSERT INTO user_spaced_repetition (id, uid, card_id, course_id, box, next_review_at, review_count, ease_factor, updated_at) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, 1, $7, NOW()) ' +
        'ON CONFLICT (id) DO UPDATE SET ' +
        'box = EXCLUDED.box, next_review_at = EXCLUDED.next_review_at, ' +
        'review_count = user_spaced_repetition.review_count + 1, ease_factor = EXCLUDED.ease_factor, updated_at = NOW()',
        [id, user.uid, cardId, courseId, box || 1, nextReviewAt || new Date(), easeFactor || 2.5]
      );

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to record SRS review' });
    }
  });
}
