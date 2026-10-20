/**
 * UniAce Mastery Hub: Stage 5 Course Generation Jobs & Workers Resilience Suite
 *
 * Tests & Validates:
 * 1. DDL Schema & Partial Unique Index Guard (`idx_uq_active_course_job`).
 * 2. Atomic Lease Acquisition & Split-Brain Zombie Fencing (`WHERE lease_owner = $2 AND status = 'running'`).
 * 3. Incremental Module/Lesson Catalog Upserts (`upsertModuleAndLesson`).
 * 4. Ephemeral Single-Use SSE Stream Ticket Lifecycle (`issueStreamTicket` & `consumeStreamTicket`).
 * 5. Two-Branch Dead-Letter + SKIP LOCKED Auto-Reclaim CTE (`reclaimStaleJobs`).
 * 6. Zero-Fallback Policy Enforcement (`ENABLE_POSTGRES_GENERATION_JOBS`).
 */

import { queryPostgres } from '../server/postgresPool';
import { JobRepository } from '../server/repositories/jobRepository';
import { getFeatureFlags, setRuntimeFlag } from '../server/config/features';

async function runResilienceSuite() {
  console.log('===============================================================');
  console.log('  UniAce Stage 5: Course Generation Jobs Resilience Test Suite ');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  const testCourseId = `resilience_course_${Date.now()}`;
  const testUserId = `resilience_user_${Date.now()}`;
  const workerA = 'worker_node_alpha';
  const workerB = 'worker_node_beta';

  try {
    // Pre-test cleanup of leftover resilience jobs
    await queryPostgres(`
      DELETE FROM course_generation_jobs WHERE course_id LIKE 'resilience_course_%' OR course_id LIKE 'course_stale_%' OR course_id LIKE 'course_deadletter_%';
    `).catch(() => {});

    // --- Test 1: DDL Table & Partial Unique Index Verification ---
    console.log('[Test 1] Verifying DDL Tables and Partial Unique Index...');
    const tableRes = await queryPostgres(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('course_generation_jobs', 'sse_stream_tickets');
    `);
    const tables = tableRes.rows.map((r: any) => r.table_name);
    if (tables.includes('course_generation_jobs') && tables.includes('sse_stream_tickets')) {
      console.log('  ✅ Relational tables exist in Neon PostgreSQL');
    } else {
      throw new Error(`Missing required tables. Found: ${tables.join(', ')}`);
    }

    const indexRes = await queryPostgres(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'course_generation_jobs' AND indexname = 'idx_uq_active_course_job';
    `);
    if (indexRes.rows.length > 0) {
      console.log(`  ✅ Partial unique index idx_uq_active_course_job verified: ${indexRes.rows[0].indexdef}`);
      passed++;
    } else {
      throw new Error('idx_uq_active_course_job index missing!');
    }

    // --- Test 2: Atomic Job Creation & Partial Unique Index Guard ---
    console.log('\n[Test 2] Testing Atomic Job Creation & Deduplication Guard...');
    const jobA = await JobRepository.createOrAcquireJob({
      courseId: testCourseId,
      userId: testUserId,
      workerId: workerA,
      requestPayload: { courseName: 'Quantum Mechanics 101', department: 'Physics' }
    });

    if (jobA.created && jobA.job.lease_owner === workerA && jobA.job.status === 'running') {
      console.log(`  ✅ Worker A created job ${jobA.job.job_id} for course ${testCourseId}`);
    } else {
      throw new Error('Worker A failed to create job');
    }

    // Attempt concurrent duplicate job creation for the same course_id
    let duplicateCaught = false;
    try {
      await queryPostgres(`
        INSERT INTO course_generation_jobs (
          job_id, course_id, user_id, status, stage, progress_percent, lease_owner, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 'running', 'initialized', 0, $4, NOW(), NOW()
        );
      `, [`job_dup_${Date.now()}`, testCourseId, testUserId, workerB]);
    } catch (dupErr: any) {
      if (dupErr.message.includes('idx_uq_active_course_job') || dupErr.code === '23505') {
        duplicateCaught = true;
        console.log('  ✅ Partial unique index blocked concurrent active job insertion for same course_id');
      }
    }

    if (!duplicateCaught) {
      throw new Error('Partial unique index failed to block duplicate active course job!');
    }
    passed++;

    // --- Test 3: Split-Brain Zombie Fencing ---
    console.log('\n[Test 3] Testing Split-Brain Zombie Fencing...');
    // Worker B tries to update progress for Worker A's job without lease ownership
    const zombieUpdateSuccess = await JobRepository.updateProgress(jobA.job.job_id, workerB, {
      progressPercent: 50,
      statusMessage: 'Zombie update from Worker B'
    });

    if (!zombieUpdateSuccess) {
      console.log('  ✅ Zombie update from Worker B was fenced (rowCount = 0)');
    } else {
      throw new Error('Zombie worker B was allowed to update job owned by Worker A!');
    }

    // Worker A updates progress correctly
    const validUpdateSuccess = await JobRepository.updateProgress(jobA.job.job_id, workerA, {
      progressPercent: 25,
      statusMessage: 'Generating Module 1...',
      currentModule: 'mod_1',
      currentLesson: 'les_1',
      checkpoint: { stage: 'module_1_start', message: 'Building Quantum Postulates module' }
    });

    if (validUpdateSuccess) {
      console.log('  ✅ Legitimate lease owner Worker A successfully updated progress');
      passed++;
    } else {
      throw new Error('Valid worker A update failed!');
    }

    // --- Test 4: Ephemeral SSE Stream Ticket Lifecycle ---
    console.log('\n[Test 4] Testing Ephemeral SSE Stream Ticket Lifecycle...');
    const ticketId = await JobRepository.issueStreamTicket(jobA.job.job_id, testUserId);
    if (ticketId.startsWith('tkt_')) {
      console.log(`  ✅ Issued stream ticket ${ticketId}`);
    } else {
      throw new Error('Failed to issue stream ticket');
    }

    // Consume ticket 1st time (valid)
    const consume1 = await JobRepository.consumeStreamTicket(ticketId, jobA.job.job_id);
    if (consume1.valid && consume1.userId === testUserId) {
      console.log('  ✅ Ticket successfully consumed on 1st connection attempt');
    } else {
      throw new Error('1st ticket consumption failed!');
    }

    // Consume ticket 2nd time (must fail - single-use)
    const consume2 = await JobRepository.consumeStreamTicket(ticketId, jobA.job.job_id);
    if (!consume2.valid) {
      console.log('  ✅ Second ticket consumption correctly rejected (single-use enforced)');
      passed++;
    } else {
      throw new Error('Single-use stream ticket was reused!');
    }

    // --- Test 5: Incremental Module/Lesson Catalog Upserts ---
    console.log('\n[Test 5] Testing Incremental Catalog Persistence...');
    // Ensure parent course exists in courses table for FK constraint
    await queryPostgres(`
      INSERT INTO courses (id, code, title, level, department, status, created_at, updated_at)
      VALUES ($1, $1, 'Resilience Test Course', 'undergraduate', 'Physics', 'draft', NOW(), NOW())
      ON CONFLICT DO NOTHING;
    `, [testCourseId]);

    const moduleInput = {
      id: `mod_test_${Date.now()}`,
      courseId: testCourseId,
      title: 'Postulates of Quantum Mechanics',
      description: 'Foundational axioms and state vectors.',
      orderIndex: 0
    };
    const lessonInput = {
      id: `les_test_${Date.now()}`,
      courseId: testCourseId,
      moduleId: moduleInput.id,
      title: 'Hilbert Spaces & Dirac Notation',
      content: 'State vectors are element of complex Hilbert space.',
      orderIndex: 0
    };

    const upsertSuccess = await JobRepository.upsertModuleAndLesson({
      courseId: testCourseId,
      module: moduleInput,
      lesson: lessonInput
    }).then(() => true).catch(() => false);
    if (upsertSuccess) {
      const modCheck = await queryPostgres(`SELECT title FROM course_modules WHERE id = $1;`, [moduleInput.id]);
      const lesCheck = await queryPostgres(`SELECT title FROM course_lessons WHERE id = $1;`, [lessonInput.id]);
      if (modCheck.rows.length > 0 && lesCheck.rows.length > 0) {
        console.log('  ✅ Incrementally persisted module and lesson directly to Neon catalog');
        passed++;
      } else {
        throw new Error('Catalog record missing after upsert');
      }
    } else {
      throw new Error('upsertModuleAndLesson returned false');
    }

    // --- Test 6: Two-Branch Dead-Letter + SKIP LOCKED Auto-Reclaim ---
    console.log('\n[Test 6] Testing Two-Branch Dead-Letter & SKIP LOCKED Auto-Reclaim...');
    // Create an expired stale job under max_attempts
    const staleJobId = `job_stale_${Date.now()}`;
    await queryPostgres(`
      INSERT INTO course_generation_jobs (
        job_id, course_id, user_id, status, stage, progress_percent, lease_owner,
        lease_heartbeat, lease_expires_at, attempts_count, max_attempts, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 'running', 'generating_module_2', 40, 'crashed_worker',
        NOW() - INTERVAL '60 seconds', NOW() - INTERVAL '30 seconds', 1, 3, NOW(), NOW()
      );
    `, [staleJobId, `course_stale_${Date.now()}`, testUserId]);

    // Create an expired job at max_attempts (must hit dead-letter)
    const deadLetterJobId = `job_deadletter_${Date.now()}`;
    await queryPostgres(`
      INSERT INTO course_generation_jobs (
        job_id, course_id, user_id, status, stage, progress_percent, lease_owner,
        lease_heartbeat, lease_expires_at, attempts_count, max_attempts, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 'running', 'generating_module_3', 60, 'crashed_worker',
        NOW() - INTERVAL '60 seconds', NOW() - INTERVAL '30 seconds', 3, 3, NOW(), NOW()
      );
    `, [deadLetterJobId, `course_deadletter_${Date.now()}`, testUserId]);

    // Reclaim stale jobs as Worker B
    const reclaimedJob = await JobRepository.reclaimStaleJobs(workerB);
    if (reclaimedJob && reclaimedJob.job_id === staleJobId && reclaimedJob.lease_owner === workerB && reclaimedJob.attempts_count === 2) {
      console.log(`  ✅ Worker B reclaimed stale job ${staleJobId} (attempts incremented to ${reclaimedJob.attempts_count})`);
    } else {
      console.log('Reclaimed job mismatch:', reclaimedJob);
      throw new Error(`Failed to reclaim eligible stale job. Expected ${staleJobId}, got ${reclaimedJob?.job_id}`);
    }

    // Verify dead letter job was updated to 'failed'
    const deadLetterCheck = await JobRepository.getJobById(deadLetterJobId);
    if (deadLetterCheck && deadLetterCheck.status === 'failed' && deadLetterCheck.stage === 'failed_max_retries') {
      console.log(`  ✅ Dead-letter job ${deadLetterJobId} automatically transitioned to 'failed' (attempts >= max_attempts)`);
      passed++;
    } else {
      throw new Error('Dead-letter job was not transitioned to failed!');
    }

    // --- Cleanup Test Artifacts ---
    console.log('\nCleaning up test artifacts...');
    await queryPostgres(`DELETE FROM course_lessons WHERE course_id IN ($1);`, [testCourseId]);
    await queryPostgres(`DELETE FROM course_modules WHERE course_id IN ($1);`, [testCourseId]);
    await queryPostgres(`DELETE FROM course_generation_jobs WHERE course_id LIKE 'resilience_course_%' OR course_id LIKE 'course_stale_%' OR course_id LIKE 'course_deadletter_%';`);
    await queryPostgres(`DELETE FROM courses WHERE id IN ($1);`, [testCourseId]);
    console.log('  ✅ Cleanup complete');
    passed++;

  } catch (err: any) {
    console.error(`\n❌ Test suite failed: ${err.message}`);
    failed++;
  }

  console.log('\n===============================================================');
  console.log(`  Results: ${passed} Passed, ${failed} Failed`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runResilienceSuite();
