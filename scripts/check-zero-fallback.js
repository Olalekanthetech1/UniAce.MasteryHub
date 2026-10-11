import fs from 'fs';
import path from 'path';

const FORBIDDEN_PATTERNS = [
  /mockData/i,
  /hardcodedResponse/i,
  /cannedReply/i,
  /placeholderAnswer/i,
];

const SCAN_DIRS = ['src', 'server'];
const IGNORE_FILES = ['check-zero-fallback.js'];

let violations = 0;

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      if (IGNORE_FILES.includes(entry.name)) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          console.error(`[ZERO-FALLBACK VIOLATION] Found forbidden pattern ${pattern} in ${fullPath}`);
          violations++;
        }
      }
    }
  }
}

SCAN_DIRS.forEach(d => scanDir(d));

if (violations > 0) {
  console.error(`\n❌ Zero-Fallback Policy check failed: found ${violations} violation(s).`);
  process.exit(1);
} else {
  console.log('✅ Zero-Fallback Policy check passed: no mock/placeholder data detected in codebase.');
  process.exit(0);
}
