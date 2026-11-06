import crypto from 'crypto';
import { getPostgresPool } from '../postgresPool';

export type AvailabilityState = 'live' | 'coming_soon' | 'hidden';

export interface AcademicLevelAvailability {
  level_key: string;
  label: string;
  availability: AvailabilityState;
  sort_order: number;
  updated_at: string;
}

const VALID_STATES = new Set<AvailabilityState>(['live', 'coming_soon', 'hidden']);
let migrationPromise: Promise<void> | null = null;

export function normalizeAcademicLevelKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^level\s*/, '')
    .replace(/\s*(?:level|lvl|l)$/, '')
    .replace(/[^a-z0-9_-]/g, '');
}

export function isAvailabilityState(value: unknown): value is AvailabilityState {
  return typeof value === 'string' && VALID_STATES.has(value as AvailabilityState);
}

export async function ensureAcademicAvailabilitySchema(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const pool = getPostgresPool();
      if (!pool) throw new Error('Academic availability is unavailable: PostgreSQL is not connected.');

      await pool.query(`
        CREATE TABLE IF NOT EXISTS academic_level_availability (
          level_key TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          availability TEXT NOT NULL DEFAULT 'hidden'
            CHECK (availability IN ('live', 'coming_soon', 'hidden')),
          sort_order INTEGER NOT NULL DEFAULT 0,
          updated_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS student_visibility TEXT');
      // Preserve the existing student experience on first rollout: already-published
      // courses remain visible. Draft and in-review courses stay hidden by default.
      await pool.query(`
        UPDATE courses
        SET student_visibility = CASE WHEN status = 'published' THEN 'live' ELSE 'hidden' END
        WHERE student_visibility IS NULL
      `);
      await pool.query("UPDATE courses SET student_visibility = 'hidden' WHERE student_visibility NOT IN ('live', 'coming_soon', 'hidden')");
      await pool.query("ALTER TABLE courses ALTER COLUMN student_visibility SET DEFAULT 'hidden'");
      await pool.query("ALTER TABLE courses ALTER COLUMN student_visibility SET NOT NULL");

      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'courses_student_visibility_check'
          ) THEN
            ALTER TABLE courses
              ADD CONSTRAINT courses_student_visibility_check
              CHECK (student_visibility IN ('live', 'coming_soon', 'hidden'));
          END IF;
        END $$
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS academic_availability_audit (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('academic_level', 'course')),
          entity_id TEXT NOT NULL,
          previous_state TEXT,
          next_state TEXT NOT NULL,
          actor_uid TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_academic_availability_audit_entity
        ON academic_availability_audit (entity_type, entity_id, created_at DESC)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_courses_student_visibility
        ON courses (student_visibility)
      `);

      const defaults: Array<[string, string, AvailabilityState, number]> = [
        ['100', '100 Level', 'live', 100],
        ['200', '200 Level', 'coming_soon', 200],
        ['300', '300 Level', 'coming_soon', 300],
        ['400', '400 Level', 'coming_soon', 400],
        ['500', '500 Level', 'coming_soon', 500]
      ];
      for (const [key, label, availability, sortOrder] of defaults) {
        await pool.query(
          `INSERT INTO academic_level_availability (level_key, label, availability, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (level_key) DO NOTHING`,
          [key, label, availability, sortOrder]
        );
      }
    })().catch((error: any) => {
      migrationPromise = null;
      throw new Error(`Academic availability schema migration failed: ${error?.message || String(error)}`);
    });
  }
  await migrationPromise;
}

export async function listAcademicLevelAvailability(): Promise<AcademicLevelAvailability[]> {
  await ensureAcademicAvailabilitySchema();
  const pool = getPostgresPool();
  if (!pool) throw new Error('Academic availability is unavailable: PostgreSQL is not connected.');
  const result = await pool.query<AcademicLevelAvailability>(
    `SELECT level_key, label, availability, sort_order, updated_at
     FROM academic_level_availability
     ORDER BY sort_order ASC, level_key ASC`
  );
  return result.rows;
}

export async function listStudentVisibleAcademicLevels(): Promise<AcademicLevelAvailability[]> {
  const levels = await listAcademicLevelAvailability();
  return levels.filter(level => level.availability !== 'hidden');
}

export async function createAcademicLevelAvailability(input: {
  levelKey: unknown;
  label: unknown;
  availability?: unknown;
  sortOrder?: unknown;
  actorUid: string;
}): Promise<AcademicLevelAvailability> {
  await ensureAcademicAvailabilitySchema();
  const levelKey = normalizeAcademicLevelKey(input.levelKey);
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const availability = input.availability === undefined ? 'hidden' : input.availability;
  const sortOrder = input.sortOrder === undefined ? 0 : Number(input.sortOrder);

  if (!levelKey || levelKey.length > 20 || !/^[a-z0-9_-]+$/.test(levelKey)) {
    throw Object.assign(new Error('Provide a valid academic level key (letters, numbers, hyphens or underscores; maximum 20 characters).'), { statusCode: 400 });
  }
  if (!label || label.length > 80) {
    throw Object.assign(new Error('Academic level label is required and must not exceed 80 characters.'), { statusCode: 400 });
  }
  if (!isAvailabilityState(availability)) {
    throw Object.assign(new Error('Availability must be live, coming_soon or hidden.'), { statusCode: 400 });
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
    throw Object.assign(new Error('Sort order must be a non-negative whole number.'), { statusCode: 400 });
  }

  const pool = getPostgresPool();
  if (!pool) throw new Error('Academic availability is unavailable: PostgreSQL is not connected.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query<AcademicLevelAvailability>(
      `INSERT INTO academic_level_availability (level_key, label, availability, sort_order, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (level_key) DO NOTHING
       RETURNING level_key, label, availability, sort_order, updated_at`,
      [levelKey, label, availability, sortOrder, input.actorUid]
    );
    if (!inserted.rows[0]) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error(`Academic level ${levelKey} already exists.`), { statusCode: 409 });
    }
    await client.query(
      `INSERT INTO academic_availability_audit (id, entity_type, entity_id, previous_state, next_state, actor_uid)
       VALUES ($1, 'academic_level', $2, NULL, $3, $4)`,
      [crypto.randomUUID(), levelKey, availability, input.actorUid]
    );
    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAcademicLevelAvailability(
  levelKeyInput: string,
  input: { availability?: unknown; label?: unknown; sortOrder?: unknown; actorUid: string }
): Promise<AcademicLevelAvailability> {
  await ensureAcademicAvailabilitySchema();
  const levelKey = normalizeAcademicLevelKey(levelKeyInput);
  const availability = input.availability;
  const label = input.label === undefined ? undefined : (typeof input.label === 'string' ? input.label.trim() : '');
  const sortOrder = input.sortOrder === undefined ? undefined : Number(input.sortOrder);

  if (!levelKey) throw Object.assign(new Error('A valid academic level key is required.'), { statusCode: 400 });
  if (availability !== undefined && !isAvailabilityState(availability)) {
    throw Object.assign(new Error('Availability must be live, coming_soon or hidden.'), { statusCode: 400 });
  }
  if (label !== undefined && (!label || label.length > 80)) {
    throw Object.assign(new Error('Academic level label is required and must not exceed 80 characters.'), { statusCode: 400 });
  }
  if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000)) {
    throw Object.assign(new Error('Sort order must be a non-negative whole number.'), { statusCode: 400 });
  }
  if (availability === undefined && label === undefined && sortOrder === undefined) {
    throw Object.assign(new Error('At least one availability, label or sortOrder field is required.'), { statusCode: 400 });
  }

  const pool = getPostgresPool();
  if (!pool) throw new Error('Academic availability is unavailable: PostgreSQL is not connected.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<AcademicLevelAvailability>(
      `SELECT level_key, label, availability, sort_order, updated_at
       FROM academic_level_availability WHERE level_key = $1 FOR UPDATE`,
      [levelKey]
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error(`Academic level ${levelKey} was not found.`), { statusCode: 404 });
    }
    const previous = current.rows[0];
    const updated = await client.query<AcademicLevelAvailability>(
      `UPDATE academic_level_availability
       SET availability = COALESCE($1, availability),
           label = COALESCE($2, label),
           sort_order = COALESCE($3, sort_order),
           updated_by = $4,
           updated_at = NOW()
       WHERE level_key = $5
       RETURNING level_key, label, availability, sort_order, updated_at`,
      [availability ?? null, label ?? null, sortOrder ?? null, input.actorUid, levelKey]
    );
    const next = updated.rows[0];
    if (previous.availability !== next.availability) {
      await client.query(
        `INSERT INTO academic_availability_audit (id, entity_type, entity_id, previous_state, next_state, actor_uid)
         VALUES ($1, 'academic_level', $2, $3, $4, $5)`,
        [crypto.randomUUID(), levelKey, previous.availability, next.availability, input.actorUid]
      );
    }
    await client.query('COMMIT');
    return next;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCourseStudentVisibility(
  courseId: string,
  availability: unknown,
  actorUid: string
): Promise<{ courseId: string; availability: AvailabilityState }> {
  await ensureAcademicAvailabilitySchema();
  if (!isAvailabilityState(availability)) {
    throw Object.assign(new Error('Availability must be live, coming_soon or hidden.'), { statusCode: 400 });
  }
  const id = typeof courseId === 'string' ? courseId.trim() : '';
  if (!id) throw Object.assign(new Error('A valid course ID is required.'), { statusCode: 400 });

  const pool = getPostgresPool();
  if (!pool) throw new Error('Academic availability is unavailable: PostgreSQL is not connected.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ status: string; student_visibility: AvailabilityState }>(
      'SELECT status, student_visibility FROM courses WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Course was not found.'), { statusCode: 404 });
    }
    if (current.rows[0].status !== 'published') {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Only published courses can be made visible to students. Complete the existing review and publication workflow first.'), { statusCode: 409 });
    }
    const previous = current.rows[0].student_visibility;
    await client.query(
      `UPDATE courses
       SET student_visibility = $1, version = COALESCE(version, 1) + 1, updated_at = NOW()
       WHERE id = $2`,
      [availability, id]
    );
    if (previous !== availability) {
      await client.query(
        `INSERT INTO academic_availability_audit (id, entity_type, entity_id, previous_state, next_state, actor_uid)
         VALUES ($1, 'course', $2, $3, $4, $5)`,
        [crypto.randomUUID(), id, previous, availability, actorUid]
      );
    }
    await client.query('COMMIT');
    return { courseId: id, availability };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}


export interface AcademicAvailabilityAuditRecord {
  id: string;
  entity_type: 'academic_level' | 'course';
  entity_id: string;
  previous_state: string | null;
  next_state: string;
  actor_uid: string;
  created_at: string;
}

export async function listRecentAcademicAvailabilityAudit(limitInput: unknown = 15): Promise<AcademicAvailabilityAuditRecord[]> {
  await ensureAcademicAvailabilitySchema();
  const pool = getPostgresPool();
  if (!pool) throw new Error('Academic availability is unavailable: PostgreSQL is not connected.');
  const parsedLimit = Number(limitInput);
  const limit = Number.isInteger(parsedLimit) ? Math.max(1, Math.min(50, parsedLimit)) : 15;
  const result = await pool.query<AcademicAvailabilityAuditRecord>(
    `SELECT id, entity_type, entity_id, previous_state, next_state, actor_uid, created_at
     FROM academic_availability_audit
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}
