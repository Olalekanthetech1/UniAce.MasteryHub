import { queryPostgres } from '../postgresPool';

/**
 * Additive, idempotent persistence for student lesson-practice attempts.
 * A reveal is served only after the student's attempt is committed here.
 */
let migrationPromise: Promise<void> | null = null;

export async function ensureCourseAssessmentSchema(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await queryPostgres(`
        CREATE TABLE IF NOT EXISTS course_lesson_practice_attempts (
          id BIGSERIAL PRIMARY KEY,
          uid TEXT NOT NULL,
          course_id TEXT NOT NULL,
          module_id TEXT NOT NULL,
          lesson_id TEXT NOT NULL,
          activity_type TEXT NOT NULL CHECK (
            activity_type IN ('guidedPractice', 'independentPractice', 'knowledgeChecks')
          ),
          activity_index INTEGER NOT NULL CHECK (activity_index >= 0),
          response_text TEXT NOT NULL,
          attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await queryPostgres(`
        CREATE INDEX IF NOT EXISTS idx_lesson_practice_attempts_user_lesson
        ON course_lesson_practice_attempts (uid, course_id, lesson_id, attempted_at DESC)
      `);
    })().catch((error: any) => {
      migrationPromise = null;
      throw new Error(`Course assessment schema migration failed: ${error?.message || String(error)}`);
    });
  }
  await migrationPromise;
}
