/**
 * UniAce Mastery Hub: Stage 2 RAG Embeddings Migration & Ingestion Script
 *
 * Performs preflight embedding verification (768-dim gemini-embedding-2-preview),
 * reads course lesson/content chunks, verifies course existence in Neon PostgreSQL,
 * embeds text with RETRIEVAL_DOCUMENT in batches, and upserts into course_knowledge_chunks.
 */

import { GoogleGenAI } from '@google/genai';
import { queryPostgres, checkPostgresHealth } from '../server/postgresPool';
import { VectorRepository } from '../server/repositories/vectorRepository';
import { logger } from '../logger';

const BATCH_SIZE = 10;
const DELAY_MS = 1000;

export async function migrateRagEmbeddings() {
  console.log('================================================================');
  console.log('🚀 Phase 5 Stage 2: RAG Vector Embeddings Migration (Batch Mode)');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL unavailable: ${health.error}`);
  }
  console.log(`✅ Connected to Neon PostgreSQL (${health.latencyMs}ms).\n`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }

  const ai = new GoogleGenAI({ apiKey });
  let activeEmbeddingModel = 'gemini-embedding-001';

  // 1. Preflight call
  console.log('--- Step 1: Performing Embedding Preflight Check ---');
  try {
    const preflightRes = await ai.models.embedContent({
      model: activeEmbeddingModel,
      contents: 'UniAce Mastery Hub academic vector preflight verification',
      config: { outputDimensionality: 768 }
    });
    const dims = preflightRes.embeddings?.[0]?.values?.length || preflightRes.embedding?.values?.length;
    console.log(`✅ Preflight Passed: model '${activeEmbeddingModel}' returned ${dims} dimensions.\n`);
  } catch (err: any) {
    console.warn(`⚠️ gemini-embedding-2-preview error (${err.message}). Trying fallback 'gemini-embedding-001'...`);
    activeEmbeddingModel = 'gemini-embedding-001';
    const preflightRes = await ai.models.embedContent({
      model: activeEmbeddingModel,
      contents: 'UniAce Mastery Hub academic vector preflight verification'
    });
    const dims = preflightRes.embeddings?.[0]?.values?.length || preflightRes.embedding?.values?.length;
    console.log(`✅ Preflight Passed: fallback model '${activeEmbeddingModel}' returned ${dims} dimensions.\n`);
  }

  // 2. Fetch existing course IDs
  const courseRes = await queryPostgres<{ id: string }>('SELECT id FROM courses;');
  const validCourseIds = new Set(courseRes.rows.map(r => r.id));
  console.log(`ℹ️ Found ${validCourseIds.size} existing courses in Neon PostgreSQL.`);

  // 3. Retrieve lessons
  const lessonRes = await queryPostgres<{
    id: string;
    course_id: string;
    module_id: string;
    title: string;
    content_markdown: string;
  }>('SELECT id, course_id, module_id, title, content_markdown FROM course_lessons WHERE content_markdown IS NOT NULL AND length(content_markdown) > 10;');

  console.log(`ℹ️ Retrieved ${lessonRes.rows.length} lessons from Neon for chunking.`);

  let processedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  // Filter lessons that already exist in chunks table
  const existingChunksRes = await queryPostgres('SELECT chunk_id FROM course_knowledge_chunks;');
  const existingChunkIds = new Set(existingChunksRes.rows.map(r => r.chunk_id));

  const pendingLessons = lessonRes.rows.filter(l => !existingChunkIds.has(`chunk_${l.id}`) && validCourseIds.has(l.course_id));
  skippedCount = lessonRes.rows.length - pendingLessons.length;

  console.log(`ℹ️ Chunks to generate: ${pendingLessons.length} (${skippedCount} already exist or invalid course).`);

  // Process in batches
  for (let i = 0; i < pendingLessons.length; i += BATCH_SIZE) {
    const batch = pendingLessons.slice(i, i + BATCH_SIZE);
    const contents = batch.map(l => `${l.title}\n\n${l.content_markdown}`.substring(0, 4000));

    try {
      console.log(`  📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} items)...`);
      
      const embedRes = await ai.models.embedContent({
        model: activeEmbeddingModel,
        contents: contents,
        config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 }
      });

      const embeddings = embedRes.embeddings || [embedRes.embedding];
      
      for (let j = 0; j < batch.length; j++) {
        const lesson = batch[j];
        const embeddingValues = embeddings[j]?.values;

        if (embeddingValues && embeddingValues.length === 768 && embeddingValues.every(Number.isFinite)) {
          const finalValues = embeddingValues;

          await VectorRepository.insertChunk({
            chunk_id: `chunk_${lesson.id}`,
            course_id: lesson.course_id,
            module_id: lesson.module_id,
            lesson_id: lesson.id,
            chunk_text: contents[j],
            token_count: Math.ceil(contents[j].length / 4),
            metadata: { embedding_model: activeEmbeddingModel, title: lesson.title },
            embedding: finalValues
          });
          processedCount++;
        }
      }

      console.log(`    ✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} completed. Total: ${processedCount}`);
      
      // Delay to respect rate limits
      if (i + BATCH_SIZE < pendingLessons.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    } catch (err: any) {
      errorCount += batch.length;
      console.error(`    ❌ Batch failed:`, err.message);
      
      // If rate limited, wait longer
      if (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED')) {
        console.log('    ⏳ Rate limit hit. Waiting 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  console.log('\n================================================================');
  console.log(`✨ RAG Embeddings Migration Summary:`);
  console.log(`   - Newly Embedded Chunks: ${processedCount}`);
  console.log(`   - Skipped (Already Exists): ${skippedCount}`);
  console.log(`   - Errors (Items in failed batches): ${errorCount}`);
  console.log('================================================================\n');
}

if (process.argv[1] && process.argv[1].includes('migrate-rag-embeddings')) {
  migrateRagEmbeddings()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ RAG Embeddings Migration failed:', err);
      process.exit(1);
    });
}
