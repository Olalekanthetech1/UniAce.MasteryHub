import crypto from 'crypto';
import { getPostgresPool } from './postgresPool';

interface MemoryCacheItem {
  answer: string;
  cachedAt: number;
}

const memoryQuestionCache = new Map<string, MemoryCacheItem>();
const QUESTION_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL
const MAX_MEMORY_ENTRIES = 500;

export async function getCachedResponse(question: string): Promise<string | null> {
  const normalized = (question || '').toLowerCase().trim();
  if (!normalized) return null;
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');

  const now = Date.now();
  const memHit = memoryQuestionCache.get(hash);
  if (memHit && now - memHit.cachedAt < QUESTION_CACHE_TTL_MS) {
    return memHit.answer;
  }

  const pool = getPostgresPool();
  if (!pool) return null;

  try {
    const res = await pool.query<{ answer: string }>(
      `SELECT answer FROM question_cache WHERE question_hash = $1 LIMIT 1;`,
      [hash]
    );
    if (res.rows.length > 0 && res.rows[0].answer) {
      const answer = res.rows[0].answer;
      if (memoryQuestionCache.size >= MAX_MEMORY_ENTRIES) {
        const oldestKey = memoryQuestionCache.keys().next().value;
        if (oldestKey) memoryQuestionCache.delete(oldestKey);
      }
      memoryQuestionCache.set(hash, { answer, cachedAt: now });
      return answer;
    }
  } catch (error) {
    console.error('[QuestionCache] Neon lookup error:', error);
  }
  return null;
}

export async function setCachedResponse(question: string, answer: string): Promise<void> {
  const normalized = (question || '').toLowerCase().trim();
  if (!normalized || !answer) return;
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');

  if (memoryQuestionCache.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryQuestionCache.keys().next().value;
    if (oldestKey) memoryQuestionCache.delete(oldestKey);
  }
  memoryQuestionCache.set(hash, { answer, cachedAt: Date.now() });

  const pool = getPostgresPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO question_cache (question_hash, question, answer, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (question_hash) DO UPDATE SET
         answer = EXCLUDED.answer,
         created_at = NOW();`,
      [hash, normalized, answer]
    );
  } catch (error) {
    console.error('[QuestionCache] Neon save error:', error);
  }
}

export async function purgeQuestionCache(): Promise<number> {
  memoryQuestionCache.clear();
  const pool = getPostgresPool();
  if (!pool) return 0;

  try {
    const res = await pool.query(`DELETE FROM question_cache;`);
    return res.rowCount ?? 0;
  } catch (err) {
    console.error('[QuestionCache] Failed to purge question_cache in Neon:', err);
    return 0;
  }
}
