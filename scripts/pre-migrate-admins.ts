/**
 * UniAce Mastery Hub: Step 3.2 — Pre-Migrate Admin Accounts to Neon PostgreSQL
 *
 * Pre-migrates all Firestore admin accounts into Neon PostgreSQL users table with role = 'admin',
 * seeds their authoritative ai_sparks balance + migration_seed ledger entry,
 * mirrors to user_sparks_wallets, and explicitly promotes any existing records.
 */

import crypto from 'crypto';
import { getDb, getAdminApp } from '../server/firebaseAdmin';
import { queryPostgres, checkPostgresHealth } from '../server/postgresPool';

export async function preMigrateAdmins(): Promise<{ migratedCount: number; adminUids: string[] }> {
  console.log('================================================================');
  console.log('🛡️ Step 3.2: Pre-Migrating Administrator Accounts to Neon PostgreSQL');
  console.log('================================================================\n');

  const health = await checkPostgresHealth();
  if (!health.connected) {
    throw new Error(`Neon PostgreSQL unavailable: ${health.error}`);
  }

  const db = getDb();
  if (!db) {
    throw new Error('Firestore Admin SDK not configured');
  }

  // 1. Fetch all users from Firestore and identify admins
  const userSnap = await db.collection('users').get();
  const adminDocs: Array<{ uid: string; data: any }> = [];

  for (const doc of userSnap.docs) {
    const data = doc.data();
    if (data.role === 'admin' || data.isAdmin === true) {
      adminDocs.push({ uid: doc.id, data });
    }
  }

  // Also check Firebase Auth custom claims if available
  const adminApp = getAdminApp();
  if (adminApp) {
    try {
      const auth = adminApp.auth();
      const listUsersRes = await auth.listUsers(100);
      for (const u of listUsersRes.users) {
        if (u.customClaims?.admin === true && !adminDocs.some(a => a.uid === u.uid)) {
          const docSnap = await db.collection('users').doc(u.uid).get();
          adminDocs.push({ uid: u.uid, data: docSnap.data() || { email: u.email } });
        }
      }
    } catch (e: any) {
      console.warn('  ⚠️ Note: Could not list Auth custom claims (continuing with Firestore scan):', e.message);
    }
  }

  console.log(`ℹ️ Identified ${adminDocs.length} administrator account(s) for pre-migration:`);
  for (const a of adminDocs) {
    console.log(`  - UID: ${a.uid} | Email: ${a.data.email || 'N/A'}`);
  }

  if (adminDocs.length === 0) {
    console.warn('⚠️ No admin accounts detected in Firestore.');
    return { migratedCount: 0, adminUids: [] };
  }

  const adminUids: string[] = [];

  // 2. Insert or update each admin in Neon PostgreSQL
  for (const a of adminDocs) {
    const uid = a.uid;
    const data = a.data;
    adminUids.push(uid);

    // Determine initial balance: wallet table > doc sparks > 10000 default
    let balance = 10000;
    const walletRes = await queryPostgres<{ balance: number }>(
      'SELECT balance FROM user_sparks_wallets WHERE uid = $1;',
      [uid]
    );
    if (walletRes.rows.length > 0) {
      balance = walletRes.rows[0].balance;
    } else if (typeof data.ai_sparks === 'number') {
      balance = data.ai_sparks;
    } else if (typeof data.sparks === 'number') {
      balance = data.sparks;
    }

    const email = data.email || null;
    const displayName = data.displayName || data.display_name || null;
    const planType = 'scholar'; // Admins have scholar/unlimited capabilities
    const learningProfile = JSON.stringify(data.learningProfile || data.learning_profile || {});
    const createdAt = data.createdAt?.toDate?.() || data.createdAt || new Date();

    // Insert into users
    await queryPostgres(
      `INSERT INTO users (uid, email, display_name, role, plan_type, ai_sparks, learning_profile, created_at, updated_at)
       VALUES ($1, $2, $3, 'admin', $4, $5, $6, $7, NOW())
       ON CONFLICT (uid) DO UPDATE SET
         role = 'admin',
         email = COALESCE(EXCLUDED.email, users.email),
         display_name = COALESCE(EXCLUDED.display_name, users.display_name),
         updated_at = NOW();`,
      [uid, email, displayName, planType, balance, learningProfile, createdAt]
    );

    // Mirror to user_sparks_wallets
    await queryPostgres(
      `INSERT INTO user_sparks_wallets (uid, balance, plan_type, last_spark_reset, updated_at)
       VALUES ($1, $2, 'admin', NOW(), NOW())
       ON CONFLICT (uid) DO UPDATE SET
         balance = EXCLUDED.balance,
         plan_type = 'admin',
         updated_at = NOW();`,
      [uid, balance]
    );

    // Opening seed row in spark_ledger if not already present
    const ledgerCheck = await queryPostgres(
      "SELECT ledger_id FROM spark_ledger WHERE user_id = $1 AND reason = 'migration_seed';",
      [uid]
    );
    if (ledgerCheck.rows.length === 0) {
      const ledgerId = `seed_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await queryPostgres(
        `INSERT INTO spark_ledger (ledger_id, user_id, delta, reason, created_at)
         VALUES ($1, $2, $3, 'migration_seed', NOW());`,
        [ledgerId, uid, balance]
      );
    }
  }

  // 3. Explicitly promote all admin UIDs to guarantee role = 'admin'
  await queryPostgres(
    `UPDATE users SET role = 'admin' WHERE uid = ANY($1);`,
    [adminUids]
  );

  // 4. Verification probe
  const verifyRes = await queryPostgres<{ uid: string; email: string; role: string; ai_sparks: number }>(
    `SELECT uid, email, role, ai_sparks FROM users WHERE uid = ANY($1);`,
    [adminUids]
  );

  console.log('\n--- Step 3.2 Verification Results ---');
  for (const row of verifyRes.rows) {
    if (row.role !== 'admin') {
      throw new Error(`Admin migration verification failed: UID ${row.uid} has role '${row.role}' instead of 'admin'`);
    }
    console.log(`  ✅ Verified Admin: UID=${row.uid} | Email=${row.email} | Role=${row.role} | Sparks=${row.ai_sparks}`);
  }

  console.log(`\n✨ Step 3.2 Complete: ${verifyRes.rows.length} administrators successfully migrated and verified.\n`);
  return { migratedCount: verifyRes.rows.length, adminUids };
}

if (process.argv[1] && process.argv[1].includes('pre-migrate-admins')) {
  preMigrateAdmins()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Admin pre-migration failed:', err);
      process.exit(1);
    });
}
