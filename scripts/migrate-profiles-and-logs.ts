/**
 * UniAce Mastery Hub: Stage 2 Users & System Logs Migration Script
 *
 * Migrates historical user profiles and administrative system logs from Firestore into Neon PostgreSQL.
 * Supports --dry-run validation, role/plan/level normalization, seeded spark ledger invariants,
 * and idempotent fenced upserts (ON CONFLICT DO UPDATE WHERE EXCLUDED.updated_at > users.updated_at).
 */

import { checkPostgresHealth, queryPostgres } from '../server/postgresPool';
import { UserRepository } from '../server/repositories/userRepository';
import { LogRepository } from '../server/repositories/logRepository';
import { getDb } from '../server/firebaseAdmin';

export async function migrateProfilesAndLogs() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('================================================================');
  console.log(`🚀 Phase 5 Stage 2: Users & System Logs Migration ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL unavailable: ${health.error}`);
  }
  console.log(`✅ Connected to Neon PostgreSQL (${health.latencyMs}ms).\n`);

  const db = getDb();
  if (!db) {
    console.warn('⚠️ Firestore Admin SDK not configured or disabled. Skipping migration.');
    return;
  }

  // --- Step 1: Migrate User Profiles ---
  console.log('--- Step 1: Migrating User Profiles ---');
  const userSnap = await db.collection('users').get();
  console.log(`ℹ️ Found ${userSnap.size} user documents in Firestore.`);

  let usersInserted = 0;
  let usersUpdated = 0;
  let usersSkipped = 0;

  for (const doc of userSnap.docs) {
    const data = doc.data();
    const uid = doc.id;

    // Permanent exclusion list to prevent resurrecting test/dev accounts
    if (['dev-admin', 'user_outbox_test'].includes(uid)) {
      usersSkipped++;
      continue;
    }

    // Normalization rules
    const role = data.role === 'admin' ? 'admin' : 'student';
    const planType = data.plan_type === 'scholar' || data.planType === 'scholar' ? 'scholar' : 'free';

    // Seeded balance: Check existing balance in user_sparks_wallets or fallback to doc data (default 50)
    let aiSparks = typeof data.ai_sparks === 'number' ? data.ai_sparks : (typeof data.sparks === 'number' ? data.sparks : 50);

    const walletRes = await queryPostgres<{ balance: number }>('SELECT balance FROM user_sparks_wallets WHERE uid = $1;', [uid]);
    if (walletRes.rows.length > 0) {
      aiSparks = walletRes.rows[0].balance;
    }

    const email = data.email || null;
    const displayName = data.displayName || data.display_name || null;
    const learningProfile = data.learningProfile || data.learning_profile || {};
    const createdAt = data.createdAt?.toDate?.() || data.createdAt || new Date();
    const updatedAt = data.updatedAt?.toDate?.() || data.updatedAt || new Date();

    if (isDryRun) {
      console.log(`  [Dry Run] User ${uid}: email=${email}, role=${role}, plan=${planType}, sparks=${aiSparks}`);
      usersInserted++;
      continue;
    }

    try {
      const res = await UserRepository.fencedUpsertUser({
        uid,
        email,
        display_name: displayName,
        role,
        plan_type: planType,
        ai_sparks: aiSparks,
        learning_profile: learningProfile,
        createdAt,
        updatedAt,
        seedReason: 'migration_seed'
      });

      if (res.inserted) usersInserted++;
      else if (res.updated) usersUpdated++;
      else usersSkipped++;
    } catch (err: any) {
      console.error(`  ❌ Error migrating user ${uid}:`, err.message);
    }
  }

  console.log(`✅ Users Migration Complete: Inserted=${usersInserted}, Updated=${usersUpdated}, Skipped=${usersSkipped}\n`);

  // --- Step 2: Migrate System Logs (Last 90 Days Only) ---
  console.log('--- Step 2: Migrating System Logs (Last 90 Days Retention Window) ---');
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
  const logSnap = await db.collection('system_logs').get();
  console.log(`ℹ️ Found ${logSnap.size} system_logs documents in Firestore.`);

  let logsMigrated = 0;
  let logsSkippedRetention = 0;
  const logBatch = [];

  for (const doc of logSnap.docs) {
    const data = doc.data();
    const logId = doc.id;
    const createdAt = data.createdAt?.toDate?.() || data.timestamp?.toDate?.() || data.createdAt || new Date();
    const createdDate = new Date(createdAt);

    // Skip logs older than 90 days (matches retention policy)
    if (createdDate < ninetyDaysAgo) {
      logsSkippedRetention++;
      continue;
    }

    // Normalization rule for level
    let level: 'debug' | 'info' | 'warn' | 'error' = 'info';
    if (['debug', 'info', 'warn', 'error'].includes(data.level)) {
      level = data.level;
    }

    const category = data.category || 'system';
    const message = data.message || 'Legacy log entry';
    const details = data.details || {};
    const userId = data.userId || data.user_id || null;

    if (isDryRun) {
      logsMigrated++;
      continue;
    }

    logBatch.push({
      logId,
      level,
      category,
      message,
      detailsJson: JSON.stringify(details),
      userId,
      createdAt: new Date(createdAt)
    });
  }

  if (!isDryRun && logBatch.length > 0) {
    const chunkSize = 250;
    for (let i = 0; i < logBatch.length; i += chunkSize) {
      const chunk = logBatch.slice(i, i + chunkSize);
      const valueStrings: string[] = [];
      const queryParams: any[] = [];
      let paramIdx = 1;

      for (const item of chunk) {
        valueStrings.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6})`);
        queryParams.push(item.logId, item.level, item.category, item.message, item.detailsJson, item.userId, item.createdAt);
        paramIdx += 7;
      }

      const sql = `
        INSERT INTO system_logs (log_id, level, category, message, details, user_id, created_at)
        VALUES ${valueStrings.join(', ')}
        ON CONFLICT (log_id) DO NOTHING;
      `;

      await queryPostgres(sql, queryParams);
      logsMigrated += chunk.length;
    }
  }

  console.log(`✅ System Logs Migration Complete: Migrated=${logsMigrated}\n`);

  // --- Step 3: Spark Balance Ledger Invariant Audit ---
  if (!isDryRun) {
    console.log('--- Step 3: Verifying Spark Balance Invariants ---');
    const ledgerSumRes = await queryPostgres<{ user_id: string; total: number }>(
      'SELECT user_id, SUM(delta)::int AS total FROM spark_ledger GROUP BY user_id;'
    );
    let invariantPassed = true;

    for (const row of ledgerSumRes.rows) {
      const uRes = await queryPostgres<{ ai_sparks: number }>('SELECT ai_sparks FROM users WHERE uid = $1;', [row.user_id]);
      if (uRes.rows.length > 0) {
        const actualSparks = uRes.rows[0].ai_sparks;
        if (actualSparks !== row.total) {
          console.warn(`  ⚠️ Drift detected for user ${row.user_id}: users.ai_sparks=${actualSparks}, ledger_sum=${row.total}`);
          invariantPassed = false;
        }
      }
    }

    if (invariantPassed) {
      console.log('✅ Balance Invariant Verification Passed: All user ai_sparks match spark_ledger SUM(delta).');
    }
  }

  console.log('\n================================================================');
  console.log(`✨ Phase 5 Users & Logs Migration Completed Successfully.`);
  console.log('================================================================\n');
}

if (process.argv[1] && process.argv[1].includes('migrate-profiles-and-logs')) {
  migrateProfilesAndLogs()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Profiles & Logs Migration failed:', err);
      process.exit(1);
    });
}
