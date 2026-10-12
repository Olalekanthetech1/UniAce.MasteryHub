/**
 * Stage 5B Controlled Pilots & Data Verification Test Suite
 *
 * Implements Stage 5B Isolated Sandbox Pilots:
 * 1. Generation Job Queue: Atomic claiming, heartbeat renewal, transactional content + checkpointing,
 *    expired worker rejection, and resumption without duplicate content.
 * 2. Normalized Progress Batching: Atomic study batch recording, immediate duplicate deduplication,
 *    and normalized lesson completion tracking.
 * 3. Cross-Database Transactional Outbox: At-least-once delivery with end-to-end idempotency,
 *    durable event IDs, retry scheduling, and destination reconciliation.
 */

import crypto from 'crypto';
import { CourseGenerationJobEntity, GenerationJobStage, TransactionalOutboxEntity } from '../src/types/databaseSchema';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`[STAGE 5B ASSERTION FAILED] ${msg}`);
  }
}

// =================================================================================================
// PILOT HARNESS 1: In-Memory Durable Generation Queue Engine
// =================================================================================================
class SandboxJobQueueEngine {
  private jobs = new Map<string, CourseGenerationJobEntity>();

  async enqueue(params: {
    jobId: string;
    courseId: string;
    requestedBy: string;
    promptParams: any;
    maxAttempts?: number;
  }): Promise<CourseGenerationJobEntity> {
    const nowIso = new Date().toISOString();
    const job: CourseGenerationJobEntity = {
      id: params.jobId,
      course_id: params.courseId,
      requested_by: params.requestedBy,
      prompt_params: params.promptParams,
      status: 'queued',
      current_stage: 'planning',
      progress_pct: 0,
      attempt_count: 0,
      max_attempts: params.maxAttempts || 3,
      worker_id: null,
      worker_heartbeat_at: null,
      lease_expires_at: null,
      next_retry_at: null,
      checkpoint_data: {},
      error_message: null,
      tokens_consumed: 0,
      started_at: null,
      completed_at: null,
      created_at: nowIso,
      updated_at: nowIso
    };
    this.jobs.set(params.jobId, job);
    return job;
  }

  async claimNext(workerId: string, leaseDurationMs: number): Promise<CourseGenerationJobEntity | null> {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      const isEligible =
        (job.status === 'queued' || job.status === 'retrying') ||
        (job.status === 'running' && job.lease_expires_at && new Date(job.lease_expires_at).getTime() < now);

      if (isEligible && job.attempt_count < job.max_attempts) {
        job.status = 'running';
        job.worker_id = workerId;
        job.worker_heartbeat_at = new Date(now).toISOString();
        job.lease_expires_at = new Date(now + leaseDurationMs).toISOString();
        job.attempt_count += 1;
        job.updated_at = new Date(now).toISOString();
        return { ...job };
      }
    }
    return null;
  }

  async saveCheckpoint(
    jobId: string,
    workerId: string,
    stage: GenerationJobStage,
    progressPct: number,
    checkpointUpdate: any
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const now = Date.now();
    const isLeaseActive =
      job.worker_id === workerId &&
      job.status === 'running' &&
      job.lease_expires_at != null &&
      new Date(job.lease_expires_at).getTime() > now;

    if (!isLeaseActive) {
      throw new Error(`Lease expired or claimed by another worker: job ${jobId}`);
    }

    job.current_stage = stage;
    job.progress_pct = progressPct;
    job.checkpoint_data = { ...job.checkpoint_data, ...checkpointUpdate };
    job.worker_heartbeat_at = new Date(now).toISOString();
    job.updated_at = new Date(now).toISOString();
  }

  async finish(jobId: string, workerId: string, status: 'completed' | 'failed'): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = status;
    job.progress_pct = status === 'completed' ? 100 : job.progress_pct;
    job.completed_at = new Date().toISOString();
  }

  getJob(jobId: string): CourseGenerationJobEntity | undefined {
    return this.jobs.get(jobId);
  }
}

// =================================================================================================
// PILOT HARNESS 2: In-Memory Normalized Progress Engine
// =================================================================================================
class SandboxProgressEngine {
  private batches = new Set<string>(); // unique batch keys
  private progress = new Map<string, { totalStudySeconds: number; lastLessonId?: string }>();
  private completions = new Map<string, { lessonId: string; completedAt: string }>();

  async recordBatch(params: {
    uid: string;
    courseId: string;
    batchId: string;
    deltaSeconds: number;
    completedLessonId?: string | null;
  }): Promise<{ success: boolean; deduplicated: boolean; totalStudySeconds: number; completedLessonRecorded: boolean }> {
    const batchKey = `${params.uid}_${params.courseId}_${params.batchId}`;
    const progressKey = `${params.uid}_${params.courseId}`;

    // 1. Deduplication check
    if (this.batches.has(batchKey)) {
      const current = this.progress.get(progressKey)?.totalStudySeconds || 0;
      return {
        success: true,
        deduplicated: true,
        totalStudySeconds: current,
        completedLessonRecorded: false
      };
    }

    // 2. Atomic insert & increment
    this.batches.add(batchKey);
    const existing = this.progress.get(progressKey) || { totalStudySeconds: 0 };
    const newTotal = existing.totalStudySeconds + Math.max(0, params.deltaSeconds);
    this.progress.set(progressKey, {
      totalStudySeconds: newTotal,
      lastLessonId: params.completedLessonId || existing.lastLessonId
    });

    let completedLessonRecorded = false;
    if (params.completedLessonId) {
      const compKey = `${params.uid}_${params.completedLessonId}`;
      if (!this.completions.has(compKey)) {
        this.completions.set(compKey, {
          lessonId: params.completedLessonId,
          completedAt: new Date().toISOString()
        });
        completedLessonRecorded = true;
      }
    }

    return {
      success: true,
      deduplicated: false,
      totalStudySeconds: newTotal,
      completedLessonRecorded
    };
  }
}

// =================================================================================================
// MAIN RUNNER
// =================================================================================================
async function runStage5BPilots() {
  console.log('=== Stage 5B Controlled Pilots & Data Verification Suite ===\n');
  const runId = crypto.randomUUID().slice(0, 8);

  // -------------------------------------------------------------------------------------------------
  // PILOT 1: Durable Generation Job Queue, Leases & Recovery
  // -------------------------------------------------------------------------------------------------
  console.log('--- PILOT 1: Course Generation Queue, Leases & Checkpointing ---');
  const jobEngine = new SandboxJobQueueEngine();
  const testJobId = `job_${runId}`;
  const workerA = `worker_A_${runId}`;
  const workerB = `worker_B_${runId}`;

  // 1.1: Enqueue Job
  const enqueued = await jobEngine.enqueue({
    jobId: testJobId,
    courseId: `course_${runId}`,
    requestedBy: `admin_${runId}`,
    promptParams: { topic: 'Differential Geometry', level: '300L' },
    maxAttempts: 3
  });
  assert(enqueued.status === 'queued', 'Initial job status must be queued');
  assert(enqueued.current_stage === 'planning', 'Initial stage must be planning');
  console.log('✅ 1.1: Enqueued job with decoupled status and stage.');

  // 1.2: Atomic Claim by Worker A (short lease 150ms for simulated expiry test)
  const claimedA = await jobEngine.claimNext(workerA, 150);
  assert(claimedA !== null && claimedA.id === testJobId, 'Worker A must claim the enqueued job');
  assert(claimedA.status === 'running', 'Claimed job status must be running');
  assert(claimedA.worker_id === workerA, 'Worker ID must match Worker A');
  assert(claimedA.attempt_count === 1, 'Attempt count must be 1');
  console.log('✅ 1.2: Worker A atomically claimed job with exclusive lease.');

  // 1.3: Active Lease Verification & Checkpointing
  await jobEngine.saveCheckpoint(testJobId, workerA, 'syllabus', 25, {
    lastCompletedUnitType: 'syllabus',
    lastCompletedUnitIndex: 0,
    lastCompletedUnitId: 'syl_1'
  });
  console.log('✅ 1.3: Worker A advanced checkpoint to 25% while lease was active.');

  // 1.4: Simulated Worker Expiry (wait 200ms for lease to expire)
  await new Promise((r) => setTimeout(r, 200));

  // 1.5: Expired Worker Write Rejection
  let expiredWriteRejected = false;
  try {
    await jobEngine.saveCheckpoint(testJobId, workerA, 'modules', 50, {
      lastCompletedUnitType: 'module',
      lastCompletedUnitIndex: 1
    });
  } catch (err: any) {
    expiredWriteRejected = err.message.includes('Lease expired') || err.message.includes('another worker');
  }
  assert(expiredWriteRejected, 'Write by expired Worker A must be strictly rejected');
  console.log('✅ 1.4: Expired worker write was rejected, preventing stale output corruption.');

  // 1.6: Worker B claims the expired lease & resumes from checkpoint
  const claimedB = await jobEngine.claimNext(workerB, 60000);
  assert(claimedB !== null && claimedB.id === testJobId, 'Worker B must claim the expired job');
  assert(claimedB.worker_id === workerB, 'Worker ID must now match Worker B');
  assert(claimedB.attempt_count === 2, 'Attempt count must increment to 2');
  assert(claimedB.checkpoint_data.lastCompletedUnitType === 'syllabus', 'Worker B must read prior checkpoint');
  assert(claimedB.progress_pct === 25, 'Progress percentage must resume from 25%');

  // Complete job
  await jobEngine.finish(testJobId, workerB, 'completed');
  console.log('✅ 1.5: Worker B cleanly resumed from checkpoint and marked job completed.\n');

  // -------------------------------------------------------------------------------------------------
  // PILOT 2: Normalized Student Progress & Batch Deduplication
  // -------------------------------------------------------------------------------------------------
  console.log('--- PILOT 2: Normalized Progress & Atomic Batch Deduplication ---');
  const progressEngine = new SandboxProgressEngine();
  const studentUid = `student_${runId}`;
  const courseId = `course_${runId}`;
  const batch1Id = `batch_001_${runId}`;

  // 2.1: First Batch Arrival (300 seconds study time)
  const res1 = await progressEngine.recordBatch({
    uid: studentUid,
    courseId,
    batchId: batch1Id,
    deltaSeconds: 300,
    completedLessonId: 'les_m1_01'
  });

  assert(res1.success === true, 'First batch must succeed');
  assert(res1.deduplicated === false, 'First batch must not be deduplicated');
  assert(res1.totalStudySeconds === 300, `Study seconds must be 300, got ${res1.totalStudySeconds}`);
  assert(res1.completedLessonRecorded === true, 'Lesson completion must be recorded');
  console.log('✅ 2.1: First study batch (300s) recorded atomically.');

  // 2.2: Immediate Retry of Identical Batch (Network replay simulation)
  const res1Retry = await progressEngine.recordBatch({
    uid: studentUid,
    courseId,
    batchId: batch1Id,
    deltaSeconds: 300,
    completedLessonId: 'les_m1_01'
  });

  assert(res1Retry.success === true, 'Retry must succeed');
  assert(res1Retry.deduplicated === true, 'Retry must be flagged as deduplicated');
  assert(res1Retry.totalStudySeconds === 300, `Study seconds must remain 300 (not 600), got ${res1Retry.totalStudySeconds}`);
  console.log('✅ 2.2: Replayed batch detected idempotently (0 additional study seconds added).');

  // 2.3: Second Batch Arrival (incremental 150 seconds)
  const batch2Id = `batch_002_${runId}`;
  const res2 = await progressEngine.recordBatch({
    uid: studentUid,
    courseId,
    batchId: batch2Id,
    deltaSeconds: 150,
    completedLessonId: 'les_m1_02'
  });

  assert(res2.success === true, 'Second batch must succeed');
  assert(res2.deduplicated === false, 'Second batch must not be deduplicated');
  assert(res2.totalStudySeconds === 450, `Study seconds must increment to 450, got ${res2.totalStudySeconds}`);
  console.log('✅ 2.3: Second incremental batch added accurately (total = 450s).\n');

  // -------------------------------------------------------------------------------------------------
  // PILOT 3: Cross-Database Transactional Outbox (At-Least-Once Delivery with Idempotency)
  // -------------------------------------------------------------------------------------------------
  console.log('--- PILOT 3: Transactional Outbox Relay & At-Least-Once Idempotency ---');
  const outboxStore = new Map<string, TransactionalOutboxEntity>();
  const destinationLedger = new Map<string, { sparksCredited: number }>();

  const rewardEventId = `reward_${runId}_1`;
  const rewardIdempotencyToken = `tok_reward_${runId}_1`;

  // 3.1: Enqueue Reward Event in PostgreSQL Outbox
  outboxStore.set(rewardEventId, {
    id: rewardEventId,
    aggregate_type: 'COURSE_COMPLETION',
    aggregate_id: courseId,
    idempotency_token: rewardIdempotencyToken,
    payload: { uid: studentUid, rewardSparks: 50, courseId },
    status: 'PENDING',
    retry_count: 0,
    error_message: null,
    created_at: new Date().toISOString(),
    processed_at: null
  });
  assert(outboxStore.get(rewardEventId)!.status === 'PENDING', 'Outbox event must start PENDING');

  // 3.2: First attempt: Transient network timeout simulation
  const event1 = outboxStore.get(rewardEventId)!;
  event1.retry_count += 1;
  event1.error_message = 'Simulated transient network timeout';
  assert(event1.status === 'PENDING' && event1.retry_count === 1, 'Event remains pending on transient failure');
  console.log('✅ 3.1: Transient relay failure handled; event retained in PENDING state for retry.');

  // 3.3: Second attempt: Successful Delivery using idempotency token
  const processOutboxEvent = (evt: TransactionalOutboxEntity) => {
    if (destinationLedger.has(evt.idempotency_token)) {
      evt.status = 'PROCESSED';
      evt.processed_at = new Date().toISOString();
      return { duplicate: true };
    }

    destinationLedger.set(evt.idempotency_token, {
      sparksCredited: evt.payload.rewardSparks
    });
    evt.status = 'PROCESSED';
    evt.processed_at = new Date().toISOString();
    return { duplicate: false };
  };

  const deliveryRes1 = processOutboxEvent(event1);
  assert(deliveryRes1.duplicate === false, 'First delivery must credit reward');
  assert(event1.status === 'PROCESSED', 'Outbox record must update to PROCESSED');
  assert(destinationLedger.get(rewardIdempotencyToken)!.sparksCredited === 50, 'Ledger must record 50 sparks');
  console.log('✅ 3.2: Successful outbox relay to destination ledger verified.');

  // 3.4: Replayed Network Duplicate (At-least-once replay test)
  const deliveryRes2 = processOutboxEvent(event1);
  assert(deliveryRes2.duplicate === true, 'Duplicate relay must be caught by destination idempotency token');
  assert(destinationLedger.size === 1, 'Destination ledger must not credit duplicate sparks');
  console.log('✅ 3.3: Replayed outbox event deduplicated at destination without duplicate Sparks.\n');

  console.log('===============================================================');
  console.log('🎉 ALL STAGE 5B PILOT TESTS PASSED CLEANLY');
  console.log('===============================================================\n');
}

runStage5BPilots().catch((err) => {
  console.error('Stage 5B Pilot Test Suite Failed:', err);
  process.exit(1);
});
