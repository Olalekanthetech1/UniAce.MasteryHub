/**
 * UniAce Mastery Hub: Stage 4 Historical AI Sparks Migration
 *
 * Migrates existing student ai_sparks, plan_type, and last_spark_reset from
 * Firestore `users/{uid}` into Neon PostgreSQL `user_sparks_wallets`,
 * and backfills initial ledger entries for audit integrity.
 */

import { getAdminApp } from '../server/firebaseAdmin';
import { queryPostgres, checkPostgresHealth } from '../server/postgresPool';

export interface SparksMigrationSummary {
  highWaterMark: string;
  usersMigrated: number;
  totalSparksMigrated: number;
}

export async function runHistoricalSparksMigration(): Promise<SparksMigrationSummary> {
  console.log('================================================================');
  console.log('📦 Starting Historical AI Sparks Migration to Neon PostgreSQL');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL is not reachable: ${health.error}`);
  }

  const app = getAdminApp();
  if (!app) {
    throw new Error('Firebase Admin App unavailable');
  }
  const db = app.firestore();

  const highWaterMark = new Date().toISOString();
  console.log(`Authoritative High-Water Mark recorded: ${highWaterMark}\n`);

  let usersMigrated = 0;
  let totalSparksMigrated = 0;

  console.log('--- 1. Migrating Users AI Sparks to user_sparks_wallets ---');
  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} user documents in Firestore.`);

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const uid = doc.id;
    const balance = Math.max(0, Number(data.ai_sparks ?? data.sparks ?? 50));
    const rawPlan = (data.plan_type || data.plan || 'free').toLowerCase();
    const planType = rawPlan === 'scholar' || rawPlan === 'pro' ? 'scholar' : rawPlan === 'admin' ? 'admin' : 'free';

    let lastResetDate = new Date();
    if (data.last_spark_reset?.toDate) {
      lastResetDate = data.last_spark_reset.toDate();
    } else if (typeof data.last_spark_reset === 'string') {
      const parsed = new Date(data.last_spark_reset);
      if (!isNaN(parsed.getTime())) lastResetDate = parsed;
    }

    await queryPostgres(
      `INSERT INTO user_sparks_wallets (uid, balance, plan_type, last_spark_reset, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (uid) DO UPDATE SET
         balance = EXCLUDED.balance,
         plan_type = EXCLUDED.plan_type,
         last_spark_reset = EXCLUDED.last_spark_reset,
         updated_at = NOW();`,
      [uid, balance, planType, lastResetDate]
    );

    // Initial migration entry in spark_transactions_ledger if not already present
    await queryPostgres(
      `INSERT INTO spark_transactions_ledger (transaction_id, uid, delta, balance_after, type, reason, created_at)
       VALUES ($1, $2, $3, $4, 'admin_adjustment', 'Historical Firestore migration initial balance', NOW())
       ON CONFLICT (transaction_id) DO NOTHING;`,
      [`tx_migration_${uid}`, uid, balance, balance]
    );

    usersMigrated++;
    totalSparksMigrated += balance;
  }

  console.log(`✅ Migrated ${usersMigrated} user wallets (${totalSparksMigrated} total sparks).`);

  // Record checkpoint
  await queryPostgres(
    `INSERT INTO progress_migration_checkpoints (phase, high_water_mark, completed_at)
     VALUES ('phase_3_sparks', $1, NOW())
     ON CONFLICT (phase) DO UPDATE SET
       high_water_mark = EXCLUDED.high_water_mark,
       completed_at = NOW();`,
    [highWaterMark]
  );

  console.log('\n================================================================');
  console.log('✨ Historical AI Sparks Migration Completed Successfully');
  console.log(`   - Users Migrated: ${usersMigrated}`);
  console.log(`   - Total Sparks: ${totalSparksMigrated}`);
  console.log(`   - Checkpoint Mark: ${highWaterMark}`);
  console.log('================================================================\n');

  return { highWaterMark, usersMigrated, totalSparksMigrated };
}

if (process.argv[1] && process.argv[1].includes('migrate-sparks-to-postgres')) {
  runHistoricalSparksMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Migration failed:', err);
      process.exit(1);
    });
}
