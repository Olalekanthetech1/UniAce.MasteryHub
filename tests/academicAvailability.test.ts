import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAcademicLevelKey,
  isAvailabilityState
} from '../server/services/academicAvailability';

test('academic level keys normalize the supported institutional labels', () => {
  assert.equal(normalizeAcademicLevelKey('100'), '100');
  assert.equal(normalizeAcademicLevelKey('100L'), '100');
  assert.equal(normalizeAcademicLevelKey('100 Level'), '100');
  assert.equal(normalizeAcademicLevelKey('Level 200'), '200');
  assert.equal(normalizeAcademicLevelKey('PG-1'), 'pg-1');
  assert.equal(normalizeAcademicLevelKey(''), '');
});

test('availability accepts only the three supported states', () => {
  assert.equal(isAvailabilityState('live'), true);
  assert.equal(isAvailabilityState('coming_soon'), true);
  assert.equal(isAvailabilityState('hidden'), true);
  assert.equal(isAvailabilityState('published'), false);
  assert.equal(isAvailabilityState(null), false);
});
