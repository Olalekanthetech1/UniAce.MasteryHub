import { db } from '../firebase';
import { collection, doc, getDoc, getDocs, setDoc, query, where, orderBy, writeBatch } from 'firebase/firestore';
import { Course, Module, SubTopic, Quiz, Formula, CourseId } from '../types';
import { getModuleOrderIndex, getLessonOrderIndex, sortCourseSyllabus } from '../shared/courseSchemas';

export const sanitizeForFirestore = (obj: any): any => {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (typeof obj !== 'object') return obj;
  
  // Only process arrays and plain objects. Preserve special objects (Date, FieldValue, etc.)
  if (Array.isArray(obj)) {
    // Check for nested arrays. Firestore does not support nested arrays.
    // If we find an array inside an array, we stringify the inner array to preserve data.
    return obj.map(item => {
      if (Array.isArray(item)) {
        return JSON.stringify(item);
      }
      return sanitizeForFirestore(item);
    });
  }
  
  if (obj.constructor !== Object) {
    return obj; // It's a special object, return as-is
  }
  
  const sanitized: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = obj[key];
      if (val !== undefined) {
        // If the value is a nested array (array within an object where the object is already inside an array)
        // sanitizeForFirestore will be called recursively.
        sanitized[key] = sanitizeForFirestore(val);
      }
    }
  }
  return sanitized;
};

export const CourseService = {
  async getFullCatalog(idToken?: string): Promise<Course[]> {
    const headers: Record<string, string> = {};
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    const res = await fetch('/api/catalog/full', { headers });
    if (!res.ok) {
      let details = `HTTP ${res.status}: ${res.statusText || 'Server Error'}`;
      try {
        const errData = await res.json();
        if (errData.message || errData.error) {
          details = `HTTP ${res.status}: ${errData.message || errData.error}`;
        }
      } catch {}
      throw new Error(`Failed to fetch catalog (${details})`);
    }
    const data = await res.json();
    return (data.courses || []).map((c: any) => ({
      id: c.id,
      title: c.title,
      description: c.description || '',
      department: c.department || '',
      faculty: c.faculty || '',
      faculties: c.faculties || (c.faculty ? [c.faculty] : []),
      departments: c.departments || (c.department ? [c.department] : []),
      level: (c.level || '100') as any,
      semester: (c.semester === 'second' ? '2nd Semester' : '1st Semester') as any,
      scope: c.scope || 'DEPARTMENT',
      status: c.status,
      syllabus: Array.isArray(c.syllabus) ? sortCourseSyllabus(c.syllabus) : []
    }));
  },

  async getCourse(courseId: string): Promise<Course | null> {
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}`);
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch course ${courseId} (HTTP ${res.status}: ${res.statusText})`);
    }
    const data = await res.json();
    if (!data.course) return null;
    const c = data.course;
    return {
      id: c.id,
      title: c.title,
      description: c.description || '',
      department: c.department || '',
      faculty: c.faculty || '',
      faculties: c.faculty ? [c.faculty] : [],
      departments: c.department ? [c.department] : [],
      level: (c.level || '100') as any,
      semester: (c.semester === 'second' ? '2nd Semester' : '1st Semester') as any,
      scope: c.scope || 'DEPARTMENT',
      status: c.status,
      syllabus: Array.isArray(c.syllabus) ? sortCourseSyllabus(c.syllabus) : []
    };
  },

  async getModules(courseId: string): Promise<Module[]> {
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/modules`);
    if (!res.ok) {
      throw new Error(`Failed to fetch modules for course ${courseId} (HTTP ${res.status}: ${res.statusText})`);
    }
    const data = await res.json();
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
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleId)}/lessons`);
    if (!res.ok) {
      throw new Error(`Failed to fetch lessons for ${courseId}/${moduleId} (HTTP ${res.status}: ${res.statusText})`);
    }
    const data = await res.json();
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
    const quizSnap = await getDocs(collection(db, `courses/${courseId}/modules/${moduleId}/quizzes`));
    if (!quizSnap.empty) {
      return { moduleId, ...quizSnap.docs[0].data() } as Quiz;
    }
    return null;
  },

  async getFormulas(courseId: string): Promise<Formula[]> {
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/formulas`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.formulas) && data.formulas.length > 0) {
          return data.formulas.map((f: any) => ({
            id: f.id,
            name: f.name,
            latex: f.latex_expression || f.latex || '',
            description: f.derivation_notes || f.description || '',
            category: f.category || 'General',
            variables: f.variables_breakdown
          }));
        }
      }
    } catch {
      // Transparent failover to Firestore
    }

    const formulasSnap = await getDocs(collection(db, `courses/${courseId}/formulas`));
    return formulasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Formula));
  },

  async saveFormulas(courseId: string, formulas: Formula[]): Promise<void> {
    const batch = writeBatch(db);
    formulas.forEach(formula => {
      const formulaRef = doc(db, `courses/${courseId}/formulas`, formula.id);
      batch.set(formulaRef, sanitizeForFirestore(formula), { merge: true });
    });
    await batch.commit();
  },

  async saveGeneratedCourse(courseId: string, data: any) {
    const batch = writeBatch(db);
    
    // 1. Prepare syllabus for the main course document (compatibility)
    const syllabus = (data.modules || []).map((m: any, mIdx: number) => ({
      id: `m${mIdx + 1}`,
      title: m.title || `Module ${mIdx + 1}`,
      subTopics: (m.lessons || []).map((l: any, lIdx: number) => ({
        id: `m${mIdx + 1}-l${lIdx + 1}`,
        title: l.title || `Lesson ${lIdx + 1}`
      }))
    }));

    // 2. Update Course document
    const courseRef = doc(db, 'courses', courseId);
    batch.set(courseRef, sanitizeForFirestore({ 
      isAIGenerated: true,
      syllabus: syllabus
    }), { merge: true });

    // 3. Save Modules, Lessons, and Quizzes to sub-collections (scalability)
    (data.modules || []).forEach((moduleData: any, mIndex: number) => {
      const moduleId = `m${mIndex + 1}`;
      const moduleRef = doc(db, `courses/${courseId}/modules`, moduleId);
      batch.set(moduleRef, sanitizeForFirestore({
        title: moduleData.title || `Module ${mIndex + 1}`,
        order: mIndex + 1
      }));

      (moduleData.lessons || []).forEach((lessonData: any, lIndex: number) => {
        const lessonId = `m${mIndex + 1}-l${lIndex + 1}`;
        const lessonRef = doc(db, `courses/${courseId}/modules/${moduleId}/lessons`, lessonId);
        batch.set(lessonRef, sanitizeForFirestore({
          title: lessonData.title || `Lesson ${lIndex + 1}`,
          content: lessonData.content || '',
          order: lIndex + 1
        }));
      });

      const quizRef = doc(db, `courses/${courseId}/modules/${moduleId}/quizzes`, 'default');
      batch.set(quizRef, sanitizeForFirestore({
        questions: moduleData.quiz?.questions || []
      }));
    });

    await batch.commit();
  },

  async updateCourse(courseId: string, data: Partial<Course>) {
    const courseRef = doc(db, 'courses', courseId);
    await setDoc(courseRef, sanitizeForFirestore(data), { merge: true });
  },

  async archiveCourse(courseId: string) {
    const courseRef = doc(db, 'courses', courseId);
    await setDoc(courseRef, { status: 'archived' }, { merge: true });
  }
};
