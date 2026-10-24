import { getPostgresPool } from '../server/postgresPool';

async function auditDepartments() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  console.log('=== ITEM 7: DEPARTMENTS & FACULTIES CROSS-CHECK AUDIT ===\n');

  // 1. Query distinct courses.department and courses.faculty from Neon
  const coursesRes = await pool.query(`
    SELECT DISTINCT department, faculty 
    FROM courses 
    WHERE department IS NOT NULL OR faculty IS NOT NULL
    ORDER BY faculty, department;
  `);

  console.log('--- 1. Distinct Courses in Neon (faculty -> department) ---');
  coursesRes.rows.forEach(r => {
    console.log(`  Faculty: "${r.faculty}", Department: "${r.department}"`);
  });

  // 2. Query institution config from system_config table
  const configRes = await pool.query(`
    SELECT key, data 
    FROM system_config 
    WHERE key IN ('institution', 'institution_config', 'faculties', 'departments', 'general');
  `);

  console.log('\n--- 2. Institution Config in system_config ---');
  if (configRes.rows.length === 0) {
    console.log('  No institution-specific config rows found in system_config.');
  } else {
    configRes.rows.forEach(r => {
      console.log(`  Key: ${r.key}`);
      console.log(`  Data: ${JSON.stringify(r.data, null, 2)}`);
    });
  }

  // 3. Query the 18 testers' profiles (department, faculty in learning_profile)
  const usersRes = await pool.query(`
    SELECT uid, email, role,
           learning_profile->>'faculty' as profile_faculty,
           learning_profile->>'department' as profile_department
    FROM users
    ORDER BY created_at ASC;
  `);

  console.log('\n--- 3. 18 Testers Profiles vs /api/courses?department= Matching ---');
  console.log('------------------------------------------------------------------------------------------------------------------------');
  console.log('| #  | Email / UID                         | Profile Faculty      | Profile Department   | Matched Courses in Catalog |');
  console.log('------------------------------------------------------------------------------------------------------------------------');

  for (let i = 0; i < usersRes.rows.length; i++) {
    const u = usersRes.rows[i];
    const num = String(i + 1).padEnd(2);
    const idStr = (u.email || u.uid).padEnd(35);
    const facStr = (u.profile_faculty || 'None').padEnd(20);
    const deptStr = (u.profile_department || 'None').padEnd(20);

    // Query courses that match tester's department
    let matchCount = 0;
    if (u.profile_department) {
      const matchRes = await pool.query(
        `SELECT COUNT(*) as cnt FROM courses WHERE department = $1 OR scope = 'GLOBAL'`,
        [u.profile_department]
      );
      matchCount = parseInt(matchRes.rows[0]?.cnt || '0', 10);
    } else {
      const globalRes = await pool.query(`SELECT COUNT(*) as cnt FROM courses WHERE scope = 'GLOBAL'`);
      matchCount = parseInt(globalRes.rows[0]?.cnt || '0', 10);
    }

    const matchStr = `${matchCount} courses (incl. GLOBAL)`.padEnd(26);
    console.log(`| ${num} | ${idStr} | ${facStr} | ${deptStr} | ${matchStr} |`);
  }
  console.log('------------------------------------------------------------------------------------------------------------------------');

  await pool.end();
  process.exit(0);
}

auditDepartments().catch(err => {
  console.error(err);
  process.exit(1);
});
