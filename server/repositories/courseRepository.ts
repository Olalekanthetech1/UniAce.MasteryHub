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
import { sortCourseSyllabus, getModuleOrderIndex, getLessonOrderIndex } from '../../src/shared/courseSchemas';

export interface CourseQueryFilter {
  status?: CourseEntity['status'];
  department?: string;
  level?: string;
  limit?: number;
}

export class CourseRepository {
  /**
   * Fetches published courses list with caching & resilient routing
   */
  async listPublishedCourses(filter: CourseQueryFilter = {}): Promise<CourseEntity[]> {
    const flags = getFeatureFlags();
    const cacheKey = `catalog:list:${filter.department || 'all'}:${filter.level || 'all'}`;

    // 1. Attempt L1 memory cache read (<5ms)
    const cached = catalogCache.getPublished<CourseEntity[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Authoritative PostgreSQL Path
    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        let sql = `
          SELECT id, code, title, description, level, department, faculty, semester,
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
        const courses: CourseEntity[] = res.rows.map((r: any) => ({
          id: r.id,
          code: r.code || '',
          title: r.title || '',
          description: r.description || null,
          level: r.level || 'undergraduate',
          department: r.department || null,
          faculty: r.faculty || null,
          semester: r.semester || null,
          thumbnail_url: r.thumbnail_url || null,
          author_id: r.author_id || '',
          status: r.status || 'published',
          generation_status: 'none',
          generation_job_id: null,
          version: Number(r.version || 1),
          content_hash: null,
          created_at: typeof r.created_at === 'string' ? r.created_at : (r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()),
          updated_at: typeof r.updated_at === 'string' ? r.updated_at : (r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString())
        }));

        // Populate in-memory cache
        catalogCache.setPublished(cacheKey, courses, 1);
        return courses;
      } catch (err: any) {
        logger.warn({ error: err.message }, '[CourseRepository] PostgreSQL listPublishedCourses query failed');
      }
    }

    // Zero-Firestore fallback: check if cached in L1 or throw clean error
    const staleCached = catalogCache.getPublished<CourseEntity[]>(cacheKey);
    if (staleCached) {
      return staleCached;
    }
    throw new Error('Database service unavailable: PostgreSQL catalog is unreachable');
  }

  /**
   * Fetches single course metadata
   */
  async getCourseById(courseId: string): Promise<CourseEntity | null> {
    const flags = getFeatureFlags();
    const cacheKey = `catalog:course:${courseId}`;

    const cached = catalogCache.getPublished<CourseEntity>(cacheKey);
    if (cached) {
      return cached;
    }

    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        const sql = `
          SELECT id, code, title, description, level, department, faculty, semester,
                 thumbnail_url, author_id, status, version, created_at, updated_at
          FROM courses
          WHERE id = $1
          LIMIT 1
        `;
        const res = await queryPostgres<any>(sql, [courseId]);
        if (res.rows.length > 0) {
          const r = res.rows[0];
          const course: CourseEntity = {
            id: r.id,
            code: r.code || '',
            title: r.title || '',
            description: r.description || null,
            level: r.level || 'undergraduate',
            department: r.department || null,
            faculty: r.faculty || null,
            semester: r.semester || null,
            thumbnail_url: r.thumbnail_url || null,
            author_id: r.author_id || '',
            status: r.status || 'published',
            generation_status: 'none',
            generation_job_id: null,
            version: Number(r.version || 1),
            content_hash: null,
            created_at: typeof r.created_at === 'string' ? r.created_at : (r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()),
            updated_at: typeof r.updated_at === 'string' ? r.updated_at : (r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString())
          };
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
                 key_terms, learning_outcomes, asset_references, created_at, updated_at
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
    const checkRes = await queryPostgres<{ version: number }>(
      'SELECT version FROM courses WHERE id = $1',
      [courseId]
    );
    if (checkRes.rows.length === 0) {
      throw new Error(`Course ${courseId} not found in PostgreSQL catalog`);
    }

    const currentVersion = Number(checkRes.rows[0].version || 1);
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
  async getFullCatalogWithSyllabus(): Promise<{ courses: any[]; etag: string; maxUpdatedAt: string }> {
    const flags = getFeatureFlags();
    const cacheKey = 'catalog:full:published';

    const cached = catalogCache.getPublished<{ courses: any[]; etag: string; maxUpdatedAt: string }>(cacheKey);
    if (cached) {
      return cached;
    }

    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        const coursesRes = await queryPostgres<any>(
          `SELECT id, title, description, department, faculty, level, semester, status, scope, updated_at
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
            description: m.description || '',
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

        let maxUpdatedAt = '1970-01-01T00:00:00.000Z';

        const fullCourses = coursesRes.rows.map(c => {
          if (c.updated_at && c.updated_at > maxUpdatedAt) maxUpdatedAt = c.updated_at;
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
            description: c.description || '',
            department: c.department || '',
            faculty: c.faculty || '',
            faculties: c.faculty ? [c.faculty] : [],
            departments: c.department ? [c.department] : [],
            level: c.level || '100',
            semester: (String(c.semester || '').toLowerCase().includes('2') || String(c.semester || '').toLowerCase().includes('second')) ? '2nd Semester' : '1st Semester',
            scope: c.scope || 'DEPARTMENT',
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
    const staleCached = catalogCache.getPublished<{ courses: any[]; etag: string; maxUpdatedAt: string }>(cacheKey);
    if (staleCached) {
      return staleCached;
    }
    throw new Error('Database service unavailable: PostgreSQL full catalog is unreachable');
  }
}

export const courseRepository = new CourseRepository();
