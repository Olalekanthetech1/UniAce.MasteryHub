import { Course, Module, SubTopic, Quiz, Formula, CourseId } from '../types';
import { getModuleOrderIndex, getLessonOrderIndex, sortCourseSyllabus } from '../shared/courseSchemas';
import { normalizeSemester } from '../utils/normalization';
import { safeFetchJson } from '../utils/safeFetch';

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

export const CourseService = {
  async getFullCatalog(idToken?: string, retries = 2): Promise<Course[]> {
    const headers: Record<string, string> = {};
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    const baseUrl = typeof window !== 'undefined' ? '' : (process.env.APP_URL || 'http://localhost:3000');
    const res = await safeFetchJson<any>(`${baseUrl}/api/catalog/full`, { headers });
    if (!res.ok || !res.data) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.getFullCatalog(idToken, retries - 1);
      }
      throw new Error(`Failed to fetch catalog (${res.error || `HTTP ${res.status}`})`);
    }
    const data = res.data;
    return (data.courses || []).map((c: any) => ({
      id: c.id,
      title: c.title,
      description: c.description || '',
      department: c.department || '',
      faculty: c.faculty || '',
      faculties: c.faculties || (c.faculty ? [c.faculty] : []),
      departments: c.departments || (c.department ? [c.department] : []),
      level: (c.level || '100') as any,
      semester: (normalizeSemester(c.semester) || '1st Semester') as any,
      scope: c.scope || 'DEPARTMENT',
      status: c.status,
      syllabus: Array.isArray(c.syllabus) ? sortCourseSyllabus(c.syllabus) : []
    }));
  },

  async getCourse(courseId: string): Promise<Course | null> {
    const res = await safeFetchJson<any>(`/api/courses/${encodeURIComponent(courseId)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to fetch course ${courseId} (${res.error || `HTTP ${res.status}`})`);
    }
    if (!res.data?.course) return null;
    const c = res.data.course;
    return {
      id: c.id,
      title: c.title,
      description: c.description || '',
      department: c.department || '',
      faculty: c.faculty || '',
      faculties: c.faculty ? [c.faculty] : [],
      departments: c.department ? [c.department] : [],
      level: (c.level || '100') as any,
      semester: (normalizeSemester(c.semester) || '1st Semester') as any,
      scope: c.scope || 'DEPARTMENT',
      status: c.status,
      syllabus: Array.isArray(c.syllabus) ? sortCourseSyllabus(c.syllabus) : []
    };
  },

  async getModules(courseId: string): Promise<Module[]> {
    const res = await safeFetchJson<any>(`/api/courses/${encodeURIComponent(courseId)}/modules`);
    if (!res.ok || !res.data) {
      throw new Error(`Failed to fetch modules for course ${courseId} (${res.error || `HTTP ${res.status}`})`);
    }
    const data = res.data;
    if (!Array.isArray(data.modules)) {
      return [];
    }
    return data.modules.map((m: any) => ({
      id: m.id,
      title: m.title,
      subTopics: [],
      order: m.order_index
    })).sort((a: any, b: any) => getModuleOrderIndex(a) - getModuleOrderIndex(b));
  },

  async getLessons(courseId: string, moduleId: string): Promise<SubTopic[]> {
    const res = await safeFetchJson<any>(`/api/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleId)}/lessons`);
    if (!res.ok || !res.data) {
      throw new Error(`Failed to fetch lessons for ${courseId}/${moduleId} (${res.error || `HTTP ${res.status}`})`);
    }
    const data = res.data;
    if (!Array.isArray(data.lessons)) {
      return [];
    }
    return data.lessons.map((l: any) => ({
      id: l.id,
      title: l.title,
      content: l.content_markdown || l.content || '',
      order: l.order_index
    })).sort((a: any, b: any) => getLessonOrderIndex(a) - getLessonOrderIndex(b));
  },

  async getQuiz(courseId: string, moduleId: string): Promise<Quiz | null> {
    return null;
  },

  async getFormulas(courseId: string): Promise<Formula[]> {
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/formulas`);
    if (!res.ok) {
      throw new Error(`Failed to fetch formulas for ${courseId} (HTTP ${res.status}: ${res.statusText})`);
    }
    const data = await res.json();
    if (Array.isArray(data.formulas)) {
      return data.formulas.map((f: any) => ({
        id: f.id,
        name: f.name,
        latex: f.latex_expression || f.latex || '',
        description: f.derivation_notes || f.description || '',
        category: f.category || 'General',
        variables: f.variables_breakdown
      }));
    }
    return [];
  },

  async saveFormulas(courseId: string, formulas: Formula[]): Promise<void> {
    const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/formulas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ formulas })
    });
    if (!res.ok) {
      throw new Error(`Failed to save formulas for ${courseId}`);
    }
  },

  async saveGeneratedCourse(courseId: string, data: any): Promise<void> {
    const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
    const res = await fetch('/api/admin/courses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
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
    const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
    const res = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      throw new Error(`Failed to update course ${courseId} via Neon`);
    }
  },

  async archiveCourse(courseId: string): Promise<void> {
    const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
    const res = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}`, {
      method: 'DELETE',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) {
      throw new Error(`Failed to archive course ${courseId} via Neon`);
    }
  }
};
