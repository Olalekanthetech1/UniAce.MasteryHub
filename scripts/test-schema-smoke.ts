import { getPostgresPool } from '../server/postgresPool';

async function run() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  console.log('================================================================');
  console.log('🧪 Step 5.7: Comprehensive SQL Schema Smoke Test');
  console.log('================================================================\n');

  const queries = [
    {
      name: '1. Full Published Courses Query',
      sql: `SELECT id, title, description, department, faculty, level, semester, status, updated_at FROM courses WHERE status = 'published' ORDER BY id ASC`,
      params: []
    },
    {
      name: '2. Published Modules Query (with is_archived filter)',
      sql: `SELECT id, course_id, title, description, order_index, updated_at FROM course_modules WHERE (is_archived IS NOT TRUE OR is_archived IS NULL) ORDER BY course_id, order_index ASC`,
      params: []
    },
    {
      name: '3. Full Lessons Query (titles & order only)',
      sql: `SELECT id, course_id, module_id, title, order_index, updated_at FROM course_lessons ORDER BY course_id, module_id, order_index ASC`,
      params: []
    },
    {
      name: '4. Parameterized Course Modules Query',
      sql: `SELECT id, course_id, title, description, order_index, estimated_minutes, created_at, updated_at FROM course_modules WHERE course_id = $1 AND (is_archived IS NOT TRUE OR is_archived IS NULL) ORDER BY order_index ASC`,
      params: ['BIO101']
    },
    {
      name: '5. Parameterized Course Lessons Query',
      sql: `SELECT id, course_id, module_id, title, content_markdown, order_index, key_terms, learning_outcomes, asset_references, created_at, updated_at FROM course_lessons WHERE course_id = $1 AND module_id = $2 ORDER BY order_index ASC`,
      params: ['BIO101', 'm1']
    },
    {
      name: '6. List Published Courses Repository Method SQL',
      sql: `SELECT id, code, title, description, level, department, faculty, semester, thumbnail_url, author_id, status, version, created_at, updated_at FROM courses WHERE 1=1`,
      params: []
    },
    {
      name: '7. Admin Catalog Full Courses SQL',
      sql: `SELECT id, title, description, department, faculty, level, semester, status, updated_at FROM courses ORDER BY id ASC`,
      params: []
    },
    {
      name: '8. Check is_archived column existence on course_modules',
      sql: `SELECT id, is_archived FROM course_modules LIMIT 1`,
      params: []
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const q of queries) {
    try {
      const t0 = performance.now();
      const res = await pool.query(q.sql, q.params);
      const durationMs = (performance.now() - t0).toFixed(2);
      console.log(`✅ [PASS] ${q.name} (${durationMs}ms, ${res.rows.length} rows)`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${q.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n================================================================`);
  console.log(`Smoke Test Results: ${passed}/${queries.length} passed (${failed} failed)`);
  console.log(`================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }

  process.exit(0);
}

run().catch(err => {
  console.error('Smoke test exception:', err);
  process.exit(1);
});
