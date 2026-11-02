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
      ),
      queryPostgres(`
        CREATE TABLE IF NOT EXISTS course_module_quizzes (
          id TEXT PRIMARY KEY,
          course_id TEXT NOT NULL,
          module_id TEXT NOT NULL,
          title TEXT NOT NULL,
          passing_score INTEGER NOT NULL DEFAULT 70 CHECK (passing_score BETWEEN 1 AND 100),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
          questions_snapshot_hash TEXT NOT NULL,
          quiz_topics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          pedagogical_reasoning TEXT NOT NULL,
          questions JSONB NOT NULL CHECK (
            jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) >= 1
          ),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT course_module_quizzes_course_module_unique UNIQUE (course_id, module_id)
        )
      `),
      queryPostgres(`
        CREATE INDEX IF NOT EXISTS idx_course_module_quizzes_course
          ON course_module_quizzes (course_id)
      `)
    ]).then(() => undefined).catch((error: any) => {
      migrationPromise = null;
      throw new Error(`Course learning schema migration failed: ${error?.message || String(error)}`);
    });
  }
  await migrationPromise;
}
