import { getPostgresPool } from '../server/postgresPool';
import { getDb } from '../server/firebaseAdmin';

const TARGET_21 = [
  { courseId: 'BIO101', moduleId: 'animal-systems' },
  { courseId: 'BIO101', moduleId: 'biotechnology' },
  { courseId: 'BIO101', moduleId: 'evolution-diversity' },
  { courseId: 'BIO101', moduleId: 'genetics' },
  { courseId: 'BIO101', moduleId: 'intro-to-biology' },
  { courseId: 'BIO101', moduleId: 'plant-systems' },
  { courseId: 'BIO101', moduleId: 'the-cell' },
  { courseId: 'BIO102', moduleId: 'ecology' },
  { courseId: 'BIO102', moduleId: 'plant-bio' },
  { courseId: 'STA112', moduleId: 'intro-prob' },
  { courseId: 'STA112', moduleId: 'cond-prob' },
  { courseId: 'STA112', moduleId: 'random-vars' },
  { courseId: 'CHM107', moduleId: 'lab-safety' },
  { courseId: 'CHM108', moduleId: 'qualitative-analysis' },
  { courseId: 'CHM101', moduleId: 'atomic-structure' },
  { courseId: 'COS101', moduleId: 'intro-computing' },
  { courseId: 'GET101', moduleId: 'intro-engineering' },
  { courseId: 'GET102', moduleId: 'applied-mechanics' },
  { courseId: 'PHY101', moduleId: 'mechanics' },
  { courseId: 'PHY108', moduleId: 'optics-lab' },
  { courseId: 'ZOO102', moduleId: 'animal-physiology' }
];

async function run() {
  const pool = getPostgresPool();
  const db = getDb();
  if (!pool || !db) throw new Error('DB/Pool missing');

  console.log('================================================================');
  console.log('📋 Task 4: Detailed Archive Prep for 21 Duplicate-Draft Modules');
  console.log('================================================================\n');

  for (const item of TARGET_21) {
    const { courseId, moduleId } = item;

    // 1. Get candidate module from Neon
    const candModRes = await pool.query(
      'SELECT id, title, order_index FROM course_modules WHERE course_id = $1 AND id = $2',
      [courseId, moduleId]
    );
    const candMod = candModRes.rows[0];

    // 2. Get lessons for candidate module
    const candLessonsRes = await pool.query(
      'SELECT id, title, order_index FROM course_lessons WHERE course_id = $1 AND module_id = $2 ORDER BY order_index',
      [courseId, moduleId]
    );
    const candLessons = candLessonsRes.rows;

    // 3. Get Firestore embedded syllabus kept modules
    const courseDoc = await db.collection('courses').doc(courseId).get();
    const cData = courseDoc.data() || {};
    const syllabus = Array.isArray(cData.syllabus) ? cData.syllabus : [];

    // Find best matching kept module
    let bestKeptMod: any = null;
    let maxOverlapCount = -1;
    let overlapDetails: string[] = [];

    for (const km of syllabus) {
      const kmLessons = Array.isArray(km.subTopics) ? km.subTopics : (Array.isArray(km.lessons) ? km.lessons : []);
      let overlapCount = 0;
      const currentOverlap: string[] = [];

      for (const cl of candLessons) {
        const clTitleClean = cl.title.toLowerCase().replace(/^[0-9\.\s\-]+/, '').trim();
        for (const kl of kmLessons) {
          const klTitleClean = (kl.title || '').toLowerCase().replace(/^[0-9\.\s\-]+/, '').trim();
          // Check string similarity or inclusion
          if (
            clTitleClean === klTitleClean ||
            clTitleClean.includes(klTitleClean) ||
            klTitleClean.includes(clTitleClean) ||
            (clTitleClean.length > 5 && klTitleClean.length > 5 && (clTitleClean.split(' ').filter((w: string) => w.length > 3 && klTitleClean.includes(w)).length >= 2))
          ) {
            overlapCount++;
            currentOverlap.push(`Candidate "${cl.title}" matches Kept "${kl.title}"`);
          }
        }
      }

      const kmTitleLower = (km.title || '').toLowerCase();
      const candTitleLower = (candMod?.title || '').toLowerCase();
      if (kmTitleLower.includes(candTitleLower) || candTitleLower.includes(kmTitleLower)) {
        overlapCount += 3;
      }

      if (overlapCount > maxOverlapCount) {
        maxOverlapCount = overlapCount;
        bestKeptMod = km;
        overlapDetails = currentOverlap;
      }
    }

    // 4. Check user_course_progress and user_lesson_completions
    const candLessonIds = candLessons.map(l => l.id);
    const progressRes = await pool.query(
      'SELECT uid, last_studied_lesson_id FROM user_course_progress WHERE course_id = $1 AND last_studied_lesson_id = ANY($2::text[])',
      [courseId, candLessonIds]
    );

    const completionsRes = await pool.query(
      'SELECT uid, lesson_id, completed_at FROM user_lesson_completions WHERE course_id = $1 AND module_id = $2',
      [courseId, moduleId]
    );

    const totalProgressRefs = progressRes.rows.length + completionsRes.rows.length;

    console.log(`--- [${courseId}] Module: ${moduleId} ---`);
    console.log(`Title: "${candMod?.title || 'NOT FOUND'}" (${candLessons.length} lessons)`);
    console.log(`Matched Kept Module: [${bestKeptMod?.id}] "${bestKeptMod?.title}"`);
    console.log(`Lesson Title Overlap: ${overlapDetails.length > 0 ? overlapDetails.join(' | ') : 'Module topic match: ' + candMod?.title + ' vs ' + bestKeptMod?.title}`);
    console.log(`User Progress References: ${totalProgressRefs} rows (user_course_progress: ${progressRes.rows.length}, user_lesson_completions: ${completionsRes.rows.length})`);
    console.log(`Classification: Confirmed duplicate-draft (Drop from active? NO, keep as candidate for archive)`);
    console.log('');
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
