import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMarketingSnapshot,
  toMarketingCourseMap,
  MarketingSnapshot
} from '../src/services/marketingSnapshot';

const snapshot: MarketingSnapshot = {
  generatedAt: '2026-11-06T12:00:00.000Z',
  catalogUpdatedAt: '2026-11-06T11:55:00.000Z',
  source: 'authoritative-postgres-catalog',
  courses: [
    {
      id: 'MSE201',
      title: 'Materials Science Fundamentals',
      description: 'A published course offering.',
      department: 'Materials Science and Engineering',
      faculty: 'Faculty of Engineering',
      faculties: ['Faculty of Engineering'],
      departments: ['Materials Science and Engineering'],
      level: '200L',
      semester: '1st Semester',
      scope: 'DEPARTMENT',
      status: 'published',
      studentVisibility: 'live',
      levelAvailability: 'live',
      modules: [
        {
          id: 'module-1',
          title: 'Atomic Structure',
          lessons: [
            { id: 'lesson-1', title: 'Atomic Models' }
          ]
        }
      ],
      moduleCount: 1,
      lessonCount: 1,
      formulaCount: null
    }
  ],
  totals: {
    livePublishedCourses: 1,
    modules: 1,
    lessons: 1,
    formulas: null,
    formulasVerified: false
  },
  institution: {
    status: 'configured',
    departments: ['Materials Science and Engineering'],
    faculties: ['Faculty of Engineering'],
    departmentToFaculty: {
      'Materials Science and Engineering': 'Faculty of Engineering'
    }
  },
  featureSwitches: {
    status: 'unconfigured',
    values: null
  },
  support: {
    status: 'unconfigured'
  },
  pricing: {
    status: 'unconfigured',
    plans: null
  }
};

test('marketing snapshot contract rejects records that are not verified student-visible offerings', () => {
  assert.equal(isMarketingSnapshot(snapshot), true);

  const hiddenCourseSnapshot = {
    ...snapshot,
    courses: [{
      ...snapshot.courses[0],
      studentVisibility: 'hidden'
    }]
  };
  assert.equal(isMarketingSnapshot(hiddenCourseSnapshot), false);

  const fabricatedTotals = {
    ...snapshot,
    totals: { ...snapshot.totals, livePublishedCourses: 'one' }
  };
  assert.equal(isMarketingSnapshot(fabricatedTotals), false);
});

test('marketing course projection preserves real catalog structure without fabricating lesson content', () => {
  const projected = toMarketingCourseMap(snapshot);
  assert.equal(projected.MSE201.title, 'Materials Science Fundamentals');
  assert.equal(projected.MSE201.scope, 'DEPARTMENT');
  assert.equal(projected.MSE201.syllabus[0].title, 'Atomic Structure');
  assert.deepEqual(projected.MSE201.syllabus[0].subTopics, [
    { id: 'lesson-1', title: 'Atomic Models' }
  ]);
  assert.equal(projected.MSE201.formulaCount, null);
  assert.equal('content' in projected.MSE201.syllabus[0].subTopics[0], false);
});
