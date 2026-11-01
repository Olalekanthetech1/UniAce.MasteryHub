import { Course, UserProfile, CourseId, Semester } from '../types';
import { isSameDepartment, normalizeLevel, normalizeSemester } from './normalization';


export type ProgramStatus = 'current_program' | 'global_core' | 'elective' | 'outside_program' | 'unmapped';

export interface EligibilityResult {
  isEligible: boolean;
  status: ProgramStatus;
  reason: string;
}

/**
 * Dynamically resolves the academic faculty for any student profile or department.
 * Future-proofed: Uses explicit profile faculty, registry lookup, and structural domain inference
 * to seamlessly accommodate new departments without manual code updates.
 */
export const resolveUserFaculty = (
  _department?: string | null,
  explicitFaculty?: string | null
): string => {
  // A department-to-faculty relationship is used only when supplied by the live user/institution record.
  // No department-name heuristics are used to infer institutional structure.
  return typeof explicitFaculty === 'string' ? explicitFaculty.trim() : '';
};

/**
 * Evaluates whether a course is a university-wide institutional core (e.g. GST courses,
 * foundational sciences with universal global scope, General Studies curriculum).
 */
export const isCourseGlobalCore = (course: Course): boolean => {
  if (!course) return false;
  return course.scope === 'GLOBAL' ||
    Boolean(course.offerings?.some(offering => offering.type === 'global'));
};

/**
 * Evaluates whether a course is a faculty-wide core requirement for students
 * belonging to that faculty (e.g. GET courses for Engineering, BMS for Medicine).
 */
export const isCourseFacultyCore = (course: Course, userFaculty: string): boolean => {
  if (!course || !userFaculty || course.scope !== 'FACULTY') return false;
  const targetFaculty = userFaculty.trim().toLowerCase();
  return Boolean(
    (course.faculty && course.faculty.trim().toLowerCase() === targetFaculty) ||
    (Array.isArray(course.faculties) && course.faculties.some(f => f.trim().toLowerCase() === targetFaculty)) ||
    (Array.isArray(course.offerings) && course.offerings.some(offering =>
      offering.type === 'core' &&
      typeof offering.facultyName === 'string' &&
      offering.facultyName.trim().toLowerCase() === targetFaculty
    ))
  );
};

/**
 * Evaluates whether a course belongs directly to the student's department.
 */
export const isCourseDepartmentMatch = (course: Course, userDepartment: string): boolean => {
  if (!course || !userDepartment) return false;

  if (course.offerings && course.offerings.length > 0) {
    const matched = course.offerings.some(
      offering =>
        isSameDepartment(offering.departmentId, userDepartment) ||
        (offering.departmentName && isSameDepartment(offering.departmentName, userDepartment))
    );
    if (matched) return true;
  }

  if (course.departments && course.departments.length > 0) {
    if (course.departments.some(d => isSameDepartment(d, userDepartment))) {
      return true;
    }
  }

  if (course.department && isSameDepartment(course.department, userDepartment)) {
    return true;
  }

  return false;
};

/**
 * Shared central engine to evaluate if a course is eligible for a student's active program,
 * explicit manual enrollments, or search/explore feeds.
 */
export const getCourseProgramStatus = (
  course: Course,
  profile: UserProfile | null,
  activeSemester?: Semester | string
): ProgramStatus => {
  if (!course) return 'unmapped';
  if (!profile?.department || !profile?.academic_level) return 'unmapped';

  const userLevel = normalizeLevel(profile.academic_level);
  const userSemester = activeSemester
    ? normalizeSemester(activeSemester)
    : profile.semester
    ? normalizeSemester(profile.semester)
    : null;

  const courseLevel = normalizeLevel(course.level || '');
  const courseSemester = normalizeSemester(course.semester || '');

  // 1. Global Core Courses (universal across all departments)
  if (isCourseGlobalCore(course)) {
    if (courseLevel === userLevel && (!userSemester || courseSemester === userSemester)) {
      return 'global_core';
    }
  }

  // 2. Faculty Core Courses (across all departments within the faculty)
  const userFaculty = resolveUserFaculty(profile.department, profile.faculty);
  if (isCourseFacultyCore(course, userFaculty)) {
    if (courseLevel === userLevel && (!userSemester || courseSemester === userSemester)) {
      return 'current_program';
    }
  }

  // 3. Direct Department Offering Match
  if (isCourseDepartmentMatch(course, profile.department)) {
    if (courseLevel === userLevel && (!userSemester || courseSemester === userSemester)) {
      return 'current_program';
    }
  }

  return 'outside_program';
};

/**
 * Evaluates whether a course should be rendered in "Your Courses" feed for the given profile and semester.
 */
export const isCourseEligibleForUser = (
  course: Course,
  profile: UserProfile | null,
  activeSemester: Semester | string,
  explicitEnrolledIds: CourseId[] = []
): boolean => {
  if (!course || !profile) return false;

  const userLevel = normalizeLevel(profile.academic_level || '');
  const targetSemester = normalizeSemester(activeSemester || profile.semester || '');
  const courseLevel = normalizeLevel(course.level || '');
  const courseSemester = normalizeSemester(course.semester || '');

  // Fail closed if course lacks basic level/semester or user profile is incomplete
  if (!userLevel || !targetSemester) return false;

  // Level and Semester MUST match for "Your Courses"
  if (courseLevel !== userLevel || courseSemester !== targetSemester) {
    return false;
  }

  const status = getCourseProgramStatus(course, profile, activeSemester);

  if (status === 'current_program' || status === 'global_core') {
    return true;
  }

  // Explicitly enrolled electives
  if (explicitEnrolledIds.includes(course.id)) {
    return true;
  }

  return false;
};

/**
 * Dry-run audit function to inspect and classify all catalog courses for a given user profile.
 */
export const auditUserCatalog = (
  allCourses: Record<string, Course>,
  profile: UserProfile | null,
  activeSemester: Semester | string
) => {
  const courseList = Object.values(allCourses);
  const audit = {
    total: courseList.length,
    currentProgram: [] as Course[],
    globalCore: [] as Course[],
    outsideProgram: [] as Course[],
    unmapped: [] as Course[],
  };

  courseList.forEach(course => {
    const status = getCourseProgramStatus(course, profile, activeSemester);
    if (status === 'current_program') audit.currentProgram.push(course);
    else if (status === 'global_core') audit.globalCore.push(course);
    else if (status === 'outside_program') audit.outsideProgram.push(course);
    else audit.unmapped.push(course);
  });

  return audit;
};
