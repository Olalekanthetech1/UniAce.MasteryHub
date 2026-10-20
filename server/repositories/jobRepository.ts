/**
 * UniAce Mastery Hub: Course Generation Background Job Repository
 *
 * Implements Phase 4 Relational Job Engine:
 * - ACID-compliant job leasing in Neon PostgreSQL (`course_generation_jobs`).
 * - Partial unique index guard against duplicate active generation jobs (`idx_uq_active_course_job`).
 * - Split-brain "zombie worker" fencing: every write method requires `WHERE job_id = $1 AND lease_owner = $2 AND status = 'running'`.
 * - Two-branch dead-letter + `FOR UPDATE SKIP LOCKED` auto-reclaim CTE.
 * - Ephemeral single-use stream ticket management (`sse_stream_tickets`).
 * - Incremental catalog persistence (`upsertModuleAndLesson`).
 */

import crypto from 'crypto';
import { queryPostgres } from '../postgresPool';
import { logger } from '../logger';

export interface CourseGenerationJobEntity {
  job_id: string;
  course_id: string;
  user_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  stage: string;
  progress_percent: number;
  status_message: string | null;
  generation_error: string | null;
  lease_owner: string | null;
  lease_heartbeat: string | null;
  lease_expires_at: string | null;
  attempts_count: number;
  max_attempts: number;
  current_module: string | null;
  current_lesson: string | null;
  completed_modules: number;
  total_modules: number;
  completed_lessons: number;
  total_lessons: number;
  active_provider: string | null;
  elapsed_seconds: number;
  request_payload: any;
  syllabus_payload: any;
  checkpoint_logs: any[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CreateJobInput {
  jobId?: string;
  courseId: string;
  userId: string;
  workerId: string;
  requestPayload: any;
  maxAttempts?: number;
}

export interface ProgressUpdateInput {
  stage?: string;
  progressPercent?: number;
  statusMessage?: string;
  currentModule?: string;
  currentLesson?: string;
  completedModules?: number;
  totalModules?: number;
  completedLessons?: number;
  totalLessons?: number;
  activeProvider?: string;
  elapsedSeconds?: number;
  checkpoint?: {
    stage: string;
    message: string;
    timestamp?: string;
    metadata?: Record<string, any>;
  };
}

export class JobRepository {
  /**
   * Creates a new generation job or acquires/returns an existing active job.
   * If a running/queued job already exists for course_id, idx_uq_active_course_job guarantees
   * atomic deduplication.
   */
  static async createOrAcquireJob(input: CreateJobInput): Promise<{
    job: CourseGenerationJobEntity;
    created: boolean;
    alreadyActive: boolean;
  }> {
    const jobId = input.jobId || `job_${crypto.randomBytes(12).toString('hex')}`;
    const maxAttempts = input.maxAttempts || 3;

    try {
      const insertSql = `
        INSERT INTO course_generation_jobs (
          job_id, course_id, user_id, status, stage, progress_percent,
          status_message, lease_owner, lease_heartbeat, lease_expires_at,
          attempts_count, max_attempts, request_payload, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 'running', 'initialized', 0,
          'Initializing course generation worker...', $4, NOW(), NOW() + INTERVAL '30 seconds',
          1, $5, $6::jsonb, NOW(), NOW()
        )
        RETURNING *;
      `;
      const res = await queryPostgres(insertSql, [
        jobId,
        input.courseId,
        input.userId,
        input.workerId,
        maxAttempts,
        JSON.stringify(input.requestPayload || {})
      ]);

      return {
        job: res.rows[0] as CourseGenerationJobEntity,
        created: true,
        alreadyActive: false
      };
    } catch (err: any) {
      // 23505 is PostgreSQL unique_violation (triggered by idx_uq_active_course_job)
      if (err.code === '23505' || err.message?.includes('idx_uq_active_course_job')) {
        logger.warn({ courseId: input.courseId }, '[JobRepository] Active job already exists for course. Returning existing job.');
        const existing = await this.getActiveJobForCourse(input.courseId);
        if (existing) {
          return {
            job: existing,
            created: false,
            alreadyActive: true
          };
        }
      }
      throw err;
    }
  }

  /**
   * Heartbeats an active worker lease.
   * Fenced with WHERE job_id = $1 AND lease_owner = $2 AND status = 'running'.
   * Returns false if the worker's lease expired and was reassigned or cancelled.
   */
  static async heartbeat(jobId: string, workerId: string): Promise<boolean> {
    const sql = `
      UPDATE course_generation_jobs
      SET
        lease_heartbeat = NOW(),
        lease_expires_at = NOW() + INTERVAL '30 seconds',
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_owner = $2
        AND status = 'running'
      RETURNING job_id;
    `;
    const res = await queryPostgres(sql, [jobId, workerId]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Fenced progress and checkpoint updater.
   * Prevents split-brain zombie workers from overwriting reclaimed jobs.
   * Returns false if lease was revoked or job was cancelled.
   */
  static async updateProgress(
    jobId: string,
    workerId: string,
    data: ProgressUpdateInput
  ): Promise<boolean> {
    const checkpointObj = data.checkpoint
      ? {
          ...data.checkpoint,
          timestamp: data.checkpoint.timestamp || new Date().toISOString()
        }
      : null;

    const sql = `
      UPDATE course_generation_jobs
      SET
        stage = COALESCE($3, stage),
        progress_percent = COALESCE($4, progress_percent),
        status_message = COALESCE($5, status_message),
        current_module = COALESCE($6, current_module),
        current_lesson = COALESCE($7, current_lesson),
        completed_modules = COALESCE($8, completed_modules),
        total_modules = COALESCE($9, total_modules),
        completed_lessons = COALESCE($10, completed_lessons),
        total_lessons = COALESCE($11, total_lessons),
        active_provider = COALESCE($12, active_provider),
        elapsed_seconds = COALESCE($13, elapsed_seconds),
        checkpoint_logs = CASE
          WHEN $14::jsonb IS NOT NULL THEN checkpoint_logs || jsonb_build_array($14::jsonb)
          ELSE checkpoint_logs
        END,
        lease_heartbeat = NOW(),
        lease_expires_at = NOW() + INTERVAL '30 seconds',
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_owner = $2
        AND status = 'running'
      RETURNING job_id, stage, progress_percent, status_message, updated_at;
    `;

    const res = await queryPostgres(sql, [
      jobId,
      workerId,
      data.stage ?? null,
      data.progressPercent ?? null,
      data.statusMessage ?? null,
      data.currentModule ?? null,
      data.currentLesson ?? null,
      data.completedModules ?? null,
      data.totalModules ?? null,
      data.completedLessons ?? null,
      data.totalLessons ?? null,
      data.activeProvider ?? null,
      data.elapsedSeconds ?? null,
      checkpointObj ? JSON.stringify(checkpointObj) : null
    ]);

    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Records a lightweight checkpoint log into checkpoint_logs JSONB.
   */
  static async recordCheckpoint(
    jobId: string,
    workerId: string,
    logEntry: { stage: string; message: string; metadata?: Record<string, any> }
  ): Promise<boolean> {
    const entry = {
      ...logEntry,
      timestamp: new Date().toISOString()
    };

    const sql = `
      UPDATE course_generation_jobs
      SET
        checkpoint_logs = checkpoint_logs || jsonb_build_array($3::jsonb),
        lease_heartbeat = NOW(),
        lease_expires_at = NOW() + INTERVAL '30 seconds',
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_owner = $2
        AND status = 'running'
      RETURNING job_id;
    `;
    const res = await queryPostgres(sql, [jobId, workerId, JSON.stringify(entry)]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Incremental Catalog Persistence:
   * Commits each module and lesson immediately upon generation using ON CONFLICT DO UPDATE.
   * This guarantees that if a crash occurs, completed modules exist in PostgreSQL and the
   * reclaiming worker can resume directly from completed_modules + 1.
   */
  static async upsertModuleAndLesson(params: {
    courseId: string;
    module: {
      id: string;
      title: string;
      description?: string;
      orderIndex: number;
      estimatedMinutes?: number;
    };
    lesson?: {
      id: string;
      title: string;
      contentMarkdown?: string;
      orderIndex: number;
      keyTerms?: string[];
      learningOutcomes?: string[];
      assetReferences?: any;
    };
  }): Promise<void> {
    // 1. Upsert course_module
    const moduleSql = `
      INSERT INTO course_modules (
        id, course_id, title, description, order_index, estimated_minutes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW(), NOW()
      )
      ON CONFLICT (id, course_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        order_index = EXCLUDED.order_index,
        estimated_minutes = EXCLUDED.estimated_minutes,
        updated_at = NOW();
    `;
    await queryPostgres(moduleSql, [
      params.module.id,
      params.courseId,
      params.module.title,
      params.module.description || '',
      params.module.orderIndex,
      params.module.estimatedMinutes || 60
    ]);

    // 2. Upsert course_lesson (if provided)
    if (params.lesson) {
      const lessonSql = `
        INSERT INTO course_lessons (
          id, course_id, module_id, title, content_markdown, order_index,
          key_terms, learning_outcomes, asset_references, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW(), NOW()
        )
        ON CONFLICT (id, course_id, module_id) DO UPDATE SET
          title = EXCLUDED.title,
          content_markdown = EXCLUDED.content_markdown,
          order_index = EXCLUDED.order_index,
          key_terms = EXCLUDED.key_terms,
          learning_outcomes = EXCLUDED.learning_outcomes,
          asset_references = EXCLUDED.asset_references,
          updated_at = NOW();
      `;
      await queryPostgres(lessonSql, [
        params.lesson.id,
        params.courseId,
        params.module.id,
        params.lesson.title,
        params.lesson.contentMarkdown || '',
        params.lesson.orderIndex,
        params.lesson.keyTerms || [],
        params.lesson.learningOutcomes || [],
        JSON.stringify(params.lesson.assetReferences || {})
      ]);
    }
  }

  /**
   * Completes a generation job atomically.
   */
  static async completeJob(
    jobId: string,
    workerId: string,
    syllabusPayload?: any
  ): Promise<boolean> {
    const sql = `
      UPDATE course_generation_jobs
      SET
        status = 'completed',
        stage = 'completed',
        progress_percent = 100,
        status_message = 'Course generation completed successfully.',
        syllabus_payload = COALESCE($3::jsonb, syllabus_payload),
        lease_owner = NULL,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_owner = $2
        AND status = 'running'
      RETURNING job_id;
    `;
    const res = await queryPostgres(sql, [
      jobId,
      workerId,
      syllabusPayload ? JSON.stringify(syllabusPayload) : null
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Fails a generation job atomically.
   */
  static async failJob(
    jobId: string,
    workerId: string,
    errorMessage: string
  ): Promise<boolean> {
    const sql = `
      UPDATE course_generation_jobs
      SET
        status = 'failed',
        stage = 'failed',
        status_message = 'Course generation failed on server.',
        generation_error = $3,
        lease_owner = NULL,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_owner = $2
        AND status = 'running'
      RETURNING job_id;
    `;
    const res = await queryPostgres(sql, [jobId, workerId, errorMessage]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Cancels a generation job (called by Admin).
   */
  static async cancelJob(jobId: string, cancelledBy: string = 'admin'): Promise<boolean> {
    const sql = `
      UPDATE course_generation_jobs
      SET
        status = 'cancelled',
        stage = 'cancelled',
        status_message = 'Course generation cancelled by ' || $2,
        lease_owner = NULL,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE job_id = $1
        AND status IN ('queued', 'running')
      RETURNING job_id;
    `;
    const res = await queryPostgres(sql, [jobId, cancelledBy]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Two-Branch Atomic Dead-Letter + SKIP LOCKED Reclaim CTE:
   * Branch 1: Transitions expired leases with attempts_count >= max_attempts to 'failed'.
   * Branch 2: Acquires the next claimable job using FOR UPDATE SKIP LOCKED and increments attempts_count.
   */
  static async reclaimStaleJobs(workerId: string): Promise<CourseGenerationJobEntity | null> {
    const sql = `
      WITH exhausted_jobs AS (
        UPDATE course_generation_jobs
        SET
          status = 'failed',
          stage = 'failed_max_retries',
          generation_error = 'Worker lease expired after reaching maximum retry attempts (' || max_attempts || ').',
          lease_owner = NULL,
          updated_at = NOW(),
          completed_at = NOW()
        WHERE status = 'running'
          AND lease_expires_at < NOW()
          AND attempts_count >= max_attempts
        RETURNING job_id
      ),
      claimable AS (
        SELECT job_id
        FROM course_generation_jobs
        WHERE (
            status = 'queued'
            OR (status = 'running' AND lease_expires_at < NOW())
          )
          AND attempts_count < max_attempts
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE course_generation_jobs j
      SET
        status = 'running',
        lease_owner = $1,
        lease_heartbeat = NOW(),
        lease_expires_at = NOW() + INTERVAL '30 seconds',
        attempts_count = j.attempts_count + 1,
        updated_at = NOW()
      FROM claimable c
      WHERE j.job_id = c.job_id
      RETURNING j.*;
    `;

    const res = await queryPostgres(sql, [workerId]);
    if (res.rows.length === 0) {
      return null;
    }
    return res.rows[0] as CourseGenerationJobEntity;
  }

  /**
   * Fetches job by ID.
   */
  static async getJobById(jobId: string): Promise<CourseGenerationJobEntity | null> {
    const sql = `SELECT * FROM course_generation_jobs WHERE job_id = $1;`;
    const res = await queryPostgres(sql, [jobId]);
    return (res.rows[0] as CourseGenerationJobEntity) || null;
  }

  /**
   * Fetches active job for a specific course.
   */
  static async getActiveJobForCourse(courseId: string): Promise<CourseGenerationJobEntity | null> {
    const sql = `
      SELECT * FROM course_generation_jobs
      WHERE course_id = $1 AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const res = await queryPostgres(sql, [courseId]);
    return (res.rows[0] as CourseGenerationJobEntity) || null;
  }

  /**
   * Returns recent generation jobs for administration overview.
   */
  static async getRecentJobs(limit: number = 20): Promise<CourseGenerationJobEntity[]> {
    const sql = `
      SELECT * FROM course_generation_jobs
      ORDER BY created_at DESC
      LIMIT $1;
    `;
    const res = await queryPostgres(sql, [Math.min(limit, 100)]);
    return res.rows as CourseGenerationJobEntity[];
  }

  /**
   * Issues a short-lived (30s) single-use SSE stream ticket.
   */
  static async issueStreamTicket(jobId: string, userId: string): Promise<string> {
    const ticketId = `tkt_${crypto.randomBytes(16).toString('hex')}`;
    const sql = `
      INSERT INTO sse_stream_tickets (ticket_id, job_id, user_id, expires_at, consumed, created_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '30 seconds', FALSE, NOW())
      RETURNING ticket_id;
    `;
    await queryPostgres(sql, [ticketId, jobId, userId]);
    return ticketId;
  }

  /**
   * Validates and consumes an ephemeral SSE stream ticket.
   * Also opportunistically cleans up expired tickets.
   */
  static async consumeStreamTicket(
    ticketId: string,
    jobId: string
  ): Promise<{ valid: boolean; userId?: string }> {
    // Opportunistic cleanup of expired tickets
    queryPostgres(`DELETE FROM sse_stream_tickets WHERE expires_at < NOW() - INTERVAL '1 minute';`).catch(
      (err) => logger.warn({ error: err.message }, '[JobRepository] Failed to clean expired tickets')
    );

    const sql = `
      UPDATE sse_stream_tickets
      SET consumed = TRUE
      WHERE ticket_id = $1
        AND job_id = $2
        AND consumed = FALSE
        AND expires_at > NOW()
      RETURNING user_id;
    `;
    const res = await queryPostgres(sql, [ticketId, jobId]);
    if (res.rows.length === 0) {
      return { valid: false };
    }
    return { valid: true, userId: res.rows[0].user_id };
  }
}
