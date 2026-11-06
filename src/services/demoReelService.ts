import { View } from '../types';
import { SupportConfig } from './supportConfig';
import { callAI } from './ai';
import { jsonrepair } from 'jsonrepair';
import { MarketingCourse, MARKETING_VIEWS } from './marketingSnapshot';

export interface DemoStep {
  id: string;
  view: View;
  durationMs: number;
  title: string;
  subtitle: string;
  badge: string;
  demoPrompt?: string;
  highlightSelector?: string;
  courseId?: string;
}

export interface DemoScenario {
  id: string;
  name: string;
  tagline: string;
  totalDurationSec: number;
  recommendedFor: string[];
  aspectRatioHint: '16:9 Landscape' | '9:16 Vertical Reel' | '1:1 Square';
  steps: DemoStep[];
  captions: {
    twitter: string;
    linkedin: string;
    tiktok: string;
    whatsapp: string;
  };
  isDynamicAI?: boolean;
  requiresReview?: boolean;
}

export type MarketingTargetScope =
  | 'full_ecosystem'
  | 'faculty'
  | 'department'
  | 'course'
  | 'exam_readiness';

export interface PlatformMarketingContext {
  courses: Record<string, MarketingCourse>;
  faculties: string[];
  departments: string[];
  departmentToFaculty?: Record<string, string>;
  featureSwitches: Record<string, boolean> | null;
  supportConfig?: Pick<SupportConfig, 'whatsappSupport' | 'contactEmail'> | null;
  liveOrigin?: string;
  targetScope: MarketingTargetScope;
  selectedFaculty?: string;
  selectedDepartment?: string;
  selectedCourseId?: string;
  formulaCountsVerified?: boolean;
}

export interface DynamicCapabilityItem {
  id: string;
  view: View;
  iconKey:
    | 'ai-tutor'
    | 'notes-chat'
    | 'quiz-gen'
    | 'theory-eval'
    | 'flashcards'
    | 'exam-mode'
    | 'notebook'
    | 'study-planner'
    | 'formulas'
    | 'voice-tutor'
    | 'arena'
    | 'course-hub';
  accentHex: string;
  badgeBgHex: string;
  title: string;
  phoneDescription: string;
  gridDescription: string;
  enabled: boolean;
  availability: 'implemented' | 'switch_enabled' | 'switch_disabled' | 'data_available' | 'data_unavailable';
  featureSwitchKey?: string;
}

export interface DynamicFlyerConfig {
  brandName: string;
  brandSubline: string[];
  topScriptCallout: string;
  midScriptCallout: string;
  headlineLine1: string;
  headlineLine2: string;
  leadBoldParagraph: string;
  subParagraph: string;
  phoneGreeting: string;
  phonePrompt: string;
  capabilities: DynamicCapabilityItem[];
  ctaText: string;
  websiteDisplayUrl: string;
  qrTargetUrl: string;
  supportLabel: string;
  supportContact: string;
  supportSublabel: string;
  footerPillars: [string, string, string];
  themeId: 'emerald_gold' | 'royal_indigo' | 'cyber_slate';
  studentPortraitMode: 'campus_scholar_svg' | 'custom_photo';
  customPhotoDataUrl?: string;
  captions: {
    whatsapp: string;
    twitter: string;
    linkedin: string;
    tiktok: string;
  };
  campaignReady: boolean;
  blockingReasons: string[];
}

const normalize = (value: unknown): string =>
  typeof value === 'string'
    ? value.normalize('NFKC').trim().toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
    : '';

function getCleanHost(origin?: string): { url: string; displayHost: string } {
  if (typeof origin !== 'string' || !origin.trim()) {
    throw new Error('The live UniAce deployment origin could not be verified. Marketing export is unavailable.');
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('The live UniAce deployment origin is invalid. Marketing export is unavailable.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) {
    throw new Error('The live UniAce deployment origin must be an HTTP(S) URL.');
  }
  return { url: parsed.origin, displayHost: parsed.host };
}

function courseTargetsDepartment(course: MarketingCourse, department: string, ctx: PlatformMarketingContext): boolean {
  const requestedDepartment = normalize(department);
  if (!requestedDepartment) return false;
  const scope = String(course.scope || '').toUpperCase();
  if (scope === 'GLOBAL') return true;

  if (scope === 'DEPARTMENT') {
    const targets = course.departments.length > 0
      ? course.departments
      : (course.department ? [course.department] : []);
    return targets.some((target) => normalize(target) === requestedDepartment);
  }

  if (scope === 'FACULTY') {
    const requestedFaculty = Object.entries(ctx.departmentToFaculty || {})
      .find(([name]) => normalize(name) === requestedDepartment)?.[1];
    if (!requestedFaculty) return false;
    const targets = course.faculties.length > 0
      ? course.faculties
      : (course.faculty ? [course.faculty] : []);
    return targets.some((target) => normalize(target) === normalize(requestedFaculty));
  }
  return false;
}

function courseTargetsFaculty(course: MarketingCourse, faculty: string, ctx: PlatformMarketingContext): boolean {
  const requestedFaculty = normalize(faculty);
  if (!requestedFaculty) return false;
  const scope = String(course.scope || '').toUpperCase();
  if (scope === 'GLOBAL') return true;

  if (scope === 'FACULTY') {
    const targets = course.faculties.length > 0
      ? course.faculties
      : (course.faculty ? [course.faculty] : []);
    return targets.some((target) => normalize(target) === requestedFaculty);
  }

  if (scope === 'DEPARTMENT') {
    const targets = course.departments.length > 0
      ? course.departments
      : (course.department ? [course.department] : []);
    return targets.some((department) => {
      const mappedFaculty = Object.entries(ctx.departmentToFaculty || {})
        .find(([name]) => normalize(name) === normalize(department))?.[1];
      return Boolean(mappedFaculty && normalize(mappedFaculty) === requestedFaculty);
    });
  }
  return false;
}

export function getCoursesForMarketingScope(ctx: PlatformMarketingContext): MarketingCourse[] {
  const courses = Object.values(ctx.courses || {}).filter((course) =>
    course &&
    course.status === 'published' &&
    course.studentVisibility === 'live' &&
    course.levelAvailability === 'live'
  );

  if (ctx.targetScope === 'course') {
    return ctx.selectedCourseId
      ? courses.filter((course) => course.id === ctx.selectedCourseId)
      : [];
  }
  if (ctx.targetScope === 'department') {
    return courses.filter((course) => courseTargetsDepartment(course, ctx.selectedDepartment || '', ctx));
  }
  if (ctx.targetScope === 'faculty') {
    return courses.filter((course) => courseTargetsFaculty(course, ctx.selectedFaculty || '', ctx));
  }
  return courses;
}

function getSelectedCourse(ctx: PlatformMarketingContext): MarketingCourse | undefined {
  const eligible = getCoursesForMarketingScope(ctx);
  if (ctx.targetScope === 'course') return eligible[0];
  if (ctx.selectedCourseId) {
    const selected = eligible.find((course) => course.id === ctx.selectedCourseId);
    if (selected) return selected;
  }
  return eligible[0];
}

function getCourseAudienceLabel(course: MarketingCourse): string | null {
  const scope = String(course.scope || '').toUpperCase();
  const level = course.level.trim();
  const semester = course.semester.trim();
  if (!level || !semester) return null;

  if (scope === 'GLOBAL') {
    return `students across the institution at ${level}, ${semester}`;
  }

  if (scope === 'FACULTY') {
    const targets = course.faculties.length > 0
      ? course.faculties
      : (course.faculty ? [course.faculty] : []);
    const names = Array.from(new Set(targets.map((value) => value.trim()).filter(Boolean)));
    return names.length > 0
      ? `students in ${names.join(', ')} at ${level}, ${semester}`
      : null;
  }

  if (scope === 'DEPARTMENT') {
    const targets = course.departments.length > 0
      ? course.departments
      : (course.department ? [course.department] : []);
    const names = Array.from(new Set(targets.map((value) => value.trim()).filter(Boolean)));
    return names.length > 0
      ? `students in ${names.join(', ')} at ${level}, ${semester}`
      : null;
  }

  return null;
}

const CAPABILITY_REGISTRY: Omit<DynamicCapabilityItem, 'phoneDescription' | 'gridDescription' | 'enabled' | 'availability'>[] = [
  { id: 'ai_tutor', view: 'ai-tutor', iconKey: 'ai-tutor', accentHex: '#10b981', badgeBgHex: '#059669', title: 'AI Academic Tutor' },
  { id: 'chat_with_notes', view: 'ai-tutor', iconKey: 'notes-chat', accentHex: '#14b8a6', badgeBgHex: '#0d9488', title: 'Chat With Study Materials' },
  { id: 'question_generator', view: 'quizzes', iconKey: 'quiz-gen', accentHex: '#3b82f6', badgeBgHex: '#16a34a', title: 'Practice Questions' },
  { id: 'theory_questions', view: 'past-questions', iconKey: 'theory-eval', accentHex: '#f97316', badgeBgHex: '#2563eb', title: 'Past Questions' },
  { id: 'flashcards', view: 'flashcards', iconKey: 'flashcards', accentHex: '#6366f1', badgeBgHex: '#7c3aed', title: 'Study Flashcards' },
  { id: 'exam_mode', view: 'quizzes', iconKey: 'exam-mode', accentHex: '#059669', badgeBgHex: '#a16207', title: 'Quiz Practice' },
  { id: 'my_notes', view: 'notebook', iconKey: 'notebook', accentHex: '#2563eb', badgeBgHex: '#d97706', title: 'Study Notebook' },
  { id: 'study_planner', view: 'study-plan', iconKey: 'study-planner', accentHex: '#16a34a', badgeBgHex: '#0284c7', title: 'Study Planner' },
  { id: 'formula_diagram_hub', view: 'formulas', iconKey: 'formulas', accentHex: '#8b5cf6', badgeBgHex: '#4f46e5', title: 'Course Formulas' },
  { id: 'battle_arena', view: 'arena', iconKey: 'arena', accentHex: '#e11d48', badgeBgHex: '#be123c', title: 'Academic Arena', featureSwitchKey: 'arena' },
  { id: 'course_hub', view: 'hub', iconKey: 'course-hub', accentHex: '#0d9488', badgeBgHex: '#0f766e', title: 'Course Hub' }
];

export function resolveDynamicCapabilities(ctx: PlatformMarketingContext): DynamicCapabilityItem[] {
  const liveCourses = Object.values(ctx.courses || {}).filter((course) =>
    course?.status === 'published' &&
    course?.studentVisibility === 'live' &&
    course?.levelAvailability === 'live'
  );
  const totalModules = liveCourses.reduce((sum, course) => sum + (course.syllabus?.length || 0), 0);
  const formulaInventoryVerified = ctx.formulaCountsVerified === true &&
    liveCourses.every((course) => typeof course.formulaCount === 'number');
  const totalFormulas = formulaInventoryVerified
    ? liveCourses.reduce((sum, course) => sum + (course.formulaCount || 0), 0)
    : null;
  const selectedCourse = getSelectedCourse(ctx);
  const scopeLabel = ctx.targetScope === 'course' && selectedCourse
    ? selectedCourse.id
    : ctx.targetScope === 'department' && ctx.selectedDepartment
      ? ctx.selectedDepartment
      : ctx.targetScope === 'faculty' && ctx.selectedFaculty
        ? ctx.selectedFaculty
        : 'your course';

  return CAPABILITY_REGISTRY.map((definition): DynamicCapabilityItem => {
    // A route/component existing is not proof that its dependent runtime works.
    // Only capabilities with explicit live evidence are eligible for marketing.
    let enabled = false;
    let availability: DynamicCapabilityItem['availability'] = 'implemented';
    let phoneDescription = '';
    let gridDescription = '';

    switch (definition.id) {
      case 'ai_tutor':
        phoneDescription = selectedCourse
          ? `Ask for step-by-step help with ${selectedCourse.id}.`
          : 'Ask questions and work through difficult topics.';
        gridDescription = 'Step-by-step academic explanations';
        break;
      case 'chat_with_notes':
        phoneDescription = 'Ask questions about uploaded study materials.';
        gridDescription = 'Discuss your study materials';
        break;
      case 'question_generator':
        phoneDescription = `Practise topics relevant to ${scopeLabel}.`;
        gridDescription = 'Practise course topics';
        break;
      case 'theory_questions':
        phoneDescription = 'Review questions from available past papers.';
        gridDescription = 'Review past questions';
        break;
      case 'flashcards':
        phoneDescription = 'Use flashcards for active-recall practice.';
        gridDescription = 'Active-recall revision';
        break;
      case 'exam_mode':
        phoneDescription = 'Practise with available course quizzes.';
        gridDescription = 'Course quiz practice';
        break;
      case 'my_notes':
        phoneDescription = totalModules > 0
          ? `Browse ${totalModules} published course modules.`
          : 'Keep personal study notes together.';
        gridDescription = 'Organise study notes';
        break;
      case 'study_planner':
        phoneDescription = 'Plan and organise study sessions.';
        gridDescription = 'Plan study sessions';
        break;
      case 'formula_diagram_hub':
        enabled = formulaInventoryVerified && (totalFormulas || 0) > 0;
        availability = enabled ? 'data_available' : 'data_unavailable';
        phoneDescription = enabled
          ? `Browse ${totalFormulas} course formula records.`
          : 'Formula inventory is not verified or has no live records.';
        gridDescription = enabled ? 'Browse course formulas' : 'Formula inventory not verified';
        break;
      case 'battle_arena': {
        const switchEnabled = ctx.featureSwitches?.arena === true;
        // The switch proves that the feature is configured on; it does not prove
        // that the Arena can complete a student-facing session successfully.
        enabled = false;
        availability = switchEnabled
          ? 'switch_enabled'
          : ctx.featureSwitches && typeof ctx.featureSwitches.arena === 'boolean'
            ? 'switch_disabled'
            : 'data_unavailable';
        phoneDescription = switchEnabled
          ? 'Enabled in configuration; live operation is not verified.'
          : 'Academic Arena is disabled or its configuration is unavailable.';
        gridDescription = switchEnabled
          ? 'Runtime operation not verified'
          : 'Not enabled for students';
        break;
      }
      case 'course_hub':
        enabled = liveCourses.length > 0;
        availability = enabled ? 'data_available' : 'data_unavailable';
        phoneDescription = enabled
          ? `Browse ${liveCourses.length} published course offerings.`
          : 'No live published course offerings are verified.';
        gridDescription = 'Browse live course offerings';
        break;
    }

    if (definition.featureSwitchKey && ctx.featureSwitches?.[definition.featureSwitchKey] !== true) {
      enabled = false;
    }

    return { ...definition, phoneDescription, gridDescription, enabled, availability };
  }).filter((item) => MARKETING_VIEWS.includes(item.view));
}

export function buildDynamicFlyerConfig(ctx: PlatformMarketingContext): DynamicFlyerConfig {
  const { url, displayHost } = getCleanHost(ctx.liveOrigin);
  const liveCourses = Object.values(ctx.courses || {}).filter((course) =>
    course?.status === 'published' &&
    course?.studentVisibility === 'live' &&
    course?.levelAvailability === 'live'
  );
  const scopedCourses = getCoursesForMarketingScope(ctx);
  const selectedCourse = getSelectedCourse(ctx);
  const capabilities = resolveDynamicCapabilities(ctx);
  const blockingReasons: string[] = [];
  const courseAudience = selectedCourse ? getCourseAudienceLabel(selectedCourse) : null;

  let headlineLine1 = 'Study with greater';
  let headlineLine2 = 'clarity and structure';
  let leadBoldParagraph = 'UniAce brings course information and student study tools together in one learning workspace.';
  let subParagraph = 'Explore current course offerings and use the learning tools that are available in the application.';
  let phoneGreeting = 'Hello, Scholar 👋';

  if (ctx.targetScope === 'course') {
    if (selectedCourse) {
      headlineLine1 = `Explore ${selectedCourse.id}`;
      headlineLine2 = selectedCourse.title;
      leadBoldParagraph = courseAudience
        ? `Explore the live ${selectedCourse.id} course offering in UniAce Mastery Hub for ${courseAudience}.`
        : `The ${selectedCourse.id} course offering is listed, but its intended student audience is not fully verified.`;
      subParagraph = selectedCourse.syllabus.length > 0
        ? `The published outline contains ${selectedCourse.syllabus.length} modules. Access is limited to the course's configured academic audience.`
        : 'View the published course information and the study tools currently available.';
      phoneGreeting = `Studying ${selectedCourse.id} 👋`;
    }
  } else if (ctx.targetScope === 'department' && ctx.selectedDepartment) {
    headlineLine1 = 'Study with';
    headlineLine2 = ctx.selectedDepartment;
    leadBoldParagraph = `UniAce course offerings for ${ctx.selectedDepartment} students.`;
    subParagraph = `${scopedCourses.length} live course offering(s) match this department audience. Course visibility remains subject to each offering's academic scope.`;
  } else if (ctx.targetScope === 'faculty' && ctx.selectedFaculty) {
    headlineLine1 = 'Explore courses in';
    headlineLine2 = ctx.selectedFaculty;
    leadBoldParagraph = `Explore UniAce course offerings targeted to ${ctx.selectedFaculty}.`;
    subParagraph = `${scopedCourses.length} live course offering(s) match this faculty audience. Department and faculty restrictions still apply.`;
  } else if (ctx.targetScope === 'exam_readiness') {
    headlineLine1 = 'Prepare with';
    headlineLine2 = 'practice and revision';
    leadBoldParagraph = 'Use the study and practice tools that are currently available in UniAce.';
    subParagraph = selectedCourse
      ? `This campaign is focused on ${selectedCourse.id} — ${selectedCourse.title}.`
      : 'Choose a live course offering to make this campaign course-specific.';
  }

  const supportContact =
    ctx.supportConfig?.whatsappSupport?.trim() ||
    ctx.supportConfig?.contactEmail?.trim() ||
    '';
  const isPhone = /^[+\d\s()-]{7,}$/.test(supportContact);
  const enabledNames = capabilities.filter((capability) => capability.enabled).slice(0, 8).map((item) => item.title);
  const featureList = enabledNames.length > 0
    ? enabledNames.map((name) => `• ${name}`).join('\n')
    : 'No capabilities are currently cleared for display.';

  if (ctx.targetScope === 'course' && !selectedCourse) {
    blockingReasons.push('Select a course that is published, student-visible and at a live academic level.');
  }
  if (ctx.targetScope === 'course' && selectedCourse && !courseAudience) {
    blockingReasons.push('The selected course is missing a valid scope, target audience, level or semester. Correct its persisted academic metadata before exporting.');
  }
  if (ctx.targetScope === 'department' && (!ctx.selectedDepartment || scopedCourses.length === 0)) {
    blockingReasons.push('No live course offering is verified for the selected department.');
  }
  if (ctx.targetScope === 'faculty' && (!ctx.selectedFaculty || scopedCourses.length === 0)) {
    blockingReasons.push('No live course offering is verified for the selected faculty.');
  }
  if ((ctx.targetScope === 'full_ecosystem' || ctx.targetScope === 'exam_readiness') && liveCourses.length === 0) {
    blockingReasons.push('The authoritative catalog contains no published course marked live for student access.');
  }

  return {
    brandName: 'UniAce Mastery Hub',
    brandSubline: ['Learn', 'Practise', 'Revise'],
    topScriptCallout: 'Your Study Companion',
    midScriptCallout: 'Build your understanding',
    headlineLine1,
    headlineLine2,
    leadBoldParagraph,
    subParagraph,
    phoneGreeting,
    phonePrompt: 'Explore the tools available in UniAce',
    capabilities,
    ctaText: 'Explore UniAce',
    websiteDisplayUrl: displayHost,
    qrTargetUrl: url,
    supportLabel: supportContact ? 'Need Help?' : '',
    supportContact,
    supportSublabel: supportContact ? (isPhone ? '(Support Line)' : '(Official Support)') : '',
    footerPillars: ['COURSE-BASED LEARNING', 'PRACTICE & REVISION', 'STUDENT STUDY TOOLS'],
    themeId: 'emerald_gold',
    studentPortraitMode: 'campus_scholar_svg',
    captions: {
      whatsapp: `🎓 *${headlineLine1} ${headlineLine2}*\n\n${leadBoldParagraph}\n\nAvailable tools:\n${featureList}\n\n🔗 Explore: ${url}`,
      twitter: `🎓 ${headlineLine1} ${headlineLine2}\n${leadBoldParagraph}\nTools: ${enabledNames.join(', ')}\n${url} #UniAce #University`.slice(0, 275),
      linkedin: `${headlineLine1} ${headlineLine2} — UniAce Mastery Hub\n\n${leadBoldParagraph}\n\n${subParagraph}\n\nExplore the live platform: ${url}\n\n#HigherEducation #EdTech #UniAce`,
      tiktok: `${headlineLine1} ${headlineLine2}. Explore the learning tools currently available in UniAce. ${url} #university #studytok #uniace`
    },
    campaignReady: blockingReasons.length === 0,
    blockingReasons
  };
}

export async function synthesizeFlyerWithAI(
  ctx: PlatformMarketingContext,
  currentConfig: DynamicFlyerConfig,
  customCampaignAngle?: string
): Promise<DynamicFlyerConfig> {
  const selectedCourse = getSelectedCourse(ctx);
  const scopedCourses = getCoursesForMarketingScope(ctx);
  const activeCaps = currentConfig.capabilities.filter((capability) => capability.enabled);

  const contextSummary = {
    targetScope: ctx.targetScope,
    selectedFaculty: ctx.selectedFaculty || null,
    selectedDepartment: ctx.selectedDepartment || null,
    selectedCourse: selectedCourse
      ? {
          code: selectedCourse.id,
          title: selectedCourse.title,
          department: selectedCourse.department,
          level: selectedCourse.level,
          semester: selectedCourse.semester,
          moduleTitles: selectedCourse.syllabus.map((module) => module.title),
          moduleCount: selectedCourse.syllabus.length
        }
      : null,
    scopedCourseOfferings: scopedCourses.map((course) => ({
      id: course.id,
      title: course.title,
      scope: course.scope,
      department: course.department,
      faculty: course.faculty,
      departments: course.departments,
      faculties: course.faculties
    })),
    verifiedCourseOfferingCount: scopedCourses.length,
    availableCapabilityIdsAndNames: activeCaps.map((capability) => ({
      id: capability.id,
      title: capability.title,
      description: capability.phoneDescription
    })),
    liveWebsiteUrl: currentConfig.qrTargetUrl,
    customCampaignAngle: customCampaignAngle?.trim() || null
  };

  const prompt = `You are UniAce Mastery Hub's marketing copy editor.
Use only the exact factual information supplied in this verified platform snapshot:

${JSON.stringify(contextSummary, null, 2)}

Rules:
- Do not invent course counts, module counts, prices, student numbers, ratings, outcomes, accreditations, guarantees, service hours, performance claims or feature availability.
- Do not describe a capability unless its exact ID and name appear in availableCapabilityIdsAndNames.
- Preserve course names, codes, faculty names and department names exactly.
- Do not claim that all students can access a targeted course; scope restrictions apply.
- You may improve tone, clarity, structure and campaign relevance.
- Return complete copy as a DRAFT for administrator review, not as independently verified fact.

Return only a JSON object with this structure:
{
  "headlineLine1": "Short first headline (maximum 32 characters)",
  "headlineLine2": "Short second headline (maximum 32 characters)",
  "topScriptCallout": "Short brand callout",
  "midScriptCallout": "Short encouragement",
  "leadBoldParagraph": "One concise value proposition based only on the supplied snapshot",
  "subParagraph": "One or two concise supporting sentences",
  "phoneGreeting": "Short greeting",
  "featureBlurbs": [
    {
      "id": "exact capability ID from availableCapabilityIdsAndNames",
      "phoneDescription": "Short description with no new factual claims",
      "gridDescription": "Short description with no new factual claims"
    }
  ],
  "captions": {
    "whatsapp": "Campaign caption that includes the exact live URL",
    "twitter": "Campaign caption that includes the exact live URL",
    "linkedin": "Professional campaign caption that includes the exact live URL",
    "tiktok": "Campaign caption that includes the exact live URL"
  }
}`;

  const result = await callAI(
    prompt,
    'Return strictly valid JSON. Never add facts that are not present in the supplied marketing snapshot.',
    'json',
    1200,
    'standard',
    'chat'
  );
  const raw = result.text.replace(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/g, '$1').trim();
  const parsed = JSON.parse(jsonrepair(raw));

  const requiredStrings = [
    'headlineLine1', 'headlineLine2', 'topScriptCallout', 'midScriptCallout',
    'leadBoldParagraph', 'subParagraph', 'phoneGreeting'
  ];
  for (const key of requiredStrings) {
    if (typeof parsed[key] !== 'string' || !parsed[key].trim()) {
      throw new Error(`AI marketing draft is missing required field: ${key}.`);
    }
  }
  for (const key of ['whatsapp', 'twitter', 'linkedin', 'tiktok']) {
    if (typeof parsed.captions?.[key] !== 'string' || !parsed.captions[key].trim() ||
        !parsed.captions[key].includes(currentConfig.qrTargetUrl)) {
      throw new Error(`AI marketing draft did not return a complete ${key} caption with the verified URL.`);
    }
  }

  const activeIds = new Set(activeCaps.map((capability) => capability.id));
  const blurbs = new Map<string, any>();
  if (Array.isArray(parsed.featureBlurbs)) {
    for (const item of parsed.featureBlurbs) {
      if (item && typeof item.id === 'string' && activeIds.has(item.id)) blurbs.set(item.id, item);
    }
  }
  const capabilities = currentConfig.capabilities.map((capability) => {
    const item = blurbs.get(capability.id);
    if (!item) return capability;
    return {
      ...capability,
      phoneDescription: typeof item.phoneDescription === 'string' && item.phoneDescription.trim()
        ? item.phoneDescription.trim()
        : capability.phoneDescription,
      gridDescription: typeof item.gridDescription === 'string' && item.gridDescription.trim()
        ? item.gridDescription.trim()
        : capability.gridDescription
    };
  });

  return {
    ...currentConfig,
    headlineLine1: parsed.headlineLine1.trim(),
    headlineLine2: parsed.headlineLine2.trim(),
    topScriptCallout: parsed.topScriptCallout.trim(),
    midScriptCallout: parsed.midScriptCallout.trim(),
    leadBoldParagraph: parsed.leadBoldParagraph.trim(),
    subParagraph: parsed.subParagraph.trim(),
    phoneGreeting: parsed.phoneGreeting.trim(),
    capabilities,
    captions: {
      whatsapp: parsed.captions.whatsapp.trim(),
      twitter: parsed.captions.twitter.trim(),
      linkedin: parsed.captions.linkedin.trim(),
      tiktok: parsed.captions.tiktok.trim()
    }
  };
}

function buildScenarioCaptions(
  url: string,
  targetName: string,
  course?: MarketingCourse,
  capabilities: DynamicCapabilityItem[] = []
): DemoScenario['captions'] {
  const names = capabilities.filter((item) => item.enabled).map((item) => item.title);
  const features = names.length > 0 ? names.join(', ') : 'the current student-facing interface';
  const courseContext = course ? `Course spotlight: ${course.id} — ${course.title}. ` : '';
  return {
    twitter: `${targetName}: ${courseContext}Explore ${features} in UniAce. ${url} #UniAce #University`,
    linkedin: `Explore UniAce Mastery Hub. ${courseContext}This walkthrough demonstrates ${features}. Course access remains subject to the published faculty, department and academic-level scope. ${url} #HigherEducation #EdTech`,
    tiktok: `${courseContext}See the current UniAce learning interface. ${url} #university #studytok #uniace`,
    whatsapp: `🎓 ${targetName}\n${courseContext}Explore the student-facing study tools currently shown in UniAce Mastery Hub:\n${features}\n${url}`
  };
}

export function buildDynamicDemoScenarios(ctx: PlatformMarketingContext): Record<string, DemoScenario> {
  const { url } = getCleanHost(ctx.liveOrigin);
  const eligibleCourses = getCoursesForMarketingScope(ctx);
  const selectedCourse = getSelectedCourse(ctx);
  const capabilities = resolveDynamicCapabilities(ctx);
  const active = capabilities.filter((item) => item.enabled);
  const targetName =
    ctx.targetScope === 'department' ? (ctx.selectedDepartment || 'Department campaign') :
    ctx.targetScope === 'faculty' ? (ctx.selectedFaculty || 'Faculty campaign') :
    ctx.targetScope === 'course' && selectedCourse ? `${selectedCourse.id} — ${selectedCourse.title}` :
    ctx.targetScope === 'exam_readiness' ? 'Exam practice campaign' :
    'UniAce platform';

  const steps: DemoStep[] = [];
  if (active.some((item) => item.view === 'hub') && eligibleCourses.length > 0) {
    steps.push({
      id: 'live_step_hub',
      view: 'hub',
      durationMs: 6000,
      title: 'Live Course Hub',
      subtitle: `${eligibleCourses.length} live course offering(s) match this campaign scope.`,
      badge: 'Course discovery'
    });
  }
  if (selectedCourse) {
    steps.push({
      id: 'live_step_syllabus',
      view: 'course-syllabus',
      courseId: selectedCourse.id,
      durationMs: 6000,
      title: `${selectedCourse.id}: ${selectedCourse.title}`,
      subtitle: selectedCourse.syllabus.length > 0
        ? `Explore its ${selectedCourse.syllabus.length} published modules.`
        : 'Explore the published course information.',
      badge: 'Course spotlight'
    });
  }
  if (active.some((item) => item.id === 'ai_tutor')) {
    const firstModule = selectedCourse?.syllabus?.[0];
    const prompt = selectedCourse && firstModule
      ? `In ${selectedCourse.id} — ${selectedCourse.title}, explain the module "${firstModule.title}" step by step. Start with the prerequisite ideas and explain the core concepts without assuming prior mastery.`
      : undefined;
    steps.push({
      id: 'live_step_tutor',
      view: 'ai-tutor',
      courseId: selectedCourse?.id,
      durationMs: 8000,
      title: 'AI Academic Tutor',
      subtitle: selectedCourse && firstModule
        ? `Use a real module from ${selectedCourse.id} as the tutoring prompt.`
        : 'Open the tutor interface and demonstrate a real question.',
      badge: 'Academic support',
      demoPrompt: prompt
    });
  }
  for (const feature of active.filter((item) => ['question_generator', 'flashcards', 'study_planner', 'my_notes'].includes(item.id))) {
    if (steps.length >= 6) break;
    steps.push({
      id: `live_step_${feature.id}`,
      view: feature.view,
      courseId: selectedCourse?.id,
      durationMs: 5000,
      title: feature.title,
      subtitle: feature.phoneDescription,
      badge: 'Live interface'
    });
  }

  const scenarios: Record<string, DemoScenario> = {};
  if (steps.length > 0) {
    scenarios.full_ecosystem = {
      id: 'full_ecosystem',
      name: 'Live UniAce Walkthrough',
      tagline: `A guided tour assembled from current ${ctx.targetScope.replace('_', ' ')} data and implemented student views.`,
      totalDurationSec: Math.round(steps.reduce((sum, step) => sum + step.durationMs, 0) / 1000),
      recommendedFor: ['WhatsApp', 'LinkedIn', 'YouTube'],
      aspectRatioHint: '16:9 Landscape',
      steps,
      captions: buildScenarioCaptions(url, targetName, selectedCourse, capabilities)
    };
  }

  if (selectedCourse && selectedCourse.syllabus.length > 0 && active.some((item) => item.id === 'ai_tutor')) {
    const module = selectedCourse.syllabus[0];
    scenarios.ai_tutor_deepdive = {
      id: 'ai_tutor_deepdive',
      name: `Tutor spotlight: ${selectedCourse.id}`,
      tagline: `A real course-module tutoring walkthrough for ${selectedCourse.title}.`,
      totalDurationSec: 18,
      recommendedFor: ['TikTok', 'Instagram Reels', 'YouTube Shorts'],
      aspectRatioHint: '9:16 Vertical Reel',
      steps: [
        {
          id: 'tutor_course_step',
          view: 'course-syllabus',
          courseId: selectedCourse.id,
          durationMs: 5000,
          title: `${selectedCourse.id} Course Outline`,
          subtitle: `Open the published outline and select ${module.title}.`,
          badge: 'Course context'
        },
        {
          id: 'tutor_live_step',
          view: 'ai-tutor',
          courseId: selectedCourse.id,
          durationMs: 13000,
          title: `Tutor: ${module.title}`,
          subtitle: 'Submit a real question to the live academic tutor.',
          badge: 'Live request',
          demoPrompt: `In ${selectedCourse.id} — ${selectedCourse.title}, explain the module "${module.title}" step by step. Include the key concepts and a check-for-understanding question.`
        }
      ],
      captions: buildScenarioCaptions(url, targetName, selectedCourse, capabilities)
    };
  }

  if (selectedCourse && active.some((item) => item.id === 'question_generator')) {
    scenarios.course_practice = {
      id: 'course_practice',
      name: `Practice spotlight: ${selectedCourse.id}`,
      tagline: `A course-specific look at the available practice interface for ${selectedCourse.title}.`,
      totalDurationSec: 16,
      recommendedFor: ['TikTok', 'Instagram Stories', 'WhatsApp'],
      aspectRatioHint: '9:16 Vertical Reel',
      steps: [
        {
          id: 'practice_syllabus',
          view: 'course-syllabus',
          courseId: selectedCourse.id,
          durationMs: 5000,
          title: `${selectedCourse.id}: ${selectedCourse.title}`,
          subtitle: 'Open a published course module.',
          badge: 'Course context'
        },
        {
          id: 'practice_quiz',
          view: 'quizzes',
          courseId: selectedCourse.id,
          durationMs: 11000,
          title: 'Course Practice',
          subtitle: 'Demonstrate the actual quiz and practice controls.',
          badge: 'Practice interface'
        }
      ],
      captions: buildScenarioCaptions(url, targetName, selectedCourse, capabilities)
    };
  }

  return scenarios;
}

export async function synthesizeCustomDemoScenarioWithAI(
  ctx: PlatformMarketingContext,
  customDirective?: string
): Promise<DemoScenario> {
  const { url } = getCleanHost(ctx.liveOrigin);
  const selectedCourse = getSelectedCourse(ctx);
  const capabilities = resolveDynamicCapabilities(ctx).filter((item) => item.enabled);
  const allowedViews = Array.from(new Set(capabilities.map((item) => item.view)));
  if (selectedCourse) allowedViews.push('course-syllabus');
  const validViews = allowedViews.filter((view, index) => allowedViews.indexOf(view) === index);

  if (validViews.length === 0) {
    throw new Error('No implemented student views are currently eligible for a marketing demonstration.');
  }

  const prompt = `You are the creative director for a UniAce product demonstration.
Create a short screen-recording storyboard from the verified runtime context below:

- Target scope: ${ctx.targetScope}
- Selected faculty: ${ctx.selectedFaculty || 'not selected'}
- Selected department: ${ctx.selectedDepartment || 'not selected'}
- Selected course: ${selectedCourse ? `${selectedCourse.id} — ${selectedCourse.title}` : 'none'}
- Actual course modules: ${selectedCourse ? selectedCourse.syllabus.map((module) => module.title).join(' | ') : 'none'}
- Allowed application views: ${validViews.join(', ')}
- Current enabled capability names: ${capabilities.map((item) => item.title).join(', ')}
- Live URL: ${url}
- Administrator direction: ${customDirective?.trim() || 'Show the current student-facing product clearly.'}

Do not invent numbers, results, service guarantees, accreditation, student usage, prices or product capabilities.
Use only allowed views. Do not invent a course, module or formula.
Return only valid JSON:
{
  "name": "Short storyboard name",
  "tagline": "One-sentence storyboard purpose",
  "aspectRatioHint": "16:9 Landscape",
  "recommendedFor": ["WhatsApp", "LinkedIn"],
  "steps": [
    {
      "view": "one allowed application view",
      "durationMs": 6000,
      "title": "Short scene title",
      "subtitle": "A factual description of what the viewer will see",
      "badge": "Short label"
    }
  ],
  "captions": {
    "twitter": "Caption including the exact URL ${url}",
    "linkedin": "Caption including the exact URL ${url}",
    "tiktok": "Caption including the exact URL ${url}",
    "whatsapp": "Caption including the exact URL ${url}"
  }
}`;

  const result = await callAI(prompt, 'Return strict JSON and do not add unsupported facts.', 'json', 1200, 'standard', 'chat');
  const raw = result.text.replace(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/g, '$1').trim();
  const parsed = JSON.parse(jsonrepair(raw));
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error('AI did not return a usable demonstration sequence.');
  }

  const steps: DemoStep[] = parsed.steps.slice(0, 6).map((step: any, index: number) => {
    if (!validViews.includes(step?.view) ||
        typeof step?.title !== 'string' || !step.title.trim() ||
        typeof step?.subtitle !== 'string' || !step.subtitle.trim() ||
        typeof step?.badge !== 'string' || !step.badge.trim()) {
      throw new Error(`AI storyboard step ${index + 1} is incomplete or uses an unsupported application view.`);
    }
    const duration = Number(step.durationMs);
    if (!Number.isFinite(duration) || duration < 4000 || duration > 15000) {
      throw new Error(`AI storyboard step ${index + 1} has an invalid duration.`);
    }
    return {
      id: `ai_step_${index + 1}_${Date.now()}`,
      view: step.view,
      durationMs: Math.round(duration),
      title: step.title.trim().slice(0, 50),
      subtitle: step.subtitle.trim().slice(0, 100),
      badge: step.badge.trim().slice(0, 24),
      courseId: selectedCourse?.id,
      demoPrompt: step.view === 'ai-tutor' && selectedCourse?.syllabus?.[0]
        ? `In ${selectedCourse.id} — ${selectedCourse.title}, explain the module "${selectedCourse.syllabus[0].title}" step by step.`
        : undefined
    };
  });

  const captions: DemoScenario['captions'] = {
    twitter: String(parsed.captions?.twitter || ''),
    linkedin: String(parsed.captions?.linkedin || ''),
    tiktok: String(parsed.captions?.tiktok || ''),
    whatsapp: String(parsed.captions?.whatsapp || '')
  };
  for (const [channel, caption] of Object.entries(captions)) {
    if (!caption.trim() || !caption.includes(url)) {
      throw new Error(`AI storyboard is missing a complete ${channel} caption with the verified deployment URL.`);
    }
  }

  const totalDurationSec = Math.round(steps.reduce((sum, step) => sum + step.durationMs, 0) / 1000);
  return {
    id: `ai_custom_${Date.now()}`,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 45) : 'AI Demo Draft',
    tagline: typeof parsed.tagline === 'string' && parsed.tagline.trim() ? parsed.tagline.trim().slice(0, 140) : 'Administrator review required.',
    totalDurationSec,
    recommendedFor: Array.isArray(parsed.recommendedFor) ? parsed.recommendedFor.filter((item: unknown) => typeof item === 'string').slice(0, 5) : ['WhatsApp', 'LinkedIn'],
    aspectRatioHint: parsed.aspectRatioHint === '9:16 Vertical Reel' || parsed.aspectRatioHint === '1:1 Square'
      ? parsed.aspectRatioHint
      : '16:9 Landscape',
    steps,
    captions,
    isDynamicAI: true,
    requiresReview: true
  };
}
