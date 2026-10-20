/**
 * UniAce Mastery Hub: Vector Search & Knowledge Chunk Repository (pgvector)
 *
 * Implements 768-dim HNSW vector similarity search with strict order iterative scan,
 * course filtering, and metadata tracking.
 */

import { getPostgresPool } from '../postgresPool';
import { logger } from '../logger';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from '../constants/embeddings';

export interface KnowledgeChunk {
  chunk_id: string;
  course_id: string;
  module_id?: string;
  lesson_id?: string;
  chunk_text: string;
  token_count: number;
  metadata: Record<string, any>;
  embedding?: number[];
  created_at?: Date;
}

export interface SearchResult {
  chunk_id: string;
  module_id: string | null;
  lesson_id: string | null;
  chunk_text: string;
  token_count: number;
  metadata: Record<string, any>;
  similarity: number;
}

export class VectorRepository {
  /**
   * Executes similarity search over course_knowledge_chunks using pgvector HNSW
   * with SET LOCAL hnsw.iterative_scan = 'strict_order' inside a transaction.
   */
  static async searchSimilar(
    courseId: string,
    queryEmbedding: number[],
    topK: number = 5
  ): Promise<SearchResult[]> {
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 768) {
      throw new Error(`Invalid embedding: must be 768 dimensions (got ${queryEmbedding?.length})`);
    }
    if (!queryEmbedding.every(Number.isFinite)) {
      throw new Error('Invalid embedding: contains non-finite numerical values');
    }

    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('[VectorRepository] Database pool unavailable');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Set connection-local parameters for pgvector 0.8+ iterative scan
      await client.query("SET LOCAL hnsw.iterative_scan = 'strict_order'");
      await client.query('SET LOCAL hnsw.ef_search = 100');
      await client.query('SET LOCAL hnsw.max_scan_tuples = 20000');

      const vectorString = `[${queryEmbedding.join(',')}]`;

      // Check if course has chunks in course_knowledge_chunks_v2
      const v2Check = await client.query(
        'SELECT 1 FROM course_knowledge_chunks_v2 WHERE course_id = $1 AND is_active IS TRUE LIMIT 1',
        [courseId]
      );
      const targetTable = v2Check.rows.length > 0 ? 'course_knowledge_chunks_v2' : 'course_knowledge_chunks';

      const sql = targetTable === 'course_knowledge_chunks_v2' ? `
        SELECT ckc.chunk_id, ckc.module_id, ckc.lesson_id, ckc.chunk_text, ckc.token_count, ckc.metadata,
               1 - (ckc.embedding <=> $2::vector) AS similarity
        FROM course_knowledge_chunks_v2 ckc
        WHERE ckc.course_id = $1
          AND ckc.is_active IS TRUE
        ORDER BY ckc.embedding <=> $2::vector
        LIMIT $3;
      ` : `
        SELECT ckc.chunk_id, ckc.module_id, ckc.lesson_id, ckc.chunk_text, ckc.token_count, ckc.metadata,
               1 - (ckc.embedding <=> $2::vector) AS similarity
        FROM course_knowledge_chunks ckc
        LEFT JOIN course_modules cm 
          ON ckc.course_id = cm.course_id AND ckc.module_id = cm.id
        WHERE ckc.course_id = $1
          AND (cm.is_archived IS NOT TRUE OR cm.is_archived IS NULL)
        ORDER BY ckc.embedding <=> $2::vector
        LIMIT $3;
      `;

      const candidateLimit = Math.max(topK * 6, 30);
      const res = await client.query(sql, [courseId, vectorString, candidateLimit]);
      await client.query('COMMIT');

      const mapped = res.rows.map(row => ({
        chunk_id: row.chunk_id,
        module_id: row.module_id,
        lesson_id: row.lesson_id,
        chunk_text: row.chunk_text,
        token_count: Number(row.token_count || 0),
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        similarity: parseFloat(row.similarity)
      }));

      // Deduplicate by lesson_id preserving the highest similarity chunk per distinct lesson
      const seenLessons = new Set<string>();
      const deduped: SearchResult[] = [];
      for (const item of mapped) {
        const key = item.lesson_id || item.chunk_id;
        if (!seenLessons.has(key)) {
          seenLessons.add(key);
          deduped.push(item);
          if (deduped.length >= topK) break;
        }
      }

      return deduped;
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error({ courseId, err: err.message }, '[VectorRepository] Similarity search failed');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Upserts a single knowledge chunk into course_knowledge_chunks
   */
  static async insertChunk(chunk: KnowledgeChunk & { embedding: number[] }): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('[VectorRepository] Database pool unavailable');
    }

    if (chunk.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding must be ${EMBEDDING_DIMENSIONS} dimensions (got ${chunk.embedding.length})`);
    }

    if (chunk.metadata?.embedding_model && chunk.metadata.embedding_model !== EMBEDDING_MODEL) {
      throw new Error(`Rejected vector insert: embedding_model must be '${EMBEDDING_MODEL}', got '${chunk.metadata.embedding_model}'`);
    }

    const vectorString = `[${chunk.embedding.join(',')}]`;
    const metadataJson = JSON.stringify(chunk.metadata || {});

    const sql = `
      INSERT INTO course_knowledge_chunks (
        chunk_id, course_id, module_id, lesson_id, chunk_text, token_count, metadata, embedding, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, NOW())
      ON CONFLICT (chunk_id) DO UPDATE SET
        chunk_text = EXCLUDED.chunk_text,
        token_count = EXCLUDED.token_count,
        metadata = EXCLUDED.metadata,
        embedding = EXCLUDED.embedding;
    `;

    await pool.query(sql, [
      chunk.chunk_id,
      chunk.course_id,
      chunk.module_id || null,
      chunk.lesson_id || null,
      chunk.chunk_text,
      chunk.token_count || 0,
      metadataJson,
      vectorString
    ]);
  }

  /**
   * Bulk inserts knowledge chunks inside a single transaction
   */
  static async bulkInsertChunks(chunks: Array<KnowledgeChunk & { embedding: number[] }>): Promise<number> {
    if (chunks.length === 0) return 0;
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('[VectorRepository] Database pool unavailable');
    }

    const client = await pool.connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      for (const chunk of chunks) {
        if (chunk.embedding.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`Embedding must be ${EMBEDDING_DIMENSIONS} dimensions (got ${chunk.embedding.length})`);
        }
        if (chunk.metadata?.embedding_model && chunk.metadata.embedding_model !== EMBEDDING_MODEL) {
          throw new Error(`Rejected vector insert: embedding_model must be '${EMBEDDING_MODEL}', got '${chunk.metadata.embedding_model}'`);
        }
        const vectorString = `[${chunk.embedding.join(',')}]`;
        const metadataJson = JSON.stringify(chunk.metadata || {});

        await client.query(
          `INSERT INTO course_knowledge_chunks (
            chunk_id, course_id, module_id, lesson_id, chunk_text, token_count, metadata, embedding, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, NOW())
          ON CONFLICT (chunk_id) DO UPDATE SET
            chunk_text = EXCLUDED.chunk_text,
            token_count = EXCLUDED.token_count,
            metadata = EXCLUDED.metadata,
            embedding = EXCLUDED.embedding;`,
          [
            chunk.chunk_id,
            chunk.course_id,
            chunk.module_id || null,
            chunk.lesson_id || null,
            chunk.chunk_text,
            chunk.token_count || 0,
            metadataJson,
            vectorString
          ]
        );
        inserted++;
      }
      await client.query('COMMIT');
      return inserted;
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error({ err: err.message }, '[VectorRepository] Bulk chunk insert failed');
      throw err;
    } finally {
      client.release();
    }
  }
}
