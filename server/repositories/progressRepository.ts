/**
 * UniAce Mastery Hub: Student Progress & Study Batch Repository
 *
 * Enforces Safeguard #1:
 * - Insert unique batch record and increment total_study_seconds in the SAME transaction.
 * - Deduplicate on conflict (no-op, zero double-counting).
 * - Authoritative server timestamps for sequencing.
 * - Zero silent fallback to Firestore if Postgres is enabled.
 */

import { getFeatureFlags } from '../config/features';
import { getAdminApp } from '../firebaseAdmin';
import { UserCourseProgressEntity, UserStudyBatchEntity } from '../../src/types/databaseSchema';

export interface ProgressSyncInput {
  uid: string;
  courseId: string;
  batchId: string;
  deltaSeconds: number;
  completedLessonId?: string | null;
  moduleId?: string | null;
  clientTimestamp?: string | null;
}

export interface ProgressSyncResult {
  success: boolean;
  deduplicated: boolean;
  totalStudySeconds: number;
  completedLessonRecorded: boolean;
}

export class ProgressRepository {
  /**
   * Records student study time atomically with batch idempotency
   */
  async recordStudyBatch(input: ProgressSyncInput): Promise<ProgressSyncResult> {
    const { uid, courseId, batchId, deltaSeconds, completedLessonId, moduleId, clientTimestamp } = input;
    const flags = getFeatureFlags();

    if (flags.ENABLE_POSTGRES_PROGRESS) {
      // PostgreSQL atomic path (Stage 5B pilot)
      // Must execute:
      // 1. INSERT INTO user_study_batches ON CONFLICT DO NOTHING
      // 2. If inserted, increment total_study_seconds
      // 3. If completedLessonId, INSERT INTO user_lesson_completions ON CONFLICT DO NOTHING
      // ZERO SILENT FALLBACK TO FIRESTORE PERMITTED
      throw new Error('PostgreSQL progress provider not yet mounted. Feature flag must remain false in Stage 5A.');
    }

    // Default Firestore path (Stage 5A baseline preserving Stage 4B invariants)
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const progressDocId = `${uid}_${courseId}`;
    const progressRef = db.collection('user_course_progress').doc(progressDocId);
    const batchRef = db.collection('user_study_batches').doc(`${uid}_${courseId}_${batchId}`);

    let totalStudySeconds = 0;
    let deduplicated = false;
    let completedLessonRecorded = false;

    await db.runTransaction(async (tx) => {
      const [batchSnap, progressSnap] = await Promise.all([
        tx.get(batchRef),
        tx.get(progressRef)
      ]);

      // 1. Check idempotency: If batch exists, do NOT increment study seconds
      if (batchSnap.exists) {
        deduplicated = true;
        totalStudySeconds = progressSnap.exists ? Number(progressSnap.data()?.total_study_seconds || 0) : 0;
        return;
      }

      // 2. Authoritative server timestamp
      const serverTimestampIso = new Date().toISOString();
      const currentSeconds = progressSnap.exists ? Number(progressSnap.data()?.total_study_seconds || 0) : 0;
      totalStudySeconds = currentSeconds + Math.max(0, deltaSeconds);

      // 3. Record unique batch doc
      tx.set(batchRef, {
        id: `${uid}_${courseId}_${batchId}`,
        uid,
        course_id: courseId,
        batch_id: batchId,
        delta_seconds: deltaSeconds,
        client_timestamp: clientTimestamp || null,
        recorded_at: serverTimestampIso
      });

      // 4. Update course progress atomically
      const progressUpdates: Record<string, any> = {
        uid,
        course_id: courseId,
        total_study_seconds: totalStudySeconds,
        last_studied_at: serverTimestampIso,
        updated_at: serverTimestampIso
      };

      if (completedLessonId) {
        progressUpdates.last_studied_lesson_id = completedLessonId;
        // Record completion doc in normalized subcollection
        const lessonCompletionRef = db
          .collection('user_lesson_completions')
          .doc(`${uid}_${completedLessonId}`);
        tx.set(lessonCompletionRef, {
          uid,
          course_id: courseId,
          module_id: moduleId || null,
          lesson_id: completedLessonId,
          completed_at: serverTimestampIso,
          source_batch_id: batchId
        }, { merge: true });
        completedLessonRecorded = true;
      }

      tx.set(progressRef, progressUpdates, { merge: true });
    });

    return {
      success: true,
      deduplicated,
      totalStudySeconds,
      completedLessonRecorded
    };
  }

  /**
   * Fetches current study progress for a user and course
   */
  async getCourseProgress(uid: string, courseId: string): Promise<UserCourseProgressEntity | null> {
    const flags = getFeatureFlags();

    if (flags.ENABLE_POSTGRES_PROGRESS) {
      throw new Error('PostgreSQL progress provider not yet mounted.');
    }

    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const snap = await db.collection('user_course_progress').doc(`${uid}_${courseId}`).get().catch(() => null);
    if (!snap || !snap.exists) return null;

    const data = snap.data() || {};
    return {
      id: snap.id,
      uid: data.uid,
      course_id: data.course_id,
      total_study_seconds: Number(data.total_study_seconds || 0),
      last_studied_lesson_id: data.last_studied_lesson_id || null,
      last_studied_at: data.last_studied_at || new Date().toISOString(),
      completed_lessons_count: Number(data.completed_lessons_count || 0),
      completed_modules_count: Number(data.completed_modules_count || 0),
      version: Number(data.version || 1),
      updated_at: data.updated_at || new Date().toISOString()
    };
  }
}

export const progressRepository = new ProgressRepository();
