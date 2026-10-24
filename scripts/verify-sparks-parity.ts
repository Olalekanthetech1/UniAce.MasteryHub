/**
 * UniAce Mastery Hub: Stage 4 AI Sparks Parity Verification Suite
 * CLI Runner
 */

import {
  runSparksParityAudit,
  SparksParityAuditResult
} from '../server/services/sparksParityService';

export { runSparksParityAudit, SparksParityAuditResult };

const isDirectCli = typeof process !== 'undefined' && process.argv && process.argv[1] && (
  process.argv[1].endsWith('verify-sparks-parity.ts') || 
  process.argv[1].endsWith('verify-sparks-parity.js')
);

if (isDirectCli) {
  runSparksParityAudit()
    .then((result) => {
      if (result.parityMatched) {
        console.log('\n🎉 ALL AI SPARKS WALLETS ARE IN 100% PARITY.');
        process.exit(0);
      } else {
        console.error('\n❌ PARITY VERIFICATION FAILED. Mismatches:', result.mismatches);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('❌ Parity Audit Execution Error:', err);
      process.exit(1);
    });
}
