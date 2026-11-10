import express from 'express';
import admin from 'firebase-admin';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { GeminiDirectProvider, MistralProvider, GroqProvider, CohereProvider, HuggingFaceProvider, OpenRouterFreeProvider, NvidiaProvider } from '../providers';
import { splitAndInspectChatPayload, inspectAndScrubUntrustedText } from '../promptShield';
import { buildAdminDemoTutorMessages, AdminDemoTutorRequestSchema } from '../services/adminDemoTutor';
import { ensureMarketingStudioSchema } from '../services/marketingStudioSchema';
import { MailService } from '../mailService';

import { GoogleGenAI } from '@google/genai';
import { fetchProviderModels, initModelDiscoverySync } from '../modelDiscovery';
import { recordBackendSystemLog } from '../memoryMonitor';
import {
  getAllRuntimeFlagRecords,
  getFeatureFlags,
  refreshRuntimeFlagsFromDb,
  updateRuntimeFlag
} from '../config/features';
import { checkPostgresHealth, getPostgresPool, queryPostgres } from '../postgresPool';
import { clearBootstrapCache } from './student';
import { catalogCache } from '../cache/catalogCache';
import { courseRepository } from '../repositories/courseRepository.js';
import { ensureCourseLearningSchema } from '../services/courseLearningSchema';
import { ensureCourseReviewSchema } from '../services/courseReviewSchema';
import { ensureCourseAssessmentSchema } from '../services/courseAssessmentSchema';
import { ensureCourseLifecycleSchema } from '../services/courseLifecycleSchema.js';
import {
  ensureAcademicAvailabilitySchema,
  listAcademicLevelAvailability,
  createAcademicLevelAvailability,
  updateAcademicLevelAvailability,
  updateCourseStudentVisibility,
  listRecentAcademicAvailabilityAudit
} from '../services/academicAvailability';
import { activeCancelledJobs, activeRunningCourseJobs, activeCoordinatedJobSnapshots } from '../services/courseJobControl.js';
import {
  getSystemConfigDoc,
  setSystemConfigDoc,
  getSystemSettingsDoc,
  setSystemSettingsDoc
} from '../systemConfigStore';

export function setupAdminRoutes(
  app: express.Express,
  verifyAuth: any,
  getAdminApp: any,
  isAdminEmail: any,
  syncAllProvidersFromSettings?: (apiKeysData: any) => void
) {
  async function checkIsAdmin(uid: string, email?: string): Promise<boolean> {
    if (email && isAdminEmail(email)) return true;
    try {
      const pool = getPostgresPool();
      if (pool) {
        const res = await pool.query('SELECT role, email FROM users WHERE uid = $1', [uid]);
        if (res.rows.length > 0) {
          const u = res.rows[0];
          if (u.role === 'admin' || (u.email && isAdminEmail(u.email))) return true;
        }
      }
    } catch (err) {
      console.warn('[AdminRoleCheck] Neon lookup error:', err);
    }
    return false;
  } 

  async function validateCourseForPublication(pool: any, courseId: string): Promise<void> {
    await ensureAcademicAvailabilitySchema();
    const courseResult = await pool.query(
      `SELECT id, title, level, department, semester, scope
       FROM courses WHERE id = $1 LIMIT 1`,
      [courseId]
    );
    if (courseResult.rows.length === 0) {
      const error: any = new Error(`Course ${courseId} does not exist.`);
      error.statusCode = 404;
      throw error;
    }

    const course = courseResult.rows[0];
    const requiredFields = ['id', 'title', 'level', 'department', 'semester', 'scope'];
    const missingFields = requiredFields.filter(key =>
      typeof course[key] !== 'string' || !course[key].trim()
    );
    if (missingFields.length > 0) {
      const error: any = new Error(`Course cannot be published because authoritative metadata is missing: ${missingFields.join(', ')}.`);
      error.statusCode = 409;
      throw error;
    }

    const moduleResult = await pool.query(
      `SELECT id FROM course_modules
       WHERE course_id = $1 AND COALESCE(is_archived, FALSE) = FALSE
       ORDER BY order_index ASC`,
      [courseId]
    );
    if (moduleResult.rows.length === 0) {
      const error: any = new Error('Course cannot be published without stored, non-archived modules.');
      error.statusCode = 409;
      throw error;
    }

    const lessonResult = await pool.query(
      `SELECT module_id, title, content_markdown
       FROM course_lessons
       WHERE course_id = $1
       ORDER BY module_id, order_index ASC`,
      [courseId]
    );
    const lessonsByModule = new Map<string, any[]>();
    for (const lesson of lessonResult.rows) {
      const key = String(lesson.module_id);
      const current = lessonsByModule.get(key) || [];
      current.push(lesson);
      lessonsByModule.set(key, current);
    }

    for (const module of moduleResult.rows) {
      const lessons = lessonsByModule.get(String(module.id)) || [];
      if (lessons.length === 0) {
        const error: any = new Error(`Course module ${module.id} has no stored lessons and cannot be published.`);
        error.statusCode = 409;
        throw error;
      }
      for (const lesson of lessons) {
        if (typeof lesson.title !== 'string' || !lesson.title.trim() ||
            typeof lesson.content_markdown !== 'string' || lesson.content_markdown.trim().length < 600) {
          const error: any = new Error(`Course lesson "${lesson.title || lesson.module_id}" is incomplete and cannot be published.`);
          error.statusCode = 409;
          throw error;
        }
      }
    }
  }


  initModelDiscoverySync().catch((err) => {
    console.warn('[Admin] Initial model discovery sync warning:', err);
  });

  // 1. Dynamic AI Lesson Remediation Endpoint (For High-Struggle Subtopics)
  app.post('/api/admin/remediate-lesson', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

    try {
      const isAdmin = await checkIsAdmin(user.uid, user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const { courseId, moduleId, subTopicId, subTopicTitle, moduleTitle, struggleCount, department: reqDepartment, level: reqLevel } = req.body;
      if (!subTopicTitle) {
        return res.status(400).json({ error: 'subTopicTitle is required' });
      }

      let resolvedCourseTitle = '';
      let resolvedDepartment = typeof reqDepartment === 'string' ? reqDepartment.trim() : '';
      let resolvedLevel = typeof reqLevel === 'string' ? reqLevel.trim() : '';
      const pool = getPostgresPool();
      if (pool && courseId) {
        const courseRow = await pool.query(
          'SELECT title, department, level FROM courses WHERE id = $1 LIMIT 1',
          [String(courseId).trim()]
        ).catch(() => ({ rows: [] as any[] }));
        if (courseRow.rows[0]) {
          resolvedCourseTitle = courseRow.rows[0].title || '';
          resolvedDepartment = resolvedDepartment || courseRow.rows[0].department || '';
          resolvedLevel = resolvedLevel || courseRow.rows[0].level || '';
        }
      }

      const apiKeysData = (await getSystemSettingsDoc('api_keys')) || {};
      const geminiKeys = Array.isArray(apiKeysData.gemini_direct?.keys)
        ? apiKeysData.gemini_direct.keys.map((k: any) => k?.key).filter(Boolean)
        : [];
      const apiKey = geminiKeys[0] || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: 'Gemini API key is not configured on the server' });
      }

      let activeModel = String(apiKeysData.gemini_direct?.model || process.env.GEMINI_MODEL || '').trim();
      if (!activeModel) {
        const { models } = await fetchProviderModels('gemini_direct', apiKey, false);
        activeModel = String(models[0]?.id || '').trim();
      }
      if (!activeModel) {
        return res.status(503).json({ error: 'No active Gemini model configured or discovered' });
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are UniAce's Senior University Academic Architect & Curriculum Specialist.
Students are actively struggling with the topic: "${subTopicTitle}"${moduleTitle ? ` in module "${moduleTitle}"` : ''}${resolvedCourseTitle ? ` (Course: "${resolvedCourseTitle}")` : ''}.
${resolvedDepartment ? `Target Discipline / Department: ${resolvedDepartment}` : ''}
${resolvedLevel ? `Target Academic Level: ${resolvedLevel} Level` : ''}
(Logged struggle requests from students: ${struggleCount || 1})

Author a comprehensive, discipline-appropriate academic remediation guide in clean Markdown that directly addresses why students struggle with "${subTopicTitle}":
- Adapt the structure and analytical approach to the nature of the subject:
  * If the topic is quantitative, mathematical, physical, or engineering-based, include step-by-step formal derivations, governing equations in balanced LaTeX ($...$ and $$...$$), and worked numerical examples.
  * If the topic is in the humanities, law, social sciences, or non-quantitative disciplines, focus on authoritative conceptual frameworks, primary source/textual or institutional analysis, and structured case evaluation without forcing artificial mathematical formulas.
- Include:
  1. Clear conceptual framing that bridges intuitive understanding to formal university-level terminology.
  2. Thorough academic exposition of the core principles, mechanisms, or analytical frameworks appropriate for ${resolvedLevel ? `${resolvedLevel} Level` : 'university study'}.
  3. Diagnosis of the specific misconceptions or analytical errors that cause students to struggle with this topic, paired with worked corrections.
  4. Diagnostic check-for-understanding questions with complete, verified academic explanations.`;

      const response = await ai.models.generateContent({
        model: activeModel,
        contents: prompt,
      });

      const remediatedContent = (response.text || '').trim();
      if (!remediatedContent) {
        return res.status(502).json({ error: 'Zero-Fallback Policy: Provider returned empty remediation content' });
      }

      await recordBackendSystemLog(
        'success',
        'ai',
        `Admin remediated high-struggle lesson "${subTopicTitle}" (Module: ${moduleTitle || 'General'})`,
        { subTopicId: subTopicId || null, courseId: courseId || null, moduleId: moduleId || null, struggleCount: struggleCount || 1 },
        { uid: user.uid, email: user.email }
      );

      res.json({
        success: true,
        subTopicTitle,
        remediatedContent,
        generatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Lesson Remediation Error:', error);
      await recordBackendSystemLog(
        'error',
        'ai',
        `Lesson remediation failed for "${req.body?.subTopicTitle || 'unknown'}": ${error.message || error}`,
        { error: error.message || String(error) },
        { uid: user?.uid, email: user?.email }
      );
      res.status(500).json({ error: error.message || 'Failed to remediate lesson' });
    }
  });

  // 2. Send Broadcast & Log Endpoint
  app.post('/api/admin/send-broadcast', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

    try {
      const isAdmin = await checkIsAdmin(user.uid, user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const { subject, message, channel, targetAudience, faculty, department } = req.body;
      if (!subject || !message) {
        return res.status(400).json({ error: 'Subject and message are required' });
      }

      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

      let userSql = 'SELECT uid, email, display_name FROM users WHERE 1=1';
      const sqlParams: any[] = [];
      if (faculty && faculty !== 'all') {
        sqlParams.push(faculty);
        userSql += ` AND (learning_profile->>'faculty' = $${sqlParams.length} OR learning_profile->>'department' IN (SELECT department FROM courses WHERE faculty = $${sqlParams.length}))`;
      }
      if (department && department !== 'all') {
        sqlParams.push(department);
        userSql += ` AND learning_profile->>'department' = $${sqlParams.length}`;
      }
      userSql += ' LIMIT 500';

      const userRows = await pool.query(userSql, sqlParams);
      const recipients = userRows.rows;

      const client = await pool.connect();
      const broadcastId = `bcast_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      try {
        await client.query('BEGIN');

        // Global Alert design: if targetAudience is All Students or All Faculty/Dept, insert global user_notification with uid='*'
        if (!faculty || faculty === 'all') {
          const globalNotifId = `notif_global_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          await client.query(
            `INSERT INTO user_notifications (id, uid, title, message, type, read, created_at)
             VALUES ($1, '*', $2, $3, 'announcement', FALSE, NOW())`,
            [globalNotifId, subject, message]
          );
        }

        // Insert individual notifications for targeted recipients
        for (const r of recipients) {
          const notifId = `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          await client.query(
            `INSERT INTO user_notifications (id, uid, title, message, type, read, created_at)
             VALUES ($1, $2, $3, $4, 'announcement', FALSE, NOW())`,
            [notifId, r.uid, subject, message]
          );
        }

        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }


      await recordBackendSystemLog(
        'success',
        'admin',
        `Dispatched broadcast "${subject}" to ${recipients.length} recipients`,
        { broadcastId, subject, channel: channel || 'email_and_app', recipientCount: recipients.length, faculty: faculty || 'All', department: department || 'All' },
        { uid: user.uid, email: user.email }
      );

      res.json({
        success: true,
        broadcastId,
        recipientCount: recipients.length,
        message: `Broadcast successfully dispatched to ${recipients.length} students`
      });

    } catch (error: any) {
      console.error('Send Broadcast Error:', error);
      res.status(500).json({ error: error.message || 'Failed to dispatch broadcast' });
    }
  });

  // 3. Server-Side AI Provider Benchmark Endpoint (Strict Zero-Fallback Live Probing)
  app.post('/api/admin/benchmark', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

    try {
      const isAdmin = await checkIsAdmin(user.uid, user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const { provider, customEndpoint, customApiKey, customModel } = req.body;
      let status: 'online' | 'degraded' | 'offline' = 'online';
      let latencyMs = 0;
      let modelUsed = '';
      let textSample = '';
      let errorMsg = '';

      const apiKeysData = (await getSystemSettingsDoc('api_keys')) || {};
      const getConfiguredKey = (prov: string, envKey?: string) => {
        const entry = apiKeysData[prov] || apiKeysData[prov.replace('_direct', '')] || apiKeysData[prov.replace('_free', '')];
        const list = entry?.keys?.map((k: any) => k.key).filter(Boolean);
        return (list && list[0]) || envKey || '';
      };

      const resolveBenchmarkModel = async (prov: string, apiKey: string, envModel?: string): Promise<string> => {
        if (customModel && String(customModel).trim()) return String(customModel).trim();
        const entry = apiKeysData[prov] || apiKeysData[prov.replace('_direct', '')] || apiKeysData[prov.replace('_free', '')];
        if (entry?.model && String(entry.model).trim()) return String(entry.model).trim();
        if (envModel && envModel.trim()) return envModel.trim();
        const { models } = await fetchProviderModels(prov, apiKey, false);
        const valid = (models || []).find(m => m?.id && !/embed|whisper|tts|moderation|guard|audio/i.test(m.id));
        if (!valid?.id) {
          throw new Error(`No active model configured or discovered for ${prov}. Please select a model in API Key Manager.`);
        }
        return valid.id;
      };

      const targetProvider = (provider || 'gemini_direct').toLowerCase();

      if (targetProvider === 'gemini_direct' || targetProvider === 'gemini') {
        try {
          const apiKey = getConfiguredKey('gemini_direct', process.env.GEMINI_API_KEY);
          if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
          const ai = new GoogleGenAI({ apiKey });
          modelUsed = await resolveBenchmarkModel('gemini_direct', apiKey, process.env.GEMINI_MODEL);
          const pStart = Date.now();
          const response = await ai.models.generateContent({
            model: modelUsed,
            contents: 'Respond with one word: Ready.',
          });
          latencyMs = Date.now() - pStart;
          textSample = (response.text || '').trim().slice(0, 50);
          if (!textSample) throw new Error('Empty response from Gemini');
        } catch (e: any) {
          status = 'offline';
          errorMsg = e.message;
        }
      } else if (targetProvider === 'groq') {
        try {
          const apiKey = getConfiguredKey('groq', process.env.GROQ_API_KEY);
          if (!apiKey) throw new Error('GROQ_API_KEY not configured');
          modelUsed = await resolveBenchmarkModel('groq', apiKey, process.env.GROQ_MODEL);
          const pStart = Date.now();
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelUsed, messages: [{ role: 'user', content: 'Say Ready' }], max_tokens: 5 })
          });
          latencyMs = Date.now() - pStart;
          if (!r.ok) throw new Error(`Groq returned HTTP ${r.status}`);
          const d = await r.json();
          textSample = (d.choices?.[0]?.message?.content || '').trim();
        } catch (e: any) {
          status = 'offline';
          errorMsg = e.message;
        }
      } else if (targetProvider === 'mistral_direct' || targetProvider === 'mistral') {
        try {
          const apiKey = getConfiguredKey('mistral_direct', process.env.MISTRAL_API_KEY);
          if (!apiKey) throw new Error('MISTRAL_API_KEY not configured');
          modelUsed = await resolveBenchmarkModel('mistral_direct', apiKey, process.env.MISTRAL_MODEL);
          const pStart = Date.now();
          const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelUsed, messages: [{ role: 'user', content: 'Say Ready' }], max_tokens: 5 })
          });
          latencyMs = Date.now() - pStart;
          if (!r.ok) throw new Error(`Mistral returned HTTP ${r.status}`);
          const d = await r.json();
          textSample = (d.choices?.[0]?.message?.content || '').trim();
        } catch (e: any) {
          status = 'offline';
          errorMsg = e.message;
        }
      } else if (targetProvider === 'nvidia') {
        try {
          const apiKey = getConfiguredKey('nvidia', process.env.NVIDIA_API_KEY);
          if (!apiKey) throw new Error('NVIDIA_API_KEY not configured');
          modelUsed = await resolveBenchmarkModel('nvidia', apiKey, process.env.NVIDIA_MODEL);
          const pStart = Date.now();
          const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelUsed, messages: [{ role: 'user', content: 'Say Ready' }], max_tokens: 5 })
          });
          latencyMs = Date.now() - pStart;
          if (!r.ok) throw new Error(`NVIDIA returned HTTP ${r.status}`);
          const d = await r.json();
          textSample = (d.choices?.[0]?.message?.content || '').trim();
        } catch (e: any) {
          status = 'offline';
          errorMsg = e.message;
        }
      } else if (targetProvider === 'openrouter_free' || targetProvider === 'openrouter') {
        try {
          const apiKey = getConfiguredKey('openrouter_free', process.env.OPENROUTER_API_KEY);
          if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');
          modelUsed = await resolveBenchmarkModel('openrouter_free', apiKey, process.env.OPENROUTER_MODEL);
          const pStart = Date.now();
          const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelUsed, messages: [{ role: 'user', content: 'Say Ready' }], max_tokens: 5 })
          });
          latencyMs = Date.now() - pStart;
          if (!r.ok) throw new Error(`OpenRouter returned HTTP ${r.status}`);
          const d = await r.json();
          textSample = (d.choices?.[0]?.message?.content || '').trim();
        } catch (e: any) {
          status = 'offline';
          errorMsg = e.message;
        }
      } else if (targetProvider === 'cohere') {
        try {
          const apiKey = getConfiguredKey('cohere', process.env.COHERE_API_KEY);
          if (!apiKey) throw new Error('COHERE_API_KEY not configured');
          modelUsed = await resolveBenchmarkModel('cohere', apiKey, process.env.COHERE_MODEL);
          const pStart = Date.now();
          const r = await fetch('https://api.cohere.com/v2/chat', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelUsed, messages: [{ role: 'user', content: 'Say Ready' }], max_tokens: 5 })
          });
          latencyMs = Date.now() - pStart;
          if (!r.ok) throw new Error(`Cohere returned HTTP ${r.status}`);
          const d = await r.json();
          textSample = (d.message?.content?.[0]?.text || '').trim();
        } catch (e: any) {
          status = 'offline';
          errorMsg = e.message;
        }
      } else if (targetProvider === 'huggingface') {
        try {
          const apiKey = getConfiguredKey('huggingface', process.env.HUGGINGFACE_API_KEY);
          if (!apiKey) throw new Error('HUGGINGFACE_API_KEY not configured');
          modelUsed = await resolveBenchmarkModel('huggingface', apiKey, process.env.HUGGINGFACE_MODEL || process.env.HF_MODEL);
          const pStart = Date.now();
          const r = await fetch('https://router.huggingface.co/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelUsed, messages: [{ role: 'user', content: 'Say Ready' }], max_tokens: 5 })
          });
          latencyMs = Date.now() - pStart;
          if (!r.ok) throw new Error(`HuggingFace returned HTTP ${r.status}`);
          const d = await r.json();
          textSample = (d.choices?.[0]?.message?.content || '').trim();
        } catch (e: any) {
          status = 'offline';
          errorMsg = e.message;
        }
      } else if (targetProvider === 'custom' && customEndpoint) {
        try {
          const pStart = Date.now();
          const r = await fetch(customEndpoint, {
            method: 'POST',
            headers: {
              ...(customApiKey ? { 'Authorization': `Bearer ${customApiKey}` } : {}),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: customModel || 'default',
              messages: [{ role: 'user', content: 'Ping' }],
              max_tokens: 5
            })
          });
          latencyMs = Date.now() - pStart;
          if (!r.ok) throw new Error(`Endpoint returned status ${r.status}`);
          const d = await r.json();
          textSample = (d.choices?.[0]?.message?.content || '').trim();
          modelUsed = customModel || 'custom';
        } catch (e: any) {
          status = 'offline';
          errorMsg = e.message;
        }
      } else {
        status = 'offline';
        errorMsg = `Unsupported or unconfigured provider: ${targetProvider}`;
      }

      await recordBackendSystemLog(
        status === 'online' ? 'info' : 'warning',
        'ai',
        `Admin benchmarked provider "${targetProvider}" (${modelUsed || 'N/A'}): ${status.toUpperCase()} (${latencyMs}ms)`,
        { provider: targetProvider, status, latencyMs, model: modelUsed, error: errorMsg || null },
        { uid: user.uid, email: user.email }
      );

      res.json({
        provider: targetProvider,
        status,
        latencyMs,
        latencyFormatted: `${latencyMs}ms`,
        model: modelUsed,
        textSample,
        error: errorMsg || undefined,
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('Benchmark Error:', error);
      res.status(500).json({ error: error.message || 'Benchmark probing failed' });
    }
  });

  // 4. Admin Managed Password Reset Link
  app.post('/api/admin/reset-password', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

    try {
      const isAdmin = await checkIsAdmin(user.uid, user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Target email is required' });

      const resetLink = await adminApp.auth().generatePasswordResetLink(email);

      try {
        await MailService.sendDiagnosticTestEmail(email);
      } catch (mailErr) {
        console.warn('Direct email sending skipped:', mailErr);
      }

      await recordBackendSystemLog(
        'warning',
        'admin',
        `Admin initiated password reset for ${email}`,
        { targetEmail: email },
        { uid: user.uid, email: user.email }
      );

      res.json({
        success: true,
        message: `Password reset link generated for ${email}`,
        resetLink
      });
    } catch (error: any) {
      console.error('Password Reset Error:', error);
      res.status(500).json({ error: error.message || 'Failed to generate password reset' });
    }
  });

  // 5. System Config Endpoints (GET & POST)
  app.get('/api/admin/config', verifyAuth, async (req, res) => {
    const user = (req as any).user;

    try {
      const isAdmin = await checkIsAdmin(user.uid, user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const configRes = await queryPostgres<{ data: any }>(`SELECT data FROM system_config WHERE key = 'general' LIMIT 1`);
      res.json(configRes.rows[0]?.data || {});
    } catch (error: any) {
      console.error('Fetch System Config Error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch system config' });
    }
  });

  app.post('/api/admin/config', verifyAuth, async (req, res) => {
    const user = (req as any).user;

    try {
      const isAdmin = await checkIsAdmin(user.uid, user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const updates = req.body || {};
      const existingRes = await queryPostgres<{ data: any }>(`SELECT data FROM system_config WHERE key = 'general' LIMIT 1`);
      const existingData = existingRes.rows[0]?.data || {};
      const merged = {
        ...existingData,
        ...updates,
        updatedAt: new Date().toISOString(),
        updatedBy: user.email || user.uid
      };
      await queryPostgres(
        `INSERT INTO system_config (key, data, updated_at)
         VALUES ('general', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [JSON.stringify(merged)]
      );

      await recordBackendSystemLog(
        'info',
        'admin',
        `Updated general system configuration`,
        { updatedKeys: Object.keys(updates || {}) },
        { uid: user.uid, email: user.email }
      );

      res.json({ success: true, message: 'System config updated successfully' });
    } catch (error: any) {
      console.error('Update System Config Error:', error);
      res.status(500).json({ error: error.message || 'Failed to update system config' });
    }
  });

  // 6. Live AI Provider Model Discovery Endpoint (supports both POST and GET)
  const handleFetchProviderModels = async (req: express.Request, res: express.Response) => {
    const user = (req as any).user;
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(500).json({ success: false, error: 'Firebase not initialized' });

    try {
      let isAdmin = Boolean(user?.admin === true || user?.role === 'admin' || isAdminEmail(user?.email));
      if (!isAdmin && user?.uid) {
        isAdmin = await checkIsAdmin(user.uid, user.email);
      }
      if (!isAdmin) return res.status(401).json({ success: false, error: 'Forbidden: Admin access required' });

      const provider = (req.body?.provider || req.query?.provider || '') as string;
      const apiKeyOverride = (req.body?.apiKeyOverride || req.query?.apiKeyOverride || undefined) as string | undefined;
      const forceRefresh = req.body?.forceRefresh ?? req.query?.forceRefresh;

      if (!provider) {
        return res.status(400).json({ success: false, error: 'Provider name is required' });
      }

      console.log(`[Admin] Discovering live models for provider '${provider}' (forceRefresh: ${!!forceRefresh})...`);
      const { models, cached } = await fetchProviderModels(
        provider,
        apiKeyOverride,
        forceRefresh === true || forceRefresh === 'true'
      );

      await recordBackendSystemLog(
        'info',
        'ai',
        `Discovered ${models.length} live models for provider "${provider}" (cached: ${!!cached})`,
        { provider, count: models.length, cached: !!cached },
        { uid: user?.uid || 'admin', email: user?.email || 'admin' }
      );

      res.json({
        success: true,
        provider,
        count: models.length,
        models,
        cached
      });
    } catch (error: any) {
      console.error(`[Admin] Model discovery failed for provider:`, error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to fetch provider models',
        details: error.stack
      });
    }
  };

  app.post('/api/admin/fetch-provider-models', verifyAuth, handleFetchProviderModels);
  app.get('/api/admin/fetch-provider-models', verifyAuth, handleFetchProviderModels);

  // 7. Get All Runtime Flags (Self-Contained Neon PostgreSQL Control Plane)
  app.get('/api/admin/runtime-flags', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

    try {
      let isAdmin = Boolean(user?.admin === true || user?.role === 'admin' || isAdminEmail(user?.email));
      if (!isAdmin && user?.uid) {
        isAdmin = await checkIsAdmin(user.uid, user.email);
      }
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      // Refresh cache from PostgreSQL before answering
      await refreshRuntimeFlagsFromDb();

      const flags = getAllRuntimeFlagRecords();
      const currentSnapshot = getFeatureFlags();

      res.json({
        success: true,
        flags,
        currentSnapshot
      });
    } catch (error: any) {
      console.error('[Admin] Fetch Runtime Flags Error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch runtime flags' });
    }
  });

  // 8. Mutate Runtime Flag State (Neon PostgreSQL + Instant In-Memory Invalidation)
  app.post('/api/admin/runtime-flags/:flagKey', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

    try {
      let isAdmin = Boolean(user?.admin === true || user?.role === 'admin' || isAdminEmail(user?.email));
      if (!isAdmin && user?.uid) {
        isAdmin = await checkIsAdmin(user.uid, user.email);
      }
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const { flagKey } = req.params;
      const { enabled, reason } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Payload property `enabled` (boolean) is required' });
      }

      const updatedRecord = await updateRuntimeFlag(
        flagKey,
        enabled,
        user.email || user.uid,
        reason
      );

      await recordBackendSystemLog(
        'info',
        'admin',
        `Admin toggled database runtime flag ${flagKey} -> ${enabled}`,
        { flagKey, enabled, reason: reason || null, cutover_at: updatedRecord.cutover_at },
        { uid: user.uid, email: user.email }
      );

      res.json({
        success: true,
        flag: updatedRecord,
        currentSnapshot: getFeatureFlags()
      });
    } catch (error: any) {
      console.error('[Admin] Update Runtime Flag Error:', error);
      res.status(400).json({ error: error.message || 'Failed to update runtime flag' });
    }
  });

  // 9. Neon PostgreSQL Connection Pool & Table Telemetry Engine
  app.get('/api/admin/database/engine-health', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

    try {
      let isAdmin = Boolean(user?.admin === true || user?.role === 'admin' || isAdminEmail(user?.email));
      if (!isAdmin && user?.uid) {
        isAdmin = await checkIsAdmin(user.uid, user.email);
      }
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const health = await checkPostgresHealth();
      const pool = getPostgresPool();

      let tableCounts: Record<string, number> = {};
      if (health.connected) {
        try {
          const countsRes = await queryPostgres(`
            SELECT
              (SELECT count(*) FROM courses) AS courses_count,
              (SELECT count(*) FROM user_course_progress) AS progress_count,
              (SELECT count(*) FROM user_study_batches) AS batches_count,
              (SELECT count(*) FROM user_lesson_completions) AS completions_count,
              (SELECT count(*) FROM user_quiz_attempts) AS quiz_attempts_count,
              (SELECT count(*) FROM system_runtime_flags) AS runtime_flags_count,
              (SELECT count(*) FROM user_sparks_wallets) AS sparks_wallets_count,
              (SELECT count(*) FROM spark_escrow_locks) AS escrow_locks_count,
              (SELECT count(*) FROM spark_transactions_ledger) AS sparks_ledger_count,
              (SELECT count(*) FROM course_generation_jobs) AS generation_jobs_count,
              (SELECT count(*) FROM sse_stream_tickets) AS sse_tickets_count;
          `);
          if (countsRes.rows && countsRes.rows[0]) {
            const r = countsRes.rows[0];
            tableCounts = {
              courses: Number(r.courses_count || 0),
              user_course_progress: Number(r.progress_count || 0),
              user_study_batches: Number(r.batches_count || 0),
              user_lesson_completions: Number(r.completions_count || 0),
              user_quiz_attempts: Number(r.quiz_attempts_count || 0),
              system_runtime_flags: Number(r.runtime_flags_count || 0),
              user_sparks_wallets: Number(r.sparks_wallets_count || 0),
              spark_escrow_locks: Number(r.escrow_locks_count || 0),
              spark_transactions_ledger: Number(r.sparks_ledger_count || 0),
              course_generation_jobs: Number(r.generation_jobs_count || 0),
              sse_stream_tickets: Number(r.sse_tickets_count || 0)
            };
          }
        } catch (tableErr: any) {
          console.warn('[Admin] Could not query table counts:', tableErr.message);
        }
      }

      res.json({
        success: true,
        connected: health.connected,
        latencyMs: health.latencyMs,
        error: health.error || null,
        pool: pool ? {
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount
        } : null,
        tableCounts,
        flags: getFeatureFlags(),
        checkedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('[Admin] Database Engine Health Error:', error);
      res.status(500).json({ error: error.message || 'Failed to inspect database engine health' });
    }
  });

  // 10. Execute Native Neon PostgreSQL Relational Integrity Audit
  app.post('/api/admin/database/run-parity-audit', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

    try {
      let isAdmin = Boolean(user?.admin === true || user?.role === 'admin' || isAdminEmail(user?.email));
      if (!isAdmin && user?.uid) {
        isAdmin = await checkIsAdmin(user.uid, user.email);
      }
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const scope = req.body?.scope || 'progress';

      if (scope === 'progress') {
        const pgRes = await queryPostgres<{
          total_rows: string;
          mismatched_rows: string;
        }>(`
          SELECT
            COUNT(*)::int AS total_rows,
            COUNT(*) FILTER (
              WHERE ucp.completed_lessons_count <> (
                SELECT COUNT(*)::int FROM user_lesson_completions ulc
                WHERE ulc.uid = ucp.uid AND ulc.course_id = ucp.course_id
              )
            )::int AS mismatched_rows
          FROM user_course_progress ucp;
        `);
        const totalRows = Number(pgRes.rows[0]?.total_rows || 0);
        const deltaCount = Number(pgRes.rows[0]?.mismatched_rows || 0);
        const parityOk = deltaCount === 0;

        await recordBackendSystemLog(
          parityOk ? 'success' : 'warning',
          'admin',
          `Admin executed Neon Progress Relational Integrity Audit (rows: ${totalRows}, mismatches: ${deltaCount})`,
          { scope, parityOk, totalRows, deltaCount },
          { uid: user.uid, email: user.email }
        );

        return res.json({
          success: true,
          scope,
          parityMatched: parityOk,
          pgCount: totalRows,
          fsCount: 0,
          deltaCount,
          auditedAt: new Date().toISOString()
        });
      }

      if (scope === 'catalog') {
        const pgRes = await queryPostgres<{ count: string }>('SELECT count(*) FROM courses;');
        const pgCount = Number(pgRes.rows[0]?.count || 0);
        const parityOk = pgCount > 0;

        await recordBackendSystemLog(
          parityOk ? 'success' : 'warning',
          'admin',
          `Admin executed Catalog Integrity Audit (Neon Postgres: ${pgCount} courses)`,
          { scope, parityOk, pgCount },
          { uid: user.uid, email: user.email }
        );

        return res.json({
          success: true,
          scope,
          parityMatched: parityOk,
          pgCount,
          fsCount: 0,
          auditedAt: new Date().toISOString()
        });
      }

      if (scope === 'sparks') {
        const pgRes = await queryPostgres<{
          total_users: string;
          matched_wallets: string;
          mismatched_wallets: string;
        }>(`
          SELECT
            COUNT(*)::int AS total_users,
            COUNT(*) FILTER (WHERE w.uid IS NULL OR w.balance = u.ai_sparks)::int AS matched_wallets,
            COUNT(*) FILTER (WHERE w.uid IS NOT NULL AND w.balance <> u.ai_sparks)::int AS mismatched_wallets
          FROM users u
          LEFT JOIN user_sparks_wallets w ON w.uid = u.uid;
        `);
        const totalUsersChecked = Number(pgRes.rows[0]?.total_users || 0);
        const matchedCount = Number(pgRes.rows[0]?.matched_wallets || 0);
        const mismatchCount = Number(pgRes.rows[0]?.mismatched_wallets || 0);
        const parityMatched = mismatchCount === 0;
        const auditedAt = new Date().toISOString();

        await recordBackendSystemLog(
          parityMatched ? 'success' : 'warning',
          'admin',
          `Admin executed Neon AI Sparks Wallet Integrity Audit (matched: ${matchedCount}/${totalUsersChecked})`,
          { scope, parityOk: parityMatched, mismatchCount },
          { uid: user.uid, email: user.email }
        );

        return res.json({
          success: true,
          scope,
          parityMatched,
          totalUsersChecked,
          matchedCount,
          mismatchCount,
          mismatches: [],
          auditedAt
        });
      }

      return res.status(400).json({ error: `Unsupported audit scope: ${scope}. Supported: 'progress', 'catalog', 'sparks'` });
    } catch (error: any) {
      console.error('[Admin] Relational Integrity Audit Error:', error);
      res.status(500).json({ error: error.message || 'Integrity audit execution failed' });
    }
  });


  // Evidence-backed marketing snapshot. Only published courses explicitly marked
  // student-visible and whose academic level is live are returned. Course scope is
  // retained so a campaign cannot imply universal access to a targeted offering.
  app.get('/api/admin/marketing/snapshot', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user?.uid, user?.email))) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    try {
      // forceRefresh=true bypasses the process-local catalog cache. This snapshot
      // must fail with 503 if PostgreSQL cannot serve a fresh read; stale cache data
      // must never be relabelled as current marketing evidence.
      const catalog = await courseRepository.getFullCatalogWithSyllabus(true);
      const liveCourses = (catalog.courses || []).filter((course: any) => {
        if (
          course?.status !== 'published' ||
          course?.student_visibility !== 'live' ||
          course?.level_availability !== 'live' ||
          typeof course?.level !== 'string' || !course.level.trim() ||
          typeof course?.semester !== 'string' || !course.semester.trim()
        ) return false;

        const scope = typeof course.scope === 'string' ? course.scope.trim().toUpperCase() : '';
        if (scope === 'GLOBAL') return true;
        if (scope === 'FACULTY') {
          return (Array.isArray(course.faculties) && course.faculties.some((value: unknown) => typeof value === 'string' && value.trim())) ||
            (typeof course.faculty === 'string' && course.faculty.trim().length > 0);
        }
        if (scope === 'DEPARTMENT') {
          return (Array.isArray(course.departments) && course.departments.some((value: unknown) => typeof value === 'string' && value.trim())) ||
            (typeof course.department === 'string' && course.department.trim().length > 0);
        }
        return false;
      });
      const courseIds = liveCourses
        .map((course: any) => String(course.id || '').trim())
        .filter(Boolean);

      let formulaCounts: Record<string, number> = {};
      let formulaCountsVerified = false;
      let quizCounts: Record<string, number> = {};
      let quizCountsVerified = false;
      let pastPaperCountsByCode: Record<string, number> = {};
      let totalPastPapersCount: number | null = null;
      let pastPaperCountsVerified = false;

      if (courseIds.length > 0) {
        const [formulaOutcome, quizOutcome, pastPapersOutcome] = await Promise.allSettled([
          queryPostgres<{ course_id: string; count: string | number }>(
            `SELECT course_id, COUNT(*)::int AS count
             FROM course_formulas
             WHERE course_id = ANY($1::text[])
             GROUP BY course_id`,
            [courseIds]
          ),
          queryPostgres<{ course_id: string; count: string | number }>(
            `SELECT course_id, COUNT(*)::int AS count
             FROM course_module_quizzes
             WHERE course_id = ANY($1::text[])
             GROUP BY course_id`,
            [courseIds]
          ),
          queryPostgres<{ course_code: string; count: string | number }>(
            `SELECT UPPER(TRIM(COALESCE(course_code, data->>'courseCode', ''))) AS course_code,
                    COUNT(*)::int AS count
             FROM past_papers
             GROUP BY 1`
          )
        ]);

        if (formulaOutcome.status === 'fulfilled') {
          formulaCounts = Object.fromEntries(
            formulaOutcome.value.rows.map(row => [row.course_id, Number(row.count)])
          );
          formulaCountsVerified = true;
        } else {
          console.warn('[MarketingSnapshot] Formula inventory could not be verified:', formulaOutcome.reason?.message || formulaOutcome.reason);
        }

        if (quizOutcome.status === 'fulfilled') {
          quizCounts = Object.fromEntries(
            quizOutcome.value.rows.map(row => [row.course_id, Number(row.count)])
          );
          quizCountsVerified = true;
        } else {
          console.warn('[MarketingSnapshot] Quiz inventory could not be verified:', quizOutcome.reason?.message || quizOutcome.reason);
        }

        if (pastPapersOutcome.status === 'fulfilled') {
          pastPaperCountsByCode = Object.fromEntries(
            pastPapersOutcome.value.rows
              .filter(row => Boolean(row.course_code))
              .map(row => [String(row.course_code).toUpperCase(), Number(row.count)])
          );
          totalPastPapersCount = pastPapersOutcome.value.rows.reduce(
            (sum, row) => sum + Number(row.count || 0),
            0
          );
          pastPaperCountsVerified = true;
        } else {
          console.warn('[MarketingSnapshot] Past papers inventory could not be verified:', pastPapersOutcome.reason?.message || pastPapersOutcome.reason);
        }
      } else {
        // An empty live catalog is a verified empty result from the authoritative catalog.
        formulaCountsVerified = true;
        quizCountsVerified = true;
        pastPaperCountsVerified = true;
        totalPastPapersCount = 0;
      }

      const readOptionalConfig = async (key: string) => {
        try {
          const value = await getSystemConfigDoc(key, true);
          return { configured: value !== null, available: true, value };
        } catch (error: any) {
          return { configured: false, available: false, value: null, error: error?.message || String(error) };
        }
      };

      const readOptionalSettings = async (key: string) => {
        try {
          const value = await getSystemSettingsDoc(key, true);
          return { configured: value !== null, available: true, value };
        } catch (error: any) {
          return { configured: false, available: false, value: null, error: error?.message || String(error) };
        }
      };

      const [institutionResult, switchesResult, supportResult, pricingResult, routingResult, apiKeysResult] = await Promise.all([
        readOptionalConfig('institution'),
        readOptionalConfig('feature_switches'),
        readOptionalConfig('support'),
        readOptionalConfig('pricing'),
        readOptionalConfig('routing'),
        readOptionalSettings('api_keys')
      ]);

      const providerEnvKeyMap: Record<string, string | undefined> = {
        gemini_direct: process.env.GEMINI_API_KEY,
        groq: process.env.GROQ_API_KEY,
        mistral_direct: process.env.MISTRAL_API_KEY,
        cohere: process.env.COHERE_API_KEY,
        huggingface: process.env.HUGGINGFACE_API_KEY,
        openrouter_free: process.env.OPENROUTER_API_KEY,
        nvidia: process.env.NVIDIA_API_KEY
      };
      const dbApiKeys = apiKeysResult.value && typeof apiKeysResult.value === 'object' ? apiKeysResult.value : {};
      const hasProviderCredential = (providerId: string): boolean => {
        const envKey = providerEnvKeyMap[providerId];
        if (typeof envKey === 'string' && envKey.trim().length > 0) return true;
        const dbEntry = (dbApiKeys as Record<string, any>)[providerId];
        if (typeof dbEntry === 'string' && dbEntry.trim().length > 0) return true;
        if (dbEntry && typeof dbEntry === 'object') {
          if (typeof dbEntry.key === 'string' && dbEntry.key.trim().length > 0 && dbEntry.exhausted !== true) return true;
          if (Array.isArray(dbEntry.keys) && dbEntry.keys.some((k: any) => typeof k === 'string' ? k.trim().length > 0 : (typeof k?.key === 'string' && k.key.trim().length > 0 && k.exhausted !== true))) {
            return true;
          }
        }
        return false;
      };

      const rawRouting = routingResult.value && typeof routingResult.value === 'object' ? routingResult.value : null;
      const candidateProviders = Array.from(new Set([
        typeof rawRouting?.global_provider === 'string' ? rawRouting.global_provider.trim().toLowerCase() : '',
        typeof rawRouting?.chat === 'string' ? rawRouting.chat.trim().toLowerCase() : '',
        ...(Array.isArray(rawRouting?.fallbacksByTask?.chat)
          ? rawRouting.fallbacksByTask.chat.map((p: unknown) => typeof p === 'string' ? p.trim().toLowerCase() : '')
          : []),
        ...Object.keys(providerEnvKeyMap)
      ].filter(Boolean)));
      const verifiedProviders = candidateProviders.filter(hasProviderCredential);
      const aiRuntimeVerified = verifiedProviders.length > 0;

      const institutionValue = institutionResult.value;
      const institutionValid = Boolean(
        institutionResult.available &&
        institutionValue &&
        Array.isArray(institutionValue.departments) &&
        Array.isArray(institutionValue.faculties) &&
        institutionValue.departmentToFaculty &&
        typeof institutionValue.departmentToFaculty === 'object' &&
        !Array.isArray(institutionValue.departmentToFaculty)
      );

      const rawSwitches = switchesResult.value;
      const featureSwitches = rawSwitches && typeof rawSwitches === 'object' && !Array.isArray(rawSwitches)
        ? Object.fromEntries(
            Object.entries(rawSwitches).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
          )
        : null;

      const rawSupport = supportResult.value;
      const support = rawSupport && typeof rawSupport === 'object'
        ? {
            whatsappSupport: typeof rawSupport.whatsappSupport === 'string' && rawSupport.whatsappSupport.trim()
              ? rawSupport.whatsappSupport.trim()
              : null,
            contactEmail: typeof rawSupport.contactEmail === 'string' && rawSupport.contactEmail.trim()
              ? rawSupport.contactEmail.trim()
              : null
          }
        : null;

      const rawPricing = pricingResult.value;
      const pricingPlans = Array.isArray(rawPricing?.plans)
        ? rawPricing.plans
            .filter((plan: any) =>
              plan &&
              plan.enabled !== false &&
              typeof plan.id === 'string' &&
              typeof plan.name === 'string' &&
              Number.isFinite(Number(plan.price)) &&
              Number(plan.price) >= 0 &&
              typeof plan.duration === 'string'
            )
            .map((plan: any) => ({
              id: plan.id,
              name: plan.name,
              price: Number(plan.price),
              duration: plan.duration,
              features: Array.isArray(plan.features)
                ? plan.features.filter((feature: unknown) => typeof feature === 'string')
                : []
            }))
        : null;

      const courses = liveCourses.map((course: any) => {
        const courseId = String(course.id);
        const normalizedCode = courseId.trim().toUpperCase();
        const modules = Array.isArray(course.syllabus) ? course.syllabus.map((module: any) => ({
          id: String(module.id || ''),
          title: String(module.title || ''),
          lessons: Array.isArray(module.subTopics)
            ? module.subTopics.map((lesson: any) => ({
                id: String(lesson.id || ''),
                title: String(lesson.title || '')
              }))
            : []
        })) : [];
        return {
          id: courseId,
          title: String(course.title),
          description: typeof course.description === 'string' ? course.description : '',
          department: typeof course.department === 'string' ? course.department : '',
          faculty: typeof course.faculty === 'string' ? course.faculty : '',
          faculties: Array.isArray(course.faculties) ? course.faculties : [],
          departments: Array.isArray(course.departments) ? course.departments : [],
          level: typeof course.level === 'string' ? course.level : '',
          semester: typeof course.semester === 'string' ? course.semester : '',
          scope: typeof course.scope === 'string' ? course.scope : '',
          status: 'published',
          studentVisibility: 'live',
          levelAvailability: 'live',
          modules,
          moduleCount: modules.length,
          lessonCount: modules.reduce((sum: number, module: any) => sum + module.lessons.length, 0),
          formulaCount: formulaCountsVerified ? (formulaCounts[courseId] ?? 0) : null,
          quizCount: quizCountsVerified ? (quizCounts[courseId] ?? 0) : null,
          pastPaperCount: pastPaperCountsVerified ? (pastPaperCountsByCode[normalizedCode] ?? 0) : null
        };
      });

      const totalModules = courses.reduce((sum: number, course: any) => sum + course.moduleCount, 0);
      const totalLessons = courses.reduce((sum: number, course: any) => sum + course.lessonCount, 0);
      const totalFormulas = formulaCountsVerified
        ? courses.reduce((sum: number, course: any) => sum + (course.formulaCount ?? 0), 0)
        : null;
      const totalQuizzes = quizCountsVerified
        ? courses.reduce((sum: number, course: any) => sum + (course.quizCount ?? 0), 0)
        : null;

      res.set('Cache-Control', 'private, no-store');
      res.set('Vary', 'Authorization');
      return res.json({
        success: true,
        snapshot: {
          generatedAt: new Date().toISOString(),
          catalogUpdatedAt: catalog.maxUpdatedAt,
          source: 'authoritative-postgres-catalog',
          courses,
          totals: {
            livePublishedCourses: courses.length,
            modules: totalModules,
            lessons: totalLessons,
            formulas: totalFormulas,
            formulasVerified: formulaCountsVerified,
            quizzes: totalQuizzes,
            quizzesVerified: quizCountsVerified,
            pastPapers: pastPaperCountsVerified ? totalPastPapersCount : null,
            pastPapersVerified: pastPaperCountsVerified,
            aiRuntimeVerified
          },
          institution: {
            status: institutionValid ? 'configured' : (institutionResult.available ? 'unconfigured' : 'unavailable'),
            departments: institutionValid ? institutionValue.departments : [],
            faculties: institutionValid ? institutionValue.faculties : [],
            departmentToFaculty: institutionValid ? institutionValue.departmentToFaculty : {}
          },
          featureSwitches: {
            status: switchesResult.available ? (featureSwitches ? 'configured' : 'unconfigured') : 'unavailable',
            values: featureSwitches
          },
          support: {
            status: supportResult.available ? (support ? 'configured' : 'unconfigured') : 'unavailable',
            whatsappSupport: support?.whatsappSupport ?? null,
            contactEmail: support?.contactEmail ?? null
          },
          pricing: {
            status: pricingResult.available ? (pricingPlans ? 'configured' : 'unconfigured') : 'unavailable',
            plans: pricingPlans
          }
        }
      });
    } catch (error: any) {
      console.error('[Admin] Marketing snapshot failed:', error);
      return res.status(503).json({
        error: 'Marketing data could not be verified from the authoritative catalog. No fallback marketing snapshot is available.'
      });
    }
  });

  // Feature Switches Admin Endpoints
  app.get('/api/admin/feature-switches', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = user?.role === 'admin' || (await checkIsAdmin(user?.uid, user?.email));
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }
    try {
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });
      const result = await pool.query("SELECT data FROM system_config WHERE key = 'feature_switches'");
      const switches = result.rows[0]?.data || { arena: false, tutor_dashboard: false };
      res.json({ success: true, featureSwitches: switches });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/feature-switches', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = user?.role === 'admin' || (await checkIsAdmin(user?.uid, user?.email));
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }
    try {
      const { featureSwitches } = req.body;
      if (!featureSwitches || typeof featureSwitches !== 'object') {
        return res.status(400).json({ error: 'featureSwitches object is required' });
      }

      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });

      // Fetch old value for audit log
      const oldRes = await pool.query("SELECT data FROM system_config WHERE key = 'feature_switches'");
      const oldValue = oldRes.rows[0]?.data || { arena: false, tutor_dashboard: false };

      // Update in system_config
      await pool.query(
        `INSERT INTO system_config (key, data, updated_at)
         VALUES ('feature_switches', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [JSON.stringify(featureSwitches)]
      );

      // Audit log
      await recordBackendSystemLog(
        'info',
        'admin',
        `Admin ${user.email || user.uid} updated Feature Switches`,
        { oldValue, newValue: featureSwitches, time: new Date().toISOString() },
        { uid: user.uid, email: user.email }
      );

      // Clear in-memory bootstrap cache so all clients see the change immediately
      clearBootstrapCache();

      res.json({ success: true, featureSwitches });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Student-facing availability is independent of course publication and lifecycle state.
  app.get('/api/admin/academic-levels', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user.uid, user.email))) return res.status(403).json({ error: 'Admin privileges required' });
    try {
      const levels = await listAcademicLevelAvailability();
      res.set('Cache-Control', 'private, no-store');
      return res.json({ success: true, levels });
    } catch (error: any) {
      return res.status(503).json({ error: error?.message || 'Academic level settings are unavailable.' });
    }
  });

  app.post('/api/admin/academic-levels', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user.uid, user.email))) return res.status(403).json({ error: 'Admin privileges required' });
    try {
      const level = await createAcademicLevelAvailability({
        levelKey: req.body?.levelKey,
        label: req.body?.label,
        availability: req.body?.availability,
        sortOrder: req.body?.sortOrder,
        actorUid: user.uid
      });
      return res.status(201).json({ success: true, level });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || 'Failed to create academic level.' });
    }
  });

  app.patch('/api/admin/academic-levels/:levelKey', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user.uid, user.email))) return res.status(403).json({ error: 'Admin privileges required' });
    try {
      const level = await updateAcademicLevelAvailability(req.params.levelKey, {
        availability: req.body?.availability,
        label: req.body?.label,
        sortOrder: req.body?.sortOrder,
        actorUid: user.uid
      });
      catalogCache.invalidateAll();
      await recordBackendSystemLog(
        'info',
        'admin',
        `Academic level availability updated for ${level.level_key}`,
        { levelKey: level.level_key, availability: level.availability },
        { uid: user.uid }
      );
      return res.json({ success: true, level });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || 'Failed to update academic level.' });
    }
  });

  app.get('/api/admin/academic-availability/audit', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user.uid, user.email))) return res.status(403).json({ error: 'Admin privileges required' });
    try {
      const entries = await listRecentAcademicAvailabilityAudit(req.query?.limit);
      res.set('Cache-Control', 'private, no-store');
      return res.json({ success: true, entries });
    } catch (error: any) {
      return res.status(503).json({ error: error?.message || 'Availability history is temporarily unavailable.' });
    }
  });

  app.patch('/api/admin/courses/:id/availability', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user.uid, user.email))) return res.status(403).json({ error: 'Admin privileges required' });
    try {
      const result = await updateCourseStudentVisibility(req.params.id, req.body?.availability, user.uid);
      catalogCache.invalidateAll();
      await recordBackendSystemLog(
        'info',
        'admin',
        `Student availability updated for course ${result.courseId}`,
        { courseId: result.courseId, availability: result.availability },
        { uid: user.uid }
      );
      return res.json({ success: true, ...result });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || 'Failed to update course availability.' });
    }
  });

  // Admin Course Creation Endpoint via Neon. New records remain drafts until explicitly validated and published.
  app.post('/api/admin/courses', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) return res.status(403).json({ error: 'Admin privileges required' });

    const { id, code, title, description, level, department, faculty, semester, creditUnits, scope, syllabus } = req.body || {};
    const requiredFields = { id, title, level, department, semester, scope };
    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => typeof value !== 'string' || !value.trim())
      .map(([key]) => key);
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Course creation requires source-supplied academic metadata.',
        missingFields
      });
    }
    if (typeof creditUnits !== 'number' || !Number.isInteger(creditUnits) || creditUnits < 1 || creditUnits > 12) {
      return res.status(400).json({ error: 'Course credit units must be a verified whole number between 1 and 12.' });
    }
    if (syllabus !== undefined && !Array.isArray(syllabus)) {
      return res.status(400).json({ error: 'Syllabus must be an array supplied by the course author or generation process.' });
    }
    if (Array.isArray(syllabus)) {
      for (let moduleIndex = 0; moduleIndex < syllabus.length; moduleIndex++) {
        const module = syllabus[moduleIndex];
        if (!module || typeof module.title !== 'string' || !module.title.trim()) {
          return res.status(400).json({ error: 'Every supplied module must contain an actual title.', moduleIndex });
        }
        const lessons = module.subTopics || module.lessons || [];
        if (!Array.isArray(lessons)) {
          return res.status(400).json({ error: 'Module lessons must be an array.', moduleIndex });
        }
        for (let lessonIndex = 0; lessonIndex < lessons.length; lessonIndex++) {
          if (!lessons[lessonIndex] || typeof lessons[lessonIndex].title !== 'string' || !lessons[lessonIndex].title.trim()) {
            return res.status(400).json({ error: 'Every supplied lesson must contain an actual title.', moduleIndex, lessonIndex });
          }
        }
      }
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
    await ensureCourseLearningSchema();
    await ensureAcademicAvailabilitySchema();
    await ensureCourseLifecycleSchema();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id.trim()]);
      await client.query(
        'DELETE FROM course_lifecycle_tombstones WHERE course_id = $1',
        [id.trim()]
      );
      const courseCode = typeof code === 'string' && code.trim() ? code.trim() : id.trim();
      await client.query(
        `INSERT INTO courses (id, code, title, description, level, department, faculty, semester, credit_units, scope, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', 1, NOW(), NOW())`,
        [id.trim(), courseCode, title.trim(), typeof description === 'string' ? description : null, level, department, faculty || null, semester, creditUnits, scope]
      );

      if (Array.isArray(syllabus)) {
        for (let mIdx = 0; mIdx < syllabus.length; mIdx++) {
          const module = syllabus[mIdx];
          const moduleId = module.id || `mod_${id.trim()}_${mIdx + 1}`;
          await client.query(
            `INSERT INTO course_modules (id, course_id, title, description, order_index, is_archived, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, FALSE, NOW(), NOW())`,
            [moduleId, id.trim(), module.title.trim(), module.description || null, module.order ?? mIdx + 1]
          );

          const lessons = module.subTopics || module.lessons || [];
          for (let lIdx = 0; lIdx < lessons.length; lIdx++) {
            const lesson = lessons[lIdx];
            const lessonId = lesson.id || `less_${moduleId}_${lIdx + 1}`;
            await client.query(
              `INSERT INTO course_lessons (id, course_id, module_id, title, content_markdown, order_index, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
              [lessonId, id.trim(), moduleId, lesson.title.trim(), lesson.content ?? lesson.content_markdown ?? '', lesson.order ?? lIdx + 1]
            );
          }
        }
      }

      await client.query('COMMIT');
      catalogCache.invalidateAll();
      await recordBackendSystemLog(
        'info',
        'admin',
        `Admin ${user.email || user.uid} created draft course ${id} via Neon`,
        { courseId: id, status: 'draft' },
        { uid: user.uid, email: user.email }
      );
      res.status(201).json({ success: true, courseId: id, status: 'draft' });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err?.code === '23505') {
        return res.status(409).json({ error: `Course identifier "${id}" already exists. Use the update workflow instead of silently overwriting it.` });
      }
      res.status(500).json({ error: 'Failed to create draft course', details: err.message });
    } finally {
      client.release();
    }
  });

  // Admin Course Update Endpoint via Neon
  app.put('/api/admin/courses/:id', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const { id } = req.params;
    const { title, description, level, semester, creditUnits, scope, faculties, departments, syllabus } = req.body;
    if (creditUnits !== undefined && (typeof creditUnits !== 'number' || !Number.isInteger(creditUnits) || creditUnits < 1 || creditUnits > 12)) {
      return res.status(400).json({ error: 'Course credit units must be a verified whole number between 1 and 12.' });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
    await ensureCourseLearningSchema();
    await ensureAcademicAvailabilitySchema();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE courses
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             level = COALESCE($3, level),
             semester = COALESCE($4, semester),
             scope = COALESCE($5, scope),
             credit_units = COALESCE($6, credit_units),
             faculty = COALESCE($7, faculty),
             department = COALESCE($8, department),
             version = version + 1,
             updated_at = NOW()
         WHERE id = $9`,
        [
          title || null,
          description || null,
          level || null,
          semester || null,
          scope || null,
          creditUnits ?? null,
          (faculties && faculties[0]) || null,
          (departments && departments[0]) || null,
          id
        ]
      );

      if (Array.isArray(syllabus)) {
        for (let mIdx = 0; mIdx < syllabus.length; mIdx++) {
          const m = syllabus[mIdx];
          const modId = m.id || `mod_${id}_${mIdx + 1}`;
          await client.query(
            `INSERT INTO course_modules (id, course_id, title, description, order_index, is_archived, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, FALSE, NOW(), NOW())
             ON CONFLICT (course_id, id) DO UPDATE SET
               title = EXCLUDED.title,
               description = EXCLUDED.description,
               order_index = EXCLUDED.order_index,
               updated_at = NOW()`,
            [modId, id, m.title || `Module ${mIdx + 1}`, m.description || null, m.order ?? mIdx + 1]
          );

          const subTopics = m.subTopics || m.lessons || [];
          if (Array.isArray(subTopics)) {
            for (let lIdx = 0; lIdx < subTopics.length; lIdx++) {
              const l = subTopics[lIdx];
              const lessId = l.id || `less_${modId}_${lIdx + 1}`;
              await client.query(
                `INSERT INTO course_lessons (id, course_id, module_id, title, content_markdown, order_index, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                 ON CONFLICT (course_id, module_id, id) DO UPDATE SET
                   title = EXCLUDED.title,
                   content_markdown = COALESCE(EXCLUDED.content_markdown, course_lessons.content_markdown),
                   order_index = EXCLUDED.order_index,
                   updated_at = NOW()`,
                [lessId, id, modId, l.title || `Lesson ${lIdx + 1}`, l.content || l.content_markdown || '', l.order ?? lIdx + 1]
              );
            }
          }
        }
      }

      await client.query('COMMIT');
      catalogCache.invalidateAll();

      await recordBackendSystemLog(
        'info',
        'admin',
        `Admin ${user.email || user.uid} updated course ${id} via Neon`,
        { courseId: id },
        { uid: user.uid, email: user.email }
      );

      res.json({ success: true, courseId: id });
    } catch (err: any) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Failed to update course', details: err.message });
    } finally {
      client.release();
    }
  });

  // Draft course review APIs. Draft material remains outside the public catalog.
  app.get('/api/admin/courses/drafts', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user.uid, user.email))) return res.status(403).json({ error: 'Admin privileges required' });
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
    try {
      await ensureCourseReviewSchema();
      await ensureCourseLearningSchema();
      const result = await pool.query(
        "SELECT c.id, c.code, c.title, c.description, c.department, c.faculty, c.level, c.semester, c.scope, c.credit_units, " +
        "c.status, c.review_status, c.review_notes, COALESCE(c.generation_status, 'completed') AS generation_status, c.generation_error, " +
        "c.created_at, c.updated_at, " +
        "(SELECT COUNT(*) FROM course_modules cm WHERE cm.course_id = c.id AND COALESCE(cm.is_archived, FALSE) = FALSE)::int AS module_count, " +
        "(SELECT COUNT(*) FROM course_lessons cl WHERE cl.course_id = c.id AND LENGTH(TRIM(COALESCE(cl.content_markdown, ''))) >= 600)::int AS lesson_count, " +
        "(SELECT COUNT(*) FROM course_modules cm WHERE cm.course_id = c.id AND COALESCE(cm.is_archived, FALSE) = FALSE " +
        " AND NOT EXISTS (SELECT 1 FROM course_lessons cl WHERE cl.course_id = c.id AND cl.module_id = cm.id AND LENGTH(TRIM(COALESCE(cl.content_markdown, ''))) >= 600))::int AS empty_module_count " +
        "FROM courses c WHERE c.status = 'draft' ORDER BY c.updated_at DESC NULLS LAST"
      );
      const completedDrafts: any[] = [];
      const incompleteCourses: any[] = [];
      for (const row of result.rows) {
        const isActivelyRunning = activeRunningCourseJobs.has(row.id);
        const liveSnap = activeCoordinatedJobSnapshots.get(row.id);

        const isStructurallyComplete =
          !isActivelyRunning &&
          row.generation_status === 'completed' &&
          Number(row.module_count) > 0 &&
          Number(row.lesson_count) > 0 &&
          Number(row.empty_module_count) === 0;

        if (isStructurallyComplete) {
          completedDrafts.push(row);
        } else {
          // If PostgreSQL says 'generating' but no background worker is actually running in memory,
          // reconcile the stale 'generating' state to 'failed' so the UI never fakes active generation.
          let effectiveStatus: 'generating' | 'failed' | 'cancelled' = 'failed';
          if (isActivelyRunning) {
            effectiveStatus = 'generating';
          } else if (row.generation_status === 'cancelled') {
            effectiveStatus = 'cancelled';
          } else {
            effectiveStatus = 'failed';
            if (row.generation_status === 'generating') {
              await pool.query(
                `UPDATE courses
                 SET generation_status = 'failed',
                     generation_error = COALESCE(generation_error, 'Course generation was interrupted before completion.'),
                     updated_at = NOW()
                 WHERE id = $1 AND status = 'draft'`,
                [row.id]
              ).catch(() => undefined);
            }
          }

          const fallbackErrorMessage =
            Number(row.module_count) === 0
              ? 'Course generation stopped before any modules were saved.'
              : Number(row.lesson_count) === 0
                ? `Course generation stopped with ${row.module_count} module(s) and 0 completed lessons.`
                : `Course generation stopped early (${row.empty_module_count} of ${row.module_count} module(s) have no completed lessons).`;

          incompleteCourses.push({
            ...row,
            generation_status: effectiveStatus,
            is_actively_running: isActivelyRunning,
            generation_progress: isActivelyRunning ? (liveSnap?.generationProgress ?? 10) : null,
            status_message: isActivelyRunning ? (liveSnap?.statusMessage || 'Authoring course curriculum on server…') : null,
            current_module: isActivelyRunning ? (liveSnap?.currentModule || null) : null,
            current_lesson: isActivelyRunning ? (liveSnap?.currentLesson || null) : null,
            completed_lessons: isActivelyRunning ? (liveSnap?.completedLessons ?? Number(row.lesson_count) ?? 0) : Number(row.lesson_count) || 0,
            total_lessons: isActivelyRunning ? (liveSnap?.totalLessons ?? null) : null,
            active_provider: isActivelyRunning ? (liveSnap?.activeProvider || null) : null,
            elapsed_seconds: isActivelyRunning ? (liveSnap?.elapsedSeconds ?? null) : null,
            generation_error: isActivelyRunning
              ? null
              : (row.generation_error || fallbackErrorMessage)
          });
        }
      }
      return res.json({ success: true, courses: completedDrafts, incompleteCourses });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load draft review queue' });
    }
  });

  app.delete('/api/admin/courses/:id/failed-draft', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user.uid, user.email))) return res.status(403).json({ error: 'Admin privileges required' });
    const { id } = req.params;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
    await ensureCourseReviewSchema();
    await ensureCourseLearningSchema();
    await ensureCourseAssessmentSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
      const courseRes = await client.query(
        'SELECT id, status FROM courses WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (courseRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Draft course not found.' });
      }
      if (courseRes.rows[0].status !== 'draft') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Only unpublished draft courses can be discarded from the generation queue.' });
      }
      await client.query('DELETE FROM course_lesson_practice_attempts WHERE course_id = $1', [id]);
      await client.query('DELETE FROM course_module_quizzes WHERE course_id = $1', [id]);
      await client.query('DELETE FROM course_formulas WHERE course_id = $1', [id]);
      await client.query('DELETE FROM course_lessons WHERE course_id = $1', [id]);
      await client.query('DELETE FROM course_modules WHERE course_id = $1', [id]);
      await client.query('DELETE FROM course_review_events WHERE course_id = $1', [id]);
      await client.query('DELETE FROM courses WHERE id = $1', [id]);
      await client.query('COMMIT');
      activeCancelledJobs.add(id);
      catalogCache.invalidateAll();
      return res.json({ success: true, courseId: id });
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      return res.status(500).json({ error: error?.message || 'Failed to discard incomplete draft course.' });
    } finally {
      client.release();
    }
  });

  app.get('/api/admin/courses/:id/review', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user.uid, user.email))) return res.status(403).json({ error: 'Admin privileges required' });
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
    try {
      await ensureCourseReviewSchema();
      await ensureCourseLearningSchema();
      const courseResult = await pool.query(
        "SELECT id, code, title, description, department, faculty, level, semester, scope, status, " +
        "review_status, review_notes, reviewed_by, reviewed_at, COALESCE(generation_status, 'completed') AS generation_status, generation_error, created_at, updated_at " +
        "FROM courses WHERE id = $1 AND status = 'draft' LIMIT 1",
        [req.params.id]
      );
      if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Draft course not found.' });
      if (courseResult.rows[0].generation_status !== 'completed') {
        return res.status(409).json({
          error: 'Course generation did not complete. Resume or discard this incomplete course before starting academic review.'
        });
      }

      const modulesResult = await pool.query(
        "SELECT id, title, description, order_index FROM course_modules " +
        "WHERE course_id = $1 AND COALESCE(is_archived, FALSE) = FALSE ORDER BY order_index ASC",
        [req.params.id]
      );
      const lessonsResult = await pool.query(
        "SELECT l.id, l.module_id, l.title, l.content_markdown, l.instructional_content, l.order_index " +
        "FROM course_lessons l INNER JOIN course_modules m ON m.id = l.module_id AND m.course_id = l.course_id " +
        "WHERE l.course_id = $1 AND COALESCE(m.is_archived, FALSE) = FALSE " +
        "ORDER BY l.module_id, l.order_index ASC",
        [req.params.id]
      );
      const formulasResult = await pool.query(
        "SELECT id, name, latex_expression, variables_breakdown, derivation_notes FROM course_formulas WHERE course_id = $1 ORDER BY name ASC",
        [req.params.id]
      );
      const historyResult = await pool.query(
        "SELECT event_id, action, from_status, to_status, notes, actor_email, created_at " +
        "FROM course_review_events WHERE course_id = $1 ORDER BY created_at DESC, event_id DESC",
        [req.params.id]
      );
      const lessonsByModule = new Map<string, any[]>();
      for (const lesson of lessonsResult.rows) {
        const key = String(lesson.module_id);
        const existing = lessonsByModule.get(key) || [];
        existing.push(lesson);
        lessonsByModule.set(key, existing);
      }
      const modules = modulesResult.rows.map((module: any) => ({
        ...module,
        lessons: lessonsByModule.get(String(module.id)) || []
      }));
      return res.json({
        success: true,
        course: courseResult.rows[0],
        modules,
        formulas: formulasResult.rows,
        reviewHistory: historyResult.rows
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load draft course review' });
    }
  });

  app.post('/api/admin/courses/:id/review-status', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user.uid, user.email))) return res.status(403).json({ error: 'Admin privileges required' });
    const action = req.body?.action;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    const approvalChecks = req.body?.approvalChecks;
    const transitions: Record<string, { from: string[]; to: string }> = {
      start_review: { from: ['pending', 'needs_revision'], to: 'in_review' },
      request_revision: { from: ['in_review'], to: 'needs_revision' },
      approve: { from: ['in_review'], to: 'approved' }
    };
    const transition = transitions[action];
    if (!transition) return res.status(400).json({ error: 'Unsupported review action.' });
    if (action === 'request_revision' && (notes.length < 10 || notes.length > 5000)) {
      return res.status(400).json({ error: 'Revision notes must contain between 10 and 5000 characters.' });
    }
    if (notes.length > 5000) return res.status(400).json({ error: 'Reviewer notes cannot exceed 5000 characters.' });
    if (action === 'approve' && (!approvalChecks || approvalChecks.subjectExpert !== true || approvalChecks.calculations !== true || approvalChecks.curriculum !== true || approvalChecks.rendering !== true)) {
      return res.status(400).json({ error: 'Approval requires explicit subject-expert, calculation, curriculum-coverage and rendering attestations.' });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
    let client: any;
    try {
      await ensureCourseReviewSchema();
      client = await pool.connect();
      await client.query('BEGIN');
      const currentResult = await client.query(
        "SELECT status, review_status, COALESCE(generation_status, 'completed') AS generation_status FROM courses WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      if (currentResult.rows.length === 0) {
        const error: any = new Error('Course not found.');
        error.statusCode = 404;
        throw error;
      }
      const current = currentResult.rows[0];
      if (current.status !== 'draft') {
        const error: any = new Error('Only unpublished draft courses can enter the review workflow.');
        error.statusCode = 409;
        throw error;
      }
      if (current.generation_status !== 'completed') {
        const error: any = new Error('Incomplete or failed course generations cannot enter the academic review workflow until generation completes.');
        error.statusCode = 409;
        throw error;
      }
      if (!transition.from.includes(current.review_status)) {
        const error: any = new Error('This review action is not valid from the current review status.');
        error.statusCode = 409;
        throw error;
      }
      const auditNotes = action === 'approve'
        ? [
            notes,
            'Approval attestations:',
            'Subject-expert review: confirmed',
            'Calculations, units and derivations: confirmed',
            'Curriculum coverage: confirmed',
            'Math and lesson rendering: confirmed'
          ].filter(Boolean).join('\n')
        : notes || null;
      await client.query(
        "UPDATE courses SET review_status = $1, review_notes = CASE WHEN $2::text IS NULL THEN review_notes ELSE $2 END, " +
        "reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW() WHERE id = $4",
        [transition.to, auditNotes, user.uid, req.params.id]
      );
      await client.query(
        "INSERT INTO course_review_events (course_id, actor_uid, actor_email, action, from_status, to_status, notes, created_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
        [req.params.id, user.uid, user.email || null, action, current.review_status, transition.to, auditNotes]
      );
      await client.query('COMMIT');
      catalogCache.invalidateAll();
      return res.json({ success: true, courseId: req.params.id, reviewStatus: transition.to });
    } catch (error: any) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      return res.status(error?.statusCode || 500).json({ error: error?.message || 'Failed to save course review decision' });
    } finally {
      client?.release();
    }
  });

  // Admin Course Archive, Restore, Publish, and Permanent Delete Endpoints via Neon PostgreSQL
  app.get('/api/admin/courses/archived', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const coursesRes = await pool.query(
        `SELECT id, code, title, description, department, faculty, level, semester, status, scope, updated_at
         FROM courses
         WHERE status = 'archived'
         ORDER BY updated_at DESC`
      );
      const courses = coursesRes.rows.map((c: any) => ({
        id: c.id,
        code: c.code || c.id,
        title: c.title,
        description: c.description || '',
        department: c.department || '',
        faculty: c.faculty || '',
        faculties: c.faculty ? [c.faculty] : [],
        departments: c.department ? [c.department] : [],
        level: c.level || '100',
        semester: c.semester || '1st Semester',
        scope: c.scope || 'DEPARTMENT',
        status: c.status,
        isDeleted: true,
        deletedAt: c.updated_at ? new Date(c.updated_at).toISOString() : new Date().toISOString(),
        syllabus: []
      }));
      res.json({ success: true, courses });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch archived courses', details: err.message });
    }
  });

  app.post('/api/admin/courses/:id/restore', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) return res.status(403).json({ error: 'Admin privileges required' });

    const { id } = req.params;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      await validateCourseForPublication(pool, id);
      const result = await pool.query(
        `UPDATE courses
         SET status = 'published', version = COALESCE(version, 1) + 1, updated_at = NOW()
         WHERE id = $1 AND status = 'archived'`,
        [id]
      );
      if ((result.rowCount ?? 0) === 0) return res.status(404).json({ error: 'Course not found.' });
      catalogCache.invalidateAll();
      return res.json({ success: true, courseId: id, status: 'published' });
    } catch (err: any) {
      return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to restore course' });
    }
  });

  app.post('/api/admin/courses/:id/publish', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    if (!(await checkIsAdmin(user.uid, user.email))) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }
    const { id } = req.params;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });
    let client: any;
    try {
      await ensureCourseReviewSchema();
      client = await pool.connect();
      await client.query('BEGIN');
      const reviewResult = await client.query(
        "SELECT status, review_status FROM courses WHERE id = $1 FOR UPDATE",
        [id]
      );
      if (reviewResult.rows.length === 0) {
        const error: any = new Error('Course not found.');
        error.statusCode = 404;
        throw error;
      }
      if (reviewResult.rows[0].status !== 'draft' || reviewResult.rows[0].review_status !== 'approved') {
        const error: any = new Error('Course must complete admin review and be approved before publishing.');
        error.statusCode = 409;
        throw error;
      }
      await validateCourseForPublication(client, id);
      await client.query(
        "UPDATE courses SET status = 'published', version = COALESCE(version, 1) + 1, updated_at = NOW() WHERE id = $1",
        [id]
      );
      await client.query(
        "INSERT INTO course_review_events (course_id, actor_uid, actor_email, action, from_status, to_status, created_at) " +
        "VALUES ($1, $2, $3, 'publish', 'approved', 'published', NOW())",
        [id, user.uid, user.email || null]
      );
      await client.query('COMMIT');
      catalogCache.invalidateAll();
      return res.json({ success: true, courseId: id, status: 'published' });
    } catch (error: any) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      return res.status(error?.statusCode || 500).json({ error: error?.message || 'Failed to publish course' });
    } finally {
      client?.release();
    }
  });

  app.delete('/api/admin/courses/:id/permanent', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const { id } = req.params;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    await ensureCourseLifecycleSchema();
    await ensureCourseReviewSchema();
    await ensureCourseAssessmentSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
      const course = await client.query(`SELECT id, code, title, status FROM courses WHERE id = $1 FOR UPDATE`, [id]);
      if (course.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Course not found.' });
      }
      if (course.rows[0].status !== 'archived') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Only archived courses can be permanently deleted.' });
      }

      // Revoke and remove persisted jobs only when the PostgreSQL job subsystem is enabled.
      if (getFeatureFlags().ENABLE_POSTGRES_GENERATION_JOBS) {
        const jobRelations = await client.query(
          `SELECT to_regclass('course_generation_jobs') AS jobs,
                  to_regclass('sse_stream_tickets') AS tickets`
        );
        if (!jobRelations.rows[0]?.jobs) {
          throw new Error('PostgreSQL generation jobs are enabled, but the job table is missing.');
        }
        await client.query(
          `UPDATE course_generation_jobs
           SET status = 'cancelled', stage = 'cancelled',
               status_message = 'Course permanently deleted by administrator.',
               lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW(),
               completed_at = NOW()
           WHERE course_id = $1 AND status IN ('queued', 'running')`,
          [id]
        );
        if (jobRelations.rows[0]?.tickets) {
          await client.query(
            `DELETE FROM sse_stream_tickets
             WHERE job_id IN (SELECT job_id FROM course_generation_jobs WHERE course_id = $1)`,
            [id]
          );
        }
        await client.query(`DELETE FROM course_generation_jobs WHERE course_id = $1`, [id]);
      }

      // Preserve a durable audit event for the destructive administrator action.
      await client.query(
        `INSERT INTO course_lifecycle_tombstones (course_id, course_code, course_title, deleted_by, deleted_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (course_id) DO NOTHING`,
        [id, course.rows[0].code || id, course.rows[0].title || null, user.uid]
      );
      await client.query(
        `INSERT INTO course_review_events
         (course_id, actor_uid, actor_email, action, from_status, to_status, notes, created_at)
         VALUES ($1, $2, $3, 'permanent_delete', 'archived', 'deleted',
                 'Course and associated instructional data permanently deleted by administrator.', NOW())`,
        [id, user.uid, user.email || null]
      );

      // Remove legacy and v2 vector chunks when those relations are present.
      const vectorTables = await client.query(
        `SELECT to_regclass('course_knowledge_chunks') AS legacy_table,
                to_regclass('course_knowledge_chunks_v2') AS v2_table`
      );
      if (vectorTables.rows[0]?.legacy_table) {
        await client.query(`DELETE FROM course_knowledge_chunks WHERE course_id = $1`, [id]);
      }
      if (vectorTables.rows[0]?.v2_table) {
        await client.query(`DELETE FROM course_knowledge_chunks_v2 WHERE course_id = $1`, [id]);
      }

      // Remove dependent instructional and learner data in the same transaction.
      await client.query(`DELETE FROM course_lesson_practice_attempts WHERE course_id = $1`, [id]);
      await client.query(`DELETE FROM course_formulas WHERE course_id = $1`, [id]);
      await client.query(`DELETE FROM course_lessons WHERE course_id = $1`, [id]);
      await client.query(`DELETE FROM course_modules WHERE course_id = $1`, [id]);
      await client.query(`DELETE FROM courses WHERE id = $1`, [id]);
      await client.query('COMMIT');
      activeCancelledJobs.add(id);
      catalogCache.invalidateAll();
      return res.json({ success: true, courseId: id });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      return res.status(500).json({ error: 'Failed to permanently delete course; transaction rolled back.', details: err.message });
    } finally {
      client.release();
    }
  });

  app.delete('/api/admin/courses/:id', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const { id } = req.params;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
      const course = await client.query(`SELECT id FROM courses WHERE id = $1 FOR UPDATE`, [id]);
      if (course.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Course not found.' });
      }
      if (getFeatureFlags().ENABLE_POSTGRES_GENERATION_JOBS) {
        await client.query(
          `UPDATE course_generation_jobs
           SET status = 'cancelled', stage = 'cancelled',
               status_message = 'Course archived by administrator.',
               lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW(),
               completed_at = NOW()
           WHERE course_id = $1 AND status IN ('queued', 'running')`,
          [id]
        );
      }
      await client.query(
        `UPDATE courses SET status = 'archived', version = COALESCE(version, 1) + 1, updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
      await client.query('COMMIT');
      activeCancelledJobs.add(id);
      catalogCache.invalidateAll();
      return res.json({ success: true, courseId: id, status: 'archived' });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      return res.status(500).json({ error: 'Failed to archive course; transaction rolled back.', details: err.message });
    } finally {
      client.release();
    }
  });

  // Admin System Alerts Management via Neon
  app.get('/api/admin/system-alerts', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const { status, type, limit } = req.query;
      let sql = 'SELECT * FROM system_alerts WHERE 1=1';
      const params: any[] = [];
      if (status) {
        params.push(status);
        sql += ` AND status = $${params.length}`;
      }
      if (type) {
        params.push(type);
        sql += ` AND type = $${params.length}`;
      }
      sql += ' ORDER BY created_at DESC';
      if (limit) {
        params.push(parseInt(limit as string, 10));
        sql += ` LIMIT $${params.length}`;
      } else {
        sql += ' LIMIT 100';
      }

      const alertsRes = await pool.query(sql, params);
      res.json({ alerts: alertsRes.rows });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve system alerts', details: err.message });
    }
  });

  app.post('/api/admin/system-alerts/:id/resolve', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const { id } = req.params;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      await pool.query(
        `UPDATE system_alerts SET status = 'resolved' WHERE id = $1`,
        [id]
      );
      res.json({ success: true, id });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to resolve alert', details: err.message });
    }
  });

  app.post('/api/admin/system-alerts/resolve-all', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const { ids } = req.body || {};
      if (Array.isArray(ids) && ids.length > 0) {
        await pool.query(
          `UPDATE system_alerts SET status = 'resolved' WHERE id = ANY($1::text[])`,
          [ids]
        );
      } else {
        await pool.query(`UPDATE system_alerts SET status = 'resolved' WHERE status = 'pending'`);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to resolve alerts', details: err.message });
    }
  });

  // Admin Users List with Pagination
  app.get('/api/admin/users', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) return res.status(403).json({ error: 'Admin privileges required' });

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const page = parseInt(req.query.page as string || '1', 10);
      const limit = parseInt(req.query.limit as string || '50', 10);
      const offset = (page - 1) * limit;
      const search = (req.query.search as string || '').trim().toLowerCase();

      let sql = 'SELECT uid, email, display_name, role, plan_type, ai_sparks, learning_profile, created_at FROM users';
      let countSql = 'SELECT COUNT(*) as total FROM users';
      const params: any[] = [];

      if (search) {
        params.push(`%${search}%`);
        sql += ` WHERE LOWER(email) LIKE $1 OR LOWER(display_name) LIKE $1 OR uid LIKE $1`;
        countSql += ` WHERE LOWER(email) LIKE $1 OR LOWER(display_name) LIKE $1 OR uid LIKE $1`;
      }

      sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const usersRes = await pool.query(sql, params);
      const countRes = await pool.query(countSql, search ? [`%${search}%`] : []);
      const total = parseInt(countRes.rows[0]?.total || '0', 10);

      res.json({
        success: true,
        users: usersRes.rows.map(u => ({
          id: u.uid,
          uid: u.uid,
          email: u.email,
          displayName: u.display_name,
          role: u.role || 'student',
          planType: u.plan_type || 'free',
          ai_sparks: u.ai_sparks ?? 0,
          learningProfile: u.learning_profile || {},
          createdAt: u.created_at
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch users', details: err.message });
    }
  });

  // Update User Role Endpoint
  app.post('/api/admin/user-role', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) return res.status(403).json({ error: 'Admin privileges required' });

    const { targetUserId, role } = req.body;
    if (!targetUserId || !role) return res.status(400).json({ error: 'targetUserId and role are required' });

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      await pool.query('UPDATE users SET role = $1, updated_at = NOW() WHERE uid = $2', [role, targetUserId]);
      const notifId = `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await pool.query(
        `INSERT INTO user_notifications (id, uid, title, message, type, read, created_at)
         VALUES ($1, $2, 'Role Updated', $3, 'system', FALSE, NOW())`,
        [notifId, targetUserId, `Your account role has been updated to ${role}.`]
      );
      res.json({ success: true, targetUserId, role });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update user role', details: err.message });
    }
  });

  // GoldenSet Engine Config Write Endpoint
  app.post('/api/admin/golden-set/config', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) return res.status(403).json({ error: 'Admin privileges required' });

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const { key, data } = req.body;
      const configKey = key || 'evaluation_policy';
      await pool.query(
        `INSERT INTO system_config (key, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [configKey, JSON.stringify(data)]
      );
      res.json({ success: true, key: configKey, data });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to save golden set config', details: err.message });
    }
  });

  // Curriculum Requests Endpoints
  app.get('/api/admin/curriculum-requests', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) return res.status(403).json({ error: 'Admin privileges required' });

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      const resRows = await pool.query(`
        SELECT id, course_code, course_title, department, faculty, status, user_id, user_email, created_at
        FROM curriculum_requests
        ORDER BY created_at DESC;
      `).catch(() => ({ rows: [] }));
      res.json({ requests: resRows.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/curriculum-requests/:id/status', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) return res.status(403).json({ error: 'Admin privileges required' });

    const { id } = req.params;
    const { status } = req.body;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      await pool.query('UPDATE curriculum_requests SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
      res.json({ success: true, id, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin Save Formulas via Neon
  app.post('/api/courses/:courseId/formulas', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) return res.status(403).json({ error: 'Admin privileges required' });

    const { courseId } = req.params;
    const { formulas } = req.body;
    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    try {
      if (Array.isArray(formulas)) {
        for (const f of formulas) {
          const formulaId = f.id || `form_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          await pool.query(
            `INSERT INTO course_formulas (id, course_id, name, latex_expression, variables_breakdown, derivation_notes, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               latex_expression = EXCLUDED.latex_expression,
               variables_breakdown = EXCLUDED.variables_breakdown,
               derivation_notes = EXCLUDED.derivation_notes,
               updated_at = NOW()`,
            [formulaId, courseId, f.name || 'Formula', f.latex || f.latex_expression || '', JSON.stringify(f.variables || {}), f.description || f.derivation_notes || '']
          );
        }
      }
      catalogCache.invalidateAll();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to save formulas', details: err.message });
    }
  });

  // Admin API Keys & Discovered Models (Neon PostgreSQL system_config)
  app.get('/api/admin/settings/api-keys', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user.uid, req.user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const data = (await getSystemSettingsDoc('api_keys')) || {};
      return res.json({ data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to load API keys' });
    }
  });

  app.put('/api/admin/settings/api-keys', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user.uid, req.user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const updates = req.body && typeof req.body === 'object' ? req.body : {};
      const current = (await getSystemSettingsDoc('api_keys')) || {};
      const merged = { ...current, ...updates };
      await setSystemSettingsDoc('api_keys', merged, false);
      if (syncAllProvidersFromSettings) {
        syncAllProvidersFromSettings(merged);
      }
      return res.json({ success: true, data: merged });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to save API keys' });
    }
  });

  app.get('/api/admin/settings/discovered-models', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user.uid, req.user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const data = (await getSystemSettingsDoc('discovered_models')) || {};
      return res.json({ data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to load discovered models' });
    }
  });

  // Past Papers & Routing Config for Question Bank (Neon PostgreSQL)
  app.get('/api/admin/past-papers', verifyAuth, async (req: any, res: any) => {
    try {
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database service unavailable: PostgreSQL is not connected.' });
      const result = await pool.query(
        `SELECT id, course_code, course_title, year, semester, department, questions, data, created_at
         FROM past_papers
         ORDER BY created_at DESC`
      );
      const papers = result.rows.map((r) => ({
        id: r.id,
        courseCode: r.course_code || r.data?.courseCode || '',
        title: r.course_title || r.data?.title || '',
        year: r.year || r.data?.year || '',
        semester: r.semester || r.data?.semester || '',
        department: r.department || r.data?.department || '',
        questions: Array.isArray(r.questions) ? r.questions : (r.data?.questions || []),
        ...(r.data || {})
      }));
      return res.json({ papers });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch past papers' });
    }
  });

  app.get('/api/admin/routing-config', verifyAuth, async (req: any, res: any) => {
    try {
      const config = (await getSystemConfigDoc('routing')) || {};
      return res.json({ config });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch routing config' });
    }
  });

  // Admin Affiliates Overview & Commission Settings (Neon PostgreSQL)
  app.get('/api/admin/affiliates-overview', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user.uid, req.user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const pool = getPostgresPool();
      if (!pool) {
        return res.status(503).json({ error: 'Affiliates service unavailable: PostgreSQL is not connected.' });
      }
      const commissionsDoc = (await getSystemConfigDoc('commissions')) || (await getSystemSettingsDoc('commissions'));
      const commissionRate = typeof commissionsDoc?.rate === 'number' ? commissionsDoc.rate : null;

      const [affRes, payRes] = await Promise.all([
        pool.query(`SELECT code, user_id, email, display_name, total_earned, pending_payout, referral_count, bank_details, status, data, created_at FROM affiliates ORDER BY created_at DESC`),
        pool.query(`SELECT id, user_id, affiliate_code, amount, status, bank_details, data, created_at FROM payout_requests ORDER BY created_at DESC`)
      ]);

      const resolveIsoCreatedAt = (pgVal: any, dataVal: any): string | null => {
        if (pgVal) {
          const d = new Date(pgVal);
          if (!Number.isNaN(d.getTime())) return d.toISOString();
        }
        if (dataVal) {
          if (typeof dataVal === 'string' || typeof dataVal === 'number') {
            const d = new Date(dataVal);
            if (!Number.isNaN(d.getTime())) return d.toISOString();
          } else if (typeof dataVal?._seconds === 'number') {
            return new Date(dataVal._seconds * 1000).toISOString();
          } else if (typeof dataVal?.seconds === 'number') {
            return new Date(dataVal.seconds * 1000).toISOString();
          }
        }
        return null;
      };

      const affiliates = affRes.rows.map((r) => ({
        ...(r.data || {}),
        id: r.code,
        userId: r.user_id,
        name: r.display_name || r.data?.name || r.code,
        userEmail: r.email || r.data?.userEmail || '',
        totalEarned: Number(r.total_earned ?? r.data?.totalEarned ?? 0),
        pendingBalance: Number(r.pending_payout ?? r.data?.pendingBalance ?? 0),
        signups: Number(r.data?.signups ?? r.referral_count ?? 0),
        clicks: Number(r.data?.clicks ?? 0),
        paidConversions: Number(r.data?.paidConversions ?? r.referral_count ?? 0),
        createdAt: resolveIsoCreatedAt(r.created_at, r.data?.createdAt)
      }));

      const payouts = payRes.rows.map((r) => ({
        ...(r.data || {}),
        id: r.id,
        userId: r.user_id,
        affiliateId: r.affiliate_code || r.data?.affiliateId || r.data?.affiliateCode || '',
        affiliateCode: r.affiliate_code || r.data?.affiliateCode || r.data?.affiliateId || '',
        amount: Number(r.amount ?? 0),
        status: r.status || 'pending',
        payoutDetails: r.bank_details || r.data?.payoutDetails || {},
        createdAt: resolveIsoCreatedAt(r.created_at, r.data?.createdAt)
      }));

      return res.json({ affiliates, payouts, commissionRate });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch affiliates overview' });
    }
  });

  app.put('/api/admin/commissions', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user.uid, req.user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const rate = Number(req.body?.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        return res.status(400).json({ error: 'Invalid commission rate (must be between 0 and 1)' });
      }
      await setSystemConfigDoc('commissions', {
        rate,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.email
      });
      return res.json({ success: true, rate });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to save commission rate' });
    }
  });

  const marketingDemoTutorLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 12,
    message: { error: 'Admin demo AI preview limit reached. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
  });
  const marketingDemoProviders: Record<string, any> = {
    gemini_direct: new GeminiDirectProvider(process.env.GEMINI_API_KEY || ''),
    mistral_direct: new MistralProvider(process.env.MISTRAL_API_KEY || ''),
    groq: new GroqProvider(process.env.GROQ_API_KEY || ''),
    cohere: new CohereProvider(process.env.COHERE_API_KEY || ''),
    huggingface: new HuggingFaceProvider(process.env.HUGGINGFACE_API_KEY || ''),
    openrouter_free: new OpenRouterFreeProvider(process.env.OPENROUTER_API_KEY || ''),
    nvidia: new NvidiaProvider(process.env.NVIDIA_API_KEY || '')
  };

  /** Admin-only stateless AI preview. This intentionally does not use the student chat/Sparks pipeline. */
  app.post('/api/admin/marketing/demo-tutor', verifyAuth, marketingDemoTutorLimiter, async (req: any, res: any) => {
    const parsed = AdminDemoTutorRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Only a prompt and optional course context are accepted.' });
    try {
      const isAdmin = await checkIsAdmin(req.user?.uid, req.user?.email);
      if (!isAdmin) return res.status(403).json({ error: 'Administrator privileges are required.' });
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Separate admin usage logging is unavailable. No provider call was started.' });

      const hygiene = splitAndInspectChatPayload(parsed.data.message, null);
      if (hygiene.questionScan?.isPureAttack) return res.status(400).json({ error: 'The preview prompt was rejected by the security filter. No provider call was made.' });
      const cleanMessage = String(hygiene.cleanQuestion || '').trim();
      if (!cleanMessage) return res.status(400).json({ error: 'A non-empty preview prompt is required.' });
      const courseContext = parsed.data.courseContext
        ? inspectAndScrubUntrustedText(parsed.data.courseContext, 'course_context').sanitizedText.trim()
        : '';
      const messages = buildAdminDemoTutorMessages({ message: cleanMessage, courseContext: courseContext || undefined });

      // Only authenticated admin activity is attributed. Prompts and answers are never stored.
      const logId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO system_logs (log_id, level, category, message, details, user_id, created_at)
         VALUES ($1, 'info', 'admin', $2, $3::jsonb, $4, NOW())`,
        [logId, '[Marketing Demo AI] Isolated preview started', JSON.stringify({ outcome: 'started', promptPersisted: false, responsePersisted: false }), req.user.uid]
      );

      const routing = await getSystemConfigDoc('routing', true);
      if (!routing || typeof routing !== 'object') throw new Error('Live AI routing configuration is unavailable.');
      const primary = String(routing.global_provider || routing.chat || '').trim().toLowerCase();
      if (!primary || !marketingDemoProviders[primary]) throw new Error('The live chat provider is not explicitly configured for the isolated preview.');
      const providerNames = [primary];
      const fallbackMap = routing.fallbacksByTask;
      const configuredFallbacks = fallbackMap?.chat;
      if (routing.autoFallback !== false && configuredFallbacks !== undefined) {
        if (!Array.isArray(configuredFallbacks)) throw new Error('The live chat fallback configuration is invalid.');
        for (const value of configuredFallbacks) {
          if (typeof value !== 'string' || !marketingDemoProviders[value.trim().toLowerCase()]) {
            throw new Error('A configured chat fallback provider is invalid or unsupported.');
          }
          const name = value.trim().toLowerCase();
          if (!providerNames.includes(name)) providerNames.push(name);
        }
      }

      const controller = new AbortController();
      const abortOnClose = () => { if (!res.writableEnded && !controller.signal.aborted) controller.abort(); };
      res.on('close', abortOnClose);
      const startedAt = Date.now();
      let providerUsed: string | null = null;
      let upstreamModel: string | null = null;
      let promptTokens: number | null = null;
      let completionTokens: number | null = null;
      let totalTokens: number | null = null;
      let responseText = '';
      let lastError: any = null;
      try {
        for (const name of providerNames) {
          if (controller.signal.aborted) throw new Error('Preview request was aborted.');
          const provider = marketingDemoProviders[name];
          providerUsed = name;
          try {
            // Direct provider call: no student Spark pre-auth/settlement, profile analysis, student history or chat_analytics.
            const generated = await provider.generate(messages, { complexity: 'standard', signal: controller.signal });
            const answer = typeof generated?.text === 'string' ? generated.text.trim() : '';
            if (!answer) throw new Error('Configured provider returned no preview content.');
            responseText = answer;
            upstreamModel = typeof generated.upstreamModel === 'string' ? generated.upstreamModel : null;
            const usage = generated.usage || {};
            promptTokens = Number.isSafeInteger(usage.promptTokens) && usage.promptTokens > 0 ? usage.promptTokens : null;
            completionTokens = Number.isSafeInteger(usage.completionTokens) && usage.completionTokens > 0 ? usage.completionTokens : null;
            totalTokens = Number.isSafeInteger(usage.totalTokens) && usage.totalTokens > 0 ? usage.totalTokens : null;
            lastError = null;
            break;
          } catch (error: any) {
            if (controller.signal.aborted) throw error;
            lastError = error;
          }
        }
        if (!responseText) throw lastError || new Error('All explicitly configured preview providers failed.');
        const latencyMs = Date.now() - startedAt;
        await pool.query(
          `UPDATE system_logs SET level = 'info', message = $1, details = $2::jsonb WHERE log_id = $3 AND user_id = $4 AND category = 'admin'`,
          ['[Marketing Demo AI] Isolated preview succeeded', JSON.stringify({ outcome: 'success', providerUsed, upstreamModel, promptTokens, completionTokens, totalTokens, latencyMs, studentSparksCharged: false, studentProfileRead: false, studentHistoryRead: false, studentHistoryWritten: false, studentChatAnalyticsWritten: false, providerAccountUsage: true, promptPersisted: false, responsePersisted: false }), logId, req.user.uid]
        );
        return res.json({ response: responseText, meta: { providerUsed, upstreamModel, promptTokens, completionTokens, totalTokens, latencyMs, telemetryScope: 'admin_demo_ai_usage', studentSparksCharged: false, studentProfileRead: false, studentHistoryRead: false, studentHistoryWritten: false, studentChatAnalyticsWritten: false, providerAccountUsage: true } });
      } catch (error: any) {
        const latencyMs = Date.now() - startedAt;
        await pool.query(
          `UPDATE system_logs SET level = 'warning', message = $1, details = $2::jsonb WHERE log_id = $3 AND user_id = $4 AND category = 'admin'`,
          ['[Marketing Demo AI] Isolated preview failed', JSON.stringify({ outcome: 'failed', providerUsed, failureCode: controller.signal.aborted ? 'ABORTED' : 'PROVIDER_OR_ROUTING_ERROR', latencyMs, promptPersisted: false, responsePersisted: false }), logId, req.user.uid]
        ).catch((logError: any) => console.error('[AdminDemoTutor] Failed to finalize usage log:', logError?.message || logError));
        if (controller.signal.aborted || res.destroyed) return;
        return res.status(503).json({ error: 'The isolated AI Tutor preview could not be completed by an explicitly configured live provider.' });
      } finally {
        res.off('close', abortOnClose);
      }
    } catch (error: any) {
      console.error('[AdminDemoTutor] Isolated preview request failed:', error?.message || error);
      return res.status(503).json({ error: 'Isolated AI Tutor preview is unavailable. No student chat or Spark operation was executed.' });
    }
  });

  const AdminMarketingAssetSnapshotSchema = z.object({
    targetScope: z.enum(['full_ecosystem', 'faculty', 'department', 'course', 'exam_readiness']),
    selectedFaculty: z.string().trim().max(160).optional(),
    selectedDepartment: z.string().trim().max(160).optional(),
    selectedCourseId: z.string().trim().max(120).optional(),
    copyReviewRequired: z.boolean(),
    config: z.record(z.string(), z.unknown())
  }).strict();

  const AdminMarketingAssetSaveSchema = z.object({
    assetKey: z.string().trim().min(3).max(180).regex(/^[a-z0-9:_-]+$/i),
    assetName: z.string().trim().min(1).max(160),
    snapshot: AdminMarketingAssetSnapshotSchema
  }).strict();

  /** List immutable versions for one exact marketing design key. */
  app.get('/api/admin/marketing/assets', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user?.uid, req.user?.email);
      if (!isAdmin) return res.status(403).json({ error: 'Administrator privileges are required.' });
      const assetKey = typeof req.query?.assetKey === 'string' ? req.query.assetKey.trim() : '';
      if (!/^[a-z0-9:_-]{3,180}$/i.test(assetKey)) {
        return res.status(400).json({ error: 'A valid assetKey is required.' });
      }
      await ensureMarketingStudioSchema();
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Marketing asset history is unavailable.' });
      const result = await pool.query(
        `SELECT id, asset_key, asset_name, target_scope, version, created_by, created_at
         FROM admin_marketing_asset_versions
         WHERE asset_key = $1
         ORDER BY version DESC, created_at DESC
         LIMIT 25`,
        [assetKey]
      );
      return res.json({
        versions: result.rows.map((row: any) => ({
          id: row.id,
          assetKey: row.asset_key,
          assetName: row.asset_name,
          targetScope: row.target_scope,
          version: Number(row.version),
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
        }))
      });
    } catch (error: any) {
      console.error('[MarketingAssetHistory] Version listing failed:', error?.message || error);
      return res.status(503).json({ error: 'Marketing asset history could not be loaded from Neon PostgreSQL.' });
    }
  });

  /** Save each submitted design as a new immutable version; no prior version is overwritten. */
  app.post('/api/admin/marketing/assets', verifyAuth, async (req: any, res: any) => {
    const parsed = AdminMarketingAssetSaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'The marketing asset version request did not match the required schema.' });
    }

    try {
      const isAdmin = await checkIsAdmin(req.user?.uid, req.user?.email);
      if (!isAdmin) return res.status(403).json({ error: 'Administrator privileges are required.' });

      const { assetKey, assetName, snapshot } = parsed.data;
      const config = snapshot.config;
      const requiredTextFields = [
        'brandName', 'headlineLine1', 'headlineLine2', 'leadBoldParagraph',
        'subParagraph', 'ctaText', 'websiteDisplayUrl', 'qrTargetUrl'
      ];
      for (const field of requiredTextFields) {
        if (typeof config[field] !== 'string' || !(config[field] as string).trim() || (config[field] as string).length > 2000) {
          return res.status(400).json({ error: `The saved flyer is missing a valid ${field} value.` });
        }
      }

      try {
        const destination = new URL(String(config.qrTargetUrl));
        if (!['http:', 'https:'].includes(destination.protocol) || !destination.hostname) {
          return res.status(400).json({ error: 'The saved flyer QR destination must be a valid HTTP(S) URL.' });
        }
      } catch {
        return res.status(400).json({ error: 'The saved flyer QR destination is invalid.' });
      }

      if (config.customPhotoDataUrl !== undefined) {
        const photo = config.customPhotoDataUrl;
        if (typeof photo !== 'string' ||
            photo.length > 600000 ||
            !/^data:image\/(?:webp|jpeg|png);base64,[a-z0-9+/=]+$/i.test(photo)) {
          return res.status(400).json({ error: 'The compressed custom photo is invalid or exceeds the 600 KB history limit.' });
        }
      }

      const serializedSnapshot = JSON.stringify(snapshot);
      if (Buffer.byteLength(serializedSnapshot, 'utf8') > 900000) {
        return res.status(413).json({ error: 'The marketing design snapshot is too large to store as a version.' });
      }

      await ensureMarketingStudioSchema();
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Marketing asset history is unavailable.' });
      const client = await pool.connect();
      const id = crypto.randomUUID();
      let version = 0;
      let createdAt: string | null = null;
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [assetKey]
        );
        const versionResult = await client.query(
          `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
           FROM admin_marketing_asset_versions
           WHERE asset_key = $1`,
          [assetKey]
        );
        version = Number(versionResult.rows[0]?.next_version);
        if (!Number.isSafeInteger(version) || version < 1) {
          throw new Error('The next marketing asset version could not be determined.');
        }
        const saved = await client.query(
          `INSERT INTO admin_marketing_asset_versions
            (id, asset_key, asset_name, target_scope, version, snapshot, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())
           RETURNING created_at`,
          [id, assetKey, assetName, snapshot.targetScope, version, serializedSnapshot, req.user.uid]
        );
        createdAt = saved.rows[0]?.created_at
          ? new Date(saved.rows[0].created_at).toISOString()
          : new Date().toISOString();
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      return res.status(201).json({
        version: { id, assetKey, assetName, targetScope: snapshot.targetScope, version, createdAt }
      });
    } catch (error: any) {
      console.error('[MarketingAssetHistory] Version save failed:', error?.message || error);
      return res.status(503).json({ error: 'The marketing design version could not be persisted to Neon PostgreSQL.' });
    }
  });

  /** Fetch one immutable snapshot for an administrator-approved restore action. */
  app.get('/api/admin/marketing/assets/:id', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user?.uid, req.user?.email);
      if (!isAdmin) return res.status(403).json({ error: 'Administrator privileges are required.' });
      const id = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'A valid asset version ID is required.' });
      await ensureMarketingStudioSchema();
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Marketing asset history is unavailable.' });
      const result = await pool.query(
        `SELECT id, asset_key, asset_name, target_scope, version, snapshot, created_at
         FROM admin_marketing_asset_versions
         WHERE id = $1
         LIMIT 1`,
        [id]
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Marketing asset version not found.' });
      return res.json({
        version: {
          id: row.id,
          assetKey: row.asset_key,
          assetName: row.asset_name,
          targetScope: row.target_scope,
          version: Number(row.version),
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
          snapshot: row.snapshot
        }
      });
    } catch (error: any) {
      console.error('[MarketingAssetHistory] Version retrieval failed:', error?.message || error);
      return res.status(503).json({ error: 'The selected marketing asset version could not be retrieved.' });
    }
  });


  const publicMarketingEventLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 80,
    message: { error: 'Marketing event rate limit reached.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  const MarketingCampaignIdSchema = z.string().trim().min(3).max(180).regex(/^[a-z0-9:_-]+$/i);
  const insertMarketingCampaignEvent = async (
    campaignId: string,
    eventType: 'qr_landing' | 'landing_visit' | 'registration_completed' | 'paid_conversion',
    visitorId: string | null,
    dedupeMaterial: string
  ): Promise<boolean> => {
    await ensureMarketingStudioSchema();
    const pool = getPostgresPool();
    if (!pool) throw new Error('Marketing campaign event storage is unavailable.');
    const eventId = crypto.randomUUID();
    const dedupeKey = crypto.createHash('sha256').update(dedupeMaterial).digest('hex');
    const result = await pool.query(
      `INSERT INTO marketing_campaign_events
        (event_id, campaign_id, event_type, visitor_id, dedupe_key, occurred_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING event_id`,
      [eventId, campaignId, eventType, visitorId, dedupeKey]
    );
    return result.rowCount === 1;
  };

  /** Public, minimal event ingestion. It accepts only browser-observed campaign landings. */
  app.post('/api/marketing/campaign-events', publicMarketingEventLimiter, async (req: any, res: any) => {
    const schema = z.object({
      campaignId: MarketingCampaignIdSchema,
      eventType: z.enum(['qr_landing', 'landing_visit']),
      visitorId: z.string().trim().min(16).max(80).regex(/^[a-z0-9_-]+$/i)
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'The campaign landing event did not match the required schema.' });
    try {
      const { campaignId, eventType, visitorId } = parsed.data;
      const utcDay = new Date().toISOString().slice(0, 10);
      const recorded = await insertMarketingCampaignEvent(
        campaignId,
        eventType,
        visitorId,
        `landing|${campaignId}|${eventType}|${visitorId}|${utcDay}`
      );
      return res.status(202).json({ accepted: true, recorded });
    } catch (error: any) {
      console.error('[MarketingCampaignAnalytics] Landing event persistence failed:', error?.message || error);
      return res.status(503).json({ error: 'The marketing event could not be persisted.' });
    }
  });

  /** Signup events are accepted only for a Firebase account created in the last 30 minutes. */
  app.post('/api/marketing/campaign-events/registration', verifyAuth, async (req: any, res: any) => {
    const schema = z.object({
      campaignId: MarketingCampaignIdSchema,
      visitorId: z.string().trim().min(16).max(80).regex(/^[a-z0-9_-]+$/i)
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'A valid campaign attribution is required.' });
    try {
      const firebaseApp = getAdminApp();
      if (!firebaseApp) return res.status(503).json({ error: 'Firebase account verification is unavailable.' });
      const account = await admin.auth(firebaseApp).getUser(req.user.uid);
      const createdAtMs = Date.parse(account.metadata.creationTime);
      const ageMs = Date.now() - createdAtMs;
      if (!Number.isFinite(createdAtMs) || ageMs < -60000 || ageMs > 30 * 60 * 1000) {
        return res.status(403).json({ error: 'Registration conversion can only be recorded for a newly created account.' });
      }
      const { campaignId, visitorId } = parsed.data;
      const recorded = await insertMarketingCampaignEvent(
        campaignId,
        'registration_completed',
        visitorId,
        `registration|${campaignId}|${req.user.uid}`
      );
      return res.status(202).json({ accepted: true, recorded });
    } catch (error: any) {
      console.error('[MarketingCampaignAnalytics] Registration event persistence failed:', error?.message || error);
      return res.status(503).json({ error: 'The registration event could not be verified or persisted.' });
    }
  });

  /** Aggregated event counts are visible only to administrators. */
  app.get('/api/admin/marketing/analytics', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user?.uid, req.user?.email);
      if (!isAdmin) return res.status(403).json({ error: 'Administrator privileges are required.' });
      const campaignId = typeof req.query?.campaignId === 'string' ? req.query.campaignId.trim() : '';
      if (!MarketingCampaignIdSchema.safeParse(campaignId).success) {
        return res.status(400).json({ error: 'A valid campaignId is required.' });
      }
      await ensureMarketingStudioSchema();
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Campaign analytics are unavailable.' });
      const result = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'qr_landing')::int AS qr_landings,
           COUNT(*) FILTER (WHERE event_type = 'landing_visit')::int AS landing_visits,
           COUNT(*) FILTER (WHERE event_type = 'registration_completed')::int AS registrations,
           COUNT(*) FILTER (WHERE event_type = 'paid_conversion')::int AS paid_conversions,
           COUNT(DISTINCT visitor_id)::int AS unique_visitors,
           MAX(occurred_at) AS last_event_at
         FROM marketing_campaign_events
         WHERE campaign_id = $1`,
        [campaignId]
      );
      const row = result.rows[0] || {};
      const metrics = {
        qrLandings: Number(row.qr_landings || 0),
        landingVisits: Number(row.landing_visits || 0),
        registrations: Number(row.registrations || 0),
        paidConversions: Number(row.paid_conversions || 0),
        uniqueVisitors: Number(row.unique_visitors || 0),
        lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : null
      };
      return res.json({ campaignId, metrics, source: 'recorded_marketing_campaign_events' });
    } catch (error: any) {
      console.error('[MarketingCampaignAnalytics] Analytics query failed:', error?.message || error);
      return res.status(503).json({ error: 'Campaign analytics could not be loaded from Neon PostgreSQL.' });
    }
  });

  // Admin Support Overview, Ticket Status, and Broadcast (Neon PostgreSQL)
  app.get('/api/admin/support/overview', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user.uid, req.user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Support service unavailable: PostgreSQL is not connected.' });

      const [tRes, cRes] = await Promise.all([
        pool.query(`SELECT id, user_id, user_email, user_name, subject, message, status, created_at FROM support_tickets ORDER BY created_at DESC LIMIT 100`),
        pool.query(`SELECT id, user_id, user_name, status, last_message, messages, updated_at FROM support_chats ORDER BY updated_at DESC LIMIT 100`)
      ]);

      const tickets = tRes.rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        name: r.user_name || 'Student',
        email: r.user_email || '',
        subject: r.subject || '',
        message: r.message || '',
        status: r.status || 'open',
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
      }));

      const chats = cRes.rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        userName: r.user_name || 'Student',
        status: r.status || 'active',
        lastMessage: r.last_message || '',
        messages: Array.isArray(r.messages) ? r.messages : [],
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString()
      }));

      return res.json({ tickets, chats });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to load support overview' });
    }
  });

  app.patch('/api/admin/support/tickets/:ticketId', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user.uid, req.user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });
      const status = req.body?.status || 'resolved';
      await pool.query(
        `UPDATE support_tickets SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, req.params.ticketId]
      );
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to update ticket' });
    }
  });

  app.post('/api/admin/support/broadcast', verifyAuth, async (req: any, res: any) => {
    try {
      const isAdmin = await checkIsAdmin(req.user.uid, req.user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const pool = getPostgresPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable' });

      const title = String(req.body?.title || '').trim();
      const message = String(req.body?.message || '').trim();
      const ctaUrl = req.body?.ctaUrl ? String(req.body.ctaUrl).trim() : null;
      const type = String(req.body?.type || 'info');
      const severity = type === 'error' ? 'urgent' : type === 'warning' ? 'warning' : 'info';
      const annId = `ann_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;

      await pool.query(
        `INSERT INTO announcements (id, title, message, severity, audience, cta_label, cta_url, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'all', $5, $6, true, NOW(), NOW())`,
        [annId, title, message, severity, ctaUrl ? 'Join WhatsApp' : null, ctaUrl]
      );

      const usersRes = await pool.query(`SELECT uid FROM users`);
      for (const u of usersRes.rows) {
        const nId = `notif_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        await pool.query(
          `INSERT INTO user_notifications (id, uid, title, message, type, read, created_at)
           VALUES ($1, $2, $3, $4, $5, false, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [nId, u.uid, title, message, type]
        );
      }

      return res.json({ success: true, announcementId: annId, recipients: usersRes.rowCount ?? 0 });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to publish broadcast' });
    }
  });
}
