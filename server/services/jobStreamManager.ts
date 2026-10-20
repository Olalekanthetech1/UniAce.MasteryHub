/**
 * UniAce Mastery Hub: Job Stream Manager (Server-Sent Events)
 *
 * Implements real-time event streaming for Course Generation Jobs:
 * - In-memory event dispatch to connected SSE clients.
 * - Heartbeat keep-alive pings (:ping\n\n) every 15 seconds.
 * - Multi-worker database fallback probe: checks Neon PostgreSQL every 3 seconds
 *   to detect and stream updates committed by other worker instances.
 */

import { Response } from 'express';
import { EventEmitter } from 'events';
import { JobRepository, CourseGenerationJobEntity } from '../repositories/jobRepository';
import { logger } from '../logger';

interface SSEClient {
  id: string;
  res: Response;
  lastEventTime: number;
}

class JobStreamManager {
  private emitter = new EventEmitter();
  private clients = new Map<string, Set<SSEClient>>();
  private jobPollers = new Map<string, NodeJS.Timeout>();
  private lastKnownUpdatedAt = new Map<string, string>();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  /**
   * Registers an active Express Response as an SSE client for a specific jobId.
   */
  registerClient(jobId: string, res: Response, initialJob?: CourseGenerationJobEntity | null) {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const client: SSEClient = { id: clientId, res, lastEventTime: Date.now() };

    if (!this.clients.has(jobId)) {
      this.clients.set(jobId, new Set());
      this.startPollerForJob(jobId);
    }

    this.clients.get(jobId)!.add(client);
    logger.info({ jobId, clientId }, '[JobStreamManager] SSE client connected');

    // Send initial connection event
    this.sendToClient(client, 'connected', {
      jobId,
      connectedAt: new Date().toISOString(),
      job: initialJob || null
    });

    if (initialJob?.updated_at) {
      this.lastKnownUpdatedAt.set(jobId, initialJob.updated_at);
    }

    // Keep-alive heartbeat ping every 15 seconds
    const pingInterval = setInterval(() => {
      try {
        res.write(':ping\n\n');
      } catch (err) {
        clearInterval(pingInterval);
      }
    }, 15000);

    // Clean up on disconnect
    res.on('close', () => {
      clearInterval(pingInterval);
      const set = this.clients.get(jobId);
      if (set) {
        set.delete(client);
        if (set.size === 0) {
          this.clients.delete(jobId);
          this.stopPollerForJob(jobId);
        }
      }
      logger.info({ jobId, clientId }, '[JobStreamManager] SSE client disconnected');
    });
  }

  /**
   * Broadcasts an event to all connected SSE clients for a specific job.
   */
  broadcast(jobId: string, event: string, data: any) {
    const set = this.clients.get(jobId);
    if (!set || set.size === 0) return;

    for (const client of set) {
      this.sendToClient(client, event, data);
    }
  }

  /**
   * Closes a job stream and disconnects all clients with a final event.
   */
  closeJob(jobId: string, finalEvent: string, finalData: any) {
    this.broadcast(jobId, finalEvent, finalData);
    const set = this.clients.get(jobId);
    if (set) {
      for (const client of set) {
        try {
          client.res.end();
        } catch {
          // ignore
        }
      }
      this.clients.delete(jobId);
    }
    this.stopPollerForJob(jobId);
  }

  private sendToClient(client: SSEClient, event: string, data: any) {
    try {
      client.res.write(`event: ${event}\n`);
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
      client.lastEventTime = Date.now();
    } catch (err: any) {
      logger.warn({ clientId: client.id, error: err.message }, '[JobStreamManager] Error writing SSE chunk');
    }
  }

  /**
   * Multi-worker fallback poller:
   * Periodically checks the database for updates if multiple workers are executing across processes.
   */
  private startPollerForJob(jobId: string) {
    if (this.jobPollers.has(jobId)) return;

    const interval = setInterval(async () => {
      try {
        const job = await JobRepository.getJobById(jobId);
        if (!job) return;

        const lastKnown = this.lastKnownUpdatedAt.get(jobId);
        if (!lastKnown || new Date(job.updated_at).getTime() > new Date(lastKnown).getTime()) {
          this.lastKnownUpdatedAt.set(jobId, job.updated_at);
          this.broadcast(jobId, 'progress', {
            jobId: job.job_id,
            status: job.status,
            stage: job.stage,
            progressPercent: job.progress_percent,
            statusMessage: job.status_message,
            currentModule: job.current_module,
            currentLesson: job.current_lesson,
            completedModules: job.completed_modules,
            totalModules: job.total_modules,
            completedLessons: job.completed_lessons,
            totalLessons: job.total_lessons,
            activeProvider: job.active_provider,
            elapsedSeconds: job.elapsed_seconds,
            updatedAt: job.updated_at
          });

          if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
            this.closeJob(jobId, job.status, {
              jobId: job.job_id,
              status: job.status,
              error: job.generation_error,
              syllabus: job.syllabus_payload
            });
          }
        }
      } catch (err: any) {
        logger.warn({ jobId, error: err.message }, '[JobStreamManager] Multi-worker polling error');
      }
    }, 3000);

    this.jobPollers.set(jobId, interval);
  }

  private stopPollerForJob(jobId: string) {
    const timer = this.jobPollers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.jobPollers.delete(jobId);
    }
    this.lastKnownUpdatedAt.delete(jobId);
  }
}

export const jobStreamManager = new JobStreamManager();
