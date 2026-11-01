import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCourseProgramStatus,
  isCourseEligibleForUser,
  resolveUserFaculty
} from '../src/utils/courseEligibility';

const studentProfile = {
  department: 'Computer Science',
  academic_level: '200',
  semester: '1st Semester'
} as any;

const courseBase = {
  id: 'TEST101',
  title: 'Test Course',
  description: 'Test course for eligibility rules',
  syllabus: [],
  level: '200',
  semester: '1st Semester'
};

test('faculty-wide course uses the live institution department-to-faculty mapping', () => {
  const facultyCourse = {
    ...courseBase,
    department: 'Engineering',
    faculty: 'Engineering',
    faculties: ['Engineering'],
    scope: 'FACULTY'
  } as any;

  const mapping = { 'Computer Science': 'Engineering' };

  assert.equal(resolveUserFaculty('Computer Science', undefined, mapping), 'Engineering');
  assert.equal(getCourseProgramStatus(facultyCourse, studentProfile, '1st Semester', mapping), 'current_program');
  assert.equal(isCourseEligibleForUser(facultyCourse, studentProfile, '1st Semester', [], mapping), true);
});

test('faculty-wide course is not eligible to students mapped to a different faculty', () => {
  const facultyCourse = {
    ...courseBase,
    department: 'Engineering',
    faculty: 'Engineering',
    faculties: ['Engineering'],
    scope: 'FACULTY'
  } as any;

  const mapping = { 'Computer Science': 'Computing' };

  assert.equal(getCourseProgramStatus(facultyCourse, studentProfile, '1st Semester', mapping), 'outside_program');
  assert.equal(isCourseEligibleForUser(facultyCourse, studentProfile, '1st Semester', [], mapping), false);
});

test('department-wide course matches every persisted target department', () => {
  const departmentCourse = {
    ...courseBase,
    department: 'Civil Engineering',
    departments: ['Civil Engineering', 'Computer Science'],
    faculties: [],
    scope: 'DEPARTMENT'
  } as any;

  assert.equal(getCourseProgramStatus(departmentCourse, studentProfile, '1st Semester'), 'current_program');
  assert.equal(isCourseEligibleForUser(departmentCourse, studentProfile, '1st Semester'), true);
});

test('global course remains available across departments when level and semester match', () => {
  const globalCourse = {
    ...courseBase,
    department: 'General Studies',
    departments: [],
    faculties: [],
    scope: 'GLOBAL'
  } as any;

  assert.equal(getCourseProgramStatus(globalCourse, studentProfile, '1st Semester'), 'global_core');
  assert.equal(isCourseEligibleForUser(globalCourse, studentProfile, '1st Semester'), true);
});

test('faculty and global course grouping labels cannot accidentally match a department', () => {
  const facultyCourse = {
    ...courseBase,
    department: 'Engineering',
    scope: 'FACULTY',
    faculties: ['Computing']
  } as any;

  const studentInEngineeringDepartment = {
    ...studentProfile,
    department: 'Engineering'
  };

  assert.equal(getCourseProgramStatus(facultyCourse, studentInEngineeringDepartment, '1st Semester', {}), 'outside_program');
});
