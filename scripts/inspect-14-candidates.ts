import { getPostgresPool } from '../server/postgresPool';

const TARGET_14 = [
  { courseId: 'BIO101', moduleId: 'animal-systems', matchedKeptId: 'm8' },
  { courseId: 'BIO101', moduleId: 'biotechnology', matchedKeptId: 'm7' },
  { courseId: 'BIO101', moduleId: 'evolution-diversity', matchedKeptId: 'm6' },
  { courseId: 'BIO101', moduleId: 'genetics', matchedKeptId: 'm4' },
  { courseId: 'BIO101', moduleId: 'intro-to-biology', matchedKeptId: 'm1' },
  { courseId: 'BIO101', moduleId: 'plant-systems', matchedKeptId: 'm9' },
  { courseId: 'BIO102', moduleId: 'ecology', matchedKeptId: 'm4' },
  { courseId: 'BIO102', moduleId: 'plant-bio', matchedKeptId: 'm6' },
  { courseId: 'STA112', moduleId: 'intro-prob', matchedKeptId: 'm1' },
  { courseId: 'STA112', moduleId: 'cond-prob', matchedKeptId: 'm2' },
  { courseId: 'STA112', moduleId: 'random-vars', matchedKeptId: 'm3' },
  { courseId: 'CHM107', moduleId: 'lab-safety', matchedKeptId: 'm1' },
  { courseId: 'COS101', moduleId: 'intro-computing', matchedKeptId: 'm1' },
  { courseId: 'CHM101', moduleId: 'atomic-structure', matchedKeptId: 'm1' },
];

async function inspect14() {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Database pool unavailable');

  for (const item of TARGET_14) {
    const { courseId, moduleId, matchedKeptId } = item;
    
    // Candidate Module Row
    const candModRes = await pool.query(
      'SELECT id, course_id, title, description, order_index FROM course_modules WHERE course_id = $1 AND id = $2',
      [courseId, moduleId]
    );
    const candMod = candModRes.rows[0];

    // Candidate Lessons
    const candLessonsRes = await pool.query(
      'SELECT id, title, order_index, LENGTH(content_markdown) as content_len FROM course_lessons WHERE course_id = $1 AND module_id = $2 ORDER BY order_index ASC',
      [courseId, moduleId]
    );

    // Kept Module Row
    const keptModRes = await pool.query(
      'SELECT id, course_id, title, description, order_index FROM course_modules WHERE course_id = $1 AND id = $2',
      [courseId, matchedKeptId]
    );
    const keptMod = keptModRes.rows[0];

    // Kept Lessons
    const keptLessonsRes = await pool.query(
      'SELECT id, title, order_index, LENGTH(content_markdown) as content_len FROM course_lessons WHERE course_id = $1 AND module_id = $2 ORDER BY order_index ASC',
      [courseId, matchedKeptId]
    );

    console.log(`================================================================`);
    console.log(`COURSE: ${courseId}`);
    console.log(`CANDIDATE MODULE: id="${candMod?.id}" | title="${candMod?.title}"`);
    console.log(`MATCHED KEPT MODULE: id="${keptMod?.id}" | title="${keptMod?.title}"`);
    console.log(`--- CANDIDATE LESSONS (${candLessonsRes.rows.length}) ---`);
    for (const l of candLessonsRes.rows) {
      console.log(`  id: ${l.id.padEnd(10)} | title: ${l.title.padEnd(50)} | content_length: ${l.content_len || 0}`);
    }
    console.log(`--- KEPT LESSONS (${keptLessonsRes.rows.length}) ---`);
    for (const l of keptLessonsRes.rows) {
      console.log(`  id: ${l.id.padEnd(10)} | title: ${l.title.padEnd(50)} | content_length: ${l.content_len || 0}`);
    }
    console.log('');
  }
  process.exit(0);
}

inspect14().catch(err => {
  console.error(err);
  process.exit(1);
});
