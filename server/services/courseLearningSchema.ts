import { queryPostgres } from '../postgresPool';

/** Idempotent additive migration; failures propagate instead of discarding lesson data. */
let migrationPromise: Promise<void> | null = null;

export async function ensureCourseLearningSchema(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = queryPostgres(
      'ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS instructional_content JSONB NULL'
    ).then(() => undefined).catch((error: any) => {
      migrationPromise = null;
      throw new Error(`Course learning schema migration failed: ${error?.message || String(error)}`);
    });
  }
  await migrationPromise;
}
