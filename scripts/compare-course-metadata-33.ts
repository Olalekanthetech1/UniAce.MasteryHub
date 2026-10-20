import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function run() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!db || !pool) {
    console.error('DB missing');
    process.exit(1);
  }

  const snap = await db.collection('courses').get();
  console.log(`Read ${snap.size} Firestore course documents.`);

  const pgRes = await pool.query('SELECT * FROM courses ORDER BY id ASC');
  const pgMap = new Map(pgRes.rows.map(r => [r.id, r]));

  const discrepancies: any[] = [];
  const fullComparison: any[] = [];

  snap.forEach(doc => {
    const fs = doc.data();
    const id = doc.id;
    const pg = pgMap.get(id);

    // Derive Firestore scope
    let fsScope = fs.scope;
    if (!fsScope) {
      if (fs.faculties && Array.isArray(fs.faculties) && fs.faculties.length > 0 && fs.faculties[0] && fs.faculties[0] !== 'General') {
        fsScope = 'FACULTY';
      } else if (fs.faculty && fs.faculty !== 'General' && fs.faculty !== 'General Studies') {
        fsScope = 'FACULTY';
      } else {
        fsScope = 'DEPARTMENT';
      }
    }

    const fsFaculty = fs.faculty || (fs.faculties && fs.faculties[0]) || '';
    const fsDepartment = fs.department || (fs.departments && fs.departments[0]) || '';
    const fsSemester = fs.semester || '1st Semester';

    // Postgres derived values
    const pgFaculty = pg?.faculty || '';
    const pgDepartment = pg?.department || '';
    const pgSemester = pg?.semester === 'second' ? '2nd Semester' : (pg?.semester === 'first' ? '1st Semester' : pg?.semester || '1st Semester');
    
    // Derived scope for Postgres
    let pgScope = 'DEPARTMENT';
    if (pgFaculty && pgFaculty !== 'General' && pgFaculty !== 'General Studies' && pgFaculty !== 'GENERAL') {
      pgScope = 'FACULTY';
    }

    const item = {
      id,
      title: fs.title || id,
      fs: { scope: fsScope, faculty: fsFaculty, department: fsDepartment, semester: fsSemester },
      pg: { scope: pgScope, faculty: pgFaculty, department: pgDepartment, semester: pgSemester },
      match: fsScope === pgScope && fsFaculty === pgFaculty && fsDepartment === pgDepartment && fsSemester === pgSemester
    };

    fullComparison.push(item);
    if (!item.match) {
      discrepancies.push(item);
    }
  });

  console.log(`\n=== 33 COURSES METADATA COMPARISON SUMMARY ===`);
  console.log(`Total Courses Analyzed: ${fullComparison.length}`);
  console.log(`Exact Matches: ${fullComparison.length - discrepancies.length}`);
  console.log(`Discrepancies Count: ${discrepancies.length}`);

  console.log(`\n=== DETAILED 33-COURSE BREAKDOWN ===`);
  console.log(`Course ID | FS Scope | PG Scope | FS Faculty | PG Faculty | FS Dept | PG Dept | FS Sem | PG Sem | Match`);
  console.log(`---------------------------------------------------------------------------------------------------------`);
  fullComparison.forEach(c => {
    console.log(`${c.id.padEnd(9)} | ${c.fs.scope.padEnd(8)} | ${c.pg.scope.padEnd(8)} | ${c.fs.faculty.padEnd(10)} | ${c.pg.faculty.padEnd(10)} | ${c.fs.department.padEnd(12)} | ${c.pg.department.padEnd(12)} | ${c.fs.semester.padEnd(12)} | ${c.pg.semester.padEnd(12)} | ${c.match ? '✅' : '❌'}`);
  });

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
