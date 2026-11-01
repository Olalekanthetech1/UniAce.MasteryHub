import { queryPostgres } from '../postgresPool';

/** Idempotent additive migrations; failures propagate instead of discarding catalog or lesson data. */
let migrationPromise: Promise<void> | null = null;

export async function ensureCourseLearningSchema(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = Promise.all([
      queryPostgres(
        'ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS instructional_content JSONB NULL'
      ),
      queryPostgres(
        'ALTER TABLE courses ADD COLUMN IF NOT EXISTS faculties TEXT[] NULL'
      ),
      queryPostgres(
        'ALTER TABLE courses ADD COLUMN IF NOT EXISTS departments TEXT[] NULL'
      ),
      queryPostgres(
        'ALTER TABLE courses ADD COLUMN IF NOT EXISTS credit_units INTEGER NULL'
      )
    ]).then(() => undefined).catch((error: any) => {
      migrationPromise = null;
      throw new Error(`Course learning schema migration failed: ${error?.message || String(error)}`);
    });
  }
  await migrationPromise;
}
