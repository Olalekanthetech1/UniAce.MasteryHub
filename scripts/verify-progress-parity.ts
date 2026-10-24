/**
 * UniAce Mastery Hub: Phase 2 Progress Parity Verification & Delta Catch-Up Suite
 * CLI Runner
 */

import {
  runProgressDeltaCatchUp,
  runProgressParityAudit,
  ProgressCanonicalRecord
} from '../server/services/progressParityService';

export { runProgressDeltaCatchUp, runProgressParityAudit, ProgressCanonicalRecord };

// Standalone CLI execution only when explicitly invoked
const isDirectCli = typeof process !== 'undefined' && process.argv && process.argv[1] && (
  process.argv[1].endsWith('verify-progress-parity.ts') || 
  process.argv[1].endsWith('verify-progress-parity.js')
);

if (isDirectCli) {
  (async () => {
    await runProgressDeltaCatchUp();
    const ok = await runProgressParityAudit();
    process.exit(ok ? 0 : 1);
  })().catch((err) => {
    console.error('Fatal error in parity audit:', err);
    process.exit(1);
  });
}
