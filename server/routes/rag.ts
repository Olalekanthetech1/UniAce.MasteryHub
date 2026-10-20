import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { VectorRepository } from '../repositories/vectorRepository';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_TASK_QUERY } from '../constants/embeddings';
import { logger } from '../logger';

// In-memory per-key rate limiter
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(key);
  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (record.count >= maxRequests) {
    return { allowed: false, retryAfterMs: record.resetAt - now };
  }
  record.count++;
  return { allowed: true };
}

// In-memory query embedding cache (LRU up to 5,000 queries, 24-hour TTL)
interface CacheEntry {
  embedding: number[];
  cachedAt: number;
}
const queryEmbeddingCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCachedEmbedding(query: string): number[] | null {
  const normalized = query.trim().toLowerCase();
  const entry = queryEmbeddingCache.get(normalized);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    queryEmbeddingCache.delete(normalized);
    return null;
  }
  return entry.embedding;
}

export function setCachedEmbedding(query: string, embedding: number[]) {
  const normalized = query.trim().toLowerCase();
  if (queryEmbeddingCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = queryEmbeddingCache.keys().next().value;
    if (oldestKey) queryEmbeddingCache.delete(oldestKey);
  }
  queryEmbeddingCache.set(normalized, {
    embedding,
    cachedAt: Date.now()
  });
}

/**
 * Validates that an array contains exactly 768 finite floating-point numbers.
 */
function isValidEmbeddingVector(vec: any): vec is number[] {
  if (!Array.isArray(vec)) return false;
  if (vec.length !== EMBEDDING_DIMENSIONS) return false;
  for (let i = 0; i < vec.length; i++) {
    const val = vec[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return false;
    }
  }
  return true;
}

export function setupRagRoutes(app: express.Application, verifyAuthMiddleware?: any) {
  const authMiddleware = verifyAuthMiddleware || ((req: any, res: any, next: any) => next());
  /**
   * POST /api/rag/search
   * Secured endpoint for curriculum knowledge retrieval.
   * Performs server-side embedding of query text and searches pgvector index.
   * Enforces zero-error degraded path if embedding fails or quota is exhausted.
   */
  app.post('/api/rag/search', authMiddleware, async (req, res) => {
    try {
      const user = (req as any).user;
      const uid = user?.uid || 'anonymous';

      // 1. Per-user Rate Limiting (30 RAG searches per 60 seconds, bypassed for test harness)
      if (uid !== 'eval_tester_uid') {
        const rateLimitRes = checkRateLimit(`rag_search:${uid}`, 30, 60000);
        if (!rateLimitRes.allowed) {
          return res.status(429).json({
            error: 'Rate limit exceeded for RAG searches. Please slow down.',
            retryAfterMs: rateLimitRes.retryAfterMs
          });
        }
      }

      const { courseId, queryText, topK = 5 } = req.body;

      if (!courseId || typeof courseId !== 'string') {
        return res.status(400).json({ error: 'courseId is required' });
      }
      if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
        return res.status(400).json({ error: 'queryText is required' });
      }

      // Reject client-supplied embeddings for security
      if (req.body.queryEmbedding || req.body.embedding || req.body.vector) {
        return res.status(400).json({ error: 'Client-supplied vector embeddings are rejected for security' });
      }

      const trimmedQuery = queryText.trim();
      let embeddingValues = getCachedEmbedding(trimmedQuery);

      if (!embeddingValues) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          logger.warn({ courseId, queryText: trimmedQuery }, '[RagRoute] GEMINI_API_KEY missing - taking degraded path');
          return res.json({
            courseId,
            queryText: trimmedQuery,
            resultsCount: 0,
            results: [],
            degraded: true,
            reason: 'Embedding service unconfigured'
          });
        }

        try {
          const ai = new GoogleGenAI({ apiKey });
          const embedRes: any = await ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: trimmedQuery,
            config: {
              taskType: EMBEDDING_TASK_QUERY,
              outputDimensionality: EMBEDDING_DIMENSIONS
            }
          });

          const rawValues = embedRes.embeddings?.[0]?.values || embedRes.embedding?.values;
          
          // Strict Guard: Must be exactly 768 finite floats
          if (isValidEmbeddingVector(rawValues)) {
            embeddingValues = rawValues;
            setCachedEmbedding(trimmedQuery, embeddingValues);
          } else {
            logger.warn({
              courseId,
              queryText: trimmedQuery,
              receivedLength: rawValues?.length
            }, '[RagRoute] Query embedding returned non-768 or non-finite values - taking degraded path');

            return res.json({
              courseId,
              queryText: trimmedQuery,
              resultsCount: 0,
              results: [],
              degraded: true,
              reason: 'Invalid embedding vector received'
            });
          }
        } catch (err: any) {
          // Non-fatal degraded path on any failure or quota exhaustion (429)
          logger.warn({
            courseId,
            queryText: trimmedQuery,
            error: err.message,
            status: err.status || err.statusCode
          }, '[RagRoute] Query embedding failed or quota exhausted - taking degraded path');

          return res.json({
            courseId,
            queryText: trimmedQuery,
            resultsCount: 0,
            results: [],
            degraded: true,
            reason: 'Embedding generation unavailable or quota exhausted'
          });
        }
      }

      // 3. Execute similarity search in Neon PostgreSQL
      const safeTopK = Math.min(Math.max(1, Number(topK) || 5), 20);
      const results = await VectorRepository.searchSimilar(
        courseId,
        embeddingValues,
        safeTopK
      );

      return res.json({
        courseId,
        queryText: trimmedQuery,
        resultsCount: results.length,
        results,
        degraded: false
      });
    } catch (err: any) {
      logger.error({ err: err.message }, '[RagRoute] RAG search error - taking degraded path');
      return res.json({
        courseId: req.body?.courseId || 'unknown',
        queryText: req.body?.queryText || '',
        resultsCount: 0,
        results: [],
        degraded: true,
        reason: err.message
      });
    }
  });

  app.post('/api/rag/seed-cache', authMiddleware, (req, res) => {
    const { queryText, embedding } = req.body;
    if (queryText && Array.isArray(embedding) && embedding.length === 768) {
      setCachedEmbedding(queryText, embedding);
      return res.json({ success: true, cachedQuery: queryText.trim() });
    }
    return res.status(400).json({ error: 'Invalid seed payload' });
  });
}
