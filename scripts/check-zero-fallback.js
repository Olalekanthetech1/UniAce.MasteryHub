import fs from 'fs';
import path from 'path';

const FORBIDDEN_PATTERNS = [
  { regex: /mockData/i, reason: 'Mock data identifier' },
  { regex: /hardcodedResponse/i, reason: 'Hardcoded response identifier' },
  { regex: /cannedReply/i, reason: 'Canned reply identifier' },
  { regex: /placeholderAnswer/i, reason: 'Placeholder answer identifier' },
  { regex: /High-fidelity academic reference simulation/i, reason: 'Simulated evaluation response' },
  { regex: /dev-bypass/i, reason: 'Mock authentication bypass token (dev-bypass)' },
  { regex: /demo-user-/i, reason: 'Mock demo-user authentication fallback' },
];

const STRICT_SERVER_FILES = [
  'server/goldenSetEngine.ts',
  'server/promptShield.ts',
  'server/sparkLedger.ts',
];

const GROUP_1_FILES = [
  'src/components/GlobalNotification.tsx',
  'src/context/InstitutionContext.tsx',
  'src/context/AuthContext.tsx',
  'src/hooks/useNotifications.ts',
  'src/components/Leaderboard.tsx',
  'src/services/gamification.ts',
  'src/services/challengesConfig.ts',
  'src/services/supportConfig.ts',
  'src/components/PricingPage.tsx',
  'src/services/pricingConfig.ts',
  'src/components/ContentArea.tsx',
  'src/services/srsService.ts',
  'src/components/Flashcards.tsx',
  'src/components/FlashcardHub.tsx',
  'src/components/QuizGenerator.tsx',
  'src/components/StudyPlan.tsx',
  'src/components/StudyArchitect.tsx',
  'src/components/AdaptiveRecalibratorModal.tsx',
  'src/services/logService.ts',
  'src/services/chatReactionService.ts',
];

const ROOT_FILES = ['server.ts'];
const SCAN_DIRS = ['src', 'server', 'scripts'];
const IGNORE_FILES = ['check-zero-fallback.js'];

let violations = 0;

function scanFileContent(fullPath) {
  if (!fs.existsSync(fullPath)) return;
  const content = fs.readFileSync(fullPath, 'utf8');
  for (const item of FORBIDDEN_PATTERNS) {
    if (item.regex.test(content)) {
      console.error(`[ZERO-FALLBACK VIOLATION] Found forbidden pattern ${item.regex} (${item.reason}) in ${fullPath}`);
      violations++;
    }
  }
}

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      if (IGNORE_FILES.includes(entry.name)) continue;
      scanFileContent(fullPath);
    }
  }
}

ROOT_FILES.forEach(f => scanFileContent(f));
SCAN_DIRS.forEach(d => scanDir(d));

// Repository-wide ZeroMock architecture guards.
// These are narrow, high-confidence checks for known production data fabrication paths.
// UI input hints and deterministic engineering constants are intentionally not treated as mock data.
const ARCHITECTURAL_GUARDS = [
  {
    path: 'src/services/pricingConfig.ts',
    regex: /DEFAULT_PRICING_PLANS|return\s*\{\s*plans:\s*\w+DEFAULT\w*\s*\}/,
    reason: 'Pricing must come from persisted pricing configuration.'
  },
  {
    path: 'src/services/supportConfig.ts',
    regex: /DEFAULT_FAQS|DEFAULT_TUTORIALS|uniace\.support@gmail\.com|picsum\.photos/,
    reason: 'Support content and contact details must come from persisted support configuration.'
  },
  {
    path: 'src/context/InstitutionContext.tsx',
    regex: /INITIAL_DEPARTMENTS|INITIAL_FACULTIES|INITIAL_MAP|from\s+['"]\.\.\/constants['"]/,
    reason: 'Institution catalogues must be loaded from the authoritative institution record.'
  },
  {
    path: 'src/constants.ts',
    regex: /DEPARTMENTS|FACULTIES|DEPARTMENT_TO_FACULTY|LEVELS|SEMESTERS/,
    reason: 'Institution catalogue values must not be source-code constants.'
  },
  {
    path: 'src/context/AuthContext.tsx',
    regex: /999999|ai_sparks[^\n]*(?:\?\?\s*50|\|\|\s*50)|VITE_ADMIN_EMAILS/,
    reason: 'Balances and administrator access must never be inferred from frontend defaults.'
  },
  {
    path: 'src/shared/courseSchemas.ts',
    regex: /groundingScore[^\n]*default\(\s*95\s*\)|confidenceState[^\n]*default\(\s*['"]verified['"]\s*\)|consistencyScore[^\n]*default\(\s*90\s*\)/,
    reason: 'Academic verification and provenance require evidence from executed checks.'
  },
  {
    path: 'src/components/LandingPage.tsx',
    regex: /20\+ universities|12 Days Active|84%|dicebear\.com/,
    reason: 'Public adoption and performance claims must be backed by live verified metrics.'
  },
  {
    path: 'src/components/Leaderboard.tsx',
    regex: /dicebear\.com|Scholar['"]|Season 1|Top 10 Gladiators|Trend.{0,100}>2</,
    reason: 'Leaderboard identities, scores, season labels and trends must be sourced from records.'
  },
  {
    path: 'src/services/gamification.ts',
    regex: /export const LEVELS\s*=|export const BADGES\s*=|xpReward\s*:\s*\d+/,
    reason: 'Gamification thresholds and badge definitions must come from persisted policy.'
  },
  {
    path: 'src/hooks/useUserProgress.ts',
    regex: /BADGES|totalSparksReward|sparksToAward|Awarded \$\{amount\} AI Sparks/,
    reason: 'Client progress hooks must not contain fixed badge catalogues or reward amounts.'
  },
  {
    path: 'src/components/admin/MathEngineTab.tsx',
    regex: /x\^3\s*-\s*6\*x\^2\s*\+\s*11\*x\s*-\s*6|\?\?\s*18|\?\?\s*100|PRESET_QUERIES|Deterministic Solver Active/,
    reason: 'Math Engine sandbox inputs, configuration and telemetry must not use sample/fabricated values.'
  },
  {
    path: 'server/mathEngine.ts',
    regex: /DEFAULT_MATH_CONFIG|userId\s*:\s*userId\s*\|\|\s*['"]anonymous['"]/,
    reason: 'Math Engine settings and calculation identities must not be synthesized.'
  },
  {
    path: 'server/routes/math.ts',
    regex: /avgLatencyMs\s*=\s*[^;]*:\s*18|successRate\s*=\s*[^;]*:\s*100|x\^3\s*-\s*6\*x\^2/,
    reason: 'Math Engine telemetry and sandbox payloads must reflect actual execution.'
  },
  {
    path: 'server/config/features.ts',
    regex: /updated_by\s*:\s*['"]system_default['"]/,
    reason: 'Runtime feature flag metadata must come from persisted records.'
  },
  {
    path: 'server/systemConfigStore.ts',
    regex: /Failed to write system_config[\s\S]{0,180}?console\.warn\([\s\S]{0,80}?\n\s*\}/,
    reason: 'Configuration persistence failures must propagate to callers.'
  },
  {
    path: 'server/routes/student.ts',
    regex: /completed_lessons_count\s*\)\s*\*\s*50|streak\s*:\s*1|Math\.sqrt\(\s*\(?r\.xp/,
    reason: 'Leaderboard XP, level and streak must come from recorded profile metrics.'
  },
  {
    path: 'server/routes/admin.ts',
    regex: /email\.toLowerCase\(\)\s*===\s*['"][^'"]+@gmail\.com['"]/,
    reason: 'Administrator access must not depend on a hardcoded personal email.'
  }
];

for (const guard of ARCHITECTURAL_GUARDS) {
  if (!fs.existsSync(guard.path)) {
    console.error(`[ZERO-MOCK CONFIGURATION ERROR] Required guarded file is missing: ${guard.path}`);
    violations++;
    continue;
  }
  const content = fs.readFileSync(guard.path, 'utf8');
  if (guard.regex.test(content)) {
    console.error(`[ZERO-MOCK VIOLATION] ${guard.reason} File: ${guard.path}; pattern: ${guard.regex}`);
    violations++;
  }
}

// Additional architectural guards on core trust & evaluation modules
for (const relPath of STRICT_SERVER_FILES) {
  if (!fs.existsSync(relPath)) continue;
  const content = fs.readFileSync(relPath, 'utf8');

  // 1. No Math.random() in trust, ledger, or evaluation engines
  if (/Math\.random\s*\(/.test(content)) {
    console.error(`[ZERO-FALLBACK VIOLATION] Math.random() is prohibited in ${relPath} (use deterministic sampling or crypto)`);
    violations++;
  }

  // 2. Ensure promptShield.ts does not contain a hardcoded Tier-1 fiat array
  if (relPath === 'server/promptShield.ts') {
    if (/const\s+TIER_1_ACADEMIC_PROVIDERS\s*=\s*new\s+Set\s*\(\s*\[/.test(content)) {
      console.error(`[ZERO-FALLBACK VIOLATION] Hardcoded TIER_1_ACADEMIC_PROVIDERS fiat set found in ${relPath}`);
      violations++;
    }
  }
}

// Group 2 Allowlist — Now empty: 100% of frontend components, hooks, services, and repositories are migrated to Neon PostgreSQL.
const GROUP_2_ALLOWLIST = new Set([]);

// Inverted Zero-Firestore Check across src/ and server/repositories/
function scanForUnapprovedFirestore(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = fullPath.replace(/^\.\//, '').replace(/\\/g, '/');
    if (entry.isDirectory()) {
      scanForUnapprovedFirestore(fullPath);
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('firebase/firestore')) {
        if (!GROUP_2_ALLOWLIST.has(relPath)) {
          console.error(`[INVERTED ZERO-FIRESTORE VIOLATION] File "${relPath}" imports firebase/firestore but is NOT in Group 2 allowlist.`);
          violations++;
        }
      }
    }
  }
}

scanForUnapprovedFirestore('src');
scanForUnapprovedFirestore('server/repositories');

if (violations > 0) {
  console.error(`\n❌ Zero-Mock Policy & Inverted Zero-Firestore check failed: found ${violations} violation(s).`);
  process.exit(1);
} else {
  console.log('✅ Zero-Mock Policy & Inverted Zero-Firestore check passed: all unapproved files cleanly migrated to Neon.');
  process.exit(0);
}
