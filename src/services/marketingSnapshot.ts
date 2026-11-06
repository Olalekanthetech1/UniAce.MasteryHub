import { View } from '../types';

export interface MarketingCourse {
  id: string;
  title: string;
  description?: string;
  department: string;
  faculty: string;
  faculties: string[];
  departments: string[];
  level: string;
  semester: string;
  scope: string;
  status: 'published';
  studentVisibility: 'live';
  levelAvailability: 'live';
  formulaCount: number | null;
  syllabus: Array<{ id: string; title: string; subTopics: Array<{ id: string; title: string }> }>;
}

export interface MarketingSnapshotCourse {
  id: string;
  title: string;
  description: string;
  department: string;
  faculty: string;
  faculties: string[];
  departments: string[];
  level: string;
  semester: string;
  scope: string;
  status: 'published';
  studentVisibility: 'live';
  levelAvailability: 'live';
  modules: Array<{
    id: string;
    title: string;
    lessons: Array<{ id: string; title: string }>;
  }>;
  moduleCount: number;
  lessonCount: number;
  formulaCount: number | null;
}

export interface MarketingSnapshot {
  generatedAt: string;
  catalogUpdatedAt: string | null;
  source: 'authoritative-postgres-catalog';
  courses: MarketingSnapshotCourse[];
  totals: {
    livePublishedCourses: number;
    modules: number;
    lessons: number;
    formulas: number | null;
    formulasVerified: boolean;
  };
  institution: {
    status: 'configured' | 'unconfigured' | 'unavailable';
    departments: string[];
    faculties: string[];
    departmentToFaculty: Record<string, string>;
  };
  featureSwitches: {
    status: 'configured' | 'unconfigured' | 'unavailable';
    values: Record<string, boolean> | null;
  };
  support: {
    status: 'configured' | 'unconfigured' | 'unavailable';
    whatsappSupport?: string | null;
    contactEmail?: string | null;
  };
  pricing: {
    status: 'configured' | 'unconfigured' | 'unavailable';
    plans: Array<{
      id: string;
      name: string;
      price: number;
      duration: string;
      features: string[];
    }> | null;
  };
}

export function toMarketingCourseMap(snapshot: MarketingSnapshot): Record<string, MarketingCourse> {
  return Object.fromEntries(snapshot.courses.map((course) => [
    course.id,
    {
      id: course.id,
      title: course.title,
      description: course.description,
      department: course.department,
      faculty: course.faculty,
      faculties: course.faculties,
      departments: course.departments,
      level: course.level,
      semester: course.semester,
      scope: course.scope,
      status: course.status,
      studentVisibility: course.studentVisibility,
      levelAvailability: course.levelAvailability,
      formulaCount: course.formulaCount,
      syllabus: course.modules.map((module) => ({
        id: module.id,
        title: module.title,
        subTopics: module.lessons
      }))
    } satisfies MarketingCourse
  ]));
}

export const MARKETING_VIEWS = [
  'hub',
  'dashboard',
  'course-syllabus',
  'ai-tutor',
  'quizzes',
  'flashcards',
  'past-questions',
  'formulas',
  'mastery',
  'study-plan',
  'notebook',
  'arena'
] satisfies View[];

export function isMarketingSnapshot(value: unknown): value is MarketingSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, any>;
  const courses = snapshot.courses;
  if (
    typeof snapshot.generatedAt !== 'string' ||
    snapshot.source !== 'authoritative-postgres-catalog' ||
    !Array.isArray(courses) ||
    !snapshot.totals ||
    !snapshot.institution ||
    !snapshot.featureSwitches ||
    !snapshot.support ||
    !snapshot.pricing
  ) return false;

  const validCourses = courses.every((course: any) => {
    if (
      !course ||
      typeof course.id !== 'string' || !course.id.trim() ||
      typeof course.title !== 'string' || !course.title.trim() ||
      typeof course.department !== 'string' ||
      typeof course.faculty !== 'string' ||
      !Array.isArray(course.faculties) ||
      !course.faculties.every((item: unknown) => typeof item === 'string') ||
      !Array.isArray(course.departments) ||
      !course.departments.every((item: unknown) => typeof item === 'string') ||
      typeof course.level !== 'string' ||
      typeof course.semester !== 'string' ||
      typeof course.scope !== 'string' ||
      course.status !== 'published' ||
      course.studentVisibility !== 'live' ||
      course.levelAvailability !== 'live' ||
      !Array.isArray(course.modules) ||
      !Number.isInteger(course.moduleCount) ||
      course.moduleCount !== course.modules.length ||
      !Number.isInteger(course.lessonCount) ||
      !(course.formulaCount === null || (Number.isInteger(course.formulaCount) && course.formulaCount >= 0))
    ) return false;

    return course.modules.every((module: any) =>
      module &&
      typeof module.id === 'string' &&
      typeof module.title === 'string' &&
      Array.isArray(module.lessons) &&
      module.lessons.every((lesson: any) =>
        lesson &&
        typeof lesson.id === 'string' &&
        typeof lesson.title === 'string'
      )
    ) && course.lessonCount === course.modules.reduce(
      (sum: number, module: any) => sum + module.lessons.length,
      0
    );
  });

  if (!validCourses) return false;

  const moduleTotal = courses.reduce((sum: number, course: any) => sum + course.moduleCount, 0);
  const lessonTotal = courses.reduce((sum: number, course: any) => sum + course.lessonCount, 0);
  if (
    !Number.isInteger(snapshot.totals.livePublishedCourses) ||
    snapshot.totals.livePublishedCourses !== courses.length ||
    !Number.isInteger(snapshot.totals.modules) ||
    snapshot.totals.modules !== moduleTotal ||
    !Number.isInteger(snapshot.totals.lessons) ||
    snapshot.totals.lessons !== lessonTotal ||
    typeof snapshot.totals.formulasVerified !== 'boolean' ||
    !(snapshot.totals.formulas === null || (Number.isInteger(snapshot.totals.formulas) && snapshot.totals.formulas >= 0))
  ) return false;

  if (snapshot.totals.formulasVerified) {
    if (courses.some((course: any) => !Number.isInteger(course.formulaCount))) return false;
    const formulaTotal = courses.reduce((sum: number, course: any) => sum + course.formulaCount, 0);
    if (snapshot.totals.formulas !== formulaTotal) return false;
  } else if (snapshot.totals.formulas !== null || courses.some((course: any) => course.formulaCount !== null)) {
    return false;
  }

  const validStatus = (status: unknown) =>
    ['configured', 'unconfigured', 'unavailable'].includes(String(status));
  if (
    !validStatus(snapshot.institution.status) ||
    !Array.isArray(snapshot.institution.departments) ||
    !snapshot.institution.departments.every((item: unknown) => typeof item === 'string') ||
    !Array.isArray(snapshot.institution.faculties) ||
    !snapshot.institution.faculties.every((item: unknown) => typeof item === 'string') ||
    !snapshot.institution.departmentToFaculty ||
    typeof snapshot.institution.departmentToFaculty !== 'object' ||
    Array.isArray(snapshot.institution.departmentToFaculty) ||
    !validStatus(snapshot.featureSwitches.status) ||
    !(
      snapshot.featureSwitches.values === null ||
      (
        snapshot.featureSwitches.values &&
        typeof snapshot.featureSwitches.values === 'object' &&
        !Array.isArray(snapshot.featureSwitches.values) &&
        Object.values(snapshot.featureSwitches.values).every((item: unknown) => typeof item === 'boolean')
      )
    ) ||
    !validStatus(snapshot.support.status) ||
    !validStatus(snapshot.pricing.status) ||
    !(
      snapshot.pricing.plans === null ||
      (
        Array.isArray(snapshot.pricing.plans) &&
        snapshot.pricing.plans.every((plan: any) =>
          plan &&
          typeof plan.id === 'string' &&
          typeof plan.name === 'string' &&
          Number.isFinite(plan.price) &&
          typeof plan.duration === 'string' &&
          Array.isArray(plan.features) &&
          plan.features.every((item: unknown) => typeof item === 'string')
        )
      )
    )
  ) return false;

  return true;
}
