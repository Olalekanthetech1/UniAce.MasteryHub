import express from 'express';
import admin from 'firebase-admin';
import crypto from 'crypto';
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
import { runProgressDeltaCatchUp, runProgressParityAudit } from '../services/progressParityService';
import { runSparksParityAudit } from '../services/sparksParityService';
import { clearBootstrapCache } from './student';
import { catalogCache } from '../cache/catalogCache';

export function setupAdminRoutes(app: express.Express, verifyAuth: any, getAdminApp: any, isAdminEmail: any) {
  async function checkIsAdmin(uid: string, email?: string): Promise<boolean> {
    if (email && (email.toLowerCase() === 'olalekan4565@gmail.com' || isAdminEmail(email))) return true;
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

      const { courseId, moduleId, subTopicId, subTopicTitle, moduleTitle, struggleCount } = req.body;
      if (!subTopicTitle) {
        return res.status(400).json({ error: 'subTopicTitle is required' });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the server' });
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are UniAce's Senior University Academic Architect & Curriculum Specialist.
Students are actively struggling with the topic: "${subTopicTitle}" in module "${moduleTitle || 'Core Studies'}".
(Logged struggle requests from students: ${struggleCount || 1})

Provide a comprehensive, high-clarity academic remediation package formatted in clean Markdown with LaTeX math notation ($...$ and $$...$$).

Structure your output into these 4 distinct sections:
# 1. Intuitive Conceptual Bridge (ELI5 & Real-World Analogy)
Explain the core mechanism simply without introducing any scientific inaccuracies.

# 2. Rigorous Academic Breakdown & Formal Definition
Provide university-standard proofs, mathematical definitions, and complete theoretical mechanisms using LaTeX ($...$).

# 3. Common Student Pitfalls & Misconceptions
Explicitly list what confuses students and provide clear contrasting examples.

# 4. Check for Understanding (3 Interactive Questions with Explanations)
Include 3 multiple-choice conceptual questions with step-by-step verified explanations.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
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

      const apiKeysDoc = await adminApp.firestore().collection('system_settings').doc('api_keys').get();
      const apiKeysData = apiKeysDoc.data() || {};
      const getConfiguredKey = (prov: string, envKey?: string) => {
        const list = apiKeysData[prov]?.keys?.map((k: any) => k.key).filter(Boolean);
        return (list && list[0]) || envKey || '';
      };

      const targetProvider = (provider || 'gemini_direct').toLowerCase();

      if (targetProvider === 'gemini_direct' || targetProvider === 'gemini') {
        try {
          const apiKey = getConfiguredKey('gemini_direct', process.env.GEMINI_API_KEY);
          if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
          const ai = new GoogleGenAI({ apiKey });
          modelUsed = apiKeysData.gemini_direct?.model || 'gemini-2.5-flash';
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
          modelUsed = apiKeysData.groq?.model || 'llama-3.3-70b-versatile';
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
          modelUsed = apiKeysData.mistral_direct?.model || 'mistral-small-latest';
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
          modelUsed = apiKeysData.nvidia?.model || 'meta/llama-3.1-70b-instruct';
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
          modelUsed = apiKeysData.openrouter_free?.model || 'meta-llama/llama-3.3-70b-instruct:free';
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
          modelUsed = apiKeysData.cohere?.model || 'command-r-08-2024';
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
          modelUsed = apiKeysData.huggingface?.model || 'Qwen/Qwen2.5-72B-Instruct';
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
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

    try {
      const isAdmin = await checkIsAdmin(user.uid, user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const configDoc = await adminApp.firestore().collection('system_config').doc('general').get();
      res.json(configDoc.exists ? configDoc.data() : {});
    } catch (error: any) {
      console.error('Fetch System Config Error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch system config' });
    }
  });

  app.post('/api/admin/config', verifyAuth, async (req, res) => {
    const user = (req as any).user;
    const adminApp = getAdminApp();
    if (!adminApp) return res.status(503).json({ error: 'Firebase not initialized' });

    try {
      const isAdmin = await checkIsAdmin(user.uid, user.email);
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

      const updates = req.body;
      await adminApp.firestore().collection('system_config').doc('general').set({
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: user.email || user.uid
      }, { merge: true });

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

  // 10. Execute Canonical SHA-256 Parity Audit & Delta Catch-Up
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
        const deltaResult = await runProgressDeltaCatchUp();
        const parityOk = await runProgressParityAudit();

        await recordBackendSystemLog(
          parityOk ? 'success' : 'error',
          'admin',
          `Admin executed Progress Parity Audit (parityMatched: ${parityOk}, deltas: ${deltaResult.deltaCount})`,
          { scope, parityOk, deltaCount: deltaResult.deltaCount },
          { uid: user.uid, email: user.email }
        );

        return res.json({
          success: true,
          scope,
          parityMatched: parityOk,
          deltaCount: deltaResult.deltaCount,
          auditedAt: new Date().toISOString()
        });
      }

      if (scope === 'catalog') {
        // Query courses count from both Postgres and Firestore
        const db = adminApp.firestore();
        const fsSnap = await db.collection('courses').get();
        const pgRes = await queryPostgres<{ count: string }>('SELECT count(*) FROM courses;');
        const pgCount = Number(pgRes.rows[0]?.count || 0);
        const fsCount = fsSnap.size;
        const parityOk = pgCount >= fsCount;

        await recordBackendSystemLog(
          parityOk ? 'success' : 'warning',
          'admin',
          `Admin executed Catalog Parity Audit (Postgres: ${pgCount}, Firestore: ${fsCount})`,
          { scope, parityOk, pgCount, fsCount },
          { uid: user.uid, email: user.email }
        );

        return res.json({
          success: true,
          scope,
          parityMatched: parityOk,
          pgCount,
          fsCount,
          auditedAt: new Date().toISOString()
        });
      }

      if (scope === 'sparks') {
        const auditResult = await runSparksParityAudit();

        await recordBackendSystemLog(
          auditResult.parityMatched ? 'success' : 'error',
          'admin',
          `Admin executed AI Sparks Parity Audit (parityMatched: ${auditResult.parityMatched}, matched: ${auditResult.matchedCount}/${auditResult.totalUsersChecked})`,
          { scope, parityOk: auditResult.parityMatched, mismatches: auditResult.mismatches.length },
          { uid: user.uid, email: user.email }
        );

        return res.json({
          success: true,
          scope,
          parityMatched: auditResult.parityMatched,
          totalUsersChecked: auditResult.totalUsersChecked,
          matchedCount: auditResult.matchedCount,
          mismatchCount: auditResult.mismatchCount,
          mismatches: auditResult.mismatches,
          auditedAt: auditResult.auditedAt
        });
      }

      return res.status(400).json({ error: `Unsupported audit scope: ${scope}. Supported: 'progress', 'catalog', 'sparks'` });
    } catch (error: any) {
      console.error('[Admin] Parity Audit Error:', error);
      res.status(500).json({ error: error.message || 'Parity audit execution failed' });
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

  // Admin Course Creation Endpoint via Neon
  app.post('/api/admin/courses', verifyAuth, async (req: any, res: any) => {
    const user = req.user;
    const isAdmin = await checkIsAdmin(user.uid, user.email);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const { id, code, title, description, level, department, faculty, semester, scope, syllabus } = req.body;
    if (!id || !title) {
      return res.status(400).json({ error: 'Course id and title are required' });
    }

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const courseCode = code || id;
      await client.query(
        `INSERT INTO courses (id, code, title, description, level, department, faculty, semester, scope, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', 1, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           code = EXCLUDED.code,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           level = EXCLUDED.level,
           department = EXCLUDED.department,
           faculty = EXCLUDED.faculty,
           semester = EXCLUDED.semester,
           scope = EXCLUDED.scope,
           updated_at = NOW()`,
        [id, courseCode, title, description || null, level || '100', department || null, faculty || null, semester || '1st Semester', scope || 'GLOBAL']
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
        `Admin ${user.email || user.uid} created/updated course ${id} via Neon`,
        { courseId: id },
        { uid: user.uid, email: user.email }
      );

      res.json({ success: true, courseId: id });
    } catch (err: any) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Failed to save course', details: err.message });
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
    const { title, description, level, semester, scope, faculties, departments, syllabus } = req.body;

    const pool = getPostgresPool();
    if (!pool) return res.status(503).json({ error: 'Database service unavailable' });

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
             faculty = COALESCE($6, faculty),
             department = COALESCE($7, department),
             version = version + 1,
             updated_at = NOW()
         WHERE id = $8`,
        [
          title || null,
          description || null,
          level || null,
          semester || null,
          scope || null,
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

  // Admin Course Archive Endpoint via Neon
  app.delete('/api/admin/courses/:id', verifyAuth, async (req: any, res: any) => {
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
        `UPDATE courses SET status = 'archived', updated_at = NOW() WHERE id = $1`,
        [id]
      );
      catalogCache.invalidateAll();
      res.json({ success: true, courseId: id });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to archive course', details: err.message });
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
}




