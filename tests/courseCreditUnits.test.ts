import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveCurriculumParameters } from '../src/shared/courseSchemas';

test('curriculum parameters preserve verified course credit units', () => {
  const parameters = deriveCurriculumParameters('200 Level', 'First Semester', 3, 'standard');
  assert.equal(parameters.credits, 3);
});

test('curriculum parameter derivation rejects missing, fractional, zero, and excessive credit units', () => {
  assert.throws(() => deriveCurriculumParameters('200 Level', 'First Semester', undefined, 'standard'));
  assert.throws(() => deriveCurriculumParameters('200 Level', 'First Semester', 1.5, 'standard'));
  assert.throws(() => deriveCurriculumParameters('200 Level', 'First Semester', 0, 'standard'));
  assert.throws(() => deriveCurriculumParameters('200 Level', 'First Semester', 13, 'standard'));
});
