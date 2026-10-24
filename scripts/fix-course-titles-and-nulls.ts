import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function fixCoursesAndCompare() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!pool || !db) throw new Error('Pool or DB unavailable');

  console.log('=== FIXING STRAY QUOTE & NULLS IN NEON COURSES ===\n');

  // Fix AGE102 stray quote
  await pool.query(`
    UPDATE courses 
    SET title = 'AGE 102: Introduction to Agricultural Engineering', updated_at = NOW() 
    WHERE id = 'AGE102' AND title LIKE '%"%';
  `);

  // Fix null departments / faculties / scopes based on course codes
  const courseFixes: Array<{ id: string; dept: string; faculty: string; scope: string }> = [
    { id: 'AGE102', dept: 'Agricultural and Bio-Resources Engineering', faculty: 'Engineering', scope: 'DEPARTMENT' },
    { id: 'MTH101', dept: 'Mathematics', faculty: 'Sciences', scope: 'DEPARTMENT' },
    { id: 'MTH103', dept: 'Mathematics', faculty: 'Sciences', scope: 'DEPARTMENT' },
    { id: 'PHY101', dept: 'Physics', faculty: 'Sciences', scope: 'DEPARTMENT' },
    { id: 'CHM101', dept: 'Chemistry', faculty: 'Sciences', scope: 'DEPARTMENT' },
    { id: 'COS101', dept: 'Computer Science', faculty: 'Sciences', scope: 'DEPARTMENT' },
    { id: 'GST111', dept: 'General Studies', faculty: 'General Studies', scope: 'GLOBAL' }
  ];

  for (const fix of courseFixes) {
    await pool.query(
      `UPDATE courses 
       SET department = COALESCE(department, $2),
           faculty = COALESCE(faculty, $3),
           scope = COALESCE(scope, $4),
           updated_at = NOW()
       WHERE id = $1;`,
      [fix.id, fix.dept, fix.faculty, fix.scope]
    );
  }

  console.log('=== ITEM A: ALL 33 COURSES (NEON vs FIRESTORE) ===\n');

  const pgRes = await pool.query(`
    SELECT id, COALESCE(department, 'N/A') as department, COALESCE(faculty, 'N/A') as faculty, COALESCE(scope, 'DEPARTMENT') as scope, title 
    FROM courses 
    ORDER BY id ASC;
  `);

  const fsSnap = await db.collection('courses').get();
  const fsMap = new Map();
  fsSnap.docs.forEach(doc => fsMap.set(doc.id, doc.data()));

  console.log(`%-10s | %-12s | %-12s | %-45s | %-45s`, 'ID', 'NEON SCOPE', 'FS SCOPE', 'NEON TITLE', 'FS TITLE');
  console.log('-'.repeat(130));

  for (const row of pgRes.rows) {
    const fsDoc = fsMap.get(row.id) || {};
    const fsTitle = fsDoc.title || fsDoc.courseTitle || 'MISSING IN FS';
    const fsScope = fsDoc.scope || 'N/A';

    console.log(
      `${row.id.padEnd(10)} | ${row.scope.padEnd(12)} | ${fsScope.padEnd(12)} | ${row.title.slice(0, 43).padEnd(45)} | ${String(fsTitle).slice(0, 43).padEnd(45)}`
    );
  }

  await pool.end();
}

fixCoursesAndCompare().catch(console.error);
