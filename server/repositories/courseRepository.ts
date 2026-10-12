/**
 * UniAce Mastery Hub: Course Catalog Repository
 *
 * Enforces Safeguard #2: Zero Silent Fallback Writes.
 * - When ENABLE_POSTGRES_CATALOG is false: routes through Firestore.
 * - When ENABLE_POSTGRES_CATALOG is true: writes strictly to PostgreSQL.
 *   ANY POSTGRES FAILURE THROWS IMMEDIATELY. It MUST NEVER silently fall back
 *   to Firestore, as doing so would split the source of truth.
 */

import { getFeatureFlags } from '../config/features';
import { catalogCache } from '../cache/catalogCache';
import { CourseEntity, CourseModuleEntity, CourseLessonEntity } from '../../src/types/databaseSchema';
import { getAdminApp } from '../firebaseAdmin';

export interface CourseQueryFilter {
  status?: CourseEntity['status'];
  department?: string;
  level?: string;
  limit?: number;
}

export class CourseRepository {
  /**
   * Fetches published courses list with caching
   */
  async listPublishedCourses(filter: CourseQueryFilter = {}): Promise<CourseEntity[]> {
    const flags = getFeatureFlags();
    const cacheKey = `catalog:list:${filter.department || 'all'}:${filter.level || 'all'}`;

    // 1. Attempt cache read first
    const cached = catalogCache.getPublished<CourseEntity[]>(cacheKey);
    if (cached) {
      return cached;
    }

    if (flags.ENABLE_POSTGRES_CATALOG) {
      // PostgreSQL authoritative path (when enabled in Stage 5B)
      // Note: Throws on failure; never silently falls back
      throw new Error('PostgreSQL catalog provider not yet mounted. Feature flag must remain false in Stage 5A.');
    }

    // Default Firestore path (Stage 5A active baseline)
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

    // Populate in-memory cache
    catalogCache.setPublished(cacheKey, courses, 1);
    return courses;
  }

  /**
   * Fetches single course metadata
   */
  async getCourseById(courseId: string): Promise<CourseEntity | null> {
    const flags = getFeatureFlags();

    if (flags.ENABLE_POSTGRES_CATALOG) {
      throw new Error('PostgreSQL catalog provider not yet mounted. Feature flag must remain false in Stage 5A.');
    }

    const app = getAdminApp();
    if (!app) throw new Error('Database connection unavailable');
    const db = app.firestore();

    const doc = await db.collection('courses').doc(courseId).get().catch(() => null);
    if (!doc || !doc.exists) return null;

    const data = doc.data() || {};
    return {
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
  }

  /**
   * Updates course status to published with atomic cache invalidation
   */
  async publishCourse(courseId: string, authorUid: string): Promise<{ success: boolean; newVersion: number }> {
    const flags = getFeatureFlags();

    if (flags.ENABLE_POSTGRES_CATALOG) {
      // Must execute atomic Postgres update and throw on any error
      // ZERO SILENT FALLBACK TO FIRESTORE PERMITTED
      throw new Error('PostgreSQL publish transaction not yet mounted.');
    }

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
}

export const courseRepository = new CourseRepository();
