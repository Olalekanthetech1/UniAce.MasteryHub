import { queryPostgres } from '../postgresPool';
let migrationPromise: Promise<void> | null = null;
export async function ensureCourseLifecycleSchema(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = queryPostgres('CREATE TABLE IF NOT EXISTS course_lifecycle_tombstones (course_id TEXT PRIMARY KEY, course_code TEXT, course_title TEXT, deleted_by TEXT NOT NULL, deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
      .then(() => undefined)
      .catch((error: any) => { migrationPromise = null; throw new Error(`Course lifecycle schema migration failed: ${error?.message || String(error)}`); });
  }
  await migrationPromise;
}
