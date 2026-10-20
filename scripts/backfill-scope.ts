import { getPostgresPool } from '../server/postgresPool';
import { getDb } from '../server/firebaseAdmin';

async function run() {
  const pool = getPostgresPool();
  const db = getDb();
  if (!pool || !db) throw new Error('DB/Pool missing');

  // 1. Add additive column
  await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS scope VARCHAR(50);');
  console.log('✅ Column courses.scope ensured.');

  // 2. Fetch all Firestore courses
  const snap = await db.collection('courses').get();
  console.log(`Read ${snap.size} courses from Firestore.`);

  const results: any[] = [];

  for (const doc of snap.docs) {
    const fsData = doc.data();
    const courseId = doc.id;
    // Pure Firestore scope, matching what's in doc.data().scope
    const fsScope = fsData.scope || (fsData.faculties && fsData.faculties.length > 0 && fsData.faculties[0] !== 'General' ? 'FACULTY' : (fsData.department ? 'DEPARTMENT' : 'GLOBAL'));
    
    // Check Neon before
    const beforeRes = await pool.query('SELECT scope, faculty, department FROM courses WHERE id = $1', [courseId]);
    const beforeScope = beforeRes.rows[0]?.scope || null;

    // Update
    await pool.query('UPDATE courses SET scope = $1 WHERE id = $2', [fsScope, courseId]);

    // Check Neon after
    const afterRes = await pool.query('SELECT scope FROM courses WHERE id = $1', [courseId]);
    const afterScope = afterRes.rows[0]?.scope;

    results.push({
      id: courseId,
      fsRawScope: fsData.scope || '(none)',
      fsResolvedScope: fsScope,
      neonBefore: beforeScope ?? '(null)',
      neonAfter: afterScope,
      firestoreFaculty: fsData.faculty || (fsData.faculties ? fsData.faculties.join(', ') : ''),
      firestoreDept: fsData.department || (fsData.departments ? fsData.departments.join(', ') : '')
    });
  }

  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
