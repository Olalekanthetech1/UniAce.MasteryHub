/**
 * UniAce Mastery Hub: Durable Course Generation Job Queue Repository
 *
 * Enforces Safeguard #4:
 * - Decoupled status ('queued', 'running', 'retrying', 'completed', 'failed')
 *   from current_stage ('planning', 'syllabus', 'modules', 'lessons', 'quizzes').
 * - Atomic lease acquisition and attempt count incrementation.
 * - Active lease verification before committing stage progress.
 * - Discrete checkpoints with exact unit identifiers and input hashes.
 * - Dead-letter terminal state handling for unrecoverable errors.
 */

import { getFeatureFlags } from '../config/features';
import { getAdminApp } from '../firebaseAdmin';
import { CourseGenerationJobEntity, GenerationJobStatus, GenerationJobStage } from '../../src/types/databaseSchema';

export interface CreateJobInput {
  jobId: string;
  courseId?: string | null;
  requestedBy: string;
  promptParams: CourseGenerationJobEntity['prompt_params'];
  maxAttempts?: number;
}

export class JobQueueRepository {
  /**
   * Enqueues a new course generation job
   */
  async enqueueJob(input: CreateJobInput): Promise<CourseGenerationJobEntity> {
    const flags = getFeatureFlags();
    const nowIso = new Date().toISOString();

    const jobData: CourseGenerationJobEntity = {
      id: input.jobId,
      course_id: input.courseId || null,
      requested_by: input.requestedBy,
      prompt_params: input.promptParams,
      status: 'queued',
      current_stage: 'planning',
      progress_pct: 0,
      attempt_count: 0,
      max_attempts: input.maxAttempts || 3,
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

    if (flags.ENABLE_POSTGRES_GENERATION_JOBS) {
      throw new Error('PostgreSQL generation jobs provider not yet mounted. Feature flag must remain false in Stage 5A.');
    }

    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    await db.collection('course_generation_jobs').doc(input.jobId).set(jobData);
    return jobData;
  }

  /**
   * Atomically claims the next available job for a worker
   */
  async claimNextJob(workerId: string, leaseDurationMs = 10 * 60 * 1000): Promise<CourseGenerationJobEntity | null> {
    const flags = getFeatureFlags();

    if (flags.ENABLE_POSTGRES_GENERATION_JOBS) {
      // In PostgreSQL:
      // UPDATE course_generation_jobs SET status = 'running', worker_id = $1, lease_expires_at = ...
      // WHERE id = (SELECT id FROM ... FOR UPDATE SKIP LOCKED)
      throw new Error('PostgreSQL job claim not yet mounted.');
    }

    const app = getAdminApp();
    if (!app) return null;
    const db = app.firestore();

    let claimedJob: CourseGenerationJobEntity | null = null;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const leaseExpiresAt = new Date(now + leaseDurationMs).toISOString();

    // Scan top queued jobs
    const snap = await db
      .collection('course_generation_jobs')
      .where('status', 'in', ['queued', 'retrying'])
      .limit(5)
      .get()
      .catch(() => ({ docs: [] } as any));

    if (snap.docs.length === 0) return null;

    for (const doc of snap.docs) {
      const docRef = db.collection('course_generation_jobs').doc(doc.id);
      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(docRef);
          if (!fresh.exists) return;
          const data = fresh.data() as CourseGenerationJobEntity;

          if (data.status !== 'queued' && data.status !== 'retrying') return;
          if (data.attempt_count >= data.max_attempts) return;

          tx.update(docRef, {
            status: 'running',
            worker_id: workerId,
            worker_heartbeat_at: nowIso,
            lease_expires_at: leaseExpiresAt,
            attempt_count: Number(data.attempt_count || 0) + 1,
            started_at: data.started_at || nowIso,
            updated_at: nowIso
          });

          claimedJob = {
            ...data,
            status: 'running',
            worker_id: workerId,
            worker_heartbeat_at: nowIso,
            lease_expires_at: leaseExpiresAt,
            attempt_count: Number(data.attempt_count || 0) + 1,
            started_at: data.started_at || nowIso,
            updated_at: nowIso
          };
        });

        if (claimedJob) break;
      } catch (err) {
        // Concurrency conflict on claim, continue to next candidate
        continue;
      }
    }

    return claimedJob;
  }

  /**
   * Refreshes worker heartbeat and extends lease
   */
  async sendHeartbeat(jobId: string, workerId: string, leaseExtensionMs = 5 * 60 * 1000): Promise<boolean> {
    const app = getAdminApp();
    if (!app) return false;
    const db = app.firestore();

    const ref = db.collection('course_generation_jobs').doc(jobId);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const leaseExpiresAt = new Date(now + leaseExtensionMs).toISOString();

    let verified = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() as CourseGenerationJobEntity;

      // Verify active lease ownership
      if (data.worker_id !== workerId || data.status !== 'running') {
        throw new Error(`Worker ${workerId} lost ownership of job ${jobId}`);
      }

      tx.update(ref, {
        worker_heartbeat_at: nowIso,
        lease_expires_at: leaseExpiresAt,
        updated_at: nowIso
      });
      verified = true;
    });

    return verified;
  }

  /**
   * Atomically persists generated content and advances job checkpoint
   * within the exact same transaction, strictly validating lease ownership and expiry.
   * If the worker lease has expired or been claimed by another worker, the write
   * rolls back completely, ensuring no stale or orphaned content is ever saved.
   */
  async saveUnitContentAndCheckpoint(params: {
    jobId: string;
    workerId: string;
    courseId: string;
    stage: GenerationJobStage;
    progressPct: number;
    checkpointUpdate: CourseGenerationJobEntity['checkpoint_data'];
    unitType: 'module' | 'lesson' | 'quiz' | 'formula';
    unitPayload: {
      id: string;
      data: Record<string, any>;
      subcollection?: string;
      parentDocId?: string;
    };
  }): Promise<void> {
    const { jobId, workerId, courseId, stage, progressPct, checkpointUpdate, unitType, unitPayload } = params;
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const jobRef = db.collection('course_generation_jobs').doc(jobId);
    const nowIso = new Date().toISOString();

    await db.runTransaction(async (tx) => {
      // 1. Transactionally verify lease ownership and lease expiry
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists) throw new Error(`Job ${jobId} not found`);
      const jobData = jobSnap.data() as CourseGenerationJobEntity;

      const isLeaseActive =
        jobData.worker_id === workerId &&
        jobData.status === 'running' &&
        jobData.lease_expires_at != null &&
        new Date(jobData.lease_expires_at).getTime() > Date.now();

      if (!isLeaseActive) {
        throw new Error(
          `Transactional lease verification failed for worker ${workerId} on job ${jobId}. Write aborted to prevent stale output.`
        );
      }

      // 2. Persist the generated content document atomically in the same transaction
      if (unitType === 'module') {
        const modRef = db.collection('courses').doc(courseId).collection('modules').doc(unitPayload.id);
        tx.set(modRef, { ...unitPayload.data, updatedAt: nowIso }, { merge: true });
      } else if (unitType === 'lesson' && unitPayload.parentDocId) {
        const lesRef = db
          .collection('courses')
          .doc(courseId)
          .collection('modules')
          .doc(unitPayload.parentDocId)
          .collection('lessons')
          .doc(unitPayload.id);
        tx.set(lesRef, { ...unitPayload.data, updatedAt: nowIso }, { merge: true });
      } else if (unitType === 'quiz') {
        const quizRef = db.collection('courses').doc(courseId).collection('quizzes').doc(unitPayload.id);
        tx.set(quizRef, { ...unitPayload.data, updatedAt: nowIso }, { merge: true });
      } else if (unitType === 'formula') {
        const fRef = db.collection('courses').doc(courseId).collection('formulas').doc(unitPayload.id);
        tx.set(fRef, { ...unitPayload.data, updatedAt: nowIso }, { merge: true });
      }

      // 3. Update checkpoint atomically in the same transaction
      const mergedCheckpoint = {
        ...(jobData.checkpoint_data || {}),
        ...checkpointUpdate
      };

      tx.update(jobRef, {
        current_stage: stage,
        progress_pct: Math.min(100, Math.max(0, progressPct)),
        checkpoint_data: mergedCheckpoint,
        worker_heartbeat_at: nowIso,
        updated_at: nowIso
      });
    });
  }

  /**
   * Saves discrete checkpoint with exact unit identifier and progress percentage
   */
  async saveCheckpoint(
    jobId: string,
    workerId: string,
    stage: GenerationJobStage,
    progressPct: number,
    checkpointUpdate: CourseGenerationJobEntity['checkpoint_data']
  ): Promise<void> {
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const ref = db.collection('course_generation_jobs').doc(jobId);
    const nowIso = new Date().toISOString();

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(`Job ${jobId} not found`);
      const data = snap.data() as CourseGenerationJobEntity;

      // Enforce active lease ownership and expiry
      const isLeaseActive =
        data.worker_id === workerId &&
        data.status === 'running' &&
        data.lease_expires_at != null &&
        new Date(data.lease_expires_at).getTime() > Date.now();

      if (!isLeaseActive) {
        throw new Error(`Lease expired or claimed by another worker: job ${jobId}`);
      }

      const mergedCheckpoint = {
        ...(data.checkpoint_data || {}),
        ...checkpointUpdate
      };

      tx.update(ref, {
        current_stage: stage,
        progress_pct: Math.min(100, Math.max(0, progressPct)),
        checkpoint_data: mergedCheckpoint,
        worker_heartbeat_at: nowIso,
        updated_at: nowIso
      });
    });
  }

  /**
   * Marks job as completed or terminal failed
   */
  async finishJob(
    jobId: string,
    workerId: string,
    status: 'completed' | 'failed',
    errorMessage?: string | null
  ): Promise<void> {
    const app = getAdminApp();
    if (!app) return;
    const db = app.firestore();

    const ref = db.collection('course_generation_jobs').doc(jobId);
    const nowIso = new Date().toISOString();

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() as CourseGenerationJobEntity;

      if (data.worker_id !== workerId && data.status === 'running') {
        throw new Error(`Cannot finalize job ${jobId}: ownership mismatch`);
      }

      tx.update(ref, {
        status,
        progress_pct: status === 'completed' ? 100 : data.progress_pct,
        error_message: errorMessage || null,
        completed_at: nowIso,
        updated_at: nowIso
      });
    });
  }
}

export const jobQueueRepository = new JobQueueRepository();
