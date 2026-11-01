/**
 * UniAce Mastery Hub: Course Catalog Repository
 *
 * Implements Stage 5C Phase 1: Authoritative PostgreSQL Course Catalog.
 * - All catalog, modules, lessons, and formulas reads prioritize Neon PostgreSQL.
 * - L1 MultiInstanceCatalogCache (<5ms) active for repeated requests.
 * - When PostgreSQL is unreachable or L1 misses: returns cached data or throws clean
 *   database service unavailable error (HTTP 503). Zero Firestore fallback reads permitted.
 * - Writes enforce Safeguard #2: Zero Silent Fallback Writes (throws immediately on Postgres error).
 */

import crypto from 'crypto';
import { getFeatureFlags } from '../config/features';
import { catalogCache } from '../cache/catalogCache';
import { CourseEntity, CourseModuleEntity, CourseLessonEntity, CourseFormulaEntity } from '../../src/types/databaseSchema';
import { queryPostgres } from '../postgresPool';
import { logger } from '../logger';
import { ensureCourseLearningSchema } from '../services/courseLearningSchema';
import { sortCourseSyllabus, getModuleOrderIndex, getLessonOrderIndex } from '../../src/shared/courseSchemas';

export interface CourseQueryFilter {
  status?: CourseEntity['status'];
  department?: string;
  level?: string;
  limit?: number;
}

/**
 * Convert an authoritative PostgreSQL course row without substituting invented
 * metadata. A malformed persisted course is rejected and surfaced to the caller.
 */
function mapCourseRecord(row: any): CourseEntity {
  const requiredText = ['id', 'code', 'title', 'level', 'status'];
  for (const field of requiredText) {
    if (typeof row[field] !== 'string' || !row[field].trim()) {
      throw new Error(`Course catalog record is missing required persisted field: ${field}.`);
    }
  }


  const version = Number(row.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Course ${row.id} is missing a valid persisted version.`);
  }

  const toPersistedIso = (value: unknown, field: string): string => {
    const date = value instanceof Date
      ? value
      : (typeof value === 'string' && value.trim() ? new Date(value) : null);
    if (!date || Number.isNaN(date.getTime())) {
      throw new Error(`Course ${row.id} is missing a valid persisted ${field} timestamp.`);
    }
    return date.toISOString();
  };

  const semester = row.semester == null
    ? null
    : (typeof row.semester === 'string' && row.semester.trim() ? row.semester : null);
  if (row.semester != null && semester === null) {
    throw new Error(`Course ${row.id} has an invalid persisted semester value.`);
  }

  const creditUnits = row.credit_units == null ? null : Number(row.credit_units);
  if (creditUnits !== null && (!Number.isInteger(creditUnits) || creditUnits < 1 || creditUnits > 12)) {
    throw new Error(`Course ${row.id} has invalid persisted credit units.`);
  }
  const generationStatuses = ['none', 'queued', 'generating', 'completed', 'failed'] as const;
  if (row.generation_status != null && !generationStatuses.includes(row.generation_status)) {
    throw new Error(`Course ${row.id} has an invalid persisted generation status.`);
  }

  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: typeof row.description === 'string' ? row.description : null,
    level: row.level,
    department: typeof row.department === 'string' ? row.department : null,
    faculty: typeof row.faculty === 'string' ? row.faculty : null,
    faculties: Array.isArray(row.faculties) ? row.faculties : null,
    departments: Array.isArray(row.departments) ? row.departments : null,
    scope: typeof row.scope === 'string' ? row.scope : null,
    semester: semester as CourseEntity['semester'],
    credit_units: creditUnits,
    thumbnail_url: typeof row.thumbnail_url === 'string' ? row.thumbnail_url : null,
    author_id: typeof row.author_id === 'string' && row.author_id.trim() ? row.author_id : null,
    status: row.status,
    version,
    created_at: toPersistedIso(row.created_at, 'created_at'),
    updated_at: toPersistedIso(row.updated_at, 'updated_at'),
    ...(typeof row.generation_status === 'string' ? { generation_status: row.generation_status as CourseEntity['generation_status'] } : {}),
    ...(typeof row.generation_job_id === 'string' ? { generation_job_id: row.generation_job_id } : {}),
    ...(typeof row.content_hash === 'string' ? { content_hash: row.content_hash } : {})
  };
}

export class CourseRepository {
  /**
   * Fetches published courses list with caching & resilient routing
   */
  async listPublishedCourses(filter: CourseQueryFilter = {}, forceRefresh = false): Promise<CourseEntity[]> {
    await ensureCourseLearningSchema();
    const flags = getFeatureFlags();
    const cacheKey = `catalog:list:${filter.department || 'all'}:${filter.level || 'all'}`;

    // 1. Attempt L1 memory cache read (<5ms)
    const cached = forceRefresh ? null : catalogCache.getPublished<CourseEntity[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Authoritative PostgreSQL Path
    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        let sql = `
          SELECT id, code, title, description, level, department, faculty, semester, credit_units, faculties, departments, scope,
                 thumbnail_url, author_id, status, version, created_at, updated_at
          FROM courses
          WHERE 1=1
        `;
        const params: any[] = [];

        if (filter.status) {
          params.push(filter.status);
          sql += ` AND status = $${params.length}`;
        } else {
          sql += ` AND status = 'published'`;
        }

        if (filter.department) {
          params.push(filter.department);
          sql += ` AND department = $${params.length}`;
        }

        sql += ` ORDER BY code ASC`;

        if (filter.limit) {
          params.push(filter.limit);
          sql += ` LIMIT $${params.length}`;
        }

        const res = await queryPostgres<any>(sql, params);
        const courses: CourseEntity[] = res.rows.map(mapCourseRecord);

        // Populate in-memory cache
        catalogCache.setPublished(cacheKey, courses, 1);
        return courses;
      } catch (err: any) {
        logger.warn({ error: err.message }, '[CourseRepository] PostgreSQL listPublishedCourses query failed');
      }
    }

    // Zero-Firestore fallback: check if cached in L1 or throw clean error
    const staleCached = forceRefresh ? null : catalogCache.getPublished<CourseEntity[]>(cacheKey);
    if (staleCached) {
      return staleCached;
    }
    throw new Error('Database service unavailable: PostgreSQL catalog is unreachable');
  }

  /**
   * Fetches single course metadata
   */
  async getCourseById(courseId: string): Promise<CourseEntity | null> {
    await ensureCourseLearningSchema();
    const flags = getFeatureFlags();
    const cacheKey = `catalog:course:${courseId}`;

    const cached = catalogCache.getPublished<CourseEntity>(cacheKey);
    if (cached) {
      return cached;
    }

    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        const sql = `
          SELECT id, code, title, description, level, department, faculty, semester, credit_units, faculties, departments, scope,
                 thumbnail_url, author_id, status, version, created_at, updated_at
          FROM courses
          WHERE id = $1
          LIMIT 1
        `;
        const res = await queryPostgres<any>(sql, [courseId]);
        if (res.rows.length > 0) {
          const r = res.rows[0];
          const course: CourseEntity = mapCourseRecord(r);
          catalogCache.setPublished(cacheKey, course, course.version || 1);
          return course;
        }
        return null;
      } catch (err: any) {
        logger.warn({ courseId, error: err.message }, '[CourseRepository] PostgreSQL getCourseById query failed');
      }
    }

    const staleCached = catalogCache.getPublished<CourseEntity>(cacheKey);
    if (staleCached) {
      return staleCached;
    }
    throw new Error(`Database service unavailable: PostgreSQL course ${courseId} is unreachable`);
  }

  /**
   * Fetches all modules for a course
   */
  async getCourseModules(courseId: string): Promise<CourseModuleEntity[]> {
    const flags = getFeatureFlags();
    const cacheKey = `catalog:modules:${courseId}`;

    const cached = catalogCache.getPublished<CourseModuleEntity[]>(cacheKey);
    if (cached) {
      return cached;
    }

    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        const sql = `
          SELECT id, course_id, title, description, order_index, estimated_minutes, created_at, updated_at
          FROM course_modules
          WHERE course_id = $1 AND (is_archived IS NOT TRUE OR is_archived IS NULL)
          ORDER BY order_index ASC
        `;
        const res = await queryPostgres<CourseModuleEntity>(sql, [courseId]);
        const modules = res.rows;
        catalogCache.setPublished(cacheKey, modules, 1);
        return modules;
      } catch (err: any) {
        logger.warn({ courseId, error: err.message }, '[CourseRepository] PostgreSQL getCourseModules query failed');
      }
    }

    const staleCached = catalogCache.getPublished<CourseModuleEntity[]>(cacheKey);
    if (staleCached) {
      return staleCached;
    }
    throw new Error(`Database service unavailable: PostgreSQL modules for ${courseId} unreachable`);
  }

  /**
   * Fetches all lessons for a given course and module
   */
  async getCourseLessons(courseId: string, moduleId: string): Promise<CourseLessonEntity[]> {
    await ensureCourseLearningSchema();
    const flags = getFeatureFlags();
    const cacheKey = `catalog:lessons:${courseId}:${moduleId}`;

    const cached = catalogCache.getPublished<CourseLessonEntity[]>(cacheKey);
    if (cached) {
      return cached;
    }

    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        const modRes = await queryPostgres<{ is_archived: boolean }>(
          `SELECT is_archived FROM course_modules WHERE course_id = $1 AND id = $2`,
          [courseId, moduleId]
        );
        if (modRes.rows.length === 0 || modRes.rows[0].is_archived) {
          return [];
        }

        const sql = `
          SELECT id, course_id, module_id, title, content_markdown, order_index,
                 key_terms, learning_outcomes, asset_references, instructional_content, created_at, updated_at
          FROM course_lessons
          WHERE course_id = $1 AND module_id = $2
          ORDER BY order_index ASC
        `;
        const res = await queryPostgres<CourseLessonEntity>(sql, [courseId, moduleId]);
        const lessons = res.rows;
        catalogCache.setPublished(cacheKey, lessons, 1);
        return lessons;
      } catch (err: any) {
        logger.warn({ courseId, moduleId, error: err.message }, '[CourseRepository] PostgreSQL getCourseLessons query failed');
      }
    }

    const staleCached = catalogCache.getPublished<CourseLessonEntity[]>(cacheKey);
    if (staleCached) {
      return staleCached;
    }
    throw new Error(`Database service unavailable: PostgreSQL lessons for ${courseId}/${moduleId} unreachable`);
  }

  /**
   * Fetches formulas for a given course
   */
  async getCourseFormulas(courseId: string): Promise<CourseFormulaEntity[]> {
    const flags = getFeatureFlags();
    const cacheKey = `catalog:formulas:${courseId}`;

    const cached = catalogCache.getPublished<CourseFormulaEntity[]>(cacheKey);
    if (cached) {
      return cached;
    }

    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        const sql = `
          SELECT id, course_id, name, latex_expression, variables_breakdown, derivation_notes, created_at
          FROM course_formulas
          WHERE course_id = $1
          ORDER BY name ASC
        `;
        const res = await queryPostgres<CourseFormulaEntity>(sql, [courseId]);
        const formulas = res.rows;
        catalogCache.setPublished(cacheKey, formulas, 1);
        return formulas;
      } catch (err: any) {
        logger.warn({ courseId, error: err.message }, '[CourseRepository] PostgreSQL getCourseFormulas query failed');
      }
    }

    const staleCached = catalogCache.getPublished<CourseFormulaEntity[]>(cacheKey);
    if (staleCached) {
      return staleCached;
    }
    throw new Error(`Database service unavailable: PostgreSQL formulas for ${courseId} unreachable`);
  }

  /**
   * Updates course status to published with atomic cache invalidation
   * Enforces Safeguard #2: Zero Silent Fallback Writes.
   */
  async publishCourse(courseId: string, authorUid: string): Promise<{ success: boolean; newVersion: number }> {
    const flags = getFeatureFlags();

    if (!flags.ENABLE_POSTGRES_CATALOG) {
      throw new Error('Course publishing unavailable: ENABLE_POSTGRES_CATALOG is disabled');
    }

    // Must execute atomic Postgres update and throw on any error
    // ZERO SILENT FALLBACK TO FIRESTORE PERMITTED ON WRITES
    const checkRes = await queryPostgres<{
      id: string;
      version: number;
      title: string;
      level: string;
      department: string | null;
      semester: string;
      scope: string;
    }>(
      'SELECT id, version, title, level, department, semester, scope FROM courses WHERE id = $1',
      [courseId]
    );
    if (checkRes.rows.length === 0) {
      throw new Error(`Course ${courseId} not found in PostgreSQL catalog`);
    }

    const course = checkRes.rows[0];
    const missingMetadata = ['title', 'level', 'department', 'semester', 'scope']
      .filter(key => typeof (course as any)[key] !== 'string' || !(course as any)[key].trim());
    if (missingMetadata.length > 0) {
      throw new Error(`Course cannot be published; required metadata is missing: ${missingMetadata.join(', ')}.`);
    }

    const modulesRes = await queryPostgres<{ id: string }>(
      `SELECT id FROM course_modules
       WHERE course_id = $1 AND COALESCE(is_archived, FALSE) = FALSE
       ORDER BY order_index ASC`,
      [courseId]
    );
    if (modulesRes.rows.length === 0) {
      throw new Error('Course cannot be published without stored, non-archived modules.');
    }

    const lessonsRes = await queryPostgres<{ module_id: string; title: string; content_markdown: string }>(
      `SELECT module_id, title, content_markdown
       FROM course_lessons
       WHERE course_id = $1
       ORDER BY module_id, order_index ASC`,
      [courseId]
    );
    const lessonsByModule = new Map<string, typeof lessonsRes.rows>();
    for (const lesson of lessonsRes.rows) {
      const moduleLessons = lessonsByModule.get(String(lesson.module_id)) || [];
      moduleLessons.push(lesson);
      lessonsByModule.set(String(lesson.module_id), moduleLessons);
    }
    for (const module of modulesRes.rows) {
      const moduleLessons = lessonsByModule.get(String(module.id)) || [];
      if (moduleLessons.length === 0) {
        throw new Error(`Course module ${module.id} has no stored lessons and cannot be published.`);
      }
      for (const lesson of moduleLessons) {
        if (typeof lesson.title !== 'string' || !lesson.title.trim() ||
            typeof lesson.content_markdown !== 'string' || lesson.content_markdown.trim().length < 600) {
          throw new Error(`Course lesson "${lesson.title || lesson.module_id}" is incomplete and cannot be published.`);
        }
      }
    }

    const currentVersion = Number(course.version);
    const newVersion = currentVersion + 1;
    const nowIso = new Date().toISOString();

    await queryPostgres(
      `UPDATE courses
       SET status = 'published', version = $1, updated_at = $2
       WHERE id = $3`,
      [newVersion, nowIso, courseId]
    );

    // Invalidate local and broadcast cache immediately
    catalogCache.invalidateCourse(courseId, newVersion);
    return { success: true, newVersion };
  }

  /**
   * Retrieves full published catalog with titles & module structure only (no lesson content)
   * Enforces status = 'published' and filters out archived modules.
   */
  async getFullCatalogWithSyllabus(forceRefresh = false): Promise<{ courses: any[]; etag: string; maxUpdatedAt: string | null }> {
    await ensureCourseLearningSchema();
    const flags = getFeatureFlags();
    const cacheKey = 'catalog:full:published';

    const cached = forceRefresh
      ? null
      : catalogCache.getPublished<{ courses: any[]; etag: string; maxUpdatedAt: string | null }>(cacheKey);
    if (cached) {
      return cached;
    }

    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        const coursesRes = await queryPostgres<any>(
          `SELECT id, title, description, department, faculty, faculties, departments, level, semester, credit_units, status, scope, updated_at
           FROM courses
           WHERE status = 'published'
           ORDER BY id ASC`
        );

        const modulesRes = await queryPostgres<any>(
          `SELECT id, course_id, title, description, order_index, updated_at
           FROM course_modules
           WHERE (is_archived IS NOT TRUE OR is_archived IS NULL)
           ORDER BY course_id, order_index ASC`
        );

        const lessonsRes = await queryPostgres<any>(
          `SELECT id, course_id, module_id, title, order_index, updated_at
           FROM course_lessons
           ORDER BY course_id, module_id, order_index ASC`
        );

        const modulesByCourse: Record<string, any[]> = {};
        for (const m of modulesRes.rows) {
          if (!modulesByCourse[m.course_id]) modulesByCourse[m.course_id] = [];
          modulesByCourse[m.course_id].push({
            id: m.id,
            title: m.title,
            description: typeof m.description === 'string' ? m.description : null,
            order: m.order_index,
            subTopics: []
          });
        }

        const lessonsByModule: Record<string, any[]> = {};
        for (const l of lessonsRes.rows) {
          const key = `${l.course_id}:${l.module_id}`;
          if (!lessonsByModule[key]) lessonsByModule[key] = [];
          lessonsByModule[key].push({
            id: l.id,
            title: l.title,
            order: l.order_index
          });
        }

        let maxUpdatedAt: string | null = null;

        const fullCourses = coursesRes.rows.map(c => {
          if (c.updated_at && c.updated_at > maxUpdatedAt) maxUpdatedAt = c.updated_at;
          const creditUnits = c.credit_units == null ? null : Number(c.credit_units);
          if (creditUnits !== null && (!Number.isInteger(creditUnits) || creditUnits < 1 || creditUnits > 12)) {
            throw new Error(`Course ${c.id} has invalid persisted credit units.`);
          }
          const cMods = (modulesByCourse[c.id] || []).map(m => {
            const mKey = `${c.id}:${m.id}`;
            const rawLessons = (lessonsByModule[mKey] || []).sort((a, b) => (a.order || 0) - (b.order || 0));

            return {
              ...m,
              subTopics: rawLessons
            };
          }).sort((a, b) => (a.order || 0) - (b.order || 0));

          return {
            id: c.id,
            title: c.title,
            description: typeof c.description === 'string' ? c.description : null,
            department: typeof c.department === 'string' ? c.department : null,
            faculty: typeof c.faculty === 'string' ? c.faculty : null,
            faculties: Array.isArray(c.faculties) ? c.faculties : null,
            departments: Array.isArray(c.departments) ? c.departments : null,
            level: c.level ?? null,
            semester: typeof c.semester === 'string' && c.semester.trim() ? ((c.semester.toLowerCase().includes('2') || c.semester.toLowerCase().includes('second')) ? '2nd Semester' : ((c.semester.toLowerCase().includes('1') || c.semester.toLowerCase().includes('first')) ? '1st Semester' : c.semester)) : null,
            creditUnits,
            scope: typeof c.scope === 'string' ? c.scope : null,
            status: c.status,
            syllabus: sortCourseSyllabus(cMods)
          };
        });

        const payloadStr = JSON.stringify(fullCourses);
        const etag = `W/"${crypto.createHash('sha256').update(payloadStr).digest('hex').substring(0, 16)}"`;

        const result = { courses: fullCourses, etag, maxUpdatedAt };
        catalogCache.setPublished(cacheKey, result, 1);
        return result;
      } catch (err: any) {
        logger.warn({ error: err.message }, '[CourseRepository] PostgreSQL getFullCatalogWithSyllabus read failed');
      }
    }

    // Zero-Firestore fallback: check if cached in L1 or throw clean 503 error
    const staleCached = forceRefresh
      ? null
      : catalogCache.getPublished<{ courses: any[]; etag: string; maxUpdatedAt: string | null }>(cacheKey);
    if (staleCached) {
      return staleCached;
    }
    throw new Error('Database service unavailable: PostgreSQL full catalog is unreachable');
  }
}

export const courseRepository = new CourseRepository();
