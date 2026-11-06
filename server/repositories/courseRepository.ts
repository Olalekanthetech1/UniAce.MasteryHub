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
import { CourseEntity, CourseModuleEntity, CourseLessonEntity, CourseFormulaEntity, CourseQuizEntity } from '../../src/types/databaseSchema';
import type { Quiz } from '../../src/types';
import { queryPostgres } from '../postgresPool';
import { logger } from '../logger';
import { ensureCourseLearningSchema } from '../services/courseLearningSchema';
import { ensureAcademicAvailabilitySchema, listAcademicLevelAvailability, normalizeAcademicLevelKey } from '../services/academicAvailability';
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
    student_visibility: row.student_visibility,
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
   * Computes a lightweight, authoritative PostgreSQL revision fingerprint across published courses,
   * academic level availability, modules, and lessons so any mutation on any application instance
   * immediately invalidates stale process-local L1 cache entries.
   */
  async getAuthoritativeCatalogRevision(): Promise<string> {
    await ensureCourseLearningSchema();
    await ensureAcademicAvailabilitySchema();
    const res = await queryPostgres<{
      courses_rev: string | null;
      levels_rev: string | null;
      modules_rev: string | null;
      lessons_rev: string | null;
    }>(`
      SELECT
        (SELECT COUNT(*) || ':' || COALESCE(SUM(version), 0) || ':' || COALESCE(MAX(updated_at)::text, '') || ':' || COALESCE(md5(string_agg(id || ':' || COALESCE(student_visibility, '') || ':' || COALESCE(status, ''), ',' ORDER BY id)), '') FROM courses WHERE status = 'published') AS courses_rev,
        (SELECT COALESCE(md5(string_agg(level_key || ':' || COALESCE(availability, '') || ':' || COALESCE(updated_at::text, ''), ',' ORDER BY level_key)), '') FROM academic_level_availability) AS levels_rev,
        (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at)::text, '') FROM course_modules WHERE COALESCE(is_archived, FALSE) = FALSE) AS modules_rev,
        (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at)::text, '') FROM course_lessons) AS lessons_rev
    `);
    const row = res.rows[0] || ({} as any);
    return `${row.courses_rev || '0'}|${row.levels_rev || '0'}|${row.modules_rev || '0'}|${row.lessons_rev || '0'}`;
  }

  /**
   * Fetches published courses list with cross-instance revision-verified caching & concurrent queries
   */
  async listPublishedCourses(filter: CourseQueryFilter = {}, forceRefresh = false): Promise<CourseEntity[]> {
    await ensureCourseLearningSchema();
    await ensureAcademicAvailabilitySchema();
    const flags = getFeatureFlags();
    const cacheKey = `catalog:list:${filter.department || 'all'}:${filter.level || 'all'}:${filter.limit || 'all'}`;

    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        const dbRevision = await this.getAuthoritativeCatalogRevision();
        catalogCache.reconcileDatabaseRevision(dbRevision);
      } catch (revErr: any) {
        logger.warn({ error: revErr.message }, '[CourseRepository] Failed to verify catalog revision before listPublishedCourses');
      }
    }

    // 1. Attempt revision-verified L1 memory cache read (<5ms)
    const cached = forceRefresh ? null : catalogCache.getPublished<CourseEntity[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Authoritative PostgreSQL Path
    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        let sql = `
          SELECT id, code, title, description, level, department, faculty, semester, credit_units, faculties, departments, scope,
                 thumbnail_url, author_id, status, student_visibility, version, created_at, updated_at
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

        const [academicLevels, res] = await Promise.all([
          listAcademicLevelAvailability(),
          queryPostgres<any>(sql, params)
        ]);
        const levelAvailabilityByKey = new Map(
          academicLevels.map(item => [normalizeAcademicLevelKey(item.level_key), item.availability] as const)
        );
        const courses: CourseEntity[] = res.rows.map((row: any) => {
          const mapped = mapCourseRecord(row);
          return {
            ...mapped,
            level_availability: levelAvailabilityByKey.get(normalizeAcademicLevelKey(String(mapped.level ?? ''))) || 'hidden'
          };
        });

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
    await ensureAcademicAvailabilitySchema();
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
                 thumbnail_url, author_id, status, student_visibility, version, created_at, updated_at
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
                 key_terms, learning_outcomes, asset_references, instructional_content, content_blocks, created_at, updated_at
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
   * Fetches a persisted module quiz and maps the database answer index to
   * the student-facing QuizQuestion contract. Malformed records fail closed.
   */
  async getCourseQuiz(courseId: string, moduleId: string): Promise<Quiz | null> {
    await ensureCourseLearningSchema();
    const result = await queryPostgres<CourseQuizEntity>(
      `SELECT id, course_id, module_id, title, passing_score, version,
              questions_snapshot_hash, quiz_topics, pedagogical_reasoning,
              questions, created_at, updated_at
       FROM course_module_quizzes
       WHERE course_id = $1 AND module_id = $2
       LIMIT 1`,
      [courseId, moduleId]
    );
    if (result.rows.length === 0) return null;

    const quiz = result.rows[0];
    if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
      throw new Error(`Persisted module quiz ${courseId}/${moduleId} has no valid question array.`);
    }

    const questions = quiz.questions.map((question, index) => {
      if (
        !question || typeof question.id !== 'string' || !question.id.trim() ||
        typeof question.question !== 'string' || !question.question.trim() ||
        !Array.isArray(question.options) || question.options.length !== 4 ||
        question.options.some(option => typeof option !== 'string' || !option.trim()) ||
        !Number.isInteger(question.correct_option_index) ||
        question.correct_option_index < 0 || question.correct_option_index >= question.options.length ||
        typeof question.explanation !== 'string' || !question.explanation.trim() ||
        typeof question.hint !== 'string' ||
        !Number.isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 5 ||
        !['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'].includes(question.bloom_level) ||
        typeof question.source_reference !== 'string' || !question.source_reference.trim()
      ) {
        throw new Error(`Persisted module quiz ${courseId}/${moduleId} contains a malformed question at index ${index}.`);
      }
      return {
        id: question.id,
        type: 'multiple-choice' as const,
        question: question.question,
        options: question.options,
        correctAnswer: question.options[question.correct_option_index],
        explanation: question.explanation,
        hint: question.hint,
        difficulty: question.difficulty,
        bloomLevel: ({
          Remember: 'remembering',
          Understand: 'understanding',
          Apply: 'applying',
          Analyze: 'analyzing',
          Evaluate: 'evaluating',
          Create: 'creating'
        } as const)[question.bloom_level],
        sourceReference: question.source_reference
        // A matching lesson title proves provenance linkage, not independent
        // semantic or academic verification of the answer key.
      };
    });

    return { moduleId, questions };
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
   * Reconciles authoritative PostgreSQL revision fingerprint before serving L1 cache,
   * and executes all 4 catalog queries concurrently via Promise.all on cache miss.
   */
  async getFullCatalogWithSyllabus(forceRefresh = false): Promise<{ courses: any[]; etag: string; maxUpdatedAt: string | null }> {
    await ensureCourseLearningSchema();
    await ensureAcademicAvailabilitySchema();
    const flags = getFeatureFlags();
    const cacheKey = 'catalog:full:published';

    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        const dbRevision = await this.getAuthoritativeCatalogRevision();
        catalogCache.reconcileDatabaseRevision(dbRevision);
      } catch (revErr: any) {
        logger.warn({ error: revErr.message }, '[CourseRepository] Failed to verify catalog revision before getFullCatalogWithSyllabus');
      }
    }

    const cached = forceRefresh
      ? null
      : catalogCache.getPublished<{ courses: any[]; etag: string; maxUpdatedAt: string | null }>(cacheKey);
    if (cached) {
      return cached;
    }

    if (flags.ENABLE_POSTGRES_CATALOG) {
      try {
        const [academicLevels, coursesRes, modulesRes, lessonsRes] = await Promise.all([
          listAcademicLevelAvailability(),
          queryPostgres<any>(
            `SELECT id, title, description, department, faculty, faculties, departments, level, semester, credit_units, status, student_visibility, scope, updated_at
             FROM courses
             WHERE status = 'published'
             ORDER BY id ASC`
          ),
          queryPostgres<any>(
            `SELECT id, course_id, title, description, order_index, updated_at
             FROM course_modules
             WHERE (is_archived IS NOT TRUE OR is_archived IS NULL)
             ORDER BY course_id, order_index ASC`
          ),
          queryPostgres<any>(
            `SELECT id, course_id, module_id, title, order_index, updated_at
             FROM course_lessons
             ORDER BY course_id, module_id, order_index ASC`
          )
        ]);

        const levelAvailabilityByKey = new Map(
          academicLevels.map(item => [normalizeAcademicLevelKey(item.level_key), item.availability] as const)
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
          if (c.updated_at && (!maxUpdatedAt || c.updated_at > maxUpdatedAt)) maxUpdatedAt = c.updated_at;
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
            student_visibility: c.student_visibility,
            level_availability: levelAvailabilityByKey.get(normalizeAcademicLevelKey(String(c.level ?? ''))) || 'hidden',
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
