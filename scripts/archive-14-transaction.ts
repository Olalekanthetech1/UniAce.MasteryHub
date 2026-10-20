import { getPostgresPool } from '../server/postgresPool';

const TARGET_14 = [
  { courseId: 'BIO101', moduleId: 'animal-systems' },
  { courseId: 'BIO101', moduleId: 'biotechnology' },
  { courseId: 'BIO101', moduleId: 'evolution-diversity' },
  { courseId: 'BIO101', moduleId: 'genetics' },
  { courseId: 'BIO101', moduleId: 'intro-to-biology' },
  { courseId: 'BIO101', moduleId: 'plant-systems' },
  { courseId: 'BIO102', moduleId: 'ecology' },
  { courseId: 'BIO102', moduleId: 'plant-bio' },
  { courseId: 'STA112', moduleId: 'intro-prob' },
  { courseId: 'STA112', moduleId: 'cond-prob' },
  { courseId: 'STA112', moduleId: 'random-vars' },
  { courseId: 'CHM107', moduleId: 'lab-safety' },
  { courseId: 'COS101', moduleId: 'intro-computing' },
  { courseId: 'CHM101', moduleId: 'atomic-structure' },
];

async function run() {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Postgres pool not available');

  console.log('--- Step 1: Create Backup Tables ---');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_modules_backup_20261017 AS 
    SELECT * FROM course_modules;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_lessons_backup_20261017 AS 
    SELECT * FROM course_lessons;
  `);

  const modBackupCount = await pool.query('SELECT count(*) FROM course_modules_backup_20261017');
  const lesBackupCount = await pool.query('SELECT count(*) FROM course_lessons_backup_20261017');
  console.log(`Backup course_modules_backup_20261017: ${modBackupCount.rows[0].count} rows`);
  console.log(`Backup course_lessons_backup_20261017: ${lesBackupCount.rows[0].count} rows`);

  console.log('\n--- Step 2: Before Counts ---');
  const beforeRes = await pool.query(`
    SELECT 
      count(*) FILTER (WHERE is_archived IS TRUE) as archived_count,
      count(*) FILTER (WHERE is_archived IS NOT TRUE OR is_archived IS NULL) as active_count,
      count(*) as total_count
    FROM course_modules;
  `);
  console.table(beforeRes.rows);

  console.log('--- Step 3: Archive 14 Duplicate-Draft Modules in ONE Transaction ---');
  const client = await pool.connect();
  let updatedRows = 0;
  try {
    await client.query('BEGIN');
    for (const item of TARGET_14) {
      const res = await client.query(`
        UPDATE course_modules 
        SET is_archived = TRUE, updated_at = NOW() 
        WHERE course_id = $1 AND id = $2 AND (is_archived IS NOT TRUE OR is_archived IS NULL)
      `, [item.courseId, item.moduleId]);
      updatedRows += res.rowCount || 0;
    }
    await client.query('COMMIT');
    console.log(`✅ Transaction committed. Updated ${updatedRows} modules to is_archived = true.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:', err);
    throw err;
  } finally {
    client.release();
  }

  console.log('\n--- Step 4: After Counts ---');
  const afterRes = await pool.query(`
    SELECT 
      count(*) FILTER (WHERE is_archived IS TRUE) as archived_count,
      count(*) FILTER (WHERE is_archived IS NOT TRUE OR is_archived IS NULL) as active_count,
      count(*) as total_count
    FROM course_modules;
  `);
  console.table(afterRes.rows);

  console.log('\n--- Step 5: Verification of the 14 Archived Modules ---');
  const verifyRes = await pool.query(`
    SELECT course_id, id, title, is_archived, updated_at 
    FROM course_modules 
    WHERE (course_id, id) IN (${TARGET_14.map((_, i) => `($${i*2+1}, $${i*2+2})`).join(', ')})
    ORDER BY course_id, id;
  `, TARGET_14.flatMap(t => [t.courseId, t.moduleId]));
  console.table(verifyRes.rows);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
