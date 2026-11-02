import { Course, View } from '../types';
import { SupportConfig } from './supportConfig';
import { callAI } from './ai';
import { jsonrepair } from 'jsonrepair';

export interface DemoStep {
  id: string;
  view: View;
  durationMs: number;
  title: string;
  subtitle: string;
  badge: string;
  simulatedQuery?: string;
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
}

export type MarketingTargetScope =
  | 'full_ecosystem'
  | 'faculty'
  | 'department'
  | 'course'
  | 'exam_readiness';

export interface PlatformMarketingContext {
  courses: Record<string, Course>;
  faculties: string[];
  departments: string[];
  departmentToFaculty?: Record<string, string>;
  featureSwitches: Record<string, boolean>;
  supportConfig?: SupportConfig | null;
  liveOrigin?: string;
  targetScope: MarketingTargetScope;
  selectedFaculty?: string;
  selectedDepartment?: string;
  selectedCourseId?: string;
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
}

function getCleanHost(origin?: string): { url: string; displayHost: string } {
  const rawOrigin =
    origin ||
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://uniace.app');
  const displayHost = rawOrigin.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return { url: rawOrigin, displayHost };
}

/**
 * Resolves live capabilities dynamically from active feature switches, loaded courses,
 * faculties, departments, and target campaign scope.
 */
export function resolveDynamicCapabilities(ctx: PlatformMarketingContext): DynamicCapabilityItem[] {
  const courseList = Object.values(ctx.courses || {});
  const totalCourses = courseList.length;
  const totalModules = courseList.reduce((acc, c) => acc + (c.syllabus?.length || 0), 0);
  const totalFormulas = courseList.reduce((acc, c) => acc + (c.formulas?.length || 0), 0);

  const selectedCourse =
    ctx.selectedCourseId && ctx.courses[ctx.selectedCourseId]
      ? ctx.courses[ctx.selectedCourseId]
      : courseList[0];

  const scopeLabel =
    ctx.targetScope === 'course' && selectedCourse
      ? `${selectedCourse.id || selectedCourse.title}`
      : ctx.targetScope === 'department' && ctx.selectedDepartment
        ? `${ctx.selectedDepartment}`
        : ctx.targetScope === 'faculty' && ctx.selectedFaculty
          ? `${ctx.selectedFaculty}`
          : 'university';

  const arenaEnabled = ctx.featureSwitches?.arena !== false;

  const allCapabilities: DynamicCapabilityItem[] = [
    {
      id: 'ai_tutor',
      view: 'ai-tutor',
      iconKey: 'ai-tutor',
      accentHex: '#10b981',
      badgeBgHex: '#059669',
      title: 'AI Tutor',
      phoneDescription:
        ctx.targetScope === 'course' && selectedCourse
          ? `Step-by-step explanations for ${selectedCourse.id || selectedCourse.title}.`
          : 'Get clear explanations and learn at your own pace.',
      gridDescription: 'Understand difficult concepts step-by-step',
      enabled: true,
    },
    {
      id: 'chat_with_notes',
      view: 'ai-tutor',
      iconKey: 'notes-chat',
      accentHex: '#14b8a6',
      badgeBgHex: '#0d9488',
      title: 'Chat With Your Notes',
      phoneDescription: 'Ask questions about your uploaded PDF & lecture notes.',
      gridDescription: 'Get answers from your own materials',
      enabled: true,
    },
    {
      id: 'question_generator',
      view: 'quizzes',
      iconKey: 'quiz-gen',
      accentHex: '#3b82f6',
      badgeBgHex: '#16a34a',
      title: 'Question Generator',
      phoneDescription: `Create ${scopeLabel} practice questions from your materials.`,
      gridDescription: 'Practise with custom AI questions',
      enabled: true,
    },
    {
      id: 'theory_questions',
      view: 'past-questions',
      iconKey: 'theory-eval',
      accentHex: '#f97316',
      badgeBgHex: '#2563eb',
      title: 'Theory & Derivations',
      phoneDescription: 'Get theory questions with AI-assisted marking & proofs.',
      gridDescription: 'Build knowledge with AI-assisted marking',
      enabled: true,
    },
    {
      id: 'flashcards',
      view: 'flashcards',
      iconKey: 'flashcards',
      accentHex: '#6366f1',
      badgeBgHex: '#7c3aed',
      title: 'Smart Flashcards',
      phoneDescription: 'Revise quickly with active-recall smart flashcards.',
      gridDescription: 'Revise faster and remember longer',
      enabled: true,
    },
    {
      id: 'exam_mode',
      view: 'quizzes',
      iconKey: 'exam-mode',
      accentHex: '#059669',
      badgeBgHex: '#eab308',
      title: 'Exam Mode',
      phoneDescription: 'Take timed practice exams and track your readiness.',
      gridDescription: 'Test yourself with timed exams',
      enabled: true,
    },
    {
      id: 'my_notes',
      view: 'notebook',
      iconKey: 'notebook',
      accentHex: '#2563eb',
      badgeBgHex: '#d97706',
      title: 'My Study Notes',
      phoneDescription:
        totalModules > 0
          ? `Access ${totalModules}+ structured modules & saved notes.`
          : 'Keep all your study materials in one place.',
      gridDescription: 'Keep your study materials organised',
      enabled: true,
    },
    {
      id: 'study_planner',
      view: 'study-plan',
      iconKey: 'study-planner',
      accentHex: '#16a34a',
      badgeBgHex: '#0284c7',
      title: 'Study Planner',
      phoneDescription: 'Plan your study timetable and stay consistent.',
      gridDescription: 'Plan, track and stay consistent',
      enabled: true,
    },
    {
      id: 'formula_diagram_hub',
      view: 'formulas',
      iconKey: 'formulas',
      accentHex: '#8b5cf6',
      badgeBgHex: '#4f46e5',
      title: 'Formulas & Diagrams',
      phoneDescription:
        totalFormulas > 0
          ? `Explore ${totalFormulas}+ verified KaTeX formulas & diagrams.`
          : 'Verified KaTeX equations and interactive diagrams.',
      gridDescription: 'Verified formulas & visual diagrams',
      enabled: false,
    },
    {
      id: 'voice_tutor',
      view: 'ai-tutor',
      iconKey: 'voice-tutor',
      accentHex: '#ec4899',
      badgeBgHex: '#db2777',
      title: 'Voice AI Tutor',
      phoneDescription: 'Hands-free spoken explanations and oral mastery checks.',
      gridDescription: 'Learn hands-free with live voice AI',
      enabled: false,
    },
    {
      id: 'battle_arena',
      view: 'arena',
      iconKey: 'arena',
      accentHex: '#e11d48',
      badgeBgHex: '#be123c',
      title: 'Academic Arena',
      phoneDescription: 'Compete in daily academic challenges & XP leaderboards.',
      gridDescription: 'Daily quests & student leaderboard',
      enabled: false,
      featureSwitchKey: 'arena',
    },
    {
      id: 'course_hub',
      view: 'hub',
      iconKey: 'course-hub',
      accentHex: '#0d9488',
      badgeBgHex: '#0f766e',
      title: 'Accredited Course Hub',
      phoneDescription:
        totalCourses > 0
          ? `Browse ${totalCourses} accredited university courses & syllabi.`
          : 'Full accredited university course catalogue.',
      gridDescription: 'Complete university course syllabi',
      enabled: false,
    },
  ];

  return allCapabilities.filter((cap) => {
    if (cap.featureSwitchKey === 'arena' && !arenaEnabled) {
      return false;
    }
    return true;
  });
}

/**
 * Builds the complete Dynamic Flyer configuration from live system state.
 */
export function buildDynamicFlyerConfig(ctx: PlatformMarketingContext): DynamicFlyerConfig {
  const { url, displayHost } = getCleanHost(ctx.liveOrigin);
  const courseList = Object.values(ctx.courses || {});
  const capabilities = resolveDynamicCapabilities(ctx);

  const selectedCourse =
    ctx.selectedCourseId && ctx.courses[ctx.selectedCourseId]
      ? ctx.courses[ctx.selectedCourseId]
      : undefined;

  let headlineLine1 = 'Study Smarter,';
  let headlineLine2 = 'Not Harder';
  let leadBoldParagraph =
    'UniAce Mastery Hub is an all-in-one AI-powered academic platform built for university students.';
  let subParagraph =
    'Get instant step-by-step derivations, practise with your own lecture materials, stay organised and prepare for your exams — all in one place.';
  let phoneGreeting = 'Hello, Scholar 👋';

  if (ctx.targetScope === 'course' && selectedCourse) {
    headlineLine1 = `Master ${selectedCourse.id || 'Your Course'},`;
    headlineLine2 = 'Ace Every Exam';
    leadBoldParagraph = `UniAce Mastery Hub is your dedicated AI study companion for ${selectedCourse.title} (${selectedCourse.id || selectedCourse.department}).`;
    subParagraph = `Explore ${selectedCourse.syllabus?.length || 10} structured university modules, interactive diagrams, verified formulas, and exam-grade practice questions — all in one place.`;
    phoneGreeting = `Studying ${selectedCourse.id || 'UniAce'} 👋`;
  } else if (ctx.targetScope === 'department' && ctx.selectedDepartment) {
    const deptCourses = courseList.filter(
      (c) => c.department?.toLowerCase() === ctx.selectedDepartment?.toLowerCase()
    );
    headlineLine1 = `Built for ${ctx.selectedDepartment}`;
    headlineLine2 = 'Scholars';
    leadBoldParagraph = `UniAce Mastery Hub is an all-in-one AI-powered platform tailored for ${ctx.selectedDepartment} university students.`;
    subParagraph = `Master ${deptCourses.length > 0 ? `${deptCourses.length} core department courses` : 'your department curriculum'}, solve complex theory questions, and prepare for semester exams with confidence.`;
  } else if (ctx.targetScope === 'faculty' && ctx.selectedFaculty) {
    headlineLine1 = `Excel Across`;
    headlineLine2 = `${ctx.selectedFaculty}`;
    leadBoldParagraph = `UniAce Mastery Hub empowers ${ctx.selectedFaculty} students with interactive AI tutoring and accredited university syllabi.`;
    subParagraph =
      'Get instant step-by-step explanations, upload your lecture notes, practise timed exams, and track your concept mastery in real time.';
  } else if (ctx.targetScope === 'exam_readiness') {
    headlineLine1 = 'Crush Your Exams,';
    headlineLine2 = 'Zero Panic';
    leadBoldParagraph =
      'UniAce Mastery Hub turns your lecture notes and syllabus into timed mock exams, smart flashcards, and step-by-step solutions.';
    subParagraph =
      'Test your recall under real exam conditions, identify weak topics automatically, and boost your semester GPA.';
  }

  const supportContact =
    ctx.supportConfig?.whatsappSupport?.trim() ||
    ctx.supportConfig?.contactEmail?.trim() ||
    'support@uniace.app';
  const isPhone = /^[+\d\s()-]{7,}$/.test(supportContact);

  return {
    brandName: 'UniAce Mastery Hub',
    brandSubline: ['Learn', 'Practise', 'Excel'],
    topScriptCallout: 'Your Study Companion',
    midScriptCallout: 'Your goals are valid',
    headlineLine1,
    headlineLine2,
    leadBoldParagraph,
    subParagraph,
    phoneGreeting,
    phonePrompt: 'What would you like to do today?',
    capabilities,
    ctaText: 'Visit Now',
    websiteDisplayUrl: displayHost,
    qrTargetUrl: url,
    supportLabel: 'Need Help?',
    supportContact,
    supportSublabel: isPhone ? '(Support Line)' : '(Official Support)',
    footerPillars: ['BUILT FOR UNIVERSITY STUDENTS', 'POWERED BY AI', 'YOUR SUCCESS MATTERS'],
    themeId: 'emerald_gold',
    studentPortraitMode: 'campus_scholar_svg',
    captions: {
      whatsapp: `🎓 *${headlineLine1} ${headlineLine2}*\n\n${leadBoldParagraph}\n\n✅ 24/7 AI Academic Tutor & Derivations\n✅ Chat With Your Uploaded Notes\n✅ Smart Quizzes, Theory Marking & Timed Exams\n✅ Structured University Course Syllabi\n\n🔗 Start now: ${url}`,
      twitter: `🎓 ${headlineLine1} ${headlineLine2}!\n\n${leadBoldParagraph}\n\n✨ AI Tutor & Chat With Notes\n📝 Question Generator & Timed Exam Mode\n📚 Flashcards & Study Planner\n\n🔗 ${url} #UniAce #University #EdTech #StudySmarter`,
      linkedin: `${headlineLine1} ${headlineLine2} — Introducing UniAce Mastery Hub 🎓\n\n${leadBoldParagraph}\n\n${subParagraph}\n\nExplore the live platform: ${url}\n\n#HigherEducation #EdTech #AIInEducation #StudentSuccess #UniAce`,
      tiktok: `${headlineLine1} ${headlineLine2} 🚀🎓 The all-in-one AI study companion for university students! Chat with your notes, generate practice exams & master every course. 🔗 ${displayHost} #studytok #universitylife #examhacks #uniace`,
    },
  };
}

/**
 * Uses the live multi-provider AI backend to synthesize tailored campaign copy,
 * feature descriptions, and social captions grounded in real platform context.
 */
export async function synthesizeFlyerWithAI(
  ctx: PlatformMarketingContext,
  currentConfig: DynamicFlyerConfig,
  customCampaignAngle?: string
): Promise<DynamicFlyerConfig> {
  const courseList = Object.values(ctx.courses || {});
  const selectedCourse =
    ctx.selectedCourseId && ctx.courses[ctx.selectedCourseId]
      ? ctx.courses[ctx.selectedCourseId]
      : undefined;

  const activeCaps = currentConfig.capabilities.filter((c) => c.enabled).slice(0, 8);

  const contextSummary = {
    brandName: currentConfig.brandName,
    targetScope: ctx.targetScope,
    selectedFaculty: ctx.selectedFaculty || null,
    selectedDepartment: ctx.selectedDepartment || null,
    selectedCourse: selectedCourse
      ? {
          code: selectedCourse.id,
          title: selectedCourse.title,
          department: selectedCourse.department,
          moduleCount: selectedCourse.syllabus?.length || 0,
          sampleModules: (selectedCourse.syllabus || []).slice(0, 4).map((m) => m.title),
        }
      : null,
    totalCoursesAvailable: courseList.length,
    availableFaculties: ctx.faculties,
    availableDepartments: ctx.departments.slice(0, 12),
    activeFeatureTitles: activeCaps.map((c) => ({ id: c.id, title: c.title })),
    liveWebsiteUrl: currentConfig.qrTargetUrl,
    customCampaignAngle: customCampaignAngle?.trim() || 'High-impact university student adoption campaign',
  };

  const prompt = `You are the Senior Academic Growth & Brand Copywriter for UniAce Mastery Hub.
Generate dynamic, factual promotional flyer copy grounded STRICTLY in the live platform context below:

${JSON.stringify(contextSummary, null, 2)}

Return ONLY a valid JSON object matching this exact structure (no markdown fences, no commentary):
{
  "headlineLine1": "Short punchy first headline line (max 24 chars, e.g. 'Study Smarter,')",
  "headlineLine2": "Short punchy second headline line (max 24 chars, e.g. 'Not Harder')",
  "topScriptCallout": "Short warm 2-4 word callout (e.g. 'Your Study Companion')",
  "midScriptCallout": "Short encouraging 3-4 word note (e.g. 'Your goals are valid')",
  "leadBoldParagraph": "1 sentence bold value proposition tailored to the target audience (max 125 chars)",
  "subParagraph": "1-2 sentence supporting explanation of what students can do on UniAce (max 175 chars)",
  "phoneGreeting": "Warm mobile greeting (max 26 chars, e.g. 'Hello, Scholar 👋')",
  "featureBlurbs": [
    {
      "id": "exact feature id from activeFeatureTitles",
      "phoneDescription": "Concise 5-8 word mobile card description",
      "gridDescription": "Concise 4-6 word bottom grid description"
    }
  ],
  "captions": {
    "whatsapp": "Ready-to-forward WhatsApp broadcast message with emojis and ${currentConfig.qrTargetUrl}",
    "twitter": "Punchy X/Twitter post under 260 chars with ${currentConfig.qrTargetUrl}",
    "linkedin": "Professional LinkedIn announcement post with ${currentConfig.qrTargetUrl}",
    "tiktok": "High-energy TikTok/Reels caption with hashtags"
  }
}`;

  const result = await callAI(
    prompt,
    'Return strictly valid JSON with dynamic marketing copy grounded in the provided UniAce platform metadata.',
    'json',
    1200,
    'standard',
    'chat'
  );

  const rawCleaned = result.text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
  const parsed = JSON.parse(jsonrepair(rawCleaned));

  const blurbMap = new Map<string, { phoneDescription?: string; gridDescription?: string }>();
  if (Array.isArray(parsed.featureBlurbs)) {
    for (const item of parsed.featureBlurbs) {
      if (item && typeof item.id === 'string') {
        blurbMap.set(item.id, item);
      }
    }
  }

  const updatedCapabilities = currentConfig.capabilities.map((cap) => {
    const match = blurbMap.get(cap.id);
    if (!match) return cap;
    return {
      ...cap,
      phoneDescription:
        typeof match.phoneDescription === 'string' && match.phoneDescription.trim()
          ? match.phoneDescription.trim()
          : cap.phoneDescription,
      gridDescription:
        typeof match.gridDescription === 'string' && match.gridDescription.trim()
          ? match.gridDescription.trim()
          : cap.gridDescription,
    };
  });

  return {
    ...currentConfig,
    headlineLine1:
      typeof parsed.headlineLine1 === 'string' && parsed.headlineLine1.trim()
        ? parsed.headlineLine1.trim()
        : currentConfig.headlineLine1,
    headlineLine2:
      typeof parsed.headlineLine2 === 'string' && parsed.headlineLine2.trim()
        ? parsed.headlineLine2.trim()
        : currentConfig.headlineLine2,
    topScriptCallout:
      typeof parsed.topScriptCallout === 'string' && parsed.topScriptCallout.trim()
        ? parsed.topScriptCallout.trim()
        : currentConfig.topScriptCallout,
    midScriptCallout:
      typeof parsed.midScriptCallout === 'string' && parsed.midScriptCallout.trim()
        ? parsed.midScriptCallout.trim()
        : currentConfig.midScriptCallout,
    leadBoldParagraph:
      typeof parsed.leadBoldParagraph === 'string' && parsed.leadBoldParagraph.trim()
        ? parsed.leadBoldParagraph.trim()
        : currentConfig.leadBoldParagraph,
    subParagraph:
      typeof parsed.subParagraph === 'string' && parsed.subParagraph.trim()
        ? parsed.subParagraph.trim()
        : currentConfig.subParagraph,
    phoneGreeting:
      typeof parsed.phoneGreeting === 'string' && parsed.phoneGreeting.trim()
        ? parsed.phoneGreeting.trim()
        : currentConfig.phoneGreeting,
    capabilities: updatedCapabilities,
    captions: {
      whatsapp:
        typeof parsed.captions?.whatsapp === 'string' && parsed.captions.whatsapp.trim()
          ? parsed.captions.whatsapp.trim()
          : currentConfig.captions.whatsapp,
      twitter:
        typeof parsed.captions?.twitter === 'string' && parsed.captions.twitter.trim()
          ? parsed.captions.twitter.trim()
          : currentConfig.captions.twitter,
      linkedin:
        typeof parsed.captions?.linkedin === 'string' && parsed.captions.linkedin.trim()
          ? parsed.captions.linkedin.trim()
          : currentConfig.captions.linkedin,
      tiktok:
        typeof parsed.captions?.tiktok === 'string' && parsed.captions.tiktok.trim()
          ? parsed.captions.tiktok.trim()
          : currentConfig.captions.tiktok,
    },
  };
}

export const DEMO_SCENARIOS: Record<string, DemoScenario> = {
  full_ecosystem: {
    id: 'full_ecosystem',
    name: '🌟 Complete University Platform Tour',
    tagline: 'Comprehensive showcase of the entire academic ecosystem',
    totalDurationSec: 40,
    recommendedFor: ['YouTube', 'LinkedIn', 'Institutional Partners', 'Investor Pitch'],
    aspectRatioHint: '16:9 Landscape',
    steps: [
      {
        id: 'step_hub',
        view: 'hub',
        durationMs: 7000,
        title: 'Curriculum & Department Hub',
        subtitle: 'Dynamic navigation across departments, semesters & accredited courses',
        badge: 'Accredited Catalog',
      },
      {
        id: 'step_dashboard',
        view: 'dashboard',
        durationMs: 6000,
        title: 'Student Performance & XP Engine',
        subtitle: 'Live study streaks, mastery radar, and adaptive difficulty tracking',
        badge: 'Adaptive Analytics',
      },
      {
        id: 'step_syllabus',
        view: 'course-syllabus',
        durationMs: 6000,
        title: 'Structured University Modules',
        subtitle: 'Deep syllabus with self-healing curriculum integrity',
        badge: 'Curriculum Integrity',
      },
      {
        id: 'step_ai_tutor',
        view: 'ai-tutor',
        durationMs: 9000,
        title: 'AI Academic Companion with KaTeX',
        subtitle: 'Live interactive university tutor with rigorous math proofs & voice synthesis',
        badge: 'Multi-Model Fallback',
        simulatedQuery:
          "Explain Maxwell's equations and derive electromagnetic wave velocity $c = \\frac{1}{\\sqrt{\\mu_0 \\epsilon_0}}$",
      },
      {
        id: 'step_quizzes',
        view: 'quizzes',
        durationMs: 7000,
        title: 'Smart Practice Quiz Engine',
        subtitle: 'Instant active-recall testing with dynamic difficulty scaling',
        badge: 'Active Recall',
      },
      {
        id: 'step_mastery',
        view: 'mastery',
        durationMs: 5000,
        title: 'Mastery Retention & Concept Map',
        subtitle: 'Visual retention tracking and personalized exam readiness scores',
        badge: 'Mastery Retention',
      },
    ],
    captions: {
      twitter: `🎓 Meet UniAce: The next-generation AI Academic Ecosystem for University Students!
✨ Real-time AI Tutor with KaTeX mathematical proofs
⚡ Multi-provider AI routing & adaptive course mastery
📊 Smart quizzes, flashcards & study planner
🔗 Try it live: https://uniace.app #EdTech #AI #University #HigherEd`,
      linkedin: `Proud to showcase UniAce Mastery Hub — an end-to-end academic learning ecosystem built for university students and higher education institutions.

Key Capabilities:
🔹 Multi-Model AI Routing with automatic circuit breakers
🔹 Dynamic University Curriculums with KaTeX & Mermaid rendering
🔹 Real-Time Interactive Quizzes & Adaptive Retention Tracking
🔹 Zero-Fallback Architecture built with React 18, Vite & Tailwind

#EdTech #ArtificialIntelligence #HigherEducation #StudentSuccess #UniAce`,
      tiktok: `Studying at university just got 10x easier 🚀🤖 Watch how UniAce breaks down complex courses step-by-step with formulas and quizzes! #studentlife #collegehacks #aitools #studytok`,
      whatsapp: `🎓 Check out this live demo of UniAce Mastery Hub! Real-time AI tutoring for university courses with step-by-step solutions and exam practice: https://uniace.app`,
    },
  },
  ai_tutor_deepdive: {
    id: 'ai_tutor_deepdive',
    name: '🤖 AI Academic Tutor & Derivations',
    tagline: 'Spotlight on deep-reasoning AI tutoring with KaTeX LaTeX math',
    totalDurationSec: 22,
    recommendedFor: ['TikTok', 'Instagram Reels', 'YouTube Shorts', 'X / Twitter'],
    aspectRatioHint: '9:16 Vertical Reel',
    steps: [
      {
        id: 'step_syllabus_intro',
        view: 'course-syllabus',
        durationMs: 4000,
        title: 'Select Complex Academic Topic',
        subtitle: 'Browsing accredited university curriculum syllabus',
        badge: 'Syllabus Browser',
      },
      {
        id: 'step_ai_tutor_solve',
        view: 'ai-tutor',
        durationMs: 14000,
        title: 'Live Multi-Step Proof & Tutoring',
        subtitle: 'Generating step-by-step LaTeX derivation with conceptual analogies',
        badge: 'KaTeX & Multi-Model',
        simulatedQuery:
          'Derive the time-dependent Schrödinger equation $\\hat{H}\\Psi = i\\hbar\\frac{\\partial}{\\partial t}\\Psi$ and explain its physical significance.',
      },
      {
        id: 'step_formulas',
        view: 'formulas',
        durationMs: 4000,
        title: 'Instant Formula Reference Library',
        subtitle: 'Verified academic equation reference for rapid problem solving',
        badge: 'KaTeX Formulas',
      },
    ],
    captions: {
      twitter: `Stuck on tough university derivations? 🤯 Watch UniAce AI break down step-by-step proofs with LaTeX notation in seconds. 🚀 #STEM #UniAce #University`,
      linkedin: `Accelerating higher education through rigorous, interactive AI tutoring. UniAce generates verifiable step-by-step derivations with KaTeX typography. #EdTech #AI #HigherEducation`,
      tiktok: `POV: You found the AI tutor that actually explains university derivations step-by-step with zero errors 🤯🔥 #collegelife #engineeringstudent #studytok #fyp`,
      whatsapp: `🚀 Watch UniAce AI solve university-level problems step-by-step with formulas: https://uniace.app`,
    },
  },
  quiz_sprint: {
    id: 'quiz_sprint',
    name: '⚡ Interactive Quiz & Mastery Sprint',
    tagline: 'High-energy active recall and exam readiness demo',
    totalDurationSec: 18,
    recommendedFor: ['TikTok', 'Instagram Stories', 'X / Twitter'],
    aspectRatioHint: '9:16 Vertical Reel',
    steps: [
      {
        id: 'step_quizzes_start',
        view: 'quizzes',
        durationMs: 9000,
        title: 'Smart Practice Quiz Engine',
        subtitle: 'Dynamic question bank with instant explanations & XP rewards',
        badge: 'Exam Prep',
      },
      {
        id: 'step_mastery_level',
        view: 'mastery',
        durationMs: 5000,
        title: 'Live Mastery Tracking',
        subtitle: 'Visual retention bars and concept mastery progression',
        badge: 'Adaptive Growth',
      },
      {
        id: 'step_arena',
        view: 'arena',
        durationMs: 4000,
        title: 'Student Arena & Daily Quests',
        subtitle: 'Gamified academic challenges and community leaderboards',
        badge: 'Gamification',
      },
    ],
    captions: {
      twitter: `Turn passive studying into active recall! ⚡ Practice with AI-generated university quizzes and track your mastery live on UniAce. 🎯 #StudyHacks #Student #EdTech`,
      linkedin: `Active recall and spaced repetition powered by AI. See how UniAce keeps university students engaged with smart quizzes and real-time mastery tracking. #LearningScience #EdTech`,
      tiktok: `Testing my knowledge before exams with AI-generated quizzes 📝⚡ +100 XP unlocked! #studymotivation #examszn #collegeexam #studytok`,
      whatsapp: `🎯 Practice university quizzes and track your mastery with UniAce: https://uniace.app`,
    },
  },
  quick_social: {
    id: 'quick_social',
    name: '🚀 15-Second Viral Teaser',
    tagline: 'Ultra-fast snappy cut perfect for social feeds',
    totalDurationSec: 15,
    recommendedFor: ['Instagram Reels', 'TikTok', 'YouTube Shorts'],
    aspectRatioHint: '9:16 Vertical Reel',
    steps: [
      {
        id: 'step_hub_quick',
        view: 'hub',
        durationMs: 4000,
        title: 'University Learning Platform',
        subtitle: 'Full accredited course catalogue',
        badge: 'All Departments',
      },
      {
        id: 'step_ai_quick',
        view: 'ai-tutor',
        durationMs: 6000,
        title: 'Instant 24/7 AI Academic Tutor',
        subtitle: 'Step-by-step rigorous answers',
        badge: 'Instant AI',
      },
      {
        id: 'step_quiz_quick',
        view: 'quizzes',
        durationMs: 5000,
        title: 'Master Every Course',
        subtitle: 'Smart quizzes and XP leaderboard',
        badge: 'Get Ahead',
      },
    ],
    captions: {
      twitter: `Ace your university exams with UniAce 🎓 24/7 AI Tutor, smart quizzes & curated syllabi in one hub. Try now: https://uniace.app 🚀 #University #StudentTools`,
      linkedin: `Transforming university student success with personalized AI tutoring and continuous mastery feedback. Explore UniAce today. #EdTech #Innovation`,
      tiktok: `The ultimate university study hack you didn't know existed 🎓✨ Try UniAce! #collegetips #freshmanadvice #aitools #studytok`,
      whatsapp: `🎓 Try UniAce Mastery Hub — your 24/7 university study companion: https://uniace.app`,
    },
  },
};

/**
 * Dynamically resolves all Video Reel scenarios using live courses, active feature switches,
 * and the current deployment origin URL.
 */
export function buildDynamicDemoScenarios(
  ctx: PlatformMarketingContext
): Record<string, DemoScenario> {
  const { url } = getCleanHost(ctx.liveOrigin);
  const courseList = Object.values(ctx.courses || {});
  const arenaEnabled = ctx.featureSwitches?.arena !== false;

  const selectedCourse =
    ctx.selectedCourseId && ctx.courses[ctx.selectedCourseId]
      ? ctx.courses[ctx.selectedCourseId]
      : courseList.find(
          (c) =>
            ctx.targetScope === 'department' &&
            ctx.selectedDepartment &&
            c.department?.toLowerCase() === ctx.selectedDepartment.toLowerCase()
        ) || courseList[0];

  const sampleModuleTitle =
    selectedCourse?.syllabus?.[0]?.title ||
    selectedCourse?.title ||
    'Fundamental Principles and Derivations';
  const sampleFormula = selectedCourse?.formulas?.[0]?.latex;

  const dynamicQuery = selectedCourse
    ? sampleFormula
      ? `In ${selectedCourse.id || selectedCourse.title} (${sampleModuleTitle}), derive and explain the significance of $${sampleFormula}$ with a practical university exam example.`
      : `In ${selectedCourse.id || selectedCourse.title}, break down the core principles of "${sampleModuleTitle}" step-by-step and show how it is tested in exams.`
    : DEMO_SCENARIOS.full_ecosystem.steps[3].simulatedQuery!;

  const replaceUrl = (text: string) => text.replace(/https:\/\/uniace\.app/g, url);

  const resolved: Record<string, DemoScenario> = {};

  for (const [id, baseScenario] of Object.entries(DEMO_SCENARIOS)) {
    const adaptedSteps = baseScenario.steps.map((step) => {
      // If Arena is switched off in Feature Switches, dynamically substitute Flashcards
      if (step.view === 'arena' && !arenaEnabled) {
        return {
          ...step,
          view: 'flashcards' as View,
          title: 'Active Recall Smart Flashcards',
          subtitle: 'Spaced-repetition decks generated from live university modules',
          badge: 'Spaced Repetition',
        };
      }
      if (step.view === 'ai-tutor' && step.simulatedQuery && selectedCourse) {
        return {
          ...step,
          courseId: selectedCourse.id,
          simulatedQuery: dynamicQuery,
        };
      }
      if (selectedCourse && (step.view === 'course-syllabus' || step.view === 'quizzes')) {
        return {
          ...step,
          courseId: selectedCourse.id,
        };
      }
      return step;
    });

    resolved[id] = {
      ...baseScenario,
      steps: adaptedSteps,
      captions: {
        twitter: replaceUrl(baseScenario.captions.twitter),
        linkedin: replaceUrl(baseScenario.captions.linkedin),
        tiktok: replaceUrl(baseScenario.captions.tiktok),
        whatsapp: replaceUrl(baseScenario.captions.whatsapp),
      },
    };
  }

  // Add a live Course / Department Spotlight Scenario whenever live courses exist
  if (selectedCourse) {
    const targetName =
      ctx.targetScope === 'department' && ctx.selectedDepartment
        ? `${ctx.selectedDepartment} Department`
        : `${selectedCourse.id || ''} ${selectedCourse.title}`.trim();

    resolved.live_course_spotlight = {
      id: 'live_course_spotlight',
      name: `🎯 Live Spotlight: ${targetName}`,
      tagline: `Dynamically generated walkthrough for ${selectedCourse.title} (${selectedCourse.syllabus?.length || 0} modules)`,
      totalDurationSec: 28,
      recommendedFor: ['WhatsApp Broadcast', 'Department Groups', 'X / Twitter', 'LinkedIn'],
      aspectRatioHint: '16:9 Landscape',
      steps: [
        {
          id: 'dyn_step_syllabus',
          view: 'course-syllabus',
          courseId: selectedCourse.id,
          durationMs: 6000,
          title: `${selectedCourse.id || 'Course'}: ${selectedCourse.title}`,
          subtitle: `Exploring ${selectedCourse.syllabus?.length || 10} accredited university modules in ${selectedCourse.department}`,
          badge: selectedCourse.department || 'Live Course',
        },
        {
          id: 'dyn_step_tutor',
          view: 'ai-tutor',
          courseId: selectedCourse.id,
          durationMs: 11000,
          title: `AI Tutor: ${sampleModuleTitle}`,
          subtitle: 'Live step-by-step academic explanation & mathematical derivation',
          badge: 'Live AI Solver',
          simulatedQuery: dynamicQuery,
        },
        {
          id: 'dyn_step_quiz',
          view: 'quizzes',
          courseId: selectedCourse.id,
          durationMs: 6000,
          title: `${selectedCourse.id || 'Course'} Exam Practice`,
          subtitle: 'Active-recall testing with instant grading & step-by-step feedback',
          badge: 'Exam Readiness',
        },
        {
          id: 'dyn_step_flashcards',
          view: 'flashcards',
          courseId: selectedCourse.id,
          durationMs: 5000,
          title: 'Smart Flashcards & Formula Review',
          subtitle: 'Rapid concept retention before semester exams',
          badge: 'Rapid Revision',
        },
      ],
      captions: {
        twitter: `📚 Studying ${targetName}? Watch how UniAce AI breaks down "${sampleModuleTitle}" and generates instant exam practice! 🎓⚡\n🔗 ${url} #UniAce #University #StudySmarter`,
        linkedin: `Demonstrating live course mastery for ${targetName} on UniAce Mastery Hub.\n\nStudents get structured syllabus modules, real-time AI derivations for "${sampleModuleTitle}", and adaptive exam practice in one unified workspace.\n\n🔗 ${url} #HigherEducation #EdTech #UniAce`,
        tiktok: `How to get an A in ${targetName} this semester 🚀🎓 Watch UniAce explain "${sampleModuleTitle}" step-by-step! #studytok #university #examszn`,
        whatsapp: `🎓 *Studying ${targetName}?*\nWatch how UniAce Mastery Hub explains *${sampleModuleTitle}*, generates practice quizzes, and helps you prepare for exams:\n🔗 ${url}`,
      },
    };
  }

  return resolved;
}

/**
 * Synthesizes a bespoke Video Reel Scenario at runtime using the live AI router.
 */
export async function synthesizeCustomDemoScenarioWithAI(
  ctx: PlatformMarketingContext,
  customDirective?: string
): Promise<DemoScenario> {
  const { url } = getCleanHost(ctx.liveOrigin);
  const courseList = Object.values(ctx.courses || {});
  const arenaEnabled = ctx.featureSwitches?.arena !== false;

  const selectedCourse =
    ctx.selectedCourseId && ctx.courses[ctx.selectedCourseId]
      ? ctx.courses[ctx.selectedCourseId]
      : courseList[0];

  const allowedViews: View[] = [
    'hub',
    'dashboard',
    'course-syllabus',
    'ai-tutor',
    'quizzes',
    'flashcards',
    'past-questions',
    'formulas',
    'mastery',
    'study-plan',
    'notebook',
    ...(arenaEnabled ? (['arena'] as View[]) : []),
  ];

  const prompt = `You are the Creative Director for UniAce Mastery Hub.
Create a dynamic, live screen-recording Demo Reel Scenario based on this real platform state:
- Target Scope: ${ctx.targetScope}
- Selected Faculty: ${ctx.selectedFaculty || 'All Faculties'}
- Selected Department: ${ctx.selectedDepartment || selectedCourse?.department || 'All Departments'}
- Selected Course: ${selectedCourse ? `${selectedCourse.id} - ${selectedCourse.title} (Modules: ${(selectedCourse.syllabus || []).slice(0, 5).map((m) => m.title).join(', ')})` : 'General University Catalog'}
- Allowed App Views for Steps: ${allowedViews.join(', ')}
- Live Platform URL: ${url}
- Custom Admin Directive: ${customDirective?.trim() || 'Create a high-converting showcase highlighting rigorous AI tutoring, active recall quizzes, and course mastery.'}

Return ONLY a valid JSON object with this exact structure:
{
  "name": "Scenario title with 1 leading emoji (max 45 chars)",
  "tagline": "Concise 1-sentence description of the reel",
  "aspectRatioHint": "16:9 Landscape",
  "recommendedFor": ["WhatsApp", "LinkedIn", "TikTok", "X / Twitter"],
  "steps": [
    {
      "id": "step_1",
      "view": "one of Allowed App Views",
      "durationMs": 6000,
      "title": "Step overlay headline (max 36 chars)",
      "subtitle": "Step overlay subtitle (max 75 chars)",
      "badge": "Short 2-word badge",
      "simulatedQuery": "Optional: If view is 'ai-tutor', provide a rigorous university question with LaTeX math ($...$) relevant to the selected course/department"
    }
  ],
  "captions": {
    "twitter": "Ready-to-post X caption including ${url}",
    "linkedin": "Ready-to-post LinkedIn caption including ${url}",
    "tiktok": "Ready-to-post TikTok/Reels caption",
    "whatsapp": "Ready-to-post WhatsApp broadcast caption including ${url}"
  }
}`;

  const result = await callAI(
    prompt,
    'Return strictly valid JSON for a dynamic DemoScenario.',
    'json',
    1200,
    'standard',
    'chat'
  );

  const rawCleaned = result.text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
  const parsed = JSON.parse(jsonrepair(rawCleaned));

  const validSteps: DemoStep[] = (Array.isArray(parsed.steps) ? parsed.steps : [])
    .slice(0, 6)
    .map((s: any, idx: number) => {
      const candidateView = allowedViews.includes(s?.view) ? (s.view as View) : 'ai-tutor';
      const durationMs = Math.min(15000, Math.max(4000, Number(s?.durationMs) || 6000));
      return {
        id: `ai_step_${idx + 1}_${Date.now()}`,
        view: candidateView,
        courseId: selectedCourse?.id,
        durationMs,
        title: String(s?.title || `Step ${idx + 1}: UniAce Feature`).slice(0, 50),
        subtitle: String(s?.subtitle || 'Live interactive demonstration').slice(0, 100),
        badge: String(s?.badge || 'Live Demo').slice(0, 24),
        simulatedQuery:
          candidateView === 'ai-tutor' && typeof s?.simulatedQuery === 'string'
            ? s.simulatedQuery
            : undefined,
      };
    });

  if (validSteps.length === 0) {
    throw new Error('AI returned an empty step sequence for the demo reel.');
  }

  const totalDurationSec = Math.round(
    validSteps.reduce((acc, s) => acc + s.durationMs, 0) / 1000
  );

  return {
    id: `ai_custom_${Date.now()}`,
    name: String(parsed.name || '✨ AI Custom Campaign Reel'),
    tagline: String(parsed.tagline || 'Dynamically synthesized live demonstration sequence'),
    totalDurationSec,
    recommendedFor: Array.isArray(parsed.recommendedFor)
      ? parsed.recommendedFor.map(String)
      : ['WhatsApp', 'X / Twitter', 'LinkedIn'],
    aspectRatioHint:
      parsed.aspectRatioHint === '9:16 Vertical Reel' || parsed.aspectRatioHint === '1:1 Square'
        ? parsed.aspectRatioHint
        : '16:9 Landscape',
    steps: validSteps,
    captions: {
      twitter: String(parsed.captions?.twitter || `Explore UniAce Mastery Hub: ${url}`),
      linkedin: String(parsed.captions?.linkedin || `Explore UniAce Mastery Hub: ${url}`),
      tiktok: String(parsed.captions?.tiktok || `Study smarter with UniAce Mastery Hub!`),
      whatsapp: String(parsed.captions?.whatsapp || `Try UniAce Mastery Hub: ${url}`),
    },
    isDynamicAI: true,
  };
}
