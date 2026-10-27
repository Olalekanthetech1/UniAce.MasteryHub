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
