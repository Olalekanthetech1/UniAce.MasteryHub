import express from 'express';
import crypto from 'crypto';
import { getPostgresPool } from '../postgresPool';
import { logger } from '../logger';
import { arenaRealtime } from '../arenaRealtime';

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
        const rankRes = await pool.query(
          `SELECT COUNT(*)::int + 1 AS rank FROM users WHERE (role = 'student' OR role IS NULL) AND COALESCE((learning_profile->>'xp')::int, 0) > $1`,
          [userXp]
        ).catch(() => ({ rows: [{ rank: 1 }] }));

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
          rank: rankRes.rows[0]?.rank ?? 1,
          department: lp.department || undefined,
          academic_level: lp.academic_level || undefined,
          semester: lp.semester || undefined,
          sessionId: u.session_id || null,
          sessionVersion: u.session_version || 1,
          updatedAt: u.updated_at
        };
      } else {
        const nowIso = new Date().toISOString();
        // Initialize new user in PostgreSQL directly from Firebase Auth token identity (zero Firestore read)
        profile = {
          uid,
          email: user.email || '',
          displayName: user.name || 'Scholar',
          role: 'student',
          plan_type: 'free',
          subscription_status: 'none',
          created_at: nowIso,
          ai_sparks: 100,
          learningProfile: {},
          sessionId: null,
          sessionVersion: 1,
          updatedAt: nowIso
        };
        await pool.query(
          'INSERT INTO users (uid, email, display_name, role, plan_type, ai_sparks, learning_profile, created_at, updated_at) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) ' +
          'ON CONFLICT (uid) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()',
          [
            uid,
            profile.email,
            profile.displayName,
            profile.role,
            profile.plan_type,
            profile.ai_sparks,
            JSON.stringify(profile.learningProfile)
          ]
        ).catch((err: any) => {
          logger.warn({ uid, error: err.message }, '[StudentRoutes] Failed to ensure user in Neon users');
        });
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

    if (!cardId) {
      return res.status(400).json({ error: 'cardId is required' });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const cleanCardId = String(cardId).trim();
      const id = cleanCardId.startsWith(`${user.uid}_`) ? cleanCardId : `${user.uid}_${cleanCardId}`;

      // Fetch existing card state if rating-based SM-2 calculation is needed
      const existingRes = await pool.query(
        'SELECT box, review_count, ease_factor, card_data FROM user_spaced_repetition WHERE id = $1 LIMIT 1',
        [id]
      );
      const existing = existingRes.rows[0] || null;

      let computedBox = typeof box === 'number' ? box : (existing?.box ?? 1);
      let computedEase = typeof easeFactor === 'number' ? easeFactor : Number(existing?.ease_factor ?? 2.5);
      let computedNextReview: Date = nextReviewAt ? new Date(nextReviewAt) : new Date();

      if (typeof rating === 'number' && !nextReviewAt) {
        const q = Math.max(0, Math.min(5, rating));
        const prevReps = Number(existing?.review_count ?? 0);
        let intervalDays = 1;
        if (q >= 3) {
          if (prevReps === 0) intervalDays = 1;
          else if (prevReps === 1) intervalDays = 4;
          else intervalDays = Math.max(1, Math.round(prevReps * computedEase));
          computedBox = Math.min(5, computedBox + 1);
        } else {
          intervalDays = 1;
          computedBox = 1;
        }
        computedEase = Math.max(1.3, computedEase + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
        computedNextReview = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);
      }

      const mergedCardData = {
        ...(existing?.card_data && typeof existing.card_data === 'object' ? existing.card_data : {}),
        ...(cardData && typeof cardData === 'object' ? cardData : {}),
        ...(front ? { front } : {}),
        ...(back ? { back } : {}),
        ...(topicTitle ? { topicTitle } : {}),
        ...(explanation ? { explanation } : {}),
        ...(source ? { source } : {})
      };

      const upserted = await pool.query(
        `INSERT INTO user_spaced_repetition (id, uid, card_id, course_id, box, next_review_at, review_count, ease_factor, card_data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8::jsonb, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           course_id = COALESCE(EXCLUDED.course_id, user_spaced_repetition.course_id),
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
          courseId || existing?.course_id || 'general',
          computedBox,
          computedNextReview,
          Number(computedEase.toFixed(2)),
          JSON.stringify(mergedCardData)
        ]
      );

      return res.json({ success: true, card: upserted.rows[0] });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to record SRS review', details: err.message });
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

    if (!Array.isArray(missedQuestions) || missedQuestions.length === 0) {
      return res.json({ success: true, scheduledCount: 0, scheduledCards: [] });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const scheduledCards: any[] = [];
      const effectiveCourseId = String(courseId || 'general').trim();

      for (const q of missedQuestions) {
        if (!q || !q.question) continue;
        const rawQuestionId = String(q.id || crypto.createHash('md5').update(String(q.question)).digest('hex').slice(0, 10))
          .replace(/[^a-zA-Z0-9_-]/g, '_');
        const cardId = `exam_${effectiveCourseId}_${rawQuestionId}`;
        const rowId = `${user.uid}_${cardId}`;
        const topicLabel = q.topic || paperTitle || `${effectiveCourseId} Past Examination`;

        const cardDataPayload = {
          front: String(q.question),
          back: `**Correct Answer:** ${q.correctAnswer}\n\n${q.explanation ? `**Explanation:**\n${q.explanation}` : ''}`.trim(),
          correctAnswer: String(q.correctAnswer || ''),
          lastMissedAnswer: q.userAnswer ? String(q.userAnswer) : 'Unanswered',
          explanation: String(q.explanation || ''),
          topicTitle: topicLabel,
          paperId: paperId || null,
          paperTitle: paperTitle || null,
          source: 'cbt_exam',
          scheduledAt: new Date().toISOString()
        };

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

        if (upsertRes.rows[0]) {
          scheduledCards.push(upsertRes.rows[0]);
        }
      }

      await client.query('COMMIT');
      return res.json({
        success: true,
        scheduledCount: scheduledCards.length,
        scheduledCards
      });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ uid: user.uid, err: err.message }, '[StudentRoutes] Failed to batch-schedule missed exam questions into SRS');
      return res.status(500).json({ error: 'Failed to schedule missed questions into Spaced Repetition', details: err.message });
    } finally {
      client.release();
    }
  });

  /**
   * GET /api/user/payments
   * User payment history from Neon PostgreSQL payments table
   */
  app.get('/api/user/payments', verifyAuth, async (req, res) => {
    try {
      const uid = (req as any).user?.uid;
      const pool = getPostgresPool();
      if (!pool || !uid) {
        return res.json({ payments: [] });
      }
      const result = await pool.query(
        `SELECT reference, amount_ngn, plan_type, status, sparks_added, created_at
         FROM payments
         WHERE uid = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [uid]
      );
      const payments = result.rows.map((r) => ({
        id: r.reference,
        reference: r.reference,
        amount: Number(r.amount_ngn ?? 0),
        plan_type: r.plan_type || 'scholar',
        status: r.status || 'success',
        sparks_added: Number(r.sparks_added ?? 0),
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
      }));
      return res.json({ payments });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch payments' });
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
      const id = `creq_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const { department = '', level = '', semester = '', courseCode = '', courseTitle = '' } = req.body || {};
      const payload = {
        id,
        userId: user.uid,
        email: user.email || '',
        department,
        level,
        semester,
        courseCode,
        courseTitle,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      await pool.query(
        `INSERT INTO curriculum_requests (id, user_id, user_email, course_code, course_title, department, level, status, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8::jsonb, NOW())`,
        [id, user.uid, user.email || null, courseCode, courseTitle, department, level, JSON.stringify(payload)]
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
    try {
      const user = (req as any).user;
      const pool = getPostgresPool();
      const defaultCode = String(user.uid || '').substring(0, 6).toUpperCase();
      if (!pool) {
        return res.json({
          affiliate: { id: defaultCode, signups: 0, clicks: 0, paidConversions: 0, totalEarned: 0, pendingBalance: 0 },
          payouts: []
        });
      }

      const affRes = await pool.query(
        `SELECT code, user_id, email, display_name, total_earned, pending_payout, referral_count, bank_details, status, data
         FROM affiliates
         WHERE user_id = $1 OR code = $2
         LIMIT 1`,
        [user.uid, defaultCode]
      );

      let affiliate: any;
      if ((affRes.rowCount ?? 0) > 0) {
        const row = affRes.rows[0];
        const rawData = row.data || {};
        affiliate = {
          ...rawData,
          id: row.code,
          userId: row.user_id,
          name: row.display_name || rawData.name || 'Partner',
          email: row.email || rawData.email || user.email,
          totalEarned: Number(row.total_earned ?? rawData.totalEarned ?? 0),
          pendingBalance: Number(row.pending_payout ?? rawData.pendingBalance ?? 0),
          signups: Number(rawData.signups ?? row.referral_count ?? 0),
          clicks: Number(rawData.clicks ?? 0),
          paidConversions: Number(rawData.paidConversions ?? row.referral_count ?? 0),
          payoutDetails: row.bank_details && Object.keys(row.bank_details).length > 0
            ? row.bank_details
            : rawData.payoutDetails || null
        };
      } else {
        affiliate = {
          id: defaultCode,
          signups: 0,
          clicks: 0,
          paidConversions: 0,
          totalEarned: 0,
          pendingBalance: 0
        };
      }

      const payoutsRes = await pool.query(
        `SELECT id, amount, status, bank_details, data, created_at
         FROM payout_requests
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [user.uid]
      );

      const payouts = payoutsRes.rows.map((r) => ({
        ...(r.data || {}),
        id: r.id,
        amount: Number(r.amount ?? 0),
        status: r.status || 'pending',
        bankDetails: r.bank_details || r.data?.bankDetails || {},
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
      }));

      return res.json({ affiliate, payouts });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to load affiliate data' });
    }
  });

  /**
   * GET /api/support/chats/:chatId/messages
   * Fetch live support chat messages from Neon PostgreSQL
   */
  app.get('/api/support/chats/:chatId/messages', verifyAuth, async (req, res) => {
    try {
      const pool = getPostgresPool();
      if (!pool) return res.json({ messages: [] });
      const chatRes = await pool.query(
        `SELECT messages FROM support_chats WHERE id = $1`,
        [req.params.chatId]
      );
      const messages = Array.isArray(chatRes.rows[0]?.messages) ? chatRes.rows[0].messages : [];
      return res.json({ messages });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to load chat messages' });
    }
  });

  /**
   * POST /api/support/chats/:chatId/messages
   * Append a support chat message in Neon PostgreSQL
   */
  app.post('/api/support/chats/:chatId/messages', verifyAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });
      const chatId = req.params.chatId;
      const text = String(req.body?.text || '').trim();
      const senderName = String(req.body?.senderName || user.name || user.email || 'Student');
      const userName = String(req.body?.userName || senderName);
      if (!text) return res.status(400).json({ error: 'Message text required' });

      const newMsg = {
        id: `msg_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
        senderId: user.uid,
        senderName,
        text,
        timestamp: new Date().toISOString()
      };

      const existing = await pool.query(`SELECT messages FROM support_chats WHERE id = $1`, [chatId]);
      const currentMessages = Array.isArray(existing.rows[0]?.messages) ? existing.rows[0].messages : [];
      const updatedMessages = [...currentMessages, newMsg];

      await pool.query(
        `INSERT INTO support_chats (id, user_id, user_name, user_email, status, last_message, messages, updated_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $6::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET
           last_message = EXCLUDED.last_message,
           messages = EXCLUDED.messages,
           status = 'active',
           updated_at = NOW()`,
        [chatId, user.uid, userName, user.email || null, text, JSON.stringify(updatedMessages)]
      );

      return res.json({ success: true, message: newMsg, messages: updatedMessages });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to send message' });
    }
  });

  /**
   * POST /api/support/tickets
   * Create a support ticket in Neon PostgreSQL
   */
  app.post('/api/support/tickets', verifyAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });
      const { name = '', email = '', subject = '', message = '' } = req.body || {};
      const id = `tkt_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
      const createdAt = new Date().toISOString();
      const payload = {
        id,
        userId: user.uid,
        name: name || user.name || 'Student',
        email: email || user.email || '',
        subject,
        message,
        status: 'open',
        createdAt
      };
      await pool.query(
        `INSERT INTO support_tickets (id, user_id, user_email, user_name, subject, message, status, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7::jsonb, NOW(), NOW())`,
        [id, user.uid, payload.email, payload.name, subject, message, JSON.stringify(payload)]
      );
      return res.json({ success: true, ticket: payload });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to submit support ticket' });
    }
  });

  /**
   * Helper: Fetch current waiting lobbies from Neon PostgreSQL
   */
  const fetchWaitingArenaBattles = async (pool: any) => {
    await pool.query(
      `DELETE FROM arena_battles WHERE status = 'waiting' AND created_at < NOW() - INTERVAL '10 minutes'`
    ).catch(() => {});

    const waitingRes = await pool.query(
      `SELECT id, topic, created_at, data
       FROM arena_battles
       WHERE status = 'waiting'
       ORDER BY created_at ASC
       LIMIT 20`
    );
    return waitingRes.rows.map((r: any) => ({
      id: r.id,
      topicId: r.topic,
      hostUid: r.data?.player1?.uid || '',
      hostName: r.data?.player1?.name || 'Scholar',
      hostAvatar: r.data?.player1?.avatar || '',
      questionCount: Array.isArray(r.data?.questions) ? r.data.questions.length : 5,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
    }));
  };

  /**
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
    if (!pool) return;
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

      const totalQuestions = Array.isArray(data.questions) ? data.questions.length : 5;
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

  /**
   * Helper: Dynamically compute Adaptive AI Challenger ([AI Challenger] Sparring Partner) calibration
   * from the student's actual Neon PostgreSQL telemetry:
   * 1. user_course_progress & user_quiz_attempts (course quiz scores & completed lessons)
   * 2. user_spaced_repetition (SRS retention rate for that course)
   * 3. arena_battles (past win/loss ratio for that course)
   */
  const computeAdaptiveChallengerTelemetry = async (db: any, uid: string, topicId: string) => {
    const cleanTopic = String(topicId || '').trim();
    const [quizStatsRes, progressStatsRes, srsStatsRes, courseBattlesRes, userStatsRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS attempts_count,
                AVG(score_pct)::float AS avg_score,
                COALESCE(AVG(time_spent_seconds), 0)::float AS avg_time_sec
         FROM user_quiz_attempts
         WHERE uid = $1 AND ($2 = '' OR course_id = $2)`,
        [uid, cleanTopic]
      ),
      db.query(
        `SELECT COALESCE(completed_lessons_count, 0)::int AS lessons_done,
                COALESCE(completed_modules_count, 0)::int AS modules_done,
                COALESCE(total_study_seconds, 0)::int AS study_sec
         FROM user_course_progress
         WHERE uid = $1 AND course_id = $2`,
        [uid, cleanTopic]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total_cards,
                COUNT(*) FILTER (WHERE box >= 2 OR (review_count > 0 AND ease_factor >= 2.3))::int AS retained_cards,
                COALESCE(AVG(ease_factor), 2.5)::float AS avg_ease
         FROM user_spaced_repetition
         WHERE uid = $1 AND ($2 = '' OR course_id = $2)`,
        [uid, cleanTopic]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total_battles,
                COUNT(*) FILTER (WHERE winner_id = $1)::int AS wins,
                COUNT(*) FILTER (WHERE winner_id IS NOT NULL AND winner_id != 'draw' AND winner_id != $1)::int AS losses
         FROM arena_battles
         WHERE status = 'finished'
           AND ($2 = '' OR topic = $2)
           AND (data->'player1'->>'uid' = $1 OR data->'player2'->>'uid' = $1)`,
        [uid, cleanTopic]
      ),
      db.query(`SELECT learning_profile FROM users WHERE uid = $1`, [uid])
    ]);

    const attemptsCount = Number(quizStatsRes.rows[0]?.attempts_count ?? 0);
    const rawQuizAvg = quizStatsRes.rows[0]?.avg_score;
    const lp = userStatsRes.rows[0]?.learning_profile || {};
    const profileCourseMastery =
      cleanTopic && lp.mastery && typeof lp.mastery[cleanTopic] === 'number'
        ? Number(lp.mastery[cleanTopic])
        : null;

    const quizScorePct: number | null =
      attemptsCount > 0 && rawQuizAvg !== null && rawQuizAvg !== undefined
        ? Math.round(Number(rawQuizAvg))
        : profileCourseMastery !== null
        ? Math.round(profileCourseMastery)
        : null;

    const lessonsDone = Number(progressStatsRes.rows[0]?.lessons_done ?? 0);
    const studySeconds = Number(progressStatsRes.rows[0]?.study_sec ?? 0);

    const srsCardsSampled = Number(srsStatsRes.rows[0]?.total_cards ?? 0);
    const srsCardsRetained = Number(srsStatsRes.rows[0]?.retained_cards ?? 0);
    const srsRetentionPct: number | null =
      srsCardsSampled > 0 ? Math.round((srsCardsRetained / srsCardsSampled) * 100) : null;

    const courseWins = Number(courseBattlesRes.rows[0]?.wins ?? 0);
    const courseLosses = Number(courseBattlesRes.rows[0]?.losses ?? 0);
    const courseBattlesSampled = Number(courseBattlesRes.rows[0]?.total_battles ?? 0);
    const courseWinLossDecided = courseWins + courseLosses;
    const courseWinRatePct: number | null =
      courseWinLossDecided > 0 ? Math.round((courseWins / courseWinLossDecided) * 100) : null;

    // Combine verified empirical signals dynamically
    let weightedSum = 0;
    let totalWeight = 0;
    if (quizScorePct !== null) {
      weightedSum += quizScorePct * 0.45;
      totalWeight += 0.45;
    }
    if (srsRetentionPct !== null) {
      weightedSum += srsRetentionPct * 0.30;
      totalWeight += 0.30;
    }
    if (courseWinRatePct !== null) {
      weightedSum += courseWinRatePct * 0.25;
      totalWeight += 0.25;
    }

    let calibratedMasteryPct = 0;
    if (totalWeight > 0) {
      calibratedMasteryPct = Math.round(weightedSum / totalWeight);
    } else if (lessonsDone > 0) {
      calibratedMasteryPct = Math.min(45, lessonsDone * 10);
    } else {
      calibratedMasteryPct = 0;
    }
    calibratedMasteryPct = Math.max(0, Math.min(100, calibratedMasteryPct));

    // Calibrate response speed & accuracy strictly by Course Mastery Tier:
    // - Beginner (<50% course mastery): ~12–15 seconds per question (12000–15000ms)
    // - Intermediate (50–80% course mastery): ~9–11.5 seconds per question (9000–11500ms)
    // - Advanced (>80% course mastery): ~6–8 seconds per question (6000–8000ms) with high accuracy
    let tier: 'beginner' | 'intermediate' | 'advanced' = 'beginner';
    let tierLabel = 'Beginner (<50% Course Mastery)';
    let pacingRangeLabel = '12–15s / question';
    let minStepMs = 12000;
    let maxStepMs = 15000;
    let baseStepMs = 13500;
    let targetAccuracyPct = 58;

    if (calibratedMasteryPct > 80) {
      tier = 'advanced';
      tierLabel = 'Advanced (>80% Course Mastery)';
      pacingRangeLabel = '6–8s / question';
      minStepMs = 6000;
      maxStepMs = 8000;
      const ratio = Math.min(1, Math.max(0, (calibratedMasteryPct - 80) / 20));
      baseStepMs = Math.round(8000 - ratio * 2000);
      targetAccuracyPct = 88;
    } else if (calibratedMasteryPct >= 50) {
      tier = 'intermediate';
      tierLabel = 'Intermediate (50–80% Course Mastery)';
      pacingRangeLabel = '9–11.5s / question';
      minStepMs = 9000;
      maxStepMs = 11500;
      const ratio = Math.min(1, Math.max(0, (calibratedMasteryPct - 50) / 30));
      baseStepMs = Math.round(11500 - ratio * 2500);
      targetAccuracyPct = 74;
    } else {
      tier = 'beginner';
      tierLabel = 'Beginner (<50% Course Mastery)';
      pacingRangeLabel = '12–15s / question';
      minStepMs = 12000;
      maxStepMs = 15000;
      const ratio = Math.min(1, Math.max(0, calibratedMasteryPct / 49));
      baseStepMs = Math.round(15000 - ratio * 3000);
      targetAccuracyPct = 58;
    }

    return {
      calibratedMasteryPct,
      tier,
      tierLabel,
      pacingRangeLabel,
      minStepMs,
      maxStepMs,
      baseStepMs,
      targetAccuracyPct,
      quizScorePct,
      attemptsSampled: attemptsCount,
      srsRetentionPct,
      srsCardsSampled,
      srsCardsRetained,
      courseWinRatePct,
      courseWins,
      courseLosses,
      arenaBattlesSampled: courseBattlesSampled,
      lessonsCompleted: lessonsDone,
      studySeconds
    };
  };

  /**
   * GET /api/arena/lobby-telemetry
   * Real-time Arena lobby presence, open waiting queues across courses, recorded historical battle availability,
   * and live Adaptive AI Challenger ([AI Challenger]) telemetry calibration for the selected course
   */
  app.get('/api/arena/lobby-telemetry', verifyAuth, async (req, res) => {
    try {
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });

      const user = (req as any).user;
      const topicId = typeof req.query.topicId === 'string' ? req.query.topicId.trim() : '';
      const [waitingBattles, challengerTelemetry] = await Promise.all([
        fetchWaitingArenaBattles(pool),
        computeAdaptiveChallengerTelemetry(pool, user.uid, topicId)
      ]);
      const presence = arenaRealtime.getOnlinePresenceSummary();

      let historicalGhostCount = 0;
      let latestGhostMeta: { recordedAt: string; playerName: string; battleId: string } | null = null;

      if (topicId) {
        const ghostRes = await pool.query(
          `SELECT id, updated_at, data
           FROM arena_battles
           WHERE status = 'finished'
             AND topic = $1
             AND (
               jsonb_array_length(COALESCE(data->'player1'->'actionLog', '[]'::jsonb)) > 0
               OR jsonb_array_length(COALESCE(data->'player2'->'actionLog', '[]'::jsonb)) > 0
             )
           ORDER BY updated_at DESC
           LIMIT 10`,
          [topicId]
        );
        historicalGhostCount = ghostRes.rowCount ?? 0;
        if (historicalGhostCount > 0) {
          const top = ghostRes.rows[0];
          const p1Log = Array.isArray(top.data?.player1?.actionLog) ? top.data.player1.actionLog : [];
          const recordedPlayer = p1Log.length > 0 ? top.data.player1 : top.data?.player2;
          latestGhostMeta = {
            battleId: top.id,
            playerName: recordedPlayer?.name || 'Scholar',
            recordedAt: top.updated_at ? new Date(top.updated_at).toISOString() : new Date().toISOString()
          };
        }
      }

      return res.json({
        serverNow: Date.now(),
        serverIsoTime: new Date().toISOString(),
        onlineCount: presence.onlineCount,
        onlineUsers: presence.users,
        waitingBattles,
        historicalGhostCount,
        latestGhostMeta,
        challengerTelemetry
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch lobby telemetry' });
    }
  });

  /**
   * POST /api/arena/matchmake
   * Atomic matchmaking in Neon PostgreSQL with real-time WebSocket room broadcast and server clock initialization
   */
  app.post('/api/arena/matchmake', verifyAuth, async (req, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });

    const user = (req as any).user;
    const { topicId, player, questions = [], targetBattleId, skipQueueJoin = false } = req.body || {};
    if (!topicId || !player) {
      return res.status(400).json({ error: 'topicId and player required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let validRow: any = null;
      if (!skipQueueJoin) {
        let waitingQuery = `
          SELECT id, topic, data
          FROM arena_battles
          WHERE status = 'waiting' AND topic = $1
          ORDER BY created_at ASC
          LIMIT 5
          FOR UPDATE SKIP LOCKED
        `;
        let queryParams: any[] = [topicId];

        if (targetBattleId && typeof targetBattleId === 'string') {
          waitingQuery = `
            SELECT id, topic, data
            FROM arena_battles
            WHERE status = 'waiting' AND id = $1
            FOR UPDATE SKIP LOCKED
          `;
          queryParams = [targetBattleId];
        }

        const waitingRes = await client.query(waitingQuery, queryParams);
        validRow = waitingRes.rows.find(
          (r) => r.data?.player1?.uid && r.data.player1.uid !== user.uid
        );
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      if (validRow) {
        const questionList = Array.isArray(validRow.data?.questions) && validRow.data.questions.length > 0
          ? validRow.data.questions
          : questions;
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
          topicId: validRow.topic || topicId,
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
      return res.status(500).json({ error: err.message || 'Failed to matchmake battle' });
    } finally {
      client.release();
    }
  });

  /**
   * POST /api/arena/battles/:battleId/spar
   * Instant Sparring Fallback when no live human challenger is in queue for the same course:
   * - mode === 'ghost_replay': Replays a real historical student recording from Neon PostgreSQL at exact recorded timestamps.
   * - mode === 'ai_challenger': Launches a transparent Adaptive AI Challenger ([AI Challenger]) calibrated from the student's live PostgreSQL telemetry.
   */
  app.post('/api/arena/battles/:battleId/spar', verifyAuth, async (req, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });

    const user = (req as any).user;
    const { battleId } = req.params;
    const { mode = 'ai_challenger' } = req.body || {};

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
      if (battleData.status !== 'waiting') {
        await client.query('COMMIT');
        return res.json({ success: true, battle: battleData, serverNow: Date.now() });
      }

      const topicId = existingRes.rows[0].topic || battleData.topicId;
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let durationSeconds = 60;

      const scheduledActions: Array<{ delayMs: number; execute: () => Promise<void> }> = [];

      if (mode === 'ghost_replay') {
        // Query Neon PostgreSQL for a genuine recorded human battle with a non-empty actionLog
        const ghostRes = await client.query(
          `SELECT id, updated_at, data
           FROM arena_battles
           WHERE status = 'finished'
             AND topic = $1
             AND id != $2
             AND (
               jsonb_array_length(COALESCE(data->'player1'->'actionLog', '[]'::jsonb)) > 0
               OR jsonb_array_length(COALESCE(data->'player2'->'actionLog', '[]'::jsonb)) > 0
             )
           ORDER BY updated_at DESC
           LIMIT 5`,
          [topicId, battleId]
        );

        if ((ghostRes.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'No recorded human battle replay exists for this course yet in Neon PostgreSQL.',
            code: 'NO_GHOST_RECORDING'
          });
        }

        const chosenRow = ghostRes.rows[0];
        const histData = chosenRow.data || {};
        const p1Log = Array.isArray(histData.player1?.actionLog) ? histData.player1.actionLog : [];
        const p2Log = Array.isArray(histData.player2?.actionLog) ? histData.player2.actionLog : [];
        const recordedSource = p1Log.length >= p2Log.length ? histData.player1 : histData.player2;
        const recordedActions: any[] = Array.isArray(recordedSource?.actionLog) ? recordedSource.actionLog : [];
        const recordedQuestions = Array.isArray(histData.questions) && histData.questions.length > 0
          ? histData.questions
          : battleData.questions;

        battleData.questions = recordedQuestions;
        battleData.opponentType = 'ghost_replay';
        battleData.recordedFromBattleId = chosenRow.id;
        battleData.recordedBattleTimestamp = chosenRow.updated_at
          ? new Date(chosenRow.updated_at).toISOString()
          : histData.finishedAt || nowIso;

        battleData.player2 = {
          uid: `ghost_${recordedSource?.uid || 'scholar'}_${chosenRow.id.slice(-4)}`,
          name: `${recordedSource?.name || 'Scholar'} [Ghost Replay]`,
          avatar: recordedSource?.avatar || '',
          score: 0,
          currentQuestionIndex: 0,
          health: 100,
          status: 'playing',
          opponentType: 'ghost_replay',
          recordedFromBattleId: chosenRow.id,
          recordedAt: battleData.recordedBattleTimestamp,
          actionLog: []
        };

        let cumulativeFallbackMs = 0;
        recordedActions.forEach((act: any, idx: number) => {
          const rawElapsed = Number(act.elapsedMs);
          const delayMs = Number.isFinite(rawElapsed) && rawElapsed > 500
            ? Math.min(durationSeconds * 1000 - 1000, rawElapsed)
            : (cumulativeFallbackMs += 8000);

          scheduledActions.push({
            delayMs,
            execute: async () => {
              await executeServerScheduledOpponentMove(
                battleId,
                typeof act.questionIndex === 'number' ? act.questionIndex : idx,
                String(act.selectedOption || ''),
                Boolean(act.correct),
                delayMs
              );
            }
          });
        });
      } else {
        // mode === 'ai_challenger': Calibrate strictly from the student's live PostgreSQL telemetry
        // (user_course_progress/user_quiz_attempts, user_spaced_repetition SRS retention, and arena_battles course W/L)
        const telemetry = await computeAdaptiveChallengerTelemetry(client, user.uid, topicId);

        const questions: any[] = Array.isArray(battleData.questions) ? battleData.questions : [];
        // Ensure Beginner matches (12–15s per question) have sufficient timer headroom (90s)
        durationSeconds = telemetry.tier === 'beginner'
          ? Math.max(85, Math.ceil((questions.length * telemetry.maxStepMs) / 1000) + 10)
          : telemetry.tier === 'intermediate'
          ? 70
          : 60;

        battleData.opponentType = 'ai_challenger';
        battleData.calibrationTelemetry = telemetry;

        battleData.player2 = {
          uid: `ai_challenger_${topicId}`,
          name: `[AI Challenger] Sparring Partner (${telemetry.calibratedMasteryPct}% Mastery)`,
          avatar: '',
          score: 0,
          currentQuestionIndex: 0,
          health: 100,
          status: 'playing',
          opponentType: 'ai_challenger',
          calibratedMasteryPct: telemetry.calibratedMasteryPct,
          actionLog: []
        };

        let cumulativeMs = 0;
        questions.forEach((q: any, idx: number) => {
          const difficulty = Number(q?.difficulty ?? 3);
          // Clamp per-question delay strictly within the calibrated tier bounds:
          // Beginner (<50%): 12000–15000ms (12–15s)
          // Intermediate (50–80%): 9000–11500ms (9–11.5s)
          // Advanced (>80%): 6000–8000ms (6–8s)
          const rawStepMs = telemetry.baseStepMs + (difficulty - 3) * 500 + ((idx % 2 === 0) ? -400 : 400);
          const stepDelayMs = Math.max(
            telemetry.minStepMs,
            Math.min(telemetry.maxStepMs, rawStepMs)
          );
          cumulativeMs += stepDelayMs;

          // Deterministic accuracy calibrated to tier targetAccuracyPct & question difficulty
          const effectiveThreshold = 100 - telemetry.targetAccuracyPct + (difficulty - 3) * 6;
          const deterministicScore = ((idx * 37 + difficulty * 19 + telemetry.calibratedMasteryPct) % 100);
          const willAnswerCorrectly =
            telemetry.tier === 'advanced'
              ? idx !== 3 || telemetry.calibratedMasteryPct >= 92 // ~80-100% accuracy on 5 questions
              : telemetry.tier === 'intermediate'
              ? idx % 3 !== 2 // ~67-80% accuracy
              : deterministicScore >= effectiveThreshold; // ~60% accuracy for beginner

          const options: string[] = Array.isArray(q?.options) ? q.options : [];
          const wrongOption = options.find((opt) => opt !== q?.correctAnswer) || '';
          const chosenOption = willAnswerCorrectly ? String(q?.correctAnswer || '') : wrongOption;
          const scheduledElapsed = cumulativeMs;

          if (scheduledElapsed < durationSeconds * 1000 - 500) {
            scheduledActions.push({
              delayMs: scheduledElapsed,
              execute: async () => {
                await executeServerScheduledOpponentMove(
                  battleId,
                  idx,
                  chosenOption,
                  willAnswerCorrectly,
                  scheduledElapsed
                );
              }
            });
          }
        });
      }

      const expiresAtEpochMs = nowMs + durationSeconds * 1000;
      const expiresAt = new Date(expiresAtEpochMs).toISOString();

      battleData.player1 = {
        ...battleData.player1,
        status: 'playing',
        actionLog: Array.isArray(battleData.player1?.actionLog) ? battleData.player1.actionLog : []
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
        [JSON.stringify(battleData.questions || []), JSON.stringify(battleData), battleId]
      );
      await client.query('COMMIT');

      arenaRealtime.registerActiveBattleSchedule(battleId, expiresAtEpochMs, scheduledActions);
      arenaRealtime.broadcastToBattle(battleId, 'battle:started', battleData);
      const remainingWaiting = await fetchWaitingArenaBattles(pool);
      arenaRealtime.broadcastLobbyQueueUpdate(remainingWaiting);

      return res.json({
        success: true,
        battle: battleData,
        serverNow: Date.now()
      });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(500).json({ error: err.message || 'Failed to launch sparring match' });
    } finally {
      client.release();
    }
  });

  /**
   * POST /api/arena/battles/:battleId/answer
   * Server-authoritative answer submission & real-time timestamped combat resolution
   */
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

      if (data.expiresAtEpochMs && nowMs >= data.expiresAtEpochMs) {
        await client.query('ROLLBACK');
        const settled = await arenaRealtime.settleExpiredBattle(battleId, nowMs);
        return res.json({ success: true, battle: settled || data, serverNow: nowMs });
      }

      const isPlayer1 = data.player1?.uid === user.uid;
      const isPlayer2 = data.player2?.uid === user.uid;
      if (!isPlayer1 && !isPlayer2) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not a participant in this battle' });
      }

      const activePlayer = isPlayer1 ? { ...data.player1 } : { ...data.player2 };
      const opponentPlayer = isPlayer1 ? { ...data.player2 } : { ...data.player1 };
      const questions: any[] = Array.isArray(data.questions) ? data.questions : [];
      const qIndex = Number(activePlayer.currentQuestionIndex || 0);
      const currentQuestion = questions[qIndex];

      if (!currentQuestion) {
        await client.query('COMMIT');
        return res.json({ success: true, battle: data, serverNow: nowMs });
      }

      const isCorrect = selectedOption === currentQuestion.correctAnswer;
      const startedAtMs = Number(data.startedAtEpochMs || nowMs);
      const elapsedMs = Math.max(100, nowMs - startedAtMs);

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
        activePlayer.score = Number(activePlayer.score || 0) + 100;
        opponentPlayer.health = Math.max(0, Number(opponentPlayer.health ?? 100) - DAMAGE_PER_HIT);
      } else {
        activePlayer.health = Math.max(0, Number(activePlayer.health ?? 100) - DAMAGE_PER_HIT);
      }

      if (isPlayer1) {
        data.player1 = activePlayer;
        data.player2 = opponentPlayer;
      } else {
        data.player2 = activePlayer;
        data.player1 = opponentPlayer;
      }

      const totalQuestions = questions.length || 5;
      const bothFinishedQuestions =
        Number(data.player1?.currentQuestionIndex || 0) >= totalQuestions &&
        Number(data.player2?.currentQuestionIndex || 0) >= totalQuestions;

      if (
        Number(data.player1?.health ?? 100) <= 0 ||
        Number(data.player2?.health ?? 100) <= 0 ||
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

  app.get('/api/arena/battles/:battleId', verifyAuth, async (req, res) => {
    try {
      const pool = getPostgresPool();
      if (!pool) return res.status(404).json({ error: 'Battle not found' });
      const battleId = req.params.battleId;
      const result = await pool.query(`SELECT id, data FROM arena_battles WHERE id = $1`, [battleId]);
      if ((result.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'Battle not found' });
      }
      let battle = { ...result.rows[0].data, id: result.rows[0].id };
      const nowMs = Date.now();
      if (battle.status === 'active' && battle.expiresAtEpochMs && nowMs >= battle.expiresAtEpochMs) {
        const settled = await arenaRealtime.settleExpiredBattle(battleId, nowMs);
        if (settled) battle = settled;
      }
      return res.json({ battle, serverNow: nowMs });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to load battle' });
    }
  });

  app.patch('/api/arena/battles/:battleId', verifyAuth, async (req, res) => {
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const battleId = req.params.battleId;
    const user = (req as any).user;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(`SELECT data FROM arena_battles WHERE id = $1 FOR UPDATE`, [battleId]);
      if ((existing.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Battle not found' });
      }

      const data = { ...(existing.rows[0].data || {}), id: battleId };
      const updates = req.body || {};
      for (const [k, v] of Object.entries(updates)) {
        if (k.includes('.')) {
          const [parentKey, childKey] = k.split('.');
          data[parentKey] = { ...(data[parentKey] || {}), [childKey]: v };
        } else {
          data[k] = v;
        }
      }

      if (data.status === 'finished' && !data.statsSettled) {
        data.finishedAt = data.finishedAt || new Date().toISOString();
        data.finishedAtEpochMs = data.finishedAtEpochMs || Date.now();
        arenaRealtime.clearBattleSchedule(battleId);
        await arenaRealtime.settlePlayersArenaStatsInTx(client, data);
        data.statsSettled = true;
        invalidateBootstrapCache(user.uid);
      }

      await client.query(
        `UPDATE arena_battles
         SET status = $1, winner_id = $2, data = $3::jsonb, updated_at = NOW()
         WHERE id = $4`,
        [data.status || 'active', data.winner || null, JSON.stringify(data), battleId]
      );
      await client.query('COMMIT');

      arenaRealtime.broadcastToBattle(
        battleId,
        data.status === 'finished' ? 'battle:finished' : 'battle:state',
        data
      );

      return res.json({ success: true, battle: data, serverNow: Date.now() });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(500).json({ error: err.message || 'Failed to update battle' });
    } finally {
      client.release();
    }
  });

  app.delete('/api/arena/battles/:battleId', verifyAuth, async (req, res) => {
    try {
      const pool = getPostgresPool();
      const battleId = req.params.battleId;
      arenaRealtime.clearBattleSchedule(battleId);
      if (pool) {
        await pool.query(`DELETE FROM arena_battles WHERE id = $1`, [battleId]);
        const waitingBattles = await fetchWaitingArenaBattles(pool);
        arenaRealtime.broadcastLobbyQueueUpdate(waitingBattles);
      }
      return res.json({ success: true, serverNow: Date.now() });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to delete battle' });
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

