import { queryPostgres } from '../postgresPool';

let migrationPromise: Promise<void> | null = null;

/** Additive, idempotent persistence for draft review decisions and generation completion state. */
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
        "ALTER TABLE courses ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'completed'"
      );
      await queryPostgres('ALTER TABLE courses ADD COLUMN IF NOT EXISTS generation_error TEXT');
      await queryPostgres('ALTER TABLE courses ADD COLUMN IF NOT EXISTS generation_skeleton JSONB');
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
        'CREATE INDEX IF NOT EXISTS idx_courses_draft_review_queue ON courses (status, generation_status, review_status, updated_at DESC)'
      );
      await queryPostgres(
        'CREATE INDEX IF NOT EXISTS idx_course_review_events_course_created ON course_review_events (course_id, created_at DESC)'
      );
      // Reconcile any existing draft courses whose generation stopped before all modules had lessons
      await queryPostgres(`
        UPDATE courses c
        SET generation_status = 'failed',
            generation_error = COALESCE(c.generation_error, 'Course generation did not complete all modules and lessons.')
        WHERE c.status = 'draft'
          AND c.generation_status = 'completed'
          AND (
            NOT EXISTS (
              SELECT 1 FROM course_modules cm
              WHERE cm.course_id = c.id AND COALESCE(cm.is_archived, FALSE) = FALSE
            )
            OR NOT EXISTS (
              SELECT 1 FROM course_lessons cl
              WHERE cl.course_id = c.id AND LENGTH(TRIM(COALESCE(cl.content_markdown, ''))) >= 600
            )
            OR EXISTS (
              SELECT 1 FROM course_modules cm
              WHERE cm.course_id = c.id
                AND COALESCE(cm.is_archived, FALSE) = FALSE
                AND NOT EXISTS (
                  SELECT 1 FROM course_lessons cl
                  WHERE cl.course_id = c.id
                    AND cl.module_id = cm.id
                    AND LENGTH(TRIM(COALESCE(cl.content_markdown, ''))) >= 600
                )
            )
          )
      `).catch(() => undefined);
    })().catch((error: any) => {
      migrationPromise = null;
      throw new Error('Course review schema migration failed: ' + (error?.message || String(error)));
    });
  }
  await migrationPromise;
}
