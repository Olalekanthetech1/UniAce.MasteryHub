import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateStudentCourseAccess,
  normalizeAcademicLevelValue,
  normalizeAcademicSemesterValue,
  type CourseAccessRecord,
  type InstitutionAccessConfig
} from '../server/services/courseAccess';

const institution: InstitutionAccessConfig = {
  departments: ['Computer Science', 'Electrical Engineering', 'Civil Engineering'],
  faculties: ['Engineering', 'Computing'],
  departmentToFaculty: {
    'Computer Science': 'Computing',
    'Electrical Engineering': 'Engineering',
    'Civil Engineering': 'Engineering'
  }
};

const profile = {
  department: 'Electrical Engineering',
  academic_level: '200L',
  semester: 'Second Semester'
};

const publishedCourse: CourseAccessRecord = {
  id: 'course-1',
  status: 'published',
  scope: 'DEPARTMENT',
  department: 'Electrical Engineering',
  faculty: null,
  faculties: [],
  departments: ['Electrical Engineering'],
  level: '200',
  semester: 'second'
};

test('normalizes persisted academic period labels without defaulting missing values', () => {
  assert.equal(normalizeAcademicLevelValue('200 Level'), '200');
  assert.equal(normalizeAcademicLevelValue('200L'), '200');
  assert.equal(normalizeAcademicSemesterValue('2nd Semester'), '2');
  assert.equal(normalizeAcademicSemesterValue('Second Semester'), '2');
  assert.equal(normalizeAcademicSemesterValue(''), '');
});

test('department-scope access requires an exact registered department target', () => {
  assert.deepEqual(evaluateStudentCourseAccess(publishedCourse, profile, institution), {
    allowed: true,
    reason: 'allowed'
  });

  const otherDepartment = {
    ...profile,
    department: 'Computer Science'
  };
  assert.equal(evaluateStudentCourseAccess(publishedCourse, otherDepartment, institution).allowed, false);
});

test('faculty-scope access resolves faculty from the live department registry', () => {
  const facultyCourse: CourseAccessRecord = {
    ...publishedCourse,
    scope: 'FACULTY',
    department: 'Engineering',
    faculty: 'Engineering',
    faculties: ['Engineering'],
    departments: []
  };

  assert.equal(evaluateStudentCourseAccess(facultyCourse, profile, institution).allowed, true);
  assert.equal(
    evaluateStudentCourseAccess(
      facultyCourse,
      { ...profile, department: 'Computer Science' },
      institution
    ).allowed,
    false
  );
});

test('a client/profile faculty value cannot override the authoritative department mapping', () => {
  const facultyCourse: CourseAccessRecord = {
    ...publishedCourse,
    scope: 'FACULTY',
    faculty: 'Engineering',
    faculties: ['Engineering'],
    departments: []
  };

  assert.equal(
    evaluateStudentCourseAccess(
      facultyCourse,
      { ...profile, faculty: 'Engineering', department: 'Computer Science' },
      institution
    ).allowed,
    false
  );
});

test('global courses cross department boundaries but still require matching level and semester', () => {
  const globalCourse: CourseAccessRecord = {
    ...publishedCourse,
    scope: 'GLOBAL',
    department: null,
    departments: [],
    faculties: []
  };

  assert.equal(
    evaluateStudentCourseAccess(globalCourse, { ...profile, department: 'Computer Science' }, institution).allowed,
    true
  );
  assert.equal(
    evaluateStudentCourseAccess(globalCourse, { ...profile, academic_level: '300L' }, institution).allowed,
    false
  );
  assert.equal(
    evaluateStudentCourseAccess(globalCourse, { ...profile, semester: 'First Semester' }, institution).allowed,
    false
  );
});

test('missing mappings, missing profile data, unpublished courses and unknown scopes fail closed', () => {
  const facultyCourse: CourseAccessRecord = {
    ...publishedCourse,
    scope: 'FACULTY',
    faculties: ['Engineering'],
    departments: []
  };
  assert.equal(
    evaluateStudentCourseAccess(facultyCourse, { ...profile, department: 'Unregistered Department' }, institution).reason,
    'department_not_registered'
  );
  assert.equal(
    evaluateStudentCourseAccess(
      facultyCourse,
      { ...profile, department: 'Computer Science' },
      { ...institution, departmentToFaculty: {} }
    ).reason,
    'faculty_unmapped'
  );
  assert.equal(evaluateStudentCourseAccess(publishedCourse, { ...profile, semester: '' }, institution).reason, 'profile_incomplete');
  assert.equal(evaluateStudentCourseAccess({ ...publishedCourse, status: 'draft' }, profile, institution).reason, 'not_published');
  assert.equal(evaluateStudentCourseAccess({ ...publishedCourse, scope: null }, profile, institution).reason, 'invalid_course_scope');
  assert.equal(evaluateStudentCourseAccess(publishedCourse, null, institution).reason, 'profile_missing');
});
