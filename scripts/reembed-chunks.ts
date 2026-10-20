import { getPostgresPool } from '../server/postgresPool';
import { GoogleGenAI } from '@google/genai';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_TASK_DOCUMENT } from '../server/constants/embeddings';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Database pool unavailable');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');

  const ai = new GoogleGenAI({ apiKey });

  console.log('================================================================');
  console.log('📦 Step 3: Re-embedding Knowledge Chunks with gemini-embedding-001');
  console.log('================================================================\n');

  // 1. Create backup table
  console.log('1. Creating backup table course_knowledge_chunks_backup_20261017...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_knowledge_chunks_backup_20261017 AS 
    SELECT * FROM course_knowledge_chunks;
  `);

  const backupCount = await pool.query('SELECT count(*) FROM course_knowledge_chunks_backup_20261017');
  console.log(`✅ Backup table verified with ${backupCount.rows[0].count} rows.`);

  // 2. Select chunks needing re-embedding
  const chunksToReembed = await pool.query(`
    SELECT chunk_id, course_id, module_id, lesson_id, chunk_text, metadata 
    FROM course_knowledge_chunks 
    WHERE (metadata->>'embedding_model') IS DISTINCT FROM $1
    ORDER BY chunk_id ASC
  `, [EMBEDDING_MODEL]);

  const total = chunksToReembed.rows.length;
  console.log(`2. Found ${total} chunks needing re-embedding (model != '${EMBEDDING_MODEL}').\n`);

  if (total === 0) {
    console.log('All chunks already embedded with ' + EMBEDDING_MODEL);
  }

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    const chunk = chunksToReembed.rows[i];
    const prefix = `[${i + 1}/${total}] Chunk ${chunk.chunk_id} (${chunk.course_id}):`;

    let attempts = 0;
    let success = false;
    let lastError: any = null;

    while (attempts < 5 && !success) {
      attempts++;
      try {
        const textToEmbed = chunk.chunk_text ? chunk.chunk_text.trim() : '';
        if (!textToEmbed) {
          throw new Error('Empty chunk text');
        }

        const embedRes = await ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: textToEmbed,
          config: {
            taskType: EMBEDDING_TASK_DOCUMENT,
            outputDimensionality: EMBEDDING_DIMENSIONS
          }
        });

        const values = embedRes.embeddings?.[0]?.values || embedRes.embedding?.values;
        if (!values || values.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`Embedding dimensions mismatch: got ${values?.length}, expected ${EMBEDDING_DIMENSIONS}`);
        }

        // Validate 768 finite floats
        const allFinite = values.every((v: any) => typeof v === 'number' && Number.isFinite(v));
        if (!allFinite) {
          throw new Error('Embedding contains NaN or non-finite values');
        }

        // Update metadata
        const metadata = typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata) : (chunk.metadata || {});
        metadata.embedding_model = EMBEDDING_MODEL;
        metadata.embedding_dims = EMBEDDING_DIMENSIONS;
        metadata.reembedded_at = new Date().toISOString();

        const vectorString = `[${values.join(',')}]`;
        await pool.query(`
          UPDATE course_knowledge_chunks 
          SET embedding = $1::vector, metadata = $2 
          WHERE chunk_id = $3
        `, [vectorString, JSON.stringify(metadata), chunk.chunk_id]);

        success = true;
        completed++;
        console.log(`✅ ${prefix} Successfully re-embedded (768 finite floats).`);
      } catch (err: any) {
        lastError = err;
        const isRateLimitOrServer = err?.status === 429 || err?.status >= 500 || (err?.message && (err.message.includes('429') || err.message.includes('503')));
        if (isRateLimitOrServer && attempts < 5) {
          const backoffMs = Math.pow(2, attempts) * 1000;
          console.warn(`⚠️ ${prefix} Hit rate limit or server error. Retrying in ${backoffMs}ms (attempt ${attempts}/5)...`);
          await sleep(backoffMs);
        } else {
          break;
        }
      }
    }

    if (!success) {
      failed++;
      console.error(`❌ ${prefix} FAILED after ${attempts} attempts: ${lastError?.message}`);
    }

    // 1-second throttle between requests
    await sleep(1000);
  }

  console.log('\n================================================================');
  console.log(`Re-embedding Batch Run Complete: ${completed}/${total} succeeded (${failed} failed)`);
  console.log('================================================================\n');

  // 3. Final verification query
  console.log('3. Running Verification Query:');
  const verifyRes = await pool.query(`
    SELECT metadata->>'embedding_model' as model, count(*) 
    FROM course_knowledge_chunks 
    GROUP BY 1
    ORDER BY 1
  `);

  console.log('--- VERIFICATION RESULT ---');
  console.table(verifyRes.rows);

  if (failed > 0) {
    process.exit(1);
  }

  process.exit(0);
}

run().catch(err => {
  console.error('Fatal reembed exception:', err);
  process.exit(1);
});
