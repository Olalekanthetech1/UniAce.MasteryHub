import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { getPostgresPool } from '../server/postgresPool';
import { generateChunkId } from '../server/utils/chunkId';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_TASK_DOCUMENT } from '../server/constants/embeddings';

dotenv.config({ override: process.env.NODE_ENV !== 'production' });

const PILOT_COURSES = ['PHY101', 'STA112', 'MTH101'];
const CHUNK_SIZE_CHARS = 1500;
const BATCH_SIZE = 25;
const DAILY_CAP = 700;

async function checkAndIncrementCap(client: any, countToIncrement: number = 0): Promise<{ allowed: boolean; requestsToday: number; dailyCap: number; pacificDate: string }> {
  // Query Pacific Date
  const dateRes = await client.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date as pacific_date");
  const pacificDate = dateRes.rows[0].pacific_date;

  const rowRes = await client.query(
    'SELECT requests_today, daily_cap, daily_date FROM rag_ingestion_progress WHERE id = $1 FOR UPDATE',
    ['daily_cap_tracker']
  );

  let requestsToday = 0;
  if (rowRes.rows.length === 0) {
    await client.query(
      `INSERT INTO rag_ingestion_progress (id, daily_date, requests_today, daily_cap, updated_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      ['daily_cap_tracker', pacificDate, 0, DAILY_CAP]
    );
    requestsToday = 0;
  } else {
    const row = rowRes.rows[0];
    const storedDate = row.daily_date.toISOString().split('T')[0];
    const currentDate = pacificDate.toISOString().split('T')[0];
    if (storedDate !== currentDate) {
      // New Pacific day reset
      await client.query(
        'UPDATE rag_ingestion_progress SET daily_date = $1, requests_today = 0, updated_at = NOW() WHERE id = $2',
        [pacificDate, 'daily_cap_tracker']
      );
      requestsToday = 0;
    } else {
      requestsToday = row.requests_today;
    }
  }

  if (requestsToday + countToIncrement > DAILY_CAP) {
    return { allowed: false, requestsToday, dailyCap: DAILY_CAP, pacificDate: pacificDate.toISOString().split('T')[0] };
  }

  if (countToIncrement > 0) {
    await client.query(
      'UPDATE rag_ingestion_progress SET requests_today = requests_today + $1, updated_at = NOW() WHERE id = $2',
      [countToIncrement, 'daily_cap_tracker']
    );
    requestsToday += countToIncrement;
  }

  return { allowed: true, requestsToday, dailyCap: DAILY_CAP, pacificDate: pacificDate.toISOString().split('T')[0] };
}

async function runMissingIngestion() {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Postgres pool unavailable');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing in environment');
  const ai = new GoogleGenAI({ apiKey });

  console.log('================================================================');
  console.log('🚀 Missing-Lesson Anti-Join Ingestion: PHY101, STA112, MTH101');
  console.log('================================================================\n');

  // Verify Daily Cap first
  const capCheckClient = await pool.connect();
  let capStatus: any;
  try {
    await capCheckClient.query('BEGIN');
    capStatus = await checkAndIncrementCap(capCheckClient, 0);
    await capCheckClient.query('COMMIT');
  } finally {
    capCheckClient.release();
  }

  console.log(`📊 Pacific Date: ${capStatus.pacificDate} | Requests Today: ${capStatus.requestsToday} / ${capStatus.dailyCap} (Allowed: ${capStatus.allowed})\n`);
  if (!capStatus.allowed) {
    console.error('❌ Daily ingestion cap reached for Pacific Date. Halting ingestion.');
    process.exit(1);
  }

  // Identify modules with both lX and mX-lY to enforce the per-module rule
  const dupModulesRes = await pool.query(`
    SELECT course_id, module_id
    FROM course_lessons
    WHERE course_id = ANY($1::text[])
    GROUP BY course_id, module_id
    HAVING COUNT(CASE WHEN id ~ '^l[0-9]+$' THEN 1 END) > 0
       AND COUNT(CASE WHEN id ~ '^m[0-9]+-l[0-9]+$' THEN 1 END) > 0
  `, [PILOT_COURSES]);

  const modulesWithStandardAndLegacy = new Set<string>();
  for (const r of dupModulesRes.rows) {
    modulesWithStandardAndLegacy.add(`${r.course_id}:${r.module_id}`);
  }

  // Load course and module titles
  const coursesRes = await pool.query('SELECT id, title FROM courses WHERE id = ANY($1::text[])', [PILOT_COURSES]);
  const courseMap = new Map<string, string>();
  for (const c of coursesRes.rows) courseMap.set(c.id, c.title);

  const modulesRes = await pool.query('SELECT id, course_id, title, is_archived FROM course_modules WHERE course_id = ANY($1::text[])', [PILOT_COURSES]);
  const moduleMap = new Map<string, any>();
  for (const m of modulesRes.rows) moduleMap.set(`${m.course_id}:${m.id}`, m);

  // Load lessons
  const lessonsRes = await pool.query(`
    SELECT l.id, l.course_id, l.module_id, l.title, l.content_markdown
    FROM course_lessons l
    WHERE l.course_id = ANY($1::text[])
    ORDER BY l.course_id, l.module_id, l.order_index ASC
  `, [PILOT_COURSES]);

  // Construct expected chunks with per-module legacy skipping rule
  const expectedChunks: Array<{
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

  let skippedLegacyCount = 0;

  for (const l of lessonsRes.rows) {
    const modKey = `${l.course_id}:${l.module_id}`;
    const isLegacyId = /^l[0-9]+$/.test(l.id);

    // Per-module rule: Skip lX only when mX-lY exists in that module!
    if (isLegacyId && modulesWithStandardAndLegacy.has(modKey)) {
      skippedLegacyCount++;
      continue;
    }

    const content = (l.content_markdown || '').trim();
    if (!content) continue;

    const mod = moduleMap.get(modKey);
    const isArchived = mod ? Boolean(mod.is_archived) : false;
    const courseTitle = courseMap.get(l.course_id) || l.course_id;
    const moduleTitle = mod ? mod.title : l.module_id;
    const prefix = `${l.course_id} ${courseTitle} – ${moduleTitle} – ${l.title}`;

    const numChunks = Math.max(1, Math.ceil(content.length / CHUNK_SIZE_CHARS));
    for (let idx = 0; idx < numChunks; idx++) {
      const start = idx * CHUNK_SIZE_CHARS;
      const rawChunkText = content.substring(start, start + CHUNK_SIZE_CHARS);
      const prefixedText = `${prefix}\n\n${rawChunkText}`;
      const chunkId = generateChunkId(l.course_id, l.module_id, l.id, idx);
      const contentHash = crypto.createHash('sha256').update(prefixedText).digest('hex');
      const tokenCount = Math.ceil(prefixedText.length / 4);

      expectedChunks.push({
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

  console.log(`📦 Total Expected Chunks (excluding ${skippedLegacyCount} legacy duplicates in shadowed modules): ${expectedChunks.length}`);

  // Anti-join against course_knowledge_chunks_v2
  const existingRes = await pool.query(`
    SELECT chunk_id, content_hash
    FROM course_knowledge_chunks_v2
    WHERE course_id = ANY($1::text[])
  `, [PILOT_COURSES]);

  const existingHashMap = new Map<string, string>();
  for (const r of existingRes.rows) {
    existingHashMap.set(r.chunk_id, r.content_hash);
  }

  const missingChunks = expectedChunks.filter(c => {
    const existingHash = existingHashMap.get(c.chunkId);
    return !existingHash || existingHash !== c.contentHash;
  });

  console.log(`🔍 Anti-Join Found: ${existingRes.rows.length} existing in v2, ${missingChunks.length} missing/stale to embed.\n`);

  if (missingChunks.length === 0) {
    console.log('✨ All pilot course chunks are already up to date in course_knowledge_chunks_v2!');
    process.exit(0);
  }

  // Check how many calls will be required
  const callsNeeded = Math.ceil(missingChunks.length / BATCH_SIZE);
  console.log(`⚡ Will execute ${callsNeeded} API calls (Batch size: ${BATCH_SIZE}) with Gemini 768-dim embeddings.\n`);

  let totalEmbedded = 0;

  for (let i = 0; i < missingChunks.length; i += BATCH_SIZE) {
    const batch = missingChunks.slice(i, i + BATCH_SIZE);
    const textsToEmbed = batch.map(b => b.prefixedText);

    // Atomically increment cap counter by 1 request
    const capClient = await pool.connect();
    try {
      await capClient.query('BEGIN');
      const check = await checkAndIncrementCap(capClient, 1);
      if (!check.allowed) {
        await capClient.query('ROLLBACK');
        console.warn(`🛑 Ingestion cap reached: ${check.requestsToday}/${check.dailyCap}. Halting gracefully.`);
        break;
      }
      await capClient.query('COMMIT');
    } finally {
      capClient.release();
    }

    let attempts = 0;
    let success = false;

    while (attempts < 3 && !success) {
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
          throw new Error(`Embedding count mismatch: expected ${batch.length}, got ${rawEmbeddings.length}`);
        }

        const dbClient = await pool.connect();
        try {
          await dbClient.query('BEGIN');
          for (let j = 0; j < batch.length; j++) {
            const item = batch[j];
            const values = rawEmbeddings[j].values;
            if (!values || values.length !== 768) {
              throw new Error(`Invalid dimensions for chunk ${item.chunkId}`);
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

            await dbClient.query(`
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
          await dbClient.query('COMMIT');
          success = true;
          totalEmbedded += batch.length;
          console.log(`  ✅ Embedded batch [${i + 1}-${i + batch.length}/${missingChunks.length}] into v2.`);
        } catch (dbErr) {
          await dbClient.query('ROLLBACK');
          throw dbErr;
        } finally {
          dbClient.release();
        }
      } catch (err: any) {
        console.warn(`  ⚠️ Attempt ${attempts} failed: ${err.message}. Waiting before retry...`);
        await new Promise(r => setTimeout(r, 2000 * attempts));
      }
    }

    if (!success) {
      console.error(`❌ Batch starting at ${i} permanently failed.`);
    }

    // 400ms pause to ensure smooth quota utilization
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n🎉 Anti-Join Ingestion Finished! Successfully embedded ${totalEmbedded} missing chunks into v2.`);

  process.exit(0);
}

runMissingIngestion().catch(err => {
  console.error('Fatal ingestion error:', err);
  process.exit(1);
});
