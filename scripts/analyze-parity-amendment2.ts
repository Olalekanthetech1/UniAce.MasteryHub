import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function run() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!db || !pool) {
    console.error('Database connection missing');
    process.exit(1);
  }

  // Read 33 course docs once from Firestore
  const coursesSnap = await db.collection('courses').get();
  console.log(`Read ${coursesSnap.docs.length} course documents from Firestore.`);

  const fsCourseSyllabus: Record<string, { modules: string[]; lessons: string[]; moduleTitleMap: Record<string, string> }> = {};
  let totalFsModules = 0;
  let totalFsLessons = 0;

  for (const doc of coursesSnap.docs) {
    const data = doc.data();
    const courseId = doc.id;
    const modulesArr = data.syllabus || data.modules || [];
    const moduleIds: string[] = [];
    const lessonIds: string[] = [];
    const moduleTitleMap: Record<string, string> = {};

    if (Array.isArray(modulesArr)) {
      for (const m of modulesArr) {
        if (!m || typeof m !== 'object') continue;
        const mId = m.id || m.moduleId;
        if (mId) {
          moduleIds.push(mId);
          moduleTitleMap[mId] = m.title || m.name || mId;
        }
        const lessons = m.lessons || m.topics || m.subtopics || [];
        if (Array.isArray(lessons)) {
          for (const l of lessons) {
            if (!l || typeof l !== 'object') continue;
            const lId = l.id || l.lessonId;
            if (lId) lessonIds.push(lId);
          }
        }
      }
    }

    fsCourseSyllabus[courseId] = {
      modules: moduleIds,
      lessons: lessonIds,
      moduleTitleMap
    };
    totalFsModules += moduleIds.length;
    totalFsLessons += lessonIds.length;
  }

  // Query Neon course_modules and course_lessons per course
  const neonModulesRes = await pool.query(`
    SELECT id, course_id, title, order_index, is_archived, created_at
    FROM course_modules
    ORDER BY course_id, order_index ASC
  `);

  const neonLessonsRes = await pool.query(`
    SELECT id, course_id, module_id, title, order_index
    FROM course_lessons
    ORDER BY course_id, module_id, order_index ASC
  `);

  const completionsRes = await pool.query(`
    SELECT DISTINCT module_id, lesson_id
    FROM user_lesson_completions
  `);

  const progressModuleIds = new Set<string>();
  const progressLessonIds = new Set<string>();

  for (const r of completionsRes.rows) {
    if (r.module_id) progressModuleIds.add(r.module_id);
    if (r.lesson_id) progressLessonIds.add(r.lesson_id);
  }

  // Group Neon by course
  const neonByCourse: Record<string, { modules: any[]; lessons: any[] }> = {};
  for (const m of neonModulesRes.rows) {
    if (!neonByCourse[m.course_id]) neonByCourse[m.course_id] = { modules: [], lessons: [] };
    neonByCourse[m.course_id].modules.push(m);
  }
  for (const l of neonLessonsRes.rows) {
    if (!neonByCourse[l.course_id]) neonByCourse[l.course_id] = { modules: [], lessons: [] };
    neonByCourse[l.course_id].lessons.push(l);
  }

  console.log('\n=== PER COURSE SYLLABUS COMPARISON ===');
  console.log(`Course ID | FS Modules | Neon Modules | FS Lessons | Neon Lessons | Extra Neon Modules`);
  console.log('-------------------------------------------------------------------------------------');

  const extraModulesList: Array<{ courseId: string; moduleId: string; title: string; hasProgress: boolean; lessonCount: number; extraLessons: string[] }> = [];

  const allCourseIds = Array.from(new Set([...Object.keys(fsCourseSyllabus), ...Object.keys(neonByCourse)])).sort();

  for (const cId of allCourseIds) {
    const fsData = fsCourseSyllabus[cId] || { modules: [], lessons: [], moduleTitleMap: {} };
    const neonData = neonByCourse[cId] || { modules: [], lessons: [] };

    const fsModSet = new Set(fsData.modules);
    const extraNeonMods = neonData.modules.filter(m => !fsModSet.has(m.id));

    for (const em of extraNeonMods) {
      const emLessons = neonData.lessons.filter(l => l.module_id === em.id);
      extraModulesList.push({
        courseId: cId,
        moduleId: em.id,
        title: em.title,
        hasProgress: progressModuleIds.has(em.id) || emLessons.some(l => progressLessonIds.has(l.id)),
        lessonCount: emLessons.length,
        extraLessons: emLessons.map(l => l.id)
      });
    }

    console.log(`${cId.padEnd(10)} | ${String(fsData.modules.length).padStart(10)} | ${String(neonData.modules.length).padStart(12)} | ${String(fsData.lessons.length).padStart(10)} | ${String(neonData.lessons.length).padStart(12)} | ${extraNeonMods.length}`);
  }

  console.log('\n=== SUMMARY TOTALS ===');
  console.log(`Firestore Embedded Syllabus Total: ${totalFsModules} modules, ${totalFsLessons} lessons`);
  console.log(`Neon Database Total: ${neonModulesRes.rows.length} modules, ${neonLessonsRes.rows.length} lessons`);
  console.log(`Extra Neon Modules (Candidates for Archiving): ${extraModulesList.length}`);

  console.log('\n=== MODULES SLATED FOR ARCHIVING (NO DB UPDATES PERFORMED) ===');
  for (const em of extraModulesList) {
    console.log(`- Course: ${em.courseId.padEnd(10)} | Module ID: ${em.moduleId.padEnd(35)} | Title: "${em.title}" | Lessons: ${em.lessonCount} | User Progress Exists: ${em.hasProgress}`);
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
