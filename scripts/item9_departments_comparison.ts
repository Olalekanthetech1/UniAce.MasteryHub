import { getPostgresPool } from '../server/postgresPool';

async function compareDepartments() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  console.log('=== ITEM 9: COURSE DEPARTMENTS VS 29 INSTITUTION NAMES COMPARISON ===\n');

  try {
    // 1. Fetch the 29 institution departments from system_config
    const configRes = await pool.query(`SELECT data FROM system_config WHERE key = 'institution';`);
    const instData = configRes.rows[0]?.data;
    const instDepts: string[] = instData?.departments || [];

    console.log(`Institution Departments Defined in system_config: ${instDepts.length}`);

    // 2. Fetch distinct course departments from courses table
    const coursesRes = await pool.query(`
      SELECT DISTINCT department 
      FROM courses 
      WHERE department IS NOT NULL AND department != ''
      ORDER BY department;
    `);
    const courseDepts: string[] = coursesRes.rows.map(r => r.department);

    console.log(`Distinct Course Departments in courses table: ${courseDepts.length}\n`);

    // 3. Find course departments not in the 29 institution names
    const unmatchedCourseDepts = courseDepts.filter(cd => !instDepts.includes(cd));

    // 4. Find institution names that have no course in courses table
    const instDeptsWithoutCourses = instDepts.filter(id => !courseDepts.includes(id));

    // 5. Find institution names that have matched courses
    const matchedDepts = courseDepts.filter(cd => instDepts.includes(cd));

    console.log('----------------------------------------------------------------------');
    console.log(`MATCHED: ${matchedDepts.length} Course Departments in Catalog matched with Institution Taxonomy`);
    console.log('----------------------------------------------------------------------');
    matchedDepts.forEach((d, i) => {
      console.log(`  ${String(i + 1).padStart(2, ' ')}. ${d}`);
    });

    console.log('\n----------------------------------------------------------------------');
    console.log(`UNMATCHED: Course Departments NOT found in 29 Institution Names (${unmatchedCourseDepts.length})`);
    console.log('----------------------------------------------------------------------');
    if (unmatchedCourseDepts.length === 0) {
      console.log('  None. Every course department in courses table perfectly matches the 29 institution names.');
    } else {
      unmatchedCourseDepts.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));
    }

    console.log('\n----------------------------------------------------------------------');
    console.log(`UNCOVERED: Institution Departments currently without department-specific courses (${instDeptsWithoutCourses.length})`);
    console.log('  (Students in these departments access the 13 foundational GLOBAL courses)');
    console.log('----------------------------------------------------------------------');
    instDeptsWithoutCourses.forEach((d, i) => {
      console.log(`  ${String(i + 1).padStart(2, ' ')}. ${d}`);
    });

    console.log('\n=== ITEM 9 COMPARISON COMPLETE ===');
  } finally {
    await pool.end();
  }
}

compareDepartments().catch(e => {
  console.error(e);
  process.exit(1);
});
