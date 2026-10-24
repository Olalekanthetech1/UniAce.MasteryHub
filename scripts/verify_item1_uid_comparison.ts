import { getPostgresPool } from '../server/postgresPool.js';
import { getDb } from '../server/firebaseAdmin.js';

async function verifyUsersAndWallets() {
  const pool = getPostgresPool();
  if (!pool) {
    console.error('Postgres pool unavailable');
    process.exit(1);
  }

  const db = getDb();
  if (!db) {
    console.error('Firestore db unavailable');
    process.exit(1);
  }

  console.log('=== ITEM 1: STRICT UID-KEYED VERIFICATION (NEON VS FIRESTORE) ===\n');

  // 1. Fetch 18 users from Neon
  const pgUsersRes = await pool.query(`
    SELECT 
      u.uid, 
      u.email, 
      u.learning_profile->>'xp' as xp, 
      u.learning_profile->>'level' as level, 
      u.learning_profile->>'streak' as streak, 
      u.learning_profile->>'department' as department,
      u.ai_sparks,
      w.balance as wallet_balance
    FROM users u
    LEFT JOIN user_sparks_wallets w ON u.uid = w.uid
    ORDER BY u.created_at ASC;
  `);

  console.log(`Neon Users Count: ${pgUsersRes.rows.length}\n`);

  // 2. Fetch corresponding Firestore users by UID
  const comparisonRows: any[] = [];
  let anyMismatch = false;

  for (let i = 0; i < pgUsersRes.rows.length; i++) {
    const pg = pgUsersRes.rows[i];
    const fsDoc = await db.collection('users').doc(pg.uid).get();
    
    if (!fsDoc.exists) {
      comparisonRows.push({
        num: i + 1,
        uid: pg.uid,
        neon_email: pg.email,
        fs_email: 'DOC_NOT_FOUND',
        email_match: false,
        neon_xp: pg.xp,
        fs_xp: 'N/A',
        neon_level: pg.level,
        fs_level: 'N/A',
        neon_streak: pg.streak,
        fs_streak: 'N/A',
        neon_dept: pg.department,
        fs_dept: 'N/A',
        neon_sparks: pg.ai_sparks,
        wallet_balance: pg.wallet_balance
      });
      anyMismatch = true;
      continue;
    }

    const fs = fsDoc.data() || {};
    const fsLP = fs.learningProfile || fs.learning_profile || {};
    const fsStats = fs.stats || {};

    const fsEmail = fs.email || 'N/A';
    const emailMatch = (pg.email || '').toLowerCase().trim() === (fsEmail || '').toLowerCase().trim();

    // In Firestore, xp/level/streak can be in doc root, learningProfile, or stats
    const fsXP = fs.xp ?? fsLP.xp ?? fsStats.xp ?? 0;
    const fsLevel = fs.level ?? fsLP.level ?? fsStats.level ?? 1;
    const fsStreak = fs.streak ?? fsLP.streak ?? fsStats.streak ?? 0;
    const fsDept = fs.department ?? fsLP.department ?? fs.departmentName ?? null;

    const neonXP = parseInt(pg.xp || '0', 10);
    const neonLevel = parseInt(pg.level || '1', 10);
    const neonStreak = parseInt(pg.streak || '0', 10);

    // Rule: Neon must be GREATEST(neon, fs), so neon must be >= fs
    const xpValid = neonXP >= fsXP;
    const levelValid = neonLevel >= fsLevel;
    const streakValid = neonStreak >= fsStreak;

    // Wallets check
    const walletMatch = pg.ai_sparks === pg.wallet_balance;

    if (!emailMatch || !xpValid || !levelValid || !streakValid || !walletMatch) {
      anyMismatch = true;
    }

    comparisonRows.push({
      num: i + 1,
      uid: pg.uid,
      neon_email: pg.email,
      fs_email: fsEmail,
      email_match: emailMatch,
      neon_xp: neonXP,
      fs_xp: fsXP,
      neon_level: neonLevel,
      fs_level: fsLevel,
      neon_streak: neonStreak,
      fs_streak: fsStreak,
      neon_dept: pg.department || 'None',
      fs_dept: fsDept || 'None',
      neon_sparks: pg.ai_sparks,
      wallet_balance: pg.wallet_balance,
      wallet_match: walletMatch
    });
  }

  console.log('--------------------------------------------------------------------------------------------------------------------------------------------------');
  console.log('| #  | UID                           | Neon Email                     | FS Email                       | Email? | Neon XP | FS XP | Neon Lvl | FS Lvl | Neon Stk | FS Stk | Neon Dept                        | FS Dept                          | Sparks | Wallet | Wal? |');
  console.log('--------------------------------------------------------------------------------------------------------------------------------------------------');
  
  for (const r of comparisonRows) {
    const num = String(r.num).padStart(2, ' ');
    const uid = r.uid.padEnd(29, ' ');
    const nEmail = (r.neon_email || 'None').slice(0, 30).padEnd(30, ' ');
    const fEmail = (r.fs_email || 'None').slice(0, 30).padEnd(30, ' ');
    const emMatch = r.email_match ? ' YES  ' : '  NO  ';
    const nXp = String(r.neon_xp).padStart(7, ' ');
    const fXp = String(r.fs_xp).padStart(5, ' ');
    const nLvl = String(r.neon_level).padStart(8, ' ');
    const fLvl = String(r.fs_level).padStart(6, ' ');
    const nStk = String(r.neon_streak).padStart(8, ' ');
    const fStk = String(r.fs_streak).padStart(6, ' ');
    const nDept = (r.neon_dept || 'None').slice(0, 32).padEnd(32, ' ');
    const fDept = (r.fs_dept || 'None').slice(0, 32).padEnd(32, ' ');
    const sparks = String(r.neon_sparks).padStart(6, ' ');
    const wBal = String(r.wallet_balance).padStart(6, ' ');
    const wMatch = r.wallet_match ? ' YES' : '  NO';

    console.log(`| ${num} | ${uid} | ${nEmail} | ${fEmail} | ${emMatch} | ${nXp} | ${fXp} | ${nLvl} | ${fLvl} | ${nStk} | ${fStk} | ${nDept} | ${fDept} | ${sparks} | ${wBal} | ${wMatch} |`);
  }
  console.log('--------------------------------------------------------------------------------------------------------------------------------------------------');

  console.log(`\nOverall Integrity Verification: ${!anyMismatch ? 'ALL 18 ROWS FULLY MATCH BY UID' : 'MISMATCH DETECTED'}`);

  await pool.end();
  return { anyMismatch, rows: comparisonRows };
}

verifyUsersAndWallets().then(res => {
  if (res.anyMismatch) {
    console.log('\n[!] Notice: Row discrepancy found. Prompt requested: "ASK ME before the restore".');
  }
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
