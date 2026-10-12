import dotenv from 'dotenv';
import { getAdminApp } from '../server/firebaseAdmin';
import { executeBackfillUserSparkBuckets } from '../server/sparkLedger';

dotenv.config();

async function main() {
  const modeArg = process.argv.find((a) => a === '--commit' || a === '--dry-run');
  const mode: 'dry_run' | 'commit' = modeArg === '--commit' ? 'commit' : 'dry_run';

  const app = getAdminApp();
  if (!app) {
    console.error('Firebase Admin app could not be initialized.');
    process.exit(1);
  }

  console.log(`[Backfill] Running legacy user Spark bucket backfill in mode="${mode}"...`);
  const result = await executeBackfillUserSparkBuckets({
    app,
    mode,
    adminUid: 'cli_admin',
    adminEmail: 'cli@uniace.app',
    reason: `CLI legacy user Spark bucket backfill (${mode}) — marked backfilled_estimate`
  });

  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        scannedUsers: result.scannedUsers,
        eligibleLegacyUsers: result.eligibleLegacyUsers,
        migratedUsers: result.migratedUsers,
        totalPaidSparksAllocated: result.totalPaidSparksAllocated,
        totalFreeSparksAllocated: result.totalFreeSparksAllocated,
        samplePreviews: result.previews.slice(0, 10)
      },
      null,
      2
    )
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
  });
