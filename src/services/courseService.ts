import { Course, Module, SubTopic, Quiz, Formula, CourseId } from '../types';
import { getModuleOrderIndex, getLessonOrderIndex, sortCourseSyllabus } from '../shared/courseSchemas';
import { normalizeSemester } from '../utils/normalization';
import { safeFetchJson } from '../utils/safeFetch';
import { auth } from '../firebase';

export type StudentAvailability = 'live' | 'coming_soon' | 'hidden';
export interface AcademicLevelOption {
  level_key: string;
  label: string;
  availability: StudentAvailability;
  sort_order: number;
}

export interface AcademicAvailabilityAuditEntry {
  id: string;
  entity_type: 'academic_level' | 'course';
  entity_id: string;
  previous_state: string | null;
  next_state: string;
  actor_uid: string;
  created_at: string;
}

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
        studentVisibility: c.student_visibility ?? c.studentVisibility,
        levelAvailability: c.level_availability ?? c.levelAvailability,
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
      studentVisibility: c.student_visibility ?? c.studentVisibility,
      levelAvailability: c.level_availability ?? c.levelAvailability,
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
      contentBlocks: l.content_blocks || undefined,
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
    if (
      typeof data?.title !== 'string' || !data.title.trim() ||
      typeof data?.level !== 'string' || !data.level.trim() ||
      typeof data?.department !== 'string' || !data.department.trim() ||
      typeof data?.semester !== 'string' || !data.semester.trim() ||
      !['GLOBAL', 'FACULTY', 'DEPARTMENT'].includes(data?.scope) ||
      !Number.isInteger(data?.creditUnits) || data.creditUnits < 1 || data.creditUnits > 12
    ) {
      throw new Error('Saving a generated course requires verified title, level, department, semester, scope, and credit units.');
    }
    const headers = await buildAuthHeaders(undefined, { 'Content-Type': 'application/json' });
    const res = await fetch('/api/admin/courses', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: courseId,
        code: courseId,
        title: data.title,
        description: data.description || '',
        level: data.level,
        department: data.department,
        semester: data.semester,
        creditUnits: data.creditUnits,
        scope: data.scope,
        faculties: Array.isArray(data.faculties) ? data.faculties : [],
        departments: Array.isArray(data.departments) ? data.departments : [],
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

  async getAcademicLevels(): Promise<AcademicLevelOption[]> {
    const headers = await buildAuthHeaders();
    const res = await safeFetchJson<any>('/api/academic-levels', { headers });
    if (!res.ok || !res.data || !Array.isArray(res.data.levels)) {
      throw new Error(res.error || 'Academic level availability could not be verified.');
    }
    return res.data.levels as AcademicLevelOption[];
  },

  async getAdminAcademicLevels(): Promise<AcademicLevelOption[]> {
    const headers = await buildAuthHeaders();
    const res = await safeFetchJson<any>('/api/admin/academic-levels', { headers });
    if (!res.ok || !res.data || !Array.isArray(res.data.levels)) {
      throw new Error(res.error || 'Academic level settings could not be loaded.');
    }
    return res.data.levels as AcademicLevelOption[];
  },

  async createAcademicLevel(input: { levelKey: string; label: string; availability?: StudentAvailability; sortOrder?: number }): Promise<void> {
    const headers = await buildAuthHeaders(undefined, { 'Content-Type': 'application/json' });
    const res = await fetch('/api/admin/academic-levels', {
      method: 'POST',
      headers,
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to add academic level.');
    }
  },

  async updateAcademicLevel(levelKey: string, input: { availability?: StudentAvailability; label?: string; sortOrder?: number }): Promise<void> {
    const headers = await buildAuthHeaders(undefined, { 'Content-Type': 'application/json' });
    const res = await fetch(`/api/admin/academic-levels/${encodeURIComponent(levelKey)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to update academic level.');
    }
  },

  async getAcademicAvailabilityAudit(limit = 15): Promise<AcademicAvailabilityAuditEntry[]> {
    const headers = await buildAuthHeaders();
    const res = await safeFetchJson<any>(`/api/admin/academic-availability/audit?limit=${encodeURIComponent(String(limit))}`, { headers });
    if (!res.ok || !res.data || !Array.isArray(res.data.entries)) {
      throw new Error(res.error || 'Availability history could not be loaded.');
    }
    return res.data.entries as AcademicAvailabilityAuditEntry[];
  },

  async updateCourseAvailability(courseId: string, availability: StudentAvailability): Promise<void> {
    const headers = await buildAuthHeaders(undefined, { 'Content-Type': 'application/json' });
    const res = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}/availability`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ availability })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to update availability for ${courseId}.`);
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

