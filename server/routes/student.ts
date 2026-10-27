import express from 'express';
import crypto from 'crypto';
import { getPostgresPool } from '../postgresPool';
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
          learningProfile: u.learning_profile || {},
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
   * Arena Matchmaking & Battles (Neon PostgreSQL arena_battles table)
   */
  app.post('/api/arena/matchmake', verifyAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });

      const { topicId, player, questions = [] } = req.body || {};
      if (!topicId || !player) {
        return res.status(400).json({ error: 'topicId and player required' });
      }

      const waitingRes = await pool.query(
        `SELECT id, data FROM arena_battles
         WHERE status = 'waiting' AND topic = $1
         ORDER BY created_at ASC
         LIMIT 5`,
        [topicId]
      );

      const validRow = waitingRes.rows.find((r) => r.data?.player1?.uid && r.data.player1.uid !== user.uid);
      if (validRow) {
        const updatedBattle = {
          ...validRow.data,
          id: validRow.id,
          player2: player,
          status: 'active'
        };
        await pool.query(
          `UPDATE arena_battles
           SET status = 'active', data = $1::jsonb, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(updatedBattle), validRow.id]
        );
        return res.json({ joined: true, battleId: validRow.id, battle: updatedBattle });
      }

      const battleId = `battle_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
      const newBattle = {
        id: battleId,
        status: 'waiting',
        player1: player,
        player2: null,
        questions,
        winner: null,
        createdAt: new Date().toISOString(),
        topicId
      };

      await pool.query(
        `INSERT INTO arena_battles (id, topic, status, questions, data, created_at, updated_at)
         VALUES ($1, $2, 'waiting', $3::jsonb, $4::jsonb, NOW(), NOW())`,
        [battleId, topicId, JSON.stringify(questions), JSON.stringify(newBattle)]
      );

      return res.json({ joined: false, battleId, battle: newBattle });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to matchmake battle' });
    }
  });

  app.get('/api/arena/battles/:battleId', verifyAuth, async (req, res) => {
    try {
      const pool = getPostgresPool();
      if (!pool) return res.status(404).json({ error: 'Battle not found' });
      const result = await pool.query(`SELECT id, data FROM arena_battles WHERE id = $1`, [req.params.battleId]);
      if ((result.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'Battle not found' });
      }
      return res.json({ battle: { ...result.rows[0].data, id: result.rows[0].id } });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to load battle' });
    }
  });

  app.patch('/api/arena/battles/:battleId', verifyAuth, async (req, res) => {
    try {
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });
      const battleId = req.params.battleId;
      const existing = await pool.query(`SELECT data FROM arena_battles WHERE id = $1`, [battleId]);
      if ((existing.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'Battle not found' });
      }

      const data = { ...(existing.rows[0].data || {}) };
      const updates = req.body || {};
      for (const [k, v] of Object.entries(updates)) {
        if (k.includes('.')) {
          const [parentKey, childKey] = k.split('.');
          data[parentKey] = { ...(data[parentKey] || {}), [childKey]: v };
        } else {
          data[k] = v;
        }
      }

      await pool.query(
        `UPDATE arena_battles
         SET status = $1, winner_id = $2, data = $3::jsonb, updated_at = NOW()
         WHERE id = $4`,
        [data.status || 'active', data.winner || null, JSON.stringify(data), battleId]
      );

      return res.json({ success: true, battle: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to update battle' });
    }
  });

  app.delete('/api/arena/battles/:battleId', verifyAuth, async (req, res) => {
    try {
      const pool = getPostgresPool();
      if (pool) {
        await pool.query(`DELETE FROM arena_battles WHERE id = $1`, [req.params.battleId]);
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to delete battle' });
    }
  });
}

