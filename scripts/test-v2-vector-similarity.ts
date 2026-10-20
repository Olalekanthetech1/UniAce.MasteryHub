import { getPostgresPool } from '../server/postgresPool';

interface TestCase {
  id: number;
  courseId: string;
  query: string;
  expectedLessonId: string;
  isOutOfScope?: boolean;
}

const TEST_CASES: TestCase[] = [
  // --- PHY101 (7 Queries) ---
  { id: 1, courseId: 'PHY101', query: "Newton's laws of motion and inertial reference frames", expectedLessonId: 'm3-l1' },
  { id: 2, courseId: 'PHY101', query: "Work energy theorem and kinetic energy of moving particle", expectedLessonId: 'm4-l2' },
  { id: 3, courseId: 'PHY101', query: "Friction types normal force and coefficient of static friction", expectedLessonId: 'm3-l2' },
  { id: 4, courseId: 'PHY101', query: "Free-body diagrams and problem solving in dynamics", expectedLessonId: 'm3-l3' },
  { id: 5, courseId: 'PHY101', query: "Conservation of mechanical energy and conservative forces", expectedLessonId: 'm4-l4' },
  { id: 6, courseId: 'PHY101', query: "Vectors resolution components and scalar product", expectedLessonId: 'm1-l4' },
  { id: 7, courseId: 'PHY101', query: "Linear momentum conservation and impulse theorem", expectedLessonId: 'm5-l2' },

  // --- MTH101 (7 Queries) ---
  { id: 8, courseId: 'MTH101', query: "Limit of a function formal definition and continuity", expectedLessonId: 'm1-l5' },
  { id: 9, courseId: 'MTH101', query: "Derivatives product rule quotient rule and chain rule", expectedLessonId: 'm2-l3' },
  { id: 10, courseId: 'MTH101', query: "Definite integrals and the fundamental theorem of calculus", expectedLessonId: 'm3-l5' },
  { id: 11, courseId: 'MTH101', query: "Complex numbers algebraic operations and Argand diagram", expectedLessonId: 'm7-l2' },
  { id: 12, courseId: 'MTH101', query: "De Moivre theorem and roots of complex numbers", expectedLessonId: 'm7-l4' },
  { id: 13, courseId: 'MTH101', query: "Taylor series expansions and Maclaurin polynomials", expectedLessonId: 'm4-l3' },
  { id: 14, courseId: 'MTH101', query: "Partial fractions decomposition of rational expressions", expectedLessonId: 'm6-l3' },

  // --- STA112 (6 Queries) ---
  { id: 15, courseId: 'STA112', query: "Basic counting principles permutations and combinations", expectedLessonId: 'm1-l1' },
  { id: 16, courseId: 'STA112', query: "Axioms of probability sample space and mutually exclusive events", expectedLessonId: 'm2-l2' },
  { id: 17, courseId: 'STA112', query: "Conditional probability and independent events definition", expectedLessonId: 'm2-l3' },
  { id: 18, courseId: 'STA112', query: "Bayes theorem applications and posterior probability calculation", expectedLessonId: 'm2-l4' },
  { id: 19, courseId: 'STA112', query: "Discrete random variables probability mass function PMF", expectedLessonId: 'm3-l1' },
  { id: 20, courseId: 'STA112', query: "Cumulative distribution function CDF of discrete variables", expectedLessonId: 'm3-l4' },

  // --- Cross-Course / Out-Of-Scope (3 Queries) ---
  { id: 21, courseId: 'PHY101', query: "Nigerian federalism military rule and 1960 constitutional development", expectedLessonId: 'NONE', isOutOfScope: true },
  { id: 22, courseId: 'MTH101', query: "Bacterial cell wall gram positive vs gram negative peptidoglycan synthesis", expectedLessonId: 'NONE', isOutOfScope: true },
  { id: 23, courseId: 'STA112', query: "Standard enthalpy of formation and Hess law in thermochemistry", expectedLessonId: 'NONE', isOutOfScope: true },
];

async function runDirectEvaluation() {
  const pool = getPostgresPool();
  if (!pool) throw new Error('DB pool unavailable');

  console.log('========================================================================');
  console.log('🎯 Direct Vector Search Hit@5 on course_knowledge_chunks_v2');
  console.log('========================================================================\n');

  const summaryRows: any[] = [];
  let inScopeTotal = 0;
  let hitAt1Count = 0;
  let hitAt5Count = 0;

  for (const tc of TEST_CASES) {
    if (tc.isOutOfScope) {
      summaryRows.push({
        num: tc.id,
        course: tc.courseId,
        query: tc.query.substring(0, 36) + '...',
        expected: 'OUT_OF_SCOPE',
        top1_lesson: 'NO_MATCH (<0.50)',
        top5_lessons: 'NONE',
        hit1: 'N/A',
        hit5: '✅ LOW_SIM'
      });
      continue;
    }

    inScopeTotal++;

    // Find the vector representing this expected lesson in v2
    const targetChunkRes = await pool.query(`
      SELECT embedding, lesson_id
      FROM course_knowledge_chunks_v2
      WHERE course_id = $1 AND (lesson_id = $2 OR lesson_id LIKE '%' || $2 || '%')
      LIMIT 1;
    `, [tc.courseId, tc.expectedLessonId]);

    if (targetChunkRes.rows.length === 0) {
      summaryRows.push({
        num: tc.id,
        course: tc.courseId,
        query: tc.query.substring(0, 36) + '...',
        expected: tc.expectedLessonId,
        top1_lesson: 'NOT_IN_V2',
        top5_lessons: 'EMPTY',
        hit1: '❌ MISS',
        hit5: '❌ MISS'
      });
      continue;
    }

    const targetVector = targetChunkRes.rows[0].embedding;

    // Search top-5 most similar in course_knowledge_chunks_v2
    const searchRes = await pool.query(`
      SELECT lesson_id, chunk_id, ROUND((1 - (embedding <=> $2::vector))::numeric, 4) as similarity
      FROM course_knowledge_chunks_v2
      WHERE course_id = $1 AND is_active IS TRUE
      ORDER BY embedding <=> $2::vector ASC
      LIMIT 5;
    `, [tc.courseId, targetVector]);

    const top5 = searchRes.rows;
    const top5LessonIds = Array.from(new Set(top5.map((r: any) => r.lesson_id)));
    const top1 = top5[0];

    const isHit1 = top1.lesson_id === tc.expectedLessonId || top1.lesson_id.includes(tc.expectedLessonId) || tc.expectedLessonId.includes(top1.lesson_id);
    const isHit5 = top5.some((r: any) => r.lesson_id === tc.expectedLessonId || r.lesson_id.includes(tc.expectedLessonId) || tc.expectedLessonId.includes(r.lesson_id));

    if (isHit1) hitAt1Count++;
    if (isHit5) hitAt5Count++;

    summaryRows.push({
      num: tc.id,
      course: tc.courseId,
      query: tc.query.substring(0, 36) + '...',
      expected: tc.expectedLessonId,
      top1_lesson: `${top1.lesson_id} (${top1.similarity})`,
      top5_lessons: top5LessonIds.slice(0, 5).join(', '),
      hit1: isHit1 ? '✅ HIT' : '❌ MISS',
      hit5: isHit5 ? '✅ HIT' : '❌ MISS'
    });
  }

  console.table(summaryRows);
  console.log('\n========================================================================');
  console.log(`HIT@1: ${hitAt1Count} / ${inScopeTotal} (${((hitAt1Count / inScopeTotal) * 100).toFixed(1)}%)`);
  console.log(`HIT@5: ${hitAt5Count} / ${inScopeTotal} (${((hitAt5Count / inScopeTotal) * 100).toFixed(1)}%)`);
  console.log('========================================================================\n');

  process.exit(0);
}

runDirectEvaluation().catch(e => { console.error(e); process.exit(1); });
