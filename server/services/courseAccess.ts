import { getPostgresPool } from '../postgresPool';
import { ensureCourseLearningSchema } from './courseLearningSchema';
import { UserRepository, type UserRecord } from '../repositories/userRepository';
import { getSystemConfigDoc } from '../systemConfigStore';
import {
  ensureAcademicAvailabilitySchema,
  listAcademicLevelAvailability,
  normalizeAcademicLevelKey,
  type AvailabilityState
} from './academicAvailability';

export interface CourseAccessRecord {
  id: string;
  status: string | null;
  scope: string | null;
  department: string | null;
  faculty: string | null;
  faculties: string[] | null;
  departments: string[] | null;
  level: string | null;
  semester: string | null;
  student_visibility: AvailabilityState | null;
  level_availability: AvailabilityState | null;
}

export interface InstitutionAccessConfig {
  departments: string[];
  faculties: string[];
  departmentToFaculty: Record<string, string>;
}

export interface CourseAccessDecision {
  allowed: boolean;
  visible: boolean;
  reason:
    | 'allowed'
    | 'not_published'
    | 'availability_hidden'
    | 'course_coming_soon'
    | 'level_coming_soon'
    | 'profile_missing'
    | 'profile_incomplete'
    | 'department_not_registered'
    | 'academic_period_mismatch'
    | 'faculty_unmapped'
    | 'faculty_target_mismatch'
    | 'department_target_mismatch'
    | 'invalid_course_scope';
}

const normalizeComparable = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const normalizeCourseTargetValue = (value: unknown): string => normalizeComparable(value);

export const normalizeAcademicLevelValue = (value: unknown): string => {
  const normalized = normalizeComparable(value);
  return normalized
    .replace(/^level\s+/, '')
    .replace(/\s+(?:level|lvl)$/, '')
    .replace(/(?:level|lvl|l)$/, '')
    .trim();
};

export const normalizeAcademicSemesterValue = (value: unknown): string => {
  const normalized = normalizeComparable(value)
    .replace(/\bsemester\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const ordinalNormalized = normalized
    .replace(/\bfirst\b/g, '1')
    .replace(/\b1st\b/g, '1')
    .replace(/\bsecond\b/g, '2')
    .replace(/\b2nd\b/g, '2')
    .trim();

  return ordinalNormalized;
};

export function isValidInstitutionAccessConfig(value: unknown): value is InstitutionAccessConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  if (!Array.isArray(config.departments) || !Array.isArray(config.faculties)) return false;
  if (!config.departments.every(item => typeof item === 'string' && item.trim().length > 0)) return false;
  if (!config.faculties.every(item => typeof item === 'string' && item.trim().length > 0)) return false;
  if (!config.departmentToFaculty || typeof config.departmentToFaculty !== 'object' ||
      Array.isArray(config.departmentToFaculty)) return false;
  return Object.values(config.departmentToFaculty as Record<string, unknown>)
    .every(item => typeof item === 'string' && item.trim().length > 0);
}

export async function getLiveCourseAccessUser(uid: string): Promise<UserRecord | null> {
  return UserRepository.getUserByUid(uid);
}

export async function getLiveInstitutionAccessConfig(): Promise<InstitutionAccessConfig> {
  const config = await getSystemConfigDoc('institution', true);
  if (!isValidInstitutionAccessConfig(config)) {
    throw new Error('Course access is unavailable: authoritative institution configuration is missing or invalid.');
  }
  return config;
}

async function attachLevelAvailability(rows: Array<Omit<CourseAccessRecord, 'level_availability'>>): Promise<CourseAccessRecord[]> {
  const levels = await listAcademicLevelAvailability();
  const availabilityByLevel = new Map(
    levels.map(level => [normalizeAcademicLevelKey(level.level_key), level.availability] as const)
  );
  return rows.map(row => ({
    ...row,
    level_availability: availabilityByLevel.get(normalizeAcademicLevelKey(row.level || '')) || 'hidden'
  }));
}

export async function getLiveCourseAccessRecord(courseId: string): Promise<CourseAccessRecord | null> {
  await ensureCourseLearningSchema();
  await ensureAcademicAvailabilitySchema();
  const pool = getPostgresPool();
  if (!pool) throw new Error('Course access is unavailable: PostgreSQL is not connected.');

  const result = await pool.query<Omit<CourseAccessRecord, 'level_availability'>>(
    `SELECT id, status, scope, department, faculty, faculties, departments, level, semester, student_visibility
     FROM courses
     WHERE id = $1
     LIMIT 1`,
    [courseId]
  );
  if (!result.rows[0]) return null;
  const [record] = await attachLevelAvailability(result.rows);
  return record;
}

export async function getLivePublishedCourseAccessRecords(): Promise<CourseAccessRecord[]> {
  await ensureCourseLearningSchema();
  await ensureAcademicAvailabilitySchema();
  const pool = getPostgresPool();
  if (!pool) throw new Error('Course access is unavailable: PostgreSQL is not connected.');

  const result = await pool.query<Omit<CourseAccessRecord, 'level_availability'>>(
    `SELECT id, status, scope, department, faculty, faculties, departments, level, semester, student_visibility
     FROM courses
     WHERE status = 'published'
     ORDER BY id ASC`
  );
  return attachLevelAvailability(result.rows);
}

const findInstitutionDepartmentFaculty = (
  department: string,
  config: InstitutionAccessConfig
): string => {
  const normalizedDepartment = normalizeCourseTargetValue(department);
  const entry = Object.entries(config.departmentToFaculty).find(
    ([name]) => normalizeCourseTargetValue(name) === normalizedDepartment
  );
  if (!entry) return '';

  const faculty = entry[1].trim();
  const isRegisteredFaculty = config.faculties.some(
    registered => normalizeCourseTargetValue(registered) === normalizeCourseTargetValue(faculty)
  );
  return isRegisteredFaculty ? faculty : '';
};

export function evaluateStudentCourseAccess(
  course: CourseAccessRecord,
  learningProfile: Record<string, any> | null | undefined,
  institution: InstitutionAccessConfig
): CourseAccessDecision {
  if (course.status !== 'published') {
    return { allowed: false, visible: false, reason: 'not_published' };
  }

  // Missing or unknown persisted availability values fail closed. Hidden items are
  // not returned in the student catalogue and cannot be opened through direct APIs.
  const validVisibility = (value: unknown): value is AvailabilityState =>
    value === 'live' || value === 'coming_soon' || value === 'hidden';
  if (
    !validVisibility(course.student_visibility) ||
    !validVisibility(course.level_availability) ||
    course.student_visibility === 'hidden' ||
    course.level_availability === 'hidden'
  ) {
    return { allowed: false, visible: false, reason: 'availability_hidden' };
  }

  if (!learningProfile || typeof learningProfile !== 'object' || Array.isArray(learningProfile)) {
    return { allowed: false, visible: false, reason: 'profile_missing' };
  }

  const department = typeof learningProfile.department === 'string'
    ? learningProfile.department.trim()
    : '';
  const level = normalizeAcademicLevelValue(learningProfile.academic_level);
  const semester = normalizeAcademicSemesterValue(learningProfile.semester);

  if (!department || !level || !semester) {
    return { allowed: false, visible: false, reason: 'profile_incomplete' };
  }

  const normalizedDepartment = normalizeCourseTargetValue(department);
  const isRegisteredDepartment = institution.departments.some(
    registered => normalizeCourseTargetValue(registered) === normalizedDepartment
  );
  if (!isRegisteredDepartment) {
    return { allowed: false, visible: false, reason: 'department_not_registered' };
  }

  const courseLevel = normalizeAcademicLevelValue(course.level);
  const courseSemester = normalizeAcademicSemesterValue(course.semester);
  if (!courseLevel || !courseSemester || courseLevel !== level || courseSemester !== semester) {
    return { allowed: false, visible: false, reason: 'academic_period_mismatch' };
  }

  const availabilityDecision = (): CourseAccessDecision => {
    if (course.level_availability !== 'live') {
      return { allowed: false, visible: true, reason: 'level_coming_soon' };
    }
    if (course.student_visibility !== 'live') {
      return { allowed: false, visible: true, reason: 'course_coming_soon' };
    }
    return { allowed: true, visible: true, reason: 'allowed' };
  };

  const scope = typeof course.scope === 'string' ? course.scope.trim().toUpperCase() : '';
  if (scope === 'GLOBAL') return availabilityDecision();

  if (scope === 'FACULTY') {
    const userFaculty = findInstitutionDepartmentFaculty(department, institution);
    if (!userFaculty) return { allowed: false, visible: false, reason: 'faculty_unmapped' };

    const configuredTargets = Array.isArray(course.faculties)
      ? course.faculties.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const targets = configuredTargets.length > 0
      ? configuredTargets
      : (typeof course.faculty === 'string' && course.faculty.trim() ? [course.faculty] : []);

    const matches = targets.some(
      target => normalizeCourseTargetValue(target) === normalizeCourseTargetValue(userFaculty)
    );
    return matches
      ? availabilityDecision()
      : { allowed: false, visible: false, reason: 'faculty_target_mismatch' };
  }

  if (scope === 'DEPARTMENT') {
    const configuredTargets = Array.isArray(course.departments)
      ? course.departments.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const targets = configuredTargets.length > 0
      ? configuredTargets
      : (typeof course.department === 'string' && course.department.trim() ? [course.department] : []);

    const matches = targets.some(
      target => normalizeCourseTargetValue(target) === normalizedDepartment
    );
    return matches
      ? availabilityDecision()
      : { allowed: false, visible: false, reason: 'department_target_mismatch' };
  }

  return { allowed: false, visible: false, reason: 'invalid_course_scope' };
}
