import { getPostgresPool } from '../server/postgresPool';

async function analyzeIngestionPlan() {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Database pool unavailable');

  console.log('================================================================');
  console.log('📊 RAG Re-Ingestion Plan & Coverage Audit (All 33 Published Courses)');
  console.log('================================================================\n');

  // 1. Fetch all modules and lessons
  const coursesRes = await pool.query('SELECT id, title FROM courses WHERE status = \'published\' ORDER BY id ASC');
  const courses = coursesRes.rows;

  const modulesRes = await pool.query('SELECT id, course_id, title, is_archived FROM course_modules ORDER BY course_id, order_index ASC');
  const modulesMap = new Map<string, any>();
  for (const m of modulesRes.rows) {
    modulesMap.set(`${m.course_id}:${m.id}`, m);
  }

  const lessonsRes = await pool.query(`
    SELECT l.id, l.course_id, l.module_id, l.title, 
           LENGTH(COALESCE(l.content_markdown, '')) as char_len,
           COALESCE(l.content_markdown, '') as content
    FROM course_lessons l
    ORDER BY l.course_id, l.module_id, l.order_index ASC
  `);

  let totalActiveLessons = 0;
  let activeLessonsWithContent = 0;
  let activeLessonsNoContent = 0;
  let totalArchivedLessons = 0;

  const emptyLessons: Array<{ courseId: string; moduleId: string; lessonId: string; title: string }> = [];
  const courseCoverage: Array<{
    courseId: string;
    activeModules: number;
    activeLessonsWithContent: number;
    emptyLessons: number;
    estimatedChunks: number;
    estimatedTokens: number;
  }> = [];

  const CHUNK_SIZE_CHARS = 1500; // ~300-400 words per chunk

  let totalEstimatedChunks = 0;
  let totalEstimatedTokens = 0;

  for (const c of courses) {
    const courseId = c.id;
    let cActiveMods = 0;
    let cWithContent = 0;
    let cEmpty = 0;
    let cChunks = 0;
    let cTokens = 0;

    const courseLessons = lessonsRes.rows.filter(l => l.course_id === courseId);

    for (const l of courseLessons) {
      const modKey = `${courseId}:${l.module_id}`;
      const mod = modulesMap.get(modKey);
      const isArchived = mod ? Boolean(mod.is_archived) : false;

      if (isArchived) {
        totalArchivedLessons++;
        continue;
      }

      totalActiveLessons++;
      const textLen = l.char_len;

      if (textLen === 0) {
        activeLessonsNoContent++;
        cEmpty++;
        emptyLessons.push({ courseId, moduleId: l.module_id, lessonId: l.id, title: l.title });
      } else {
        activeLessonsWithContent++;
        cWithContent++;

        // Estimate chunks and tokens
        const numChunks = Math.max(1, Math.ceil(textLen / CHUNK_SIZE_CHARS));
        const estTokens = Math.ceil(textLen / 4);

        cChunks += numChunks;
        cTokens += estTokens;
      }
    }

    // Count active modules for course
    const courseMods = modulesRes.rows.filter(m => m.course_id === courseId && !m.is_archived);
    cActiveMods = courseMods.length;

    totalEstimatedChunks += cChunks;
    totalEstimatedTokens += cTokens;

    courseCoverage.push({
      courseId,
      activeModules: cActiveMods,
      activeLessonsWithContent: cWithContent,
      emptyLessons: cEmpty,
      estimatedChunks: cChunks,
      estimatedTokens: cTokens
    });
  }

  console.log('--- COVERAGE SUMMARY PER COURSE ---');
  console.table(courseCoverage);

  console.log('\n--- LESSONS WITH NO CONTENT (ACTIVE MODULES) ---');
  console.table(emptyLessons);

  console.log('\n================================================================');
  console.log('TOTALS & INGESTION STATS:');
  console.log(`• Total Published Courses: ${courses.length}`);
  console.log(`• Total Active Lessons: ${totalActiveLessons} (${activeLessonsWithContent} with text, ${activeLessonsNoContent} empty)`);
  console.log(`• Total Archived Lessons Excluded: ${totalArchivedLessons}`);
  console.log(`• Total Estimated Vector Chunks: ${totalEstimatedChunks}`);
  console.log(`• Total Estimated Tokens: ${totalEstimatedTokens.toLocaleString()}`);
  console.log(`• Total Gemini Embedding API Calls: ${totalEstimatedChunks}`);
  console.log('================================================================\n');

  process.exit(0);
}

analyzeIngestionPlan().catch(err => {
  console.error(err);
  process.exit(1);
});
