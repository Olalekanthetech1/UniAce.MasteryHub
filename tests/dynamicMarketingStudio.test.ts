import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQrMatrix } from '../src/utils/qrCodeSvg';
import { convertModernCssColorsToRgb } from '../src/utils/html2canvasSafe';
import {
  resolveDynamicCapabilities,
  buildDynamicFlyerConfig,
  buildDynamicDemoScenarios,
  PlatformMarketingContext,
} from '../src/services/demoReelService';

const sampleContext: PlatformMarketingContext = {
  courses: {
    MEE201: {
      id: 'MEE201',
      title: 'Fluid Mechanics I',
      description: 'Fundamental principles of fluid statics and dynamics.',
      department: 'Mechanical Engineering',
      level: '200L',
      semester: '1st Semester',
      syllabus: [
        {
          id: 'mod-1',
          title: 'Fluid Properties & Hydrostatics',
          subTopics: [{ id: 'sub-1', title: 'Specific Weight & Density', content: 'Fluid statics.' }],
        },
      ],
      formulas: [
        {
          id: 'f-1',
          title: 'Specific Weight',
          latex: '\\gamma = \\rho g',
          description: 'Weight per unit volume of a fluid',
          category: 'Fluid Statics',
        },
      ],
    },
  },
  faculties: ['Faculty of Engineering', 'Faculty of Law'],
  departments: ['Mechanical Engineering', 'Civil Engineering', 'Commercial Law'],
  featureSwitches: { arena: true, tutor_dashboard: false },
  supportConfig: {
    faqs: [],
    tutorials: [],
    whatsappSupport: '0800-UNIACE-AI',
  },
  liveOrigin: 'https://uniace-live.example.edu.ng',
  targetScope: 'course',
  selectedCourseId: 'MEE201',
  selectedDepartment: 'Mechanical Engineering',
  selectedFaculty: 'Faculty of Engineering',
};

test('generateQrMatrix produces a valid square QR matrix with intact 7x7 finder patterns', () => {
  const matrix = generateQrMatrix('https://uniace-live.example.edu.ng');
  assert.ok(matrix.length >= 21, 'QR matrix should be at least Version 1 (21x21)');
  assert.equal(matrix.length, matrix[0].length, 'QR matrix must be square');
  // Top-left finder pattern corner and center must be dark
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[3][3], true);
  // Top-right finder pattern corner must be dark
  assert.equal(matrix[0][matrix.length - 1], true);
  // Bottom-left finder pattern corner must be dark
  assert.equal(matrix[matrix.length - 1][0], true);
});

test('resolveDynamicCapabilities filters out disabled feature switches and reflects live course context', () => {
  const capsWithArena = resolveDynamicCapabilities(sampleContext);
  assert.ok(capsWithArena.some((c) => c.id === 'battle_arena'));

  const capsWithoutArena = resolveDynamicCapabilities({
    ...sampleContext,
    featureSwitches: { arena: false },
  });
  assert.ok(!capsWithoutArena.some((c) => c.id === 'battle_arena'));

  const aiTutorCap = capsWithArena.find((c) => c.id === 'ai_tutor');
  assert.ok(aiTutorCap?.phoneDescription.includes('MEE201'));
});

test('buildDynamicFlyerConfig dynamically adapts headlines, URLs, and support contact to live state', () => {
  const flyer = buildDynamicFlyerConfig(sampleContext);
  assert.ok(flyer.headlineLine1.includes('MEE201'));
  assert.ok(flyer.leadBoldParagraph.includes('Fluid Mechanics I'));
  assert.equal(flyer.websiteDisplayUrl, 'uniace-live.example.edu.ng');
  assert.equal(flyer.qrTargetUrl, 'https://uniace-live.example.edu.ng');
  assert.equal(flyer.supportContact, '0800-UNIACE-AI');
  assert.equal(flyer.capabilities.filter((c) => c.enabled).length, 8);
});

test('buildDynamicDemoScenarios creates a live course spotlight scenario and respects feature switches', () => {
  const scenarios = buildDynamicDemoScenarios({
    ...sampleContext,
    featureSwitches: { arena: false },
  });

  assert.ok(scenarios.live_course_spotlight, 'Should include live_course_spotlight scenario');
  assert.ok(scenarios.live_course_spotlight.name.includes('MEE201'));

  const tutorStep = scenarios.live_course_spotlight.steps.find((s) => s.view === 'ai-tutor');
  assert.ok(tutorStep?.simulatedQuery?.includes('\\gamma = \\rho g'));

  // Since arena is false, quiz_sprint should dynamically substitute flashcards for arena
  const sprintViews = scenarios.quiz_sprint.steps.map((s) => s.view);
  assert.ok(!sprintViews.includes('arena'));
  assert.ok(sprintViews.includes('flashcards'));
});

test('convertModernCssColorsToRgb converts oklab, oklch, color-mix, and gradient interpolation into html2canvas-safe rgb/rgba', () => {
  const shadow = '0px 25px 50px -12px oklab(0% 0 0 / 0.25)';
  const convertedShadow = convertModernCssColorsToRgb(shadow);
  assert.ok(!convertedShadow.includes('oklab'), 'oklab should be completely removed');
  assert.equal(convertedShadow, '0px 25px 50px -12px rgba(0, 0, 0, 0.25)');

  const gradient =
    'linear-gradient(to bottom right in oklab, oklch(0.696 0.17 162.48) 0%, oklab(0.999994 0.000045 0.00002 / 0.15) 100%)';
  const convertedGradient = convertModernCssColorsToRgb(gradient);
  assert.ok(!convertedGradient.includes('oklab'), 'gradient should not contain oklab');
  assert.ok(!convertedGradient.includes('oklch'), 'gradient should not contain oklch');
  assert.ok(
    convertedGradient.startsWith('linear-gradient(to bottom right, rgb('),
    `Expected clean linear-gradient, got: ${convertedGradient}`
  );

  const nestedMix = 'color-mix(in oklab, oklch(0.7 0.15 160) 40%, transparent)';
  const convertedMix = convertModernCssColorsToRgb(nestedMix);
  assert.ok(!convertedMix.includes('color-mix'), 'color-mix should be resolved');
  assert.ok(!convertedMix.includes('oklch'), 'nested oklch should be resolved');
  assert.ok(/^rgba?\(/.test(convertedMix), `Expected rgb/rgba output, got: ${convertedMix}`);
});

