import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCourseGenerationTarget } from '../src/utils/courseTargeting';

test('GLOBAL targets all students through General Studies and drops stale selections', () => {
  assert.deepEqual(
    resolveCourseGenerationTarget(
      'GLOBAL',
      ['Engineering'],
      ['Materials Science and Engineering']
    ),
    {
      department: 'General Studies',
      selectedFaculties: [],
      selectedDepartments: []
    }
  );
});

test('FACULTY requires at least one faculty and ignores department selections', () => {
  assert.deepEqual(
    resolveCourseGenerationTarget(
      'FACULTY',
      ['Engineering', 'Science'],
      ['Materials Science and Engineering']
    ),
    {
      department: 'Engineering',
      selectedFaculties: ['Engineering', 'Science'],
      selectedDepartments: []
    }
  );

  assert.equal(resolveCourseGenerationTarget('FACULTY', [], []), null);
  assert.equal(resolveCourseGenerationTarget('FACULTY', ['  '], []), null);
});

test('DEPARTMENT requires at least one department and ignores faculty selections', () => {
  assert.deepEqual(
    resolveCourseGenerationTarget(
      'DEPARTMENT',
      ['Engineering'],
      ['Materials Science and Engineering', 'Mechanical Engineering']
    ),
    {
      department: 'Materials Science and Engineering',
      selectedFaculties: [],
      selectedDepartments: ['Materials Science and Engineering', 'Mechanical Engineering']
    }
  );

  assert.equal(resolveCourseGenerationTarget('DEPARTMENT', [], []), null);
  assert.equal(resolveCourseGenerationTarget('DEPARTMENT', [], ['  ']), null);
});
