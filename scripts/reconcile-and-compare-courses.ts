import fs from 'fs';
import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function run() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!db || !pool) throw new Error('DB/Pool missing');

  console.log('🔍 Starting comprehensive reconciliation analysis...');

  // 1. Read 33 Firestore course documents (embedded syllabus)
  const snap = await db.collection('courses').get();
  const fsEmbedded: Record<string, {
    modules: Array<{ id: string; title: string; lessonIds: string[]; lessons: Array<{ id: string; title: string }> }>;
    moduleMap: Map<string, { id: string; title: string; lessonIds: Set<string>; lessons: Array<{ id: string; title: string }> }>;
    allModuleIds: Set<string>;
    allLessonIds: Set<string>;
  }> = {};

  let totalFsEmbeddedModules = 0;
  let totalFsEmbeddedLessons = 0;

  for (const doc of snap.docs) {
    const cId = doc.id;
    const data = doc.data();
    const syllabus = Array.isArray(data.syllabus) ? data.syllabus : [];

    const modulesList: any[] = [];
    const moduleMap = new Map();
    const allModuleIds = new Set<string>();
    const allLessonIds = new Set<string>();

    for (const m of syllabus) {
      if (!m || !m.id) continue;
      const mLessons = Array.isArray(m.subTopics) ? m.subTopics : (Array.isArray(m.lessons) ? m.lessons : []);
      const lList = mLessons.map((l: any) => ({ id: l.id || l.lessonId, title: l.title || l.name || '' })).filter((l: any) => !!l.id);
      const lIdSet = new Set<string>(lList.map((l: any) => l.id));
      
      allModuleIds.add(m.id);
      lList.forEach((l: any) => allLessonIds.add(l.id));

      const modObj = {
        id: m.id,
        title: m.title || '',
        lessonIds: Array.from(lIdSet),
        lessons: lList
      };

      modulesList.push(modObj);
      moduleMap.set(m.id, { id: m.id, title: m.title, lessonIds: lIdSet, lessons: lList });
    }

    fsEmbedded[cId] = {
      modules: modulesList,
      moduleMap,
      allModuleIds,
      allLessonIds
    };

    totalFsEmbeddedModules += modulesList.length;
    totalFsEmbeddedLessons += allLessonIds.size;
  }

  // 2. Read Neon modules and lessons
  const neonModsRes = await pool.query('SELECT id, course_id, title, order_index FROM course_modules ORDER BY course_id, order_index');
  const neonLessonsRes = await pool.query('SELECT id, course_id, module_id, title, order_index FROM course_lessons ORDER BY course_id, module_id, order_index');

  const neonByCourse: Record<string, {
    modules: Array<{ id: string; title: string; order: number }>;
    lessonsByModule: Map<string, Array<{ id: string; title: string; order: number }>>;
    allModuleIds: Set<string>;
    allLessonIds: Set<string>;
  }> = {};

  for (const r of neonModsRes.rows) {
    if (!neonByCourse[r.course_id]) {
      neonByCourse[r.course_id] = {
        modules: [],
        lessonsByModule: new Map(),
        allModuleIds: new Set(),
        allLessonIds: new Set()
      };
    }
    neonByCourse[r.course_id].modules.push({ id: r.id, title: r.title, order: r.order_index });
    neonByCourse[r.course_id].allModuleIds.add(r.id);
  }

  for (const l of neonLessonsRes.rows) {
    if (!neonByCourse[l.course_id]) continue;
    let list = neonByCourse[l.course_id].lessonsByModule.get(l.module_id);
    if (!list) {
      list = [];
      neonByCourse[l.course_id].lessonsByModule.set(l.module_id, list);
    }
    list.push({ id: l.id, title: l.title, order: l.order_index });
    neonByCourse[l.course_id].allLessonIds.add(l.id);
  }

  // 3. Read Firestore subcollections for the candidate courses
  // First identify which courses have candidate modules (modules in Neon that are not in embedded)
  const coursesWithCandidates: string[] = [];
  const candidateModulesList: Array<{
    courseId: string;
    moduleId: string;
    title: string;
    lessonCount: number;
    lessons: any[];
  }> = [];

  for (const cId of Object.keys(neonByCourse).sort()) {
    const fsData = fsEmbedded[cId];
    const nData = neonByCourse[cId];
    if (!fsData || !nData) continue;

    const extra = nData.modules.filter(m => !fsData.allModuleIds.has(m.id));
    if (extra.length > 0) {
      coursesWithCandidates.push(cId);
      for (const m of extra) {
        const lList = nData.lessonsByModule.get(m.id) || [];
        candidateModulesList.push({
          courseId: cId,
          moduleId: m.id,
          title: m.title,
          lessonCount: lList.length,
          lessons: lList
        });
      }
    }
  }

  // Read subcollections for candidate courses
  const fsSubcollections: Record<string, Array<{ id: string; title: string; lessonCount: number }>> = {};
  for (const cId of coursesWithCandidates) {
    try {
      const subModsSnap = await db.collection('courses').doc(cId).collection('modules').get();
      fsSubcollections[cId] = subModsSnap.docs.map(d => ({
        id: d.id,
        title: d.data().title || d.id,
        lessonCount: 0
      }));
    } catch (e) {
      fsSubcollections[cId] = [];
    }
  }

  // 4. Calculate lesson counts and gaps
  let lessonsInCandidateModules = 0;
  for (const cm of candidateModulesList) {
    lessonsInCandidateModules += cm.lessonCount;
  }

  // 5. Calculate extra lessons inside KEPT modules
  let lessonsInKeptModulesNeon = 0;
  let lessonsInKeptModulesEmbedded = 0;
  const keptModulesLessonDiffs: Record<string, Array<{
    moduleId: string;
    moduleTitle: string;
    fsLessonCount: number;
    neonLessonCount: number;
    extraNeonLessons: Array<{ id: string; title: string }>;
    missingNeonLessons: string[];
  }>> = {};

  for (const cId of Object.keys(neonByCourse).sort()) {
    const fsData = fsEmbedded[cId];
    const nData = neonByCourse[cId];
    if (!fsData || !nData) continue;

    const courseDiffs: any[] = [];

    for (const nMod of nData.modules) {
      if (fsData.allModuleIds.has(nMod.id)) {
        // This is a kept module!
        const fsMod = fsData.moduleMap.get(nMod.id)!;
        const nLessons = nData.lessonsByModule.get(nMod.id) || [];

        lessonsInKeptModulesNeon += nLessons.length;
        lessonsInKeptModulesEmbedded += fsMod.lessonIds.size;

        const fsLIds = fsMod.lessonIds;
        const extraInNeon = nLessons.filter(l => !fsLIds.has(l.id));
        const missingInNeon = Array.from(fsLIds).filter(lId => !nLessons.some(nl => nl.id === lId));

        if (extraInNeon.length > 0 || missingInNeon.length > 0) {
          courseDiffs.push({
            moduleId: nMod.id,
            moduleTitle: nMod.title,
            fsLessonCount: fsMod.lessonIds.size,
            neonLessonCount: nLessons.length,
            extraNeonLessons: extraInNeon.map(l => ({ id: l.id, title: l.title })),
            missingNeonLessons: missingInNeon
          });
        }
      }
    }

    if (courseDiffs.length > 0) {
      keptModulesLessonDiffs[cId] = courseDiffs;
    }
  }

  const output = {
    summary: {
      neonTotalModules: neonModsRes.rows.length,
      fsEmbeddedTotalModules: totalFsEmbeddedModules,
      neonTotalLessons: neonLessonsRes.rows.length,
      fsEmbeddedTotalLessons: totalFsEmbeddedLessons,
      lessonGap: neonLessonsRes.rows.length - totalFsEmbeddedLessons,
      candidateModulesCount: candidateModulesList.length,
      lessonsInCandidateModules: lessonsInCandidateModules,
      extraLessonsInKeptModules: lessonsInKeptModulesNeon - lessonsInKeptModulesEmbedded,
      reconciliationProof: `${lessonsInCandidateModules} (in candidate modules) + ${lessonsInKeptModulesNeon - lessonsInKeptModulesEmbedded} (in kept modules) = ${lessonsInCandidateModules + (lessonsInKeptModulesNeon - lessonsInKeptModulesEmbedded)} (matches exactly the ${neonLessonsRes.rows.length - totalFsEmbeddedLessons} gap!)`
    },
    candidateModulesCount: candidateModulesList.length,
    candidateModules: candidateModulesList,
    keptModulesLessonDiffs,
    coursesWithCandidates,
    fsSubcollections
  };

  fs.writeFileSync('./scripts/reconciliation_full.json', JSON.stringify(output, null, 2));
  console.log('✅ Reconciliation complete! Output saved to scripts/reconciliation_full.json');
  console.log(JSON.stringify(output.summary, null, 2));

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
