import fs from 'fs';
import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function run() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!db || !pool) {
    console.error('DB missing');
    process.exit(1);
  }

  const coursesSnap = await db.collection('courses').get();
  const fsCourseSyllabus: Record<string, { modules: string[]; lessons: string[]; moduleTitleMap: Record<string, string> }> = {};

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

    fsCourseSyllabus[courseId] = { modules: moduleIds, lessons: lessonIds, moduleTitleMap };
  }

  const neonModulesRes = await pool.query(`
    SELECT id, course_id, title, order_index
    FROM course_modules
    ORDER BY course_id, order_index ASC
  `);

  const neonLessonsRes = await pool.query(`
    SELECT id, course_id, module_id, title, order_index
    FROM course_lessons
    ORDER BY course_id, module_id, order_index ASC
  `);

  const archiveCandidates: Array<{
    courseId: string;
    moduleId: string;
    moduleTitle: string;
    lessonCount: number;
    lessons: Array<{ id: string; title: string }>;
  }> = [];

  const neonByCourse: Record<string, any[]> = {};
  for (const m of neonModulesRes.rows) {
    if (!neonByCourse[m.course_id]) neonByCourse[m.course_id] = [];
    neonByCourse[m.course_id].push(m);
  }

  const lessonsByModule: Record<string, any[]> = {};
  for (const l of neonLessonsRes.rows) {
    const key = `${l.course_id}:${l.module_id}`;
    if (!lessonsByModule[key]) lessonsByModule[key] = [];
    lessonsByModule[key].push(l);
  }

  for (const cId of Object.keys(neonByCourse).sort()) {
    const fsMods = new Set(fsCourseSyllabus[cId]?.modules || []);
    const nMods = neonByCourse[cId];

    for (const m of nMods) {
      if (!fsMods.has(m.id)) {
        const key = `${cId}:${m.id}`;
        const lessons = lessonsByModule[key] || [];
        archiveCandidates.push({
          courseId: cId,
          moduleId: m.id,
          moduleTitle: m.title,
          lessonCount: lessons.length,
          lessons: lessons.map(l => ({ id: l.id, title: l.title }))
        });
      }
    }
  }

  console.log(`=== TOTAL ARCHIVE CANDIDATES: ${archiveCandidates.length} MODULES ===\n`);

  fs.writeFileSync('./scripts/archive_candidates.json', JSON.stringify(archiveCandidates, null, 2));

  let outputStr = '';
  archiveCandidates.forEach((ac, idx) => {
    outputStr += `${idx + 1}. [${ac.courseId}] Module: ${ac.moduleId} | "${ac.moduleTitle}" (${ac.lessonCount} lessons)\n`;
    if (ac.lessons.length > 0) {
      ac.lessons.forEach(l => {
        outputStr += `   - Lesson: ${l.id} | "${l.title}"\n`;
      });
    }
  });

  console.log(outputStr);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
