import fs from 'fs';
import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function run() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!db || !pool) throw new Error('DB/Pool missing');

  const fullData = JSON.parse(fs.readFileSync('./scripts/reconciliation_full.json', 'utf8'));
  const candidateCourses = fullData.coursesWithCandidates; // 17 courses

  console.log('Analyzing 17 candidate courses in detail...');

  const detailedAnalysis: Record<string, any> = {};

  for (const cId of candidateCourses) {
    // 1. Embedded modules
    const cDoc = await db.collection('courses').doc(cId).get();
    const cData = cDoc.data() || {};
    const embeddedSyllabus = Array.isArray(cData.syllabus) ? cData.syllabus : [];
    const embeddedMods = embeddedSyllabus.map((m: any) => ({
      id: m.id,
      title: m.title,
      lessonCount: (m.subTopics || m.lessons || []).length
    }));

    // 2. Firestore subcollection modules
    const subSnap = await db.collection('courses').doc(cId).collection('modules').get();
    const subcollectionMods = subSnap.docs.map(d => ({
      id: d.id,
      title: d.data().title || d.id
    }));

    // 3. Neon modules
    const neonRes = await pool.query('SELECT id, title, order_index FROM course_modules WHERE course_id = $1 ORDER BY order_index', [cId]);
    const neonMods = neonRes.rows;

    const embeddedIdSet = new Set(embeddedMods.map(m => m.id));

    // 4. Classify each candidate module
    const candidates = neonMods.filter(nm => !embeddedIdSet.has(nm.id)).map(nm => {
      // Check if title or topic overlaps with any kept module
      const nmTitleLower = (nm.title || '').toLowerCase();
      let matchType: 'duplicate-draft' | 'unique-content' = 'unique-content';
      let matchedWith = '';

      for (const em of embeddedMods) {
        const emTitleLower = (em.title || '').toLowerCase();
        // check keyword overlap
        const words = nmTitleLower.split(/[\s,:\-_]+/).filter(w => w.length > 3 && !['module', 'introduction', 'advanced', 'course'].includes(w));
        const emWords = new Set(emTitleLower.split(/[\s,:\-_]+/).filter(w => w.length > 3));
        const matches = words.filter(w => emWords.has(w));
        if (matches.length >= 1 || (nmTitleLower.includes('mechanics') && emTitleLower.includes('mechanics')) || (nmTitleLower.includes('optics') && emTitleLower.includes('optics'))) {
          matchType = 'duplicate-draft';
          matchedWith = `${em.id}: "${em.title}" (overlap: ${matches.join(', ')})`;
          break;
        }
      }

      return {
        id: nm.id,
        title: nm.title,
        order: nm.order_index,
        classification: matchType,
        matchedWithKept: matchedWith || 'None (no title overlap with kept modules)'
      };
    });

    detailedAnalysis[cId] = {
      courseId: cId,
      embeddedModulesCount: embeddedMods.length,
      embeddedModules: embeddedMods,
      subcollectionModulesCount: subcollectionMods.length,
      subcollectionModules: subcollectionMods,
      neonModulesCount: neonMods.length,
      neonCandidateCount: candidates.length,
      candidateModules: candidates
    };
  }

  fs.writeFileSync('./scripts/candidate_modules_breakdown.json', JSON.stringify(detailedAnalysis, null, 2));
  console.log('✅ Detailed breakdown saved to scripts/candidate_modules_breakdown.json');

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
