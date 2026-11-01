import { queryPostgres } from '../postgresPool';

let migrationPromise: Promise<void> | null = null;

/** Additive, idempotent persistence for draft review decisions and their audit history. */
export async function ensureCourseReviewSchema(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await queryPostgres(
        "ALTER TABLE courses ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending'"
      );
      await queryPostgres('ALTER TABLE courses ADD COLUMN IF NOT EXISTS review_notes TEXT');
      await queryPostgres('ALTER TABLE courses ADD COLUMN IF NOT EXISTS reviewed_by TEXT');
      await queryPostgres('ALTER TABLE courses ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ');
      await queryPostgres(
        "CREATE TABLE IF NOT EXISTS course_review_events (" +
        "event_id BIGSERIAL PRIMARY KEY, " +
        "course_id TEXT NOT NULL, " +
        "actor_uid TEXT NOT NULL, " +
        "actor_email TEXT, " +
        "action TEXT NOT NULL, " +
        "from_status TEXT, " +
        "to_status TEXT, " +
        "notes TEXT, " +
        "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
      );
      await queryPostgres(
        'CREATE INDEX IF NOT EXISTS idx_courses_draft_review_queue ON courses (status, review_status, updated_at DESC)'
      );
      await queryPostgres(
        'CREATE INDEX IF NOT EXISTS idx_course_review_events_course_created ON course_review_events (course_id, created_at DESC)'
      );
    })().catch((error: any) => {
      migrationPromise = null;
      throw new Error('Course review schema migration failed: ' + (error?.message || String(error)));
    });
  }
  await migrationPromise;
}
