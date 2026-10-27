import { GoogleGenAI } from '@google/genai';
import { getPostgresPool } from './postgresPool';
import { DynamicKeyRotator } from './providers';
import { inspectAndScrubUntrustedText } from './promptShield';

export interface SearchResult {
  content: string;
  source: string;
  type: 'question' | 'syllabus' | 'formula';
  score: number;
}

const geminiKeyRotator = new DynamicKeyRotator('gemini_direct', process.env.GEMINI_API_KEY || '');

async function getAI(): Promise<{ ai: GoogleGenAI; apiKey: string }> {
  const apiKey = await geminiKeyRotator.getNextKey();
  return { ai: new GoogleGenAI({ apiKey }), apiKey };
}

export function addVectorItem(_id: string, _content: string, _source: string, _type: 'question' | 'syllabus' | 'formula', _embedding: number[]) {
  // Handled via VectorRepository in Neon PostgreSQL pgvector.
}

export function removeVectorItem(_id: string) {
  // Handled via VectorRepository in Neon PostgreSQL pgvector.
}

/**
 * Initializes Vector Store verification against Neon PostgreSQL pgvector.
 * Uses zero in-memory heap caching to prevent OOM on Cloud Run containers.
 */
export async function initializeVectorStore() {
  try {
    const pool = getPostgresPool();
    if (!pool) return;
    const countRes = await pool.query('SELECT COUNT(*)::int AS cnt FROM course_knowledge_chunks');
    const count = countRes.rows[0]?.cnt ?? 0;
    console.log(`[Vector Store] Initialized with ${count} items available in Neon PostgreSQL pgvector index.`);
  } catch (error: any) {
    console.warn('[Vector Store] Vector index check:', error.message || error);
  }
}

/**
 * Performs semantic search using Neon PostgreSQL pgvector HNSW index.
 */
export async function findRelevantContentSemantic(query: string, limit: number = 5): Promise<SearchResult[]> {
  try {
    const pool = getPostgresPool();
    if (!pool) return [];

    const { ai, apiKey } = await getAI();
    let result;
    try {
      result = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: query,
        config: { outputDimensionality: 768 }
      });
    } catch (embedErr: any) {
      const msg = (embedErr?.message || String(embedErr)).toLowerCase();
      if (embedErr?.status === 400 || embedErr?.status === 401 || embedErr?.status === 403 || msg.includes('api key not valid') || msg.includes('api_key_invalid')) {
        await geminiKeyRotator.markKeyExhausted(apiKey);
        const retryClient = await getAI();
        result = await retryClient.ai.models.embedContent({
          model: 'gemini-embedding-001',
          contents: query,
          config: { outputDimensionality: 768 }
        });
      } else {
        throw embedErr;
      }
    }

    const queryEmbedding = result.embeddings?.[0]?.values;
    if (!queryEmbedding || queryEmbedding.length === 0) return [];

    const vectorString = `[${queryEmbedding.join(',')}]`;
    const res = await pool.query(
      `SELECT chunk_text, course_id, metadata, 1 - (embedding <=> $1::vector) AS similarity
       FROM course_knowledge_chunks
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorString, limit]
    );

    if (res.rows.length === 0) return [];

    return res.rows.map(row => {
      const rawContent = row.chunk_text || '';
      const scrubbed = inspectAndScrubUntrustedText(rawContent, 'rag_chunk');
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
      return {
        content: scrubbed.sanitizedText,
        source: meta.source || row.course_id || 'Knowledge Base',
        type: (meta.type as any) || 'syllabus',
        score: Number(row.similarity ?? 1.0)
      };
    });
  } catch (error) {
    console.error('Error in semantic search:', error);
    return [];
  }
}
