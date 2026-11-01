import { getPostgresPool } from '../postgresPool';
import { ensureCourseLearningSchema } from './courseLearningSchema';
import { UserRepository, type UserRecord } from '../repositories/userRepository';
import { getSystemConfigDoc } from '../systemConfigStore';

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
}

export interface InstitutionAccessConfig {
  departments: string[];
  faculties: string[];
  departmentToFaculty: Record<string, string>;
}

export interface CourseAccessDecision {
  allowed: boolean;
  reason:
    | 'allowed'
    | 'not_published'
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

export async function getLiveCourseAccessRecord(courseId: string): Promise<CourseAccessRecord | null> {
  await ensureCourseLearningSchema();
  const pool = getPostgresPool();
  if (!pool) throw new Error('Course access is unavailable: PostgreSQL is not connected.');

  const result = await pool.query<CourseAccessRecord>(
    `SELECT id, status, scope, department, faculty, faculties, departments, level, semester
     FROM courses
     WHERE id = $1
     LIMIT 1`,
    [courseId]
  );
  return result.rows[0] || null;
}

export async function getLivePublishedCourseAccessRecords(): Promise<CourseAccessRecord[]> {
  await ensureCourseLearningSchema();
  const pool = getPostgresPool();
  if (!pool) throw new Error('Course access is unavailable: PostgreSQL is not connected.');

  const result = await pool.query<CourseAccessRecord>(
    `SELECT id, status, scope, department, faculty, faculties, departments, level, semester
     FROM courses
     WHERE status = 'published'
     ORDER BY id ASC`
  );
  return result.rows;
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
  if (course.status !== 'published') return { allowed: false, reason: 'not_published' };
  if (!learningProfile || typeof learningProfile !== 'object' || Array.isArray(learningProfile)) {
    return { allowed: false, reason: 'profile_missing' };
  }

  const department = typeof learningProfile.department === 'string'
    ? learningProfile.department.trim()
    : '';
  const level = normalizeAcademicLevelValue(learningProfile.academic_level);
  const semester = normalizeAcademicSemesterValue(learningProfile.semester);

  if (!department || !level || !semester) {
    return { allowed: false, reason: 'profile_incomplete' };
  }

  const normalizedDepartment = normalizeCourseTargetValue(department);
  const isRegisteredDepartment = institution.departments.some(
    registered => normalizeCourseTargetValue(registered) === normalizedDepartment
  );
  if (!isRegisteredDepartment) return { allowed: false, reason: 'department_not_registered' };

  const courseLevel = normalizeAcademicLevelValue(course.level);
  const courseSemester = normalizeAcademicSemesterValue(course.semester);
  if (!courseLevel || !courseSemester || courseLevel !== level || courseSemester !== semester) {
    return { allowed: false, reason: 'academic_period_mismatch' };
  }

  const scope = typeof course.scope === 'string' ? course.scope.trim().toUpperCase() : '';
  if (scope === 'GLOBAL') return { allowed: true, reason: 'allowed' };

  if (scope === 'FACULTY') {
    const userFaculty = findInstitutionDepartmentFaculty(department, institution);
    if (!userFaculty) return { allowed: false, reason: 'faculty_unmapped' };

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
      ? { allowed: true, reason: 'allowed' }
      : { allowed: false, reason: 'faculty_target_mismatch' };
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
      ? { allowed: true, reason: 'allowed' }
      : { allowed: false, reason: 'department_target_mismatch' };
  }

  return { allowed: false, reason: 'invalid_course_scope' };
}
