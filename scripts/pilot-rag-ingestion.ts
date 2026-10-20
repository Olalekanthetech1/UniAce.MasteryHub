import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { getPostgresPool } from '../server/postgresPool';
import { generateChunkId } from '../server/utils/chunkId';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_TASK_DOCUMENT, EMBEDDING_TASK_QUERY } from '../server/constants/embeddings';

const PILOT_COURSES = ['PHY101', 'STA112', 'MTH101'];
const CHUNK_SIZE_CHARS = 1500;
const BATCH_SIZE = 25; // 25 texts per Gemini API call

async function runPilot() {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Database pool unavailable');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const ai = new GoogleGenAI({ apiKey });

  console.log('================================================================');
  console.log('🚀 Group A: PILOT RAG Ingestion for PHY101, STA112, MTH101');
  console.log('================================================================\n');

  // 1. Fetch courses, modules, and lessons for pilot
  const coursesRes = await pool.query('SELECT id, title FROM courses WHERE id = ANY($1::text[])', [PILOT_COURSES]);
  const courseMap = new Map<string, string>();
  for (const c of coursesRes.rows) courseMap.set(c.id, c.title);

  const modulesRes = await pool.query('SELECT id, course_id, title, is_archived FROM course_modules WHERE course_id = ANY($1::text[])', [PILOT_COURSES]);
  const moduleMap = new Map<string, any>();
  for (const m of modulesRes.rows) moduleMap.set(`${m.course_id}:${m.id}`, m);

  const lessonsRes = await pool.query(`
    SELECT l.id, l.course_id, l.module_id, l.title, l.content_markdown
    FROM course_lessons l
    WHERE l.course_id = ANY($1::text[])
    ORDER BY l.course_id, l.module_id, l.order_index ASC
  `, [PILOT_COURSES]);

  // 2. Prepare chunks with prefixes and hashes
  const pendingItems: Array<{
    chunkId: string;
    courseId: string;
    moduleId: string;
    lessonId: string;
    chunkIndex: number;
    chunkText: string;
    prefixedText: string;
    contentHash: string;
    tokenCount: number;
    isActive: boolean;
  }> = [];

  for (const l of lessonsRes.rows) {
    const content = (l.content_markdown || '').trim();
    if (!content) continue; // Skip empty stubs

    const modKey = `${l.course_id}:${l.module_id}`;
    const mod = moduleMap.get(modKey);
    const isArchived = mod ? Boolean(mod.is_archived) : false;
    const courseTitle = courseMap.get(l.course_id) || l.course_id;
    const moduleTitle = mod ? mod.title : l.module_id;

    const prefix = `${l.course_id} ${courseTitle} – ${moduleTitle} – ${l.title}`;

    // Chunk text by size
    const numChunks = Math.max(1, Math.ceil(content.length / CHUNK_SIZE_CHARS));
    for (let idx = 0; idx < numChunks; idx++) {
      const start = idx * CHUNK_SIZE_CHARS;
      const rawChunkText = content.substring(start, start + CHUNK_SIZE_CHARS);
      const prefixedText = `${prefix}\n\n${rawChunkText}`;
      const chunkId = generateChunkId(l.course_id, l.module_id, l.id, idx);
      const contentHash = crypto.createHash('sha256').update(prefixedText).digest('hex');
      const tokenCount = Math.ceil(prefixedText.length / 4);

      pendingItems.push({
        chunkId,
        courseId: l.course_id,
        moduleId: l.module_id,
        lessonId: l.id,
        chunkIndex: idx,
        chunkText: rawChunkText,
        prefixedText,
        contentHash,
        tokenCount,
        isActive: !isArchived
      });
    }
  }

  console.log(`1. Total Pilot Chunks Prepared: ${pendingItems.length}`);

  // 3. Filter out unchanged chunks using content_hash in v2
  const existingRes = await pool.query(`
    SELECT chunk_id, content_hash 
    FROM course_knowledge_chunks_v2 
    WHERE course_id = ANY($1::text[])
  `, [PILOT_COURSES]);

  const existingHashMap = new Map<string, string>();
  for (const r of existingRes.rows) {
    existingHashMap.set(r.chunk_id, r.content_hash);
  }

  const itemsToEmbed = pendingItems.filter(item => {
    const existingHash = existingHashMap.get(item.chunkId);
    return !existingHash || existingHash !== item.contentHash;
  });

  console.log(`2. Chunks to Embed after Hash Check (Skipped ${pendingItems.length - itemsToEmbed.length} unchanged): ${itemsToEmbed.length}\n`);

  // 4. Batched Embedding Ingestion into v2
  let embeddedCount = 0;
  for (let i = 0; i < itemsToEmbed.length; i += BATCH_SIZE) {
    const batch = itemsToEmbed.slice(i, i + BATCH_SIZE);
    const textsToEmbed = batch.map(b => b.prefixedText);

    let attempts = 0;
    let success = false;

    while (attempts < 5 && !success) {
      attempts++;
      try {
        const embedRes = await ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: textsToEmbed,
          config: {
            taskType: EMBEDDING_TASK_DOCUMENT,
            outputDimensionality: EMBEDDING_DIMENSIONS
          }
        });

        const rawEmbeddings = embedRes.embeddings || (embedRes.embedding ? [embedRes.embedding] : []);
        if (rawEmbeddings.length !== batch.length) {
          throw new Error(`Batch size mismatch: expected ${batch.length}, got ${rawEmbeddings.length}`);
        }

        // Insert batch into course_knowledge_chunks_v2 inside transaction
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (let j = 0; j < batch.length; j++) {
            const item = batch[j];
            const values = rawEmbeddings[j].values;
            if (!values || values.length !== 768) {
              throw new Error(`Invalid dimensions for chunk ${item.chunkId}: ${values?.length}`);
            }

            const vectorString = `[${values.join(',')}]`;
            const metadata = {
              embedding_model: EMBEDDING_MODEL,
              embedding_dims: EMBEDDING_DIMENSIONS,
              course_id: item.courseId,
              module_id: item.moduleId,
              lesson_id: item.lessonId,
              chunk_index: item.chunkIndex,
              prefixed: true,
              ingested_at: new Date().toISOString()
            };

            await client.query(`
              INSERT INTO course_knowledge_chunks_v2 (
                chunk_id, course_id, module_id, lesson_id, chunk_index, chunk_text, 
                token_count, is_active, metadata, embedding, content_hash, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, $11, NOW())
              ON CONFLICT (chunk_id) DO UPDATE SET
                chunk_text = EXCLUDED.chunk_text,
                token_count = EXCLUDED.token_count,
                is_active = EXCLUDED.is_active,
                metadata = EXCLUDED.metadata,
                embedding = EXCLUDED.embedding,
                content_hash = EXCLUDED.content_hash;
            `, [
              item.chunkId,
              item.courseId,
              item.moduleId,
              item.lessonId,
              item.chunkIndex,
              item.chunkText,
              item.tokenCount,
              item.isActive,
              JSON.stringify(metadata),
              vectorString,
              item.contentHash
            ]);
          }
          await client.query('COMMIT');
          success = true;
          embeddedCount += batch.length;
          console.log(`  ✅ Embedded batch [${i + 1}-${i + batch.length}/${itemsToEmbed.length}] successfully.`);
        } catch (dbErr) {
          await client.query('ROLLBACK');
          throw dbErr;
        } finally {
          client.release();
        }
      } catch (err: any) {
        console.warn(`  ⚠️ Attempt ${attempts}/5 failed: ${err.message}. Retrying...`);
        await new Promise(r => setTimeout(r, Math.pow(2, attempts) * 1000));
      }
    }

    if (!success) {
      console.error(`❌ Batch starting at index ${i} failed permanently.`);
    }

    // 500ms throttle between batches to leave 80%+ API quota for user chat
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n✅ Pilot Ingestion Complete: ${embeddedCount} chunks inserted/updated in course_knowledge_chunks_v2.`);

  // 5. Run 15+ Labeled Query hit@5 Evaluation across PHY101, STA112, MTH101
  console.log('\n================================================================');
  console.log('🎯 Running Labeled Retrieval Hit@5 Evaluation (15 Test Cases)');
  console.log('================================================================\n');

  const testCases = [
    // PHY101
    { courseId: 'PHY101', query: "Newton's second law of motion and acceleration", expectedSubstring: "motion" },
    { courseId: 'PHY101', query: "Work energy theorem and kinetic energy", expectedSubstring: "energy" },
    { courseId: 'PHY101', query: "Rotational kinematics and angular momentum", expectedSubstring: "rotation" },
    { courseId: 'PHY101', query: "Vectors dot product and cross product", expectedSubstring: "vector" },
    { courseId: 'PHY101', query: "Simple harmonic motion and pendulum oscillations", expectedSubstring: "harmonic" },

    // STA112
    { courseId: 'STA112', query: "Bayes theorem and conditional probability", expectedSubstring: "bayes" },
    { courseId: 'STA112', query: "Binomial distribution and probability mass function", expectedSubstring: "binomial" },
    { courseId: 'STA112', query: "Combinatorics permutations and combinations", expectedSubstring: "combinatorics" },
    { courseId: 'STA112', query: "Expectation and variance of random variables", expectedSubstring: "variance" },
    { courseId: 'STA112', query: "Pigeonhole principle in probability", expectedSubstring: "pigeonhole" },

    // MTH101
    { courseId: 'MTH101', query: "Limits of functions and continuity", expectedSubstring: "limit" },
    { courseId: 'MTH101', query: "Derivatives product rule and chain rule", expectedSubstring: "derivative" },
    { courseId: 'MTH101', query: "Definite integrals and fundamental theorem of calculus", expectedSubstring: "integral" },
    { courseId: 'MTH101', query: "Complex numbers algebra and De Moivre theorem", expectedSubstring: "complex" },
    { courseId: 'MTH101', query: "Taylor series expansions and power series", expectedSubstring: "series" },
  ];

  let hits = 0;
  const evalResults: any[] = [];

  for (let idx = 0; idx < testCases.length; idx++) {
    const tc = testCases[idx];
    const embedRes = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: tc.query,
      config: {
        taskType: EMBEDDING_TASK_QUERY,
        outputDimensionality: EMBEDDING_DIMENSIONS
      }
    });

    const values = embedRes.embeddings?.[0]?.values || embedRes.embedding?.values;
    const vectorString = `[${values.join(',')}]`;

    const searchRes = await pool.query(`
      SELECT ckc.chunk_id, ckc.course_id, ckc.module_id, ckc.lesson_id, ckc.chunk_text,
             ROUND((1 - (ckc.embedding <=> $2::vector))::numeric, 4) as similarity
      FROM course_knowledge_chunks_v2 ckc
      WHERE ckc.course_id = $1 AND ckc.is_active IS TRUE
      ORDER BY ckc.embedding <=> $2::vector ASC
      LIMIT 5;
    `, [tc.courseId, vectorString]);

    const top5 = searchRes.rows;
    const isHit = top5.some(r => 
      r.chunk_text.toLowerCase().includes(tc.expectedSubstring.toLowerCase()) ||
      r.lesson_id.toLowerCase().includes(tc.expectedSubstring.toLowerCase())
    );

    if (isHit) hits++;

    evalResults.push({
      testNum: idx + 1,
      courseId: tc.courseId,
      query: tc.query,
      topResultChunk: top5[0]?.chunk_id || 'NONE',
      topSimilarity: top5[0]?.similarity || '0.0000',
      hitAt5: isHit ? '✅ HIT' : '❌ MISS'
    });
  }

  console.table(evalResults);
  console.log(`\n🎯 Hit@5 Evaluation Score: ${hits}/${testCases.length} (${((hits / testCases.length) * 100).toFixed(1)}% Hit Rate)`);

  process.exit(0);
}

runPilot().catch(err => {
  console.error(err);
  process.exit(1);
});
