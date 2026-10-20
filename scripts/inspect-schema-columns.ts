import { getPostgresPool } from '../server/postgresPool';

async function run() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('No pool');
    process.exit(1);
  }

  const coursesCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'courses'");
  console.log('--- COURSES COLUMNS ---');
  console.log(coursesCols.rows);

  const modulesCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'course_modules'");
  console.log('--- COURSE_MODULES COLUMNS ---');
  console.log(modulesCols.rows);

  const lessonsCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'course_lessons'");
  console.log('--- COURSE_LESSONS COLUMNS ---');
  console.log(lessonsCols.rows);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
