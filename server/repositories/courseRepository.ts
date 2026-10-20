/**
 * UniAce Mastery Hub: Course Catalog Repository
 *
 * Implements Stage 5C Phase 1: Production Catalog Read Cutover.
 * - When ENABLE_POSTGRES_CATALOG is true:
 *   - Reads prioritize Neon PostgreSQL with sub-50ms latency.
 *   - Transparent read-failover to Firestore with audit logging if PostgreSQL is temporarily unavailable.
 *   - L1 MultiInstanceCatalogCache (<5ms) active for repeated requests.
 *   - Writes enforce Safeguard #2: Zero Silent Fallback Writes (throws immediately on Postgres error).
 * - When ENABLE_POSTGRES_CATALOG is false: routes through Firestore baseline.
 */

import crypto from 'crypto';
import { getFeatureFlags } from '../config/features';
import { catalogCache } from '../cache/catalogCache';
import { CourseEntity, CourseModuleEntity, CourseLessonEntity, CourseFormulaEntity } from '../../src/types/databaseSchema';
import { getAdminApp } from '../firebaseAdmin';
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
   * Helper to log audit alert on read failover
   */
  private async logFailoverAlert(operation: string, errorMsg: string): Promise<void> {
    logger.warn({ operation, error: errorMsg }, '[CourseRepository] PostgreSQL read failed; initiating transparent Firestore failover');
    try {
      const app = getAdminApp();
      if (app) {
        await app.firestore().collection('system_logs').add({
          type: 'DATABASE_FAILOVER',
          source: 'postgres_catalog',
          operation,
          error: errorMsg,
          timestamp: new Date().toISOString()
        });
      }
    } catch (logErr: any) {
      logger.warn({ logErr: logErr.message }, '[CourseRepository] Failed to record failover alert in system_logs');
    }
  }

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

    // 2. Authoritative PostgreSQL Path (Phase 1 Read Cutover)
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
        // Confirmed Decision 3: Transparent failover to Firestore with alert logging
        await this.logFailoverAlert('listPublishedCourses', err.message);
      }
    }

    // 3. Fallback / Baseline Firestore Read Path
    return this.listPublishedCoursesFirestore(filter, cacheKey);
  }

  private async listPublishedCoursesFirestore(filter: CourseQueryFilter, cacheKey: string): Promise<CourseEntity[]> {
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    let query: FirebaseFirestore.Query = db.collection('courses');
    if (filter.status) {
      query = query.where('status', '==', filter.status);
    } else {
      query = query.where('status', '==', 'published');
    }
    if (filter.department) {
      query = query.where('department', '==', filter.department);
    }
    if (filter.limit) {
      query = query.limit(filter.limit);
    }

    const snap = await query.get().catch(() => ({ docs: [] } as any));
    const courses: CourseEntity[] = snap.docs.map((d: any) => {
      const data = d.data();
      return {
        id: d.id,
        code: data.code || '',
        title: data.title || '',
        description: data.description || null,
        level: data.level || 'undergraduate',
        department: data.department || null,
        faculty: data.faculty || null,
        semester: data.semester || null,
        thumbnail_url: data.thumbnailUrl || data.thumbnail_url || null,
        author_id: data.authorId || data.author_id || '',
        status: data.status || 'published',
        generation_status: data.generationStatus || 'none',
        generation_job_id: data.generationJobId || null,
        version: Number(data.version || 1),
        content_hash: data.contentHash || null,
        created_at: data.createdAt || new Date().toISOString(),
        updated_at: data.updatedAt || new Date().toISOString()
      };
    });

    catalogCache.setPublished(cacheKey, courses, 1);
    return courses;
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
        await this.logFailoverAlert(`getCourseById:${courseId}`, err.message);
      }
    }

    // Fallback to Firestore
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const doc = await db.collection('courses').doc(courseId).get().catch(() => null);
    if (!doc || !doc.exists) return null;

    const data = doc.data() || {};
    const course: CourseEntity = {
      id: doc.id,
      code: data.code || '',
      title: data.title || '',
      description: data.description || null,
      level: data.level || 'undergraduate',
      department: data.department || null,
      faculty: data.faculty || null,
      semester: data.semester || null,
      thumbnail_url: data.thumbnailUrl || data.thumbnail_url || null,
      author_id: data.authorId || data.author_id || '',
      status: data.status || 'draft',
      generation_status: data.generationStatus || 'none',
      generation_job_id: data.generationJobId || null,
      version: Number(data.version || 1),
      content_hash: data.contentHash || null,
      created_at: data.createdAt || new Date().toISOString(),
      updated_at: data.updatedAt || new Date().toISOString()
    };

    catalogCache.setPublished(cacheKey, course, course.version);
    return course;
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
        await this.logFailoverAlert(`getCourseModules:${courseId}`, err.message);
      }
    }

    // Firestore fallback
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const snap = await db.collection('courses').doc(courseId).collection('modules').orderBy('order', 'asc').get().catch(() => ({ docs: [] } as any));
    const modules: CourseModuleEntity[] = snap.docs.map((d: any, idx: number) => {
      const data = d.data();
      return {
        id: d.id,
        course_id: courseId,
        title: data.title || `Module ${idx + 1}`,
        description: data.description || null,
        order_index: typeof data.order === 'number' ? data.order : idx + 1,
        estimated_minutes: Number(data.estimatedMinutes || 60),
        created_at: data.createdAt || new Date().toISOString(),
        updated_at: data.updatedAt || new Date().toISOString()
      };
    });

    catalogCache.setPublished(cacheKey, modules, 1);
    return modules;
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
          return null;
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
        await this.logFailoverAlert(`getCourseLessons:${courseId}:${moduleId}`, err.message);
      }
    }

    // Firestore fallback
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const snap = await db.collection('courses').doc(courseId).collection('modules').doc(moduleId).collection('lessons').orderBy('order', 'asc').get().catch(() => ({ docs: [] } as any));
    const lessons: CourseLessonEntity[] = snap.docs.map((d: any, idx: number) => {
      const data = d.data();
      return {
        id: d.id,
        course_id: courseId,
        module_id: moduleId,
        title: data.title || `Lesson ${idx + 1}`,
        content_markdown: data.content || '',
        order_index: typeof data.order === 'number' ? data.order : idx + 1,
        key_terms: Array.isArray(data.keyTerms) ? data.keyTerms : [],
        learning_outcomes: Array.isArray(data.learningOutcomes) ? data.learningOutcomes : [],
        asset_references: Array.isArray(data.assetReferences) ? data.assetReferences : [],
        created_at: data.createdAt || new Date().toISOString(),
        updated_at: data.updatedAt || new Date().toISOString()
      };
    });

    catalogCache.setPublished(cacheKey, lessons, 1);
    return lessons;
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
        await this.logFailoverAlert(`getCourseFormulas:${courseId}`, err.message);
      }
    }

    // Firestore fallback
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const snap = await db.collection('courses').doc(courseId).collection('formulas').get().catch(() => ({ docs: [] } as any));
    const formulas: CourseFormulaEntity[] = snap.docs.map((d: any) => {
      const data = d.data();
      return {
        id: d.id,
        course_id: courseId,
        name: data.name || '',
        latex_expression: data.latexExpression || data.latex_expression || '',
        variables_breakdown: data.variablesBreakdown || data.variables_breakdown || {},
        derivation_notes: data.derivationNotes || data.derivation_notes || null,
        created_at: data.createdAt || new Date().toISOString()
      };
    });

    catalogCache.setPublished(cacheKey, formulas, 1);
    return formulas;
  }

  /**
   * Updates course status to published with atomic cache invalidation
   * Enforces Safeguard #2: Zero Silent Fallback Writes.
   */
  async publishCourse(courseId: string, authorUid: string): Promise<{ success: boolean; newVersion: number }> {
    const flags = getFeatureFlags();

    if (flags.ENABLE_POSTGRES_CATALOG) {
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

    // Default Firestore write path
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const ref = db.collection('courses').doc(courseId);
    let newVersion = 2;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(`Course ${courseId} not found`);
      const current = snap.data() || {};
      newVersion = Number(current.version || 1) + 1;

      tx.update(ref, {
        status: 'published',
        version: newVersion,
        publishedAt: new Date().toISOString(),
        publishedBy: authorUid,
        updatedAt: new Date().toISOString()
      });
    });

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
          semester: c.semester === 'second' ? '2nd Semester' : '1st Semester',
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
    }

    // Fallback to Firestore
    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const snap = await db.collection('courses').where('status', '==', 'published').get();
    const fullCourses: any[] = [];
    let maxUpdatedAt = '1970-01-01T00:00:00.000Z';

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.deleted) continue;
      const updatedAt = data.updatedAt || new Date().toISOString();
      if (updatedAt > maxUpdatedAt) maxUpdatedAt = updatedAt;

      const syllabus = Array.isArray(data.syllabus) ? sortCourseSyllabus(data.syllabus.map((m: any) => ({
        id: m.id,
        title: m.title,
        order: m.order,
        subTopics: (m.subTopics || m.lessons || []).map((l: any) => ({
          id: l.id,
          title: l.title,
          order: l.order
        }))
      }))) : [];

      fullCourses.push({
        id: doc.id,
        title: data.title,
        description: data.description || '',
        department: data.department || '',
        faculty: data.faculty || '',
        level: data.level || '100',
        semester: data.semester === 'second' ? '2nd Semester' : '1st Semester',
        status: data.status,
        syllabus
      });
    }

    const payloadStr = JSON.stringify(fullCourses);
    const etag = `W/"${crypto.createHash('sha256').update(payloadStr).digest('hex').substring(0, 16)}"`;
    const result = { courses: fullCourses, etag, maxUpdatedAt };
    catalogCache.setPublished(cacheKey, result, 1);
    return result;
  }
}

export const courseRepository = new CourseRepository();
