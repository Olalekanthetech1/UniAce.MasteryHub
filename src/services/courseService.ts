import { Course, Module, SubTopic, Quiz, Formula, CourseId } from '../types';
import { getModuleOrderIndex, getLessonOrderIndex, sortCourseSyllabus } from '../shared/courseSchemas';
import { normalizeSemester } from '../utils/normalization';
import { safeFetchJson } from '../utils/safeFetch';
import { auth } from '../firebase';

export const sanitizeForFirestore = (obj: any): any => {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => (Array.isArray(item) ? JSON.stringify(item) : sanitizeForFirestore(item)));
  }
  if (obj.constructor !== Object) return obj;
  const sanitized: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = obj[key];
      if (val !== undefined) sanitized[key] = sanitizeForFirestore(val);
    }
  }
  return sanitized;
};

async function buildAuthHeaders(explicitToken?: string, extraHeaders?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  const token = explicitToken || (await auth.currentUser?.getIdToken().catch(() => undefined));
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export const CourseService = {
  async getFullCatalog(idToken?: string, retries = 2): Promise<Course[]> {
    const headers = await buildAuthHeaders(idToken);
    const baseUrl = typeof window !== 'undefined' ? '' : (process.env.APP_URL || 'http://localhost:3000');
    const res = await safeFetchJson<any>(`${baseUrl}/api/catalog/full`, { headers });
    if (!res.ok || !res.data) {
      if (retries > 0 && res.status !== 401 && res.status !== 403) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.getFullCatalog(idToken, retries - 1);
      }
      throw new Error(`Failed to fetch catalog (${res.error || `HTTP ${res.status}`})`);
    }
    const data = res.data;
    if (!Array.isArray(data.courses)) throw new Error('Catalog response is missing its live courses array.');
    return data.courses.map((c: any) => {
      const normalizedSemester = normalizeSemester(c.semester);
      if (!c.id || !c.title || !c.level || !normalizedSemester || !c.scope) {
        throw new Error(`Course ${c.id || '(unknown id)'} is missing authoritative academic metadata.`);
      }
      return {
        id: c.id,
        title: c.title,
        description: typeof c.description === 'string' ? c.description : '',
        department: typeof c.department === 'string' ? c.department : '',
        faculty: typeof c.faculty === 'string' ? c.faculty : '',
        faculties: Array.isArray(c.faculties) && c.faculties.length > 0 ? c.faculties : (c.faculty ? [c.faculty] : []),
        departments: Array.isArray(c.departments) && c.departments.length > 0
          ? c.departments
          : (c.scope === 'DEPARTMENT' && c.department ? [c.department] : []),
        level: c.level as any,
        semester: normalizedSemester as any,
        ...(Number.isInteger(c.creditUnits ?? c.credit_units) ? { creditUnits: Number(c.creditUnits ?? c.credit_units) } : {}),
        scope: c.scope,
        status: c.status,
        syllabus: Array.isArray(c.syllabus) ? sortCourseSyllabus(c.syllabus) : []
      };
    });
  },

  async getCourse(courseId: string): Promise<Course | null> {
    const headers = await buildAuthHeaders();
    const res = await safeFetchJson<any>(`/api/courses/${encodeURIComponent(courseId)}`, { headers });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to fetch course ${courseId} (${res.error || `HTTP ${res.status}`})`);
    }
    if (!res.data?.course) return null;
    const c = res.data.course;
    const normalizedSemester = normalizeSemester(c.semester);
    if (!c.id || !c.title || !c.level || !normalizedSemester || !c.scope) {
      throw new Error(`Course ${courseId} is missing authoritative academic metadata.`);
    }
    return {
      id: c.id,
      title: c.title,
      description: typeof c.description === 'string' ? c.description : '',
      department: typeof c.department === 'string' ? c.department : '',
      faculty: typeof c.faculty === 'string' ? c.faculty : '',
      faculties: Array.isArray(c.faculties) && c.faculties.length > 0 ? c.faculties : (c.faculty ? [c.faculty] : []),
      departments: Array.isArray(c.departments) && c.departments.length > 0
        ? c.departments
        : (c.scope === 'DEPARTMENT' && c.department ? [c.department] : []),
      level: c.level as any,
      semester: normalizedSemester as any,
      ...(Number.isInteger(c.creditUnits ?? c.credit_units) ? { creditUnits: Number(c.creditUnits ?? c.credit_units) } : {}),
      scope: c.scope,
      status: c.status,
      syllabus: Array.isArray(c.syllabus) ? sortCourseSyllabus(c.syllabus) : []
    };
  },

  async getModules(courseId: string): Promise<Module[]> {
    const headers = await buildAuthHeaders();
    const res = await safeFetchJson<any>(`/api/courses/${encodeURIComponent(courseId)}/modules`, { headers });
    if (!res.ok || !res.data) {
      throw new Error(`Failed to fetch modules for course ${courseId} (${res.error || `HTTP ${res.status}`})`);
    }
    const data = res.data;
    if (!Array.isArray(data.modules)) {
      throw new Error(`Modules response for ${courseId} did not include a verified modules array.`);
    }
    return data.modules.map((m: any) => ({
      id: m.id,
      title: m.title,
      subTopics: [],
      order: m.order_index
    })).sort((a: any, b: any) => getModuleOrderIndex(a) - getModuleOrderIndex(b));
  },

  async getLessons(courseId: string, moduleId: string): Promise<SubTopic[]> {
    const headers = await buildAuthHeaders();
    const res = await safeFetchJson<any>(`/api/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleId)}/lessons`, { headers });
    if (!res.ok || !res.data) {
      throw new Error(`Failed to fetch lessons for ${courseId}/${moduleId} (${res.error || `HTTP ${res.status}`})`);
    }
    const data = res.data;
    if (!Array.isArray(data.lessons)) {
      throw new Error(`Lessons response for ${courseId}/${moduleId} did not include a verified lessons array.`);
    }
    return data.lessons.map((l: any) => ({
      id: l.id,
      title: l.title,
      content: l.content_markdown || l.content || '',
      instructionalContent: l.instructional_content || undefined,
      order: l.order_index
    })).sort((a: any, b: any) => getLessonOrderIndex(a) - getLessonOrderIndex(b));
  },

  async getQuiz(courseId: string, moduleId: string): Promise<Quiz | null> {
    const headers = await buildAuthHeaders();
    const res = await safeFetchJson<any>(`/api/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleId)}/quiz`, { headers });
    if (!res.ok || !res.data || !Object.prototype.hasOwnProperty.call(res.data, 'quiz')) {
      throw new Error(`Live quiz retrieval is unavailable for ${courseId}/${moduleId}.`);
    }
    return res.data.quiz as Quiz | null;
  },

  async getFormulas(courseId: string): Promise<Formula[]> {
    const headers = await buildAuthHeaders();
    const res = await safeFetchJson<any>(`/api/courses/${encodeURIComponent(courseId)}/formulas`, { headers });
    if (!res.ok || !res.data) {
      throw new Error(`Failed to fetch formulas for ${courseId} (${res.error || `HTTP ${res.status}`})`);
    }
    const data = res.data;
    if (!Array.isArray(data.formulas)) {
      throw new Error(`Formula response for ${courseId} did not include a verified formulas array.`);
    }
    return data.formulas.map((f: any) => ({
      id: f.id,
      name: f.name,
      latex: f.latex_expression ?? f.latex ?? '',
      description: f.derivation_notes ?? f.description ?? '',
      category: typeof f.category === 'string' ? f.category : '',
      variables: f.variables_breakdown
    }));
  },

  async saveFormulas(courseId: string, formulas: Formula[]): Promise<void> {
    const headers = await buildAuthHeaders(undefined, { 'Content-Type': 'application/json' });
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/formulas`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ formulas })
    });
    if (!res.ok) {
      throw new Error(`Failed to save formulas for ${courseId}`);
    }
  },

  async saveGeneratedCourse(courseId: string, data: any): Promise<void> {
    const headers = await buildAuthHeaders(undefined, { 'Content-Type': 'application/json' });
    const res = await fetch('/api/admin/courses', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: courseId,
        code: courseId,
        title: data.title || courseId,
        description: data.description || '',
        syllabus: (data.modules || []).map((m: any, mIdx: number) => ({
          id: `m${mIdx + 1}`,
          title: m.title || `Module ${mIdx + 1}`,
          order: mIdx + 1,
          subTopics: (m.lessons || []).map((l: any, lIdx: number) => ({
            id: `m${mIdx + 1}-l${lIdx + 1}`,
            title: l.title || `Lesson ${lIdx + 1}`,
            content: l.content || '',
            order: lIdx + 1
          }))
        }))
      })
    });
    if (!res.ok) {
      throw new Error(`Failed to save generated course ${courseId} via Neon`);
    }
  },

  async updateCourse(courseId: string, data: Partial<Course>): Promise<void> {
    const headers = await buildAuthHeaders(undefined, { 'Content-Type': 'application/json' });
    const res = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      throw new Error(`Failed to update course ${courseId} via Neon`);
    }
  },

  async archiveCourse(courseId: string): Promise<void> {
    const headers = await buildAuthHeaders();
    const res = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}`, {
      method: 'DELETE',
      headers
    });
    if (!res.ok) {
      throw new Error(`Failed to archive course ${courseId} via Neon`);
    }
  },

  async getArchivedCourses(): Promise<Course[]> {
    const headers = await buildAuthHeaders();
    const res = await safeFetchJson<any>('/api/admin/courses/archived', { headers });
    if (!res.ok || !res.data) {
      throw new Error(res.error || 'Failed to fetch archived courses via Neon');
    }
    return Array.isArray(res.data.courses) ? res.data.courses : [];
  },

  async restoreCourse(courseId: string): Promise<void> {
    const headers = await buildAuthHeaders();
    const res = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}/restore`, {
      method: 'POST',
      headers
    });
    if (!res.ok) {
      throw new Error(`Failed to restore course ${courseId} via Neon`);
    }
  },

  async publishCourse(courseId: string): Promise<void> {
    const headers = await buildAuthHeaders();
    const res = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}/publish`, {
      method: 'POST',
      headers
    });
    if (!res.ok) {
      throw new Error(`Failed to publish course ${courseId} via Neon`);
    }
  },

  async permanentDeleteCourse(courseId: string): Promise<void> {
    const headers = await buildAuthHeaders();
    const res = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}/permanent`, {
      method: 'DELETE',
      headers
    });
    if (!res.ok) {
      throw new Error(`Failed to permanently delete course ${courseId} via Neon`);
    }
  }
};

