import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';

async function audit18Users() {
  const db = getDb();
  const pool = getPostgresPool();
  if (!db || !pool) {
    console.error('Database connection failed');
    process.exit(1);
  }

  // Fetch all users from Neon
  const pgUsersRes = await pool.query(`
    SELECT uid, email, display_name, role, learning_profile 
    FROM users 
    ORDER BY created_at ASC;
  `);

  console.log(`Found ${pgUsersRes.rows.length} users in Neon database.\n`);

  const results: any[] = [];

  for (const pgUser of pgUsersRes.rows) {
    const uid = pgUser.uid;
    const email = pgUser.email;
    const pgProfile = pgUser.learning_profile || {};

    // Fetch Firestore doc
    let fsData: any = null;
    let fsExists = false;
    if (db) {
      try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) {
          fsExists = true;
          fsData = doc.data();
        }
      } catch (e) {
        console.error(`Error fetching Firestore user ${uid}:`, e);
      }
    }

    // Extract Firestore fields
    const fsXp = fsData?.learningProfile?.xp ?? fsData?.xp ?? 0;
    const fsLevel = fsData?.learningProfile?.level ?? fsData?.level ?? 1;
    const fsStreak = fsData?.learningProfile?.streakDays ?? fsData?.streakDays ?? fsData?.learningProfile?.streak ?? fsData?.streak ?? 0;
    const fsMastery = fsData?.learningProfile?.masteryScores ?? fsData?.masteryScores ?? {};
    const fsAchievements = fsData?.learningProfile?.unlockedAchievements ?? fsData?.unlockedAchievements ?? fsData?.achievements ?? [];
    const fsBookmarks = fsData?.bookmarks ?? fsData?.learningProfile?.bookmarks ?? [];
    const fsStudyTime = fsData?.totalStudySeconds ?? fsData?.learningProfile?.totalStudySeconds ?? 0;

    // Extract Neon fields
    const pgXp = pgProfile.xp ?? 0;
    const pgLevel = pgProfile.level ?? 1;
    const pgStreak = pgProfile.streakDays ?? pgProfile.streak ?? 0;
    const pgMastery = pgProfile.masteryScores ?? {};
    const pgAchievements = pgProfile.unlockedAchievements ?? pgProfile.achievements ?? [];
    const pgBookmarks = pgProfile.bookmarks ?? [];
    const pgStudyTime = pgProfile.totalStudySeconds ?? 0;

    results.push({
      uid,
      email,
      fsExists,
      fs: {
        xp: fsXp,
        level: fsLevel,
        streak: fsStreak,
        mastery: fsMastery,
        achievements: Array.isArray(fsAchievements) ? fsAchievements.length : fsAchievements,
        bookmarks: Array.isArray(fsBookmarks) ? fsBookmarks.length : fsBookmarks,
        studyTime: fsStudyTime,
        rawMastery: JSON.stringify(fsMastery)
      },
      neon: {
        xp: pgXp,
        level: pgLevel,
        streak: pgStreak,
        mastery: pgMastery,
        achievements: Array.isArray(pgAchievements) ? pgAchievements.length : pgAchievements,
        bookmarks: Array.isArray(pgBookmarks) ? pgBookmarks.length : pgBookmarks,
        studyTime: pgStudyTime,
        rawMastery: JSON.stringify(pgMastery)
      }
    });
  }

  console.log('=== TABLE COMPARISON FOR ALL USERS (FIRESTORE vs NEON) ===');
  console.log('------------------------------------------------------------------------------------------------------------------------');
  console.log('| #  | Email / UID                         | Source | XP   | Level | Streak | Mastery           | Achv | Bkmk | StudyTime |');
  console.log('------------------------------------------------------------------------------------------------------------------------');
  
  results.forEach((r, idx) => {
    const num = String(idx + 1).padEnd(2);
    const idStr = (r.email || r.uid).padEnd(35);
    
    // Firestore row
    const fsXpStr = String(r.fs.xp).padEnd(4);
    const fsLvlStr = String(r.fs.level).padEnd(5);
    const fsStrkStr = String(r.fs.streak).padEnd(6);
    const fsMastStr = r.fs.rawMastery.padEnd(17).substring(0, 17);
    const fsAchStr = String(r.fs.achievements).padEnd(4);
    const fsBkmkStr = String(r.fs.bookmarks).padEnd(4);
    const fsTimeStr = String(r.fs.studyTime).padEnd(9);

    console.log(`| ${num} | ${idStr} | FS     | ${fsXpStr} | ${fsLvlStr} | ${fsStrkStr} | ${fsMastStr} | ${fsAchStr} | ${fsBkmkStr} | ${fsTimeStr} |`);

    // Neon row
    const pgXpStr = String(r.neon.xp).padEnd(4);
    const pgLvlStr = String(r.neon.level).padEnd(5);
    const pgStrkStr = String(r.neon.streak).padEnd(6);
    const pgMastStr = r.neon.rawMastery.padEnd(17).substring(0, 17);
    const pgAchStr = String(r.neon.achievements).padEnd(4);
    const pgBkmkStr = String(r.neon.bookmarks).padEnd(4);
    const pgTimeStr = String(r.neon.studyTime).padEnd(9);

    console.log(`|    | ${''.padEnd(35)} | NEON   | ${pgXpStr} | ${pgLvlStr} | ${pgStrkStr} | ${pgMastStr} | ${pgAchStr} | ${pgBkmkStr} | ${pgTimeStr} |`);
    console.log('------------------------------------------------------------------------------------------------------------------------');
  });

  // Specifically analyze Olatunbosun
  const olatunbosun = results.find(r => r.email?.includes('olatunbosun') || r.email?.includes('crowther') || r.uid === 'fXj3VzbcIMX8OJn5tlQL5fKf2Na2');
  console.log('\n=== DETAILED ANALYSIS FOR OLATUNBOSUN (olatunbosuncrowther17) ===');
  if (olatunbosun) {
    console.log('Email:', olatunbosun.email);
    console.log('UID:', olatunbosun.uid);
    console.log('Firestore Profile:', JSON.stringify(olatunbosun.fs, null, 2));
    console.log('Neon Profile:', JSON.stringify(olatunbosun.neon, null, 2));
  } else {
    console.log('Olatunbosun user not found in results.');
  }

  // Fenced backfill dry-run diff
  console.log('\n=== FENCED BACKFILL DRY-RUN DIFF (NEVER LOWER A VALUE) ===');
  for (const r of results) {
    const updates: any = {};
    let needsUpdate = false;

    // Fenced rules: new = max(neon, fs)
    const fsProfile = r.fs;
    const neonProfile = r.neon;

    const targetXp = Math.max(neonProfile.xp, fsProfile.xp);
    if (targetXp > neonProfile.xp) {
      updates.xp = targetXp;
      needsUpdate = true;
    }

    const targetLevel = Math.max(neonProfile.level, fsProfile.level);
    if (targetLevel > neonProfile.level) {
      updates.level = targetLevel;
      needsUpdate = true;
    }

    const targetStreak = Math.max(neonProfile.streak, fsProfile.streak);
    if (targetStreak > neonProfile.streak) {
      updates.streakDays = targetStreak;
      needsUpdate = true;
    }

    const targetStudyTime = Math.max(neonProfile.studyTime, fsProfile.studyTime);
    if (targetStudyTime > neonProfile.studyTime) {
      updates.totalStudySeconds = targetStudyTime;
      needsUpdate = true;
    }

    // Merge mastery scores without lowering
    const fsMastery = JSON.parse(fsProfile.rawMastery);
    const neonMastery = JSON.parse(neonProfile.rawMastery);
    const mergedMastery = { ...neonMastery };
    for (const [k, v] of Object.entries(fsMastery)) {
      const numV = Number(v) || 0;
      if (!mergedMastery[k] || numV > Number(mergedMastery[k])) {
        mergedMastery[k] = numV;
        needsUpdate = true;
      }
    }
    if (needsUpdate) {
      updates.masteryScores = mergedMastery;
    }

    if (needsUpdate) {
      console.log(`[DRY-RUN DIFF] User: ${r.email || r.uid}`);
      console.log(`  Current Neon learning_profile: ${JSON.stringify(neonProfile)}`);
      console.log(`  Proposed Fenced learning_profile Updates: ${JSON.stringify(updates)}`);
      console.log(`  SQL Preview: UPDATE users SET learning_profile = learning_profile || '${JSON.stringify(updates)}'::jsonb WHERE uid = '${r.uid}';\n`);
    }
  }

  await pool.end();
}

audit18Users().catch(e => {
  console.error(e);
  process.exit(1);
});
