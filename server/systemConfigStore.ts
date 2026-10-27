import crypto from 'crypto';
import { getPostgresPool } from './postgresPool';

interface CachedConfigEntry {
  data: Record<string, any> | null;
  fetchedAt: number;
}

const configMemoryCache = new Map<string, CachedConfigEntry>();
const CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

export function invalidateSystemConfigCache(key?: string): void {
  if (key) {
    configMemoryCache.delete(key);
    configMemoryCache.delete(`settings_${key}`);
  } else {
    configMemoryCache.clear();
  }
}

export async function getSystemConfigDoc(
  key: string,
  forceRefresh: boolean = false
): Promise<Record<string, any> | null> {
  const now = Date.now();
  if (!forceRefresh) {
    const cached = configMemoryCache.get(key);
    if (cached && now - cached.fetchedAt < CONFIG_TTL_MS) {
      return cached.data ? { ...cached.data } : null;
    }
  }

  const pool = getPostgresPool();
  if (!pool) return null;

  try {
    const res = await pool.query<{ data: Record<string, any> }>(
      `SELECT data FROM system_config WHERE key = $1 LIMIT 1;`,
      [key]
    );
    const data = res.rows.length > 0 && res.rows[0].data ? res.rows[0].data : null;
    configMemoryCache.set(key, { data, fetchedAt: now });
    return data ? { ...data } : null;
  } catch (err) {
    console.warn(`[SystemConfigStore] Failed to read system_config key '${key}' from Neon:`, err);
    return null;
  }
}

export async function setSystemConfigDoc(
  key: string,
  payload: Record<string, any>,
  merge: boolean = true
): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;

  try {
    let nextData = payload;
    if (merge) {
      const existing = await getSystemConfigDoc(key, true);
      nextData = { ...(existing || {}), ...payload };
    }

    await pool.query(
      `INSERT INTO system_config (key, data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET
         data = $2::jsonb,
         updated_at = NOW();`,
      [key, JSON.stringify(nextData)]
    );

    configMemoryCache.set(key, { data: nextData, fetchedAt: Date.now() });
  } catch (err) {
    console.warn(`[SystemConfigStore] Failed to write system_config key '${key}' to Neon:`, err);
  }
}

export async function getSystemSettingsDoc(
  docId: string,
  forceRefresh: boolean = false
): Promise<Record<string, any> | null> {
  const settingsKey = docId.startsWith('settings_') ? docId : `settings_${docId}`;
  const data = await getSystemConfigDoc(settingsKey, forceRefresh);
  if (data) return data;
  // Also check bare key if stored directly (e.g., 'api_keys')
  if (docId === 'api_keys') {
    return await getSystemConfigDoc('api_keys', forceRefresh);
  }
  return null;
}

export async function setSystemSettingsDoc(
  docId: string,
  payload: Record<string, any>,
  merge: boolean = true
): Promise<void> {
  const settingsKey = docId.startsWith('settings_') ? docId : `settings_${docId}`;
  await setSystemConfigDoc(settingsKey, payload, merge);
}

export async function insertSystemLog(params: {
  level: string;
  category: string;
  message: string;
  details?: any;
  userId?: string | null;
}): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;

  try {
    const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await pool.query(
      `INSERT INTO system_logs (log_id, level, category, message, details, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW());`,
      [
        logId,
        params.level || 'info',
        params.category || 'system',
        params.message || '',
        JSON.stringify(params.details ?? {}),
        params.userId || null
      ]
    );
  } catch (err) {
    console.warn('[SystemConfigStore] Failed to insert system_log into Neon:', err);
  }
}

export async function insertChatAnalytics(params: {
  uid: string;
  query: string;
  context?: string | null;
  complexity: string;
  tokens: number;
  providerUsed: string;
  piiRedacted?: boolean;
}): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;

  try {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO chat_analytics (id, uid, query, context, complexity, tokens, provider_used, pii_redacted, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW());`,
      [
        id,
        params.uid,
        params.query,
        params.context || 'General',
        params.complexity || 'standard',
        Math.max(0, Math.round(Number(params.tokens) || 0)),
        params.providerUsed || 'unknown',
        params.piiRedacted !== false
      ]
    );
  } catch (err) {
    console.warn('[SystemConfigStore] Failed to insert chat_analytics into Neon:', err);
  }
}
