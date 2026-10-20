import { generateChunkId } from '../server/utils/chunkId';
import { getPostgresPool } from '../server/postgresPool';

async function runTest() {
  console.log('--- Testing Shared Chunk ID Generator & Collision Resistance ---');

  // Test 1: Identical module/lesson IDs across two different courses
  const id1 = generateChunkId('PHY101', 'm1', 'm1-l1', 0);
  const id2 = generateChunkId('AGE102', 'm1', 'm1-l1', 0);
  const id3 = generateChunkId('GST111', 'm1', 'm1-l1', 0);

  console.log('PHY101 Chunk ID:', id1, `(len: ${id1.length})`);
  console.log('AGE102 Chunk ID:', id2, `(len: ${id2.length})`);
  console.log('GST111 Chunk ID:', id3, `(len: ${id3.length})`);

  if (id1 === id2 || id1 === id3 || id2 === id3) {
    throw new Error('❌ COLLISION DETECTED: Chunk IDs must be course-qualified and distinct!');
  }
  console.log('✅ All generated IDs are distinct and course-qualified.');

  // Test 2: Insert into course_knowledge_chunks_v2 to verify constraint
  const pool = getPostgresPool();
  if (!pool) throw new Error('Database pool unavailable');

  await pool.query('DELETE FROM course_knowledge_chunks_v2 WHERE course_id IN (\'TEST_COURSE_A\', \'TEST_COURSE_B\')');

  const idA = generateChunkId('TEST_COURSE_A', 'm1', 'm1-l1', 0);
  const idB = generateChunkId('TEST_COURSE_B', 'm1', 'm1-l1', 0);

  const dummyVector = `[${new Array(768).fill(0.01).join(',')}]`;

  await pool.query(`
    INSERT INTO course_knowledge_chunks_v2 (
      chunk_id, course_id, module_id, lesson_id, chunk_index, chunk_text, token_count, is_active, metadata, embedding
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector)
  `, [idA, 'TEST_COURSE_A', 'm1', 'm1-l1', 0, 'Test chunk text for course A', 10, true, JSON.stringify({ test: true }), dummyVector]);

  await pool.query(`
    INSERT INTO course_knowledge_chunks_v2 (
      chunk_id, course_id, module_id, lesson_id, chunk_index, chunk_text, token_count, is_active, metadata, embedding
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector)
  `, [idB, 'TEST_COURSE_B', 'm1', 'm1-l1', 0, 'Test chunk text for course B', 10, true, JSON.stringify({ test: true }), dummyVector]);

  const verifyRes = await pool.query(`
    SELECT chunk_id, course_id, module_id, lesson_id, chunk_index, chunk_text 
    FROM course_knowledge_chunks_v2 
    WHERE course_id IN ('TEST_COURSE_A', 'TEST_COURSE_B')
    ORDER BY course_id;
  `);

  console.log('\n--- Database Verification Table ---');
  console.table(verifyRes.rows);

  await pool.query('DELETE FROM course_knowledge_chunks_v2 WHERE course_id IN (\'TEST_COURSE_A\', \'TEST_COURSE_B\')');

  if (verifyRes.rows.length !== 2) {
    throw new Error('❌ Expected 2 distinct rows kept in course_knowledge_chunks_v2');
  }

  console.log('✅ Collision test passed: Two courses with identical module/lesson IDs both kept their chunks!');
  process.exit(0);
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
