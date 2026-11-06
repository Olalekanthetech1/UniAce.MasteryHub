import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQrMatrix } from '../src/utils/qrCodeSvg';
import { sanitizeCssColorString } from '../src/utils/html2canvasSafe';
import {
  resolveDynamicCapabilities,
  buildDynamicFlyerConfig,
  buildDynamicDemoScenarios,
  getCoursesForMarketingScope,
  PlatformMarketingContext
} from '../src/services/demoReelService';
import { MarketingCourse } from '../src/services/marketingSnapshot';

function course(overrides: Partial<MarketingCourse> = {}): MarketingCourse {
  return {
    id: 'MEE201',
    title: 'Fluid Mechanics I',
    description: 'Fundamental principles of fluid statics and dynamics.',
    department: 'Mechanical Engineering',
    faculty: 'Faculty of Engineering',
    faculties: ['Faculty of Engineering'],
    departments: ['Mechanical Engineering'],
    level: '200L',
    semester: '1st Semester',
    scope: 'DEPARTMENT',
    status: 'published',
    studentVisibility: 'live',
    levelAvailability: 'live',
    formulaCount: null,
    syllabus: [
      {
        id: 'mod-1',
        title: 'Fluid Properties & Hydrostatics',
        subTopics: [
          { id: 'sub-1', title: 'Specific Weight & Density' }
        ]
      }
    ],
    ...overrides
  };
}

const sampleContext: PlatformMarketingContext = {
  courses: { MEE201: course() },
  faculties: ['Faculty of Engineering', 'Faculty of Law'],
  departments: ['Mechanical Engineering', 'Civil Engineering', 'Commercial Law'],
  departmentToFaculty: {
    'Mechanical Engineering': 'Faculty of Engineering',
    'Civil Engineering': 'Faculty of Engineering',
    'Commercial Law': 'Faculty of Law'
  },
  featureSwitches: { arena: true, tutor_dashboard: false },
  supportConfig: {
    whatsappSupport: '0800-UNIACE-AI'
  },
  liveOrigin: 'https://uniace-live.example.edu.ng',
  targetScope: 'course',
  selectedCourseId: 'MEE201',
  selectedDepartment: 'Mechanical Engineering',
  selectedFaculty: 'Faculty of Engineering',
  formulaCountsVerified: false
};

test('generateQrMatrix produces a square QR matrix with intact finder patterns', () => {
  const matrix = generateQrMatrix('https://uniace-live.example.edu.ng');
  assert.ok(matrix.length >= 21);
  assert.equal(matrix.length, matrix[0].length);
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[3][3], true);
  assert.equal(matrix[0][matrix.length - 1], true);
  assert.equal(matrix[matrix.length - 1][0], true);
});

test('QR generation rejects empty or oversized destinations instead of silently substituting or truncating', () => {
  assert.throws(
    () => generateQrMatrix(''),
    /QR content is required/
  );
  assert.throws(
    () => generateQrMatrix('x'.repeat(135)),
    /exceeds the supported capacity/
  );
});

test('marketing scope includes only published, visible, live-level offerings matching audience scope', () => {
  const globalCourse = course({
    id: 'GST101',
    scope: 'GLOBAL',
    department: 'General Studies',
    faculties: [],
    departments: []
  });
  const facultyCourse = course({
    id: 'ENG202',
    scope: 'FACULTY',
    department: 'Engineering',
    faculties: ['Faculty of Engineering'],
    departments: []
  });
  const hiddenCourse = course({
    id: 'MEE203',
    studentVisibility: 'hidden'
  });
  const comingSoonCourse = course({
    id: 'MEE204',
    levelAvailability: 'coming_soon'
  });
  const ctx: PlatformMarketingContext = {
    ...sampleContext,
    targetScope: 'department',
    courses: {
      MEE201: course(),
      GST101: globalCourse,
      ENG202: facultyCourse,
      MEE203: hiddenCourse,
      MEE204: comingSoonCourse,
      LAW201: course({
        id: 'LAW201',
        scope: 'DEPARTMENT',
        department: 'Commercial Law',
        departments: ['Commercial Law'],
        faculty: 'Faculty of Law',
        faculties: ['Faculty of Law']
      })
    },
    selectedDepartment: 'Mechanical Engineering'
  };

  const scoped = getCoursesForMarketingScope(ctx);
  assert.deepEqual(scoped.map((item) => item.id).sort(), ['ENG202', 'GST101', 'MEE201']);
});

test('marketing catalog rejects published courses without a resolvable audience scope', () => {
  const invalidFacultyTarget = course({
    scope: 'FACULTY',
    faculty: '',
    faculties: []
  });
  const invalidSemester = course({
    semester: ''
  });
  const ctx = {
    ...sampleContext,
    targetScope: 'full_ecosystem' as const,
    courses: {
      MEE201: invalidFacultyTarget,
      MEE202: invalidSemester
    }
  };

  assert.deepEqual(getCoursesForMarketingScope(ctx), []);
  const hub = resolveDynamicCapabilities(ctx).find((item) => item.id === 'course_hub');
  assert.equal(hub?.enabled, false);
});

test('course targeting does not silently substitute an unrelated course', () => {
  const ctx = {
    ...sampleContext,
    targetScope: 'course' as const,
    selectedCourseId: 'NOT-IN-CATALOG'
  };
  assert.deepEqual(getCoursesForMarketingScope(ctx), []);
  const flyer = buildDynamicFlyerConfig(ctx);
  assert.equal(flyer.campaignReady, false);
  assert.ok(flyer.blockingReasons.some((reason) => reason.includes('Select a course')));
});

test('unprobed interfaces are not advertised as verified capabilities', () => {
  const capabilities = resolveDynamicCapabilities(sampleContext);
  const byId = Object.fromEntries(capabilities.map((item) => [item.id, item]));

  assert.equal(byId.course_hub.enabled, true);
  assert.equal(byId.battle_arena.enabled, false);
  assert.equal(byId.battle_arena.availability, 'switch_enabled');
  assert.equal(byId.ai_tutor.enabled, false);
  assert.equal(byId.chat_with_notes.enabled, false);
  assert.equal(byId.question_generator.enabled, false);
  assert.equal(byId.flashcards.enabled, false);
  assert.equal(byId.study_planner.enabled, false);
  assert.equal(byId.formula_diagram_hub.enabled, false);
  assert.equal(byId.ai_tutor.availability, 'implemented');
});

test('switch-gated capabilities require an explicit true value', () => {
  const capabilities = resolveDynamicCapabilities({
    ...sampleContext,
    featureSwitches: null
  });
  const arena = capabilities.find((item) => item.id === 'battle_arena');
  assert.equal(arena?.enabled, false);
  assert.equal(arena?.availability, 'data_unavailable');

  const disabled = resolveDynamicCapabilities({
    ...sampleContext,
    featureSwitches: { arena: false }
  }).find((item) => item.id === 'battle_arena');
  assert.equal(disabled?.enabled, false);
  assert.equal(disabled?.availability, 'switch_disabled');
});

test('formula capability is enabled only when the inventory is verified and non-empty', () => {
  const unknown = resolveDynamicCapabilities(sampleContext)
    .find((item) => item.id === 'formula_diagram_hub');
  assert.equal(unknown?.enabled, false);

  const verified = resolveDynamicCapabilities({
    ...sampleContext,
    formulaCountsVerified: true,
    courses: { MEE201: course({ formulaCount: 2 }) }
  }).find((item) => item.id === 'formula_diagram_hub');
  assert.equal(verified?.enabled, true);
  assert.match(verified?.phoneDescription || '', /2 course formula records/);
});

test('flyer uses only scoped live data and omits unconfigured support details', () => {
  const ctx = {
    ...sampleContext,
    supportConfig: null
  };
  const flyer = buildDynamicFlyerConfig(ctx);

  assert.ok(flyer.headlineLine1.includes('MEE201'));
  assert.ok(flyer.leadBoldParagraph.includes('MEE201'));
  assert.match(flyer.leadBoldParagraph, /Mechanical Engineering at 200L, 1st Semester/);
  assert.match(flyer.subParagraph, /limited to the course's configured academic audience/);
  assert.equal(flyer.websiteDisplayUrl, 'uniace-live.example.edu.ng');
  assert.equal(flyer.qrTargetUrl, 'https://uniace-live.example.edu.ng');
  assert.equal(flyer.supportContact, '');
  assert.equal(flyer.supportLabel, '');
  assert.equal(flyer.campaignReady, true);
  assert.ok(flyer.capabilities.filter((item) => item.enabled).every((item) =>
    ['data_available', 'switch_enabled'].includes(item.availability)
  ));
  assert.doesNotMatch(
    JSON.stringify(flyer),
    /24\/7|10x|zero errors|boost your semester GPA|10 accredited university modules/i
  );
});

test('course flyer export is blocked when the course audience scope is incomplete', () => {
  const invalid = course({
    scope: 'FACULTY',
    faculties: [],
    faculty: '',
    level: '',
    semester: ''
  });
  const flyer = buildDynamicFlyerConfig({
    ...sampleContext,
    courses: { MEE201: invalid }
  });

  assert.equal(flyer.campaignReady, false);
  assert.deepEqual(getCoursesForMarketingScope({
    ...sampleContext,
    courses: { MEE201: invalid }
  }), []);
  assert.ok(flyer.blockingReasons.some((reason) => reason.includes('Select a course')));
});

test('faculty course flyer copy retains the persisted faculty target', () => {
  const facultyCourse = course({
    scope: 'FACULTY',
    department: 'Engineering',
    departments: [],
    faculty: 'Faculty of Engineering',
    faculties: ['Faculty of Engineering']
  });
  const flyer = buildDynamicFlyerConfig({
    ...sampleContext,
    courses: { MEE201: facultyCourse }
  });

  assert.equal(flyer.campaignReady, true);
  assert.match(flyer.leadBoldParagraph, /Faculty of Engineering at 200L, 1st Semester/);
});

test('flyer generation fails closed when the live deployment origin is missing', () => {
  assert.throws(
    () => buildDynamicFlyerConfig({ ...sampleContext, liveOrigin: undefined }),
    /deployment origin could not be verified/
  );
});

test('demo scenarios use a real selected course and do not fabricate tutoring prompts', () => {
  const scenarios = buildDynamicDemoScenarios({
    ...sampleContext,
    featureSwitches: { arena: false }
  });

  assert.ok(scenarios.full_ecosystem);
  const syllabusStep = scenarios.full_ecosystem.steps.find((step) => step.view === 'course-syllabus');
  assert.equal(syllabusStep?.courseId, 'MEE201');
  assert.match(syllabusStep?.title || '', /Fluid Mechanics I/);
  assert.equal(
    scenarios.full_ecosystem.steps.some((step) => step.view === 'ai-tutor'),
    false,
    'Unprobed AI tutoring must not be scripted as a verified live demonstration'
  );
  assert.equal(
    scenarios.full_ecosystem.steps.some((step) => 'demoPrompt' in step),
    false
  );
  assert.equal(
    scenarios.full_ecosystem.steps.some((step) => step.view === 'arena'),
    false
  );
});

test('department campaign never borrows a course from an unrelated department', () => {
  const scenarios = buildDynamicDemoScenarios({
    ...sampleContext,
    targetScope: 'department',
    selectedDepartment: 'Commercial Law',
    selectedCourseId: 'MEE201',
    courses: {
      MEE201: course(),
      LAW201: course({
        id: 'LAW201',
        title: 'Commercial Law',
        department: 'Commercial Law',
        faculty: 'Faculty of Law',
        faculties: ['Faculty of Law'],
        departments: ['Commercial Law']
      })
    }
  });

  const scenario = scenarios.full_ecosystem;
  assert.ok(scenario);
  assert.ok(scenario.steps.some((step) => step.courseId === 'LAW201'));
  assert.equal(scenario.steps.some((step) => step.courseId === 'MEE201'), false);
});

test('sanitizeCssColorString removes CSS Color 4 functions and gradient interpolation syntax', () => {
  const shadow = '0px 25px 50px -12px oklab(0% 0 0 / 0.25)';
  const convertedShadow = sanitizeCssColorString(shadow);
  assert.doesNotMatch(convertedShadow, /oklab|oklch|color-mix|\bcolor\(/i);
  assert.match(convertedShadow, /^0px 25px 50px -12px rgba?\(/);

  const gradient =
    'linear-gradient(to bottom right in oklab, oklch(0.696 0.17 162.48) 0%, oklab(0.999994 0.000045 0.00002 / 0.15) 100%)';
  const convertedGradient = sanitizeCssColorString(gradient);
  assert.doesNotMatch(convertedGradient, /oklab|oklch|color-mix|\bcolor\(/i);
  assert.match(
    convertedGradient,
    /^linear-gradient\(to bottom right,\s*rgba?\(/,
    'Expected a sanitized linear-gradient, got: ' + convertedGradient
  );

  const nestedMix = 'color-mix(in oklab, oklch(0.7 0.15 160) 40%, transparent)';
  const convertedMix = sanitizeCssColorString(nestedMix);
  assert.doesNotMatch(convertedMix, /color-mix|oklab|oklch|\bcolor\(/i);
  assert.match(convertedMix, /^rgba?\(/, 'Expected rgb/rgba output, got: ' + convertedMix);
});
