import http from 'http';

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

async function callEndpoint(path: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer uniace-secure-local-eval-token',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runLiveHit5Suite() {
  console.log('========================================================================');
  console.log('🎯 Running Live End-to-End Hit@5 Retrieval Suite via POST /api/rag/search');
  console.log('   (Using Fresh GEMINI_API_KEY for live real-time query embeddings)');
  console.log('========================================================================\n');

  let inScopeTotal = 0;
  let hitAt1Count = 0;
  let hitAt5Count = 0;
  let outOfScopeCount = 0;
  let outOfScopeSuccess = 0;

  const summaryRows: any[] = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    if (i > 0) {
      await new Promise(r => setTimeout(r, 4200));
    }

    const response = await callEndpoint('/api/rag/search', {
      courseId: tc.courseId,
      queryText: tc.query,
      topK: 5
    });

    const results = response.results || [];
    const top5Ids = results.map((r: any) => r.lesson_id);
    const top5Sims = results.map((r: any) => Number(r.similarity).toFixed(4));
    const top1Id = top5Ids[0] || 'EMPTY';
    const top1Sim = top5Sims[0] || '0.0000';
    const top5Formatted = results.map((r: any) => `${r.lesson_id}(${Number(r.similarity).toFixed(3)})`).join(', ') || 'EMPTY';

    if (tc.isOutOfScope) {
      outOfScopeCount++;
      const isRejected = results.length === 0 || Number(top1Sim) < 0.60;
      if (isRejected) outOfScopeSuccess++;

      const row = {
        num: tc.id,
        course: tc.courseId,
        query: tc.query.substring(0, 32) + '...',
        expected: 'OUT_OF_SCOPE',
        top1_lesson: `${top1Id} (${top1Sim})`,
        top5_lessons_sim: top5Formatted,
        hit1: 'N/A',
        hit5: isRejected ? '✅ LOW_SIM (<0.60)' : '⚠️ HIGH_SIM'
      };
      summaryRows.push(row);
      console.log(`[Query ${tc.id}/23] ${tc.courseId} "${tc.query.substring(0, 28)}..." -> Top1: ${top1Id} (${top1Sim}) | Hit5: ${row.hit5}`);
    } else {
      inScopeTotal++;
      const isHit1 = top1Id === tc.expectedLessonId || top1Id.includes(tc.expectedLessonId) || tc.expectedLessonId.includes(top1Id);
      const isHit5 = top5Ids.some((id: string) => id === tc.expectedLessonId || id.includes(tc.expectedLessonId) || tc.expectedLessonId.includes(id));

      if (isHit1) hitAt1Count++;
      if (isHit5) hitAt5Count++;

      const row = {
        num: tc.id,
        course: tc.courseId,
        query: tc.query.substring(0, 32) + '...',
        expected: tc.expectedLessonId,
        top1_lesson: `${top1Id} (${top1Sim})`,
        top5_lessons_sim: top5Formatted,
        hit1: isHit1 ? '✅ HIT' : '❌ MISS',
        hit5: isHit5 ? '✅ HIT' : '❌ MISS'
      };
      summaryRows.push(row);
      console.log(`[Query ${tc.id}/23] ${tc.courseId} "${tc.query.substring(0, 28)}..." -> Expected: ${tc.expectedLessonId} | Top1: ${top1Id} (${top1Sim}) | Hit5: ${row.hit5}`);
    }
  }

  console.table(summaryRows);

  console.log('\n========================================================================');
  console.log('REAL LIVE HIT@5 RETRIEVAL PERFORMANCE (POST /api/rag/search):');
  console.log(`• Total In-Scope Queries: ${inScopeTotal}`);
  console.log(`• Hit@1: ${hitAt1Count} / ${inScopeTotal} (${((hitAt1Count / inScopeTotal) * 100).toFixed(1)}%)`);
  console.log(`• Hit@5: ${hitAt5Count} / ${inScopeTotal} (${((hitAt5Count / inScopeTotal) * 100).toFixed(1)}%)`);
  console.log(`• Out-Of-Scope / Cross-Course: ${outOfScopeCount} tested, ${outOfScopeSuccess} successfully rejected/isolated`);
  console.log('========================================================================\n');

  process.exit(0);
}

runLiveHit5Suite().catch(e => { console.error(e); process.exit(1); });
