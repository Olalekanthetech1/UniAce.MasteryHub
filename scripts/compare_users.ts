import { getPostgresPool } from '../server/postgresPool.js';
import { getDb } from '../server/firebaseAdmin.js';

async function main() {
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

  // 1. Get all users from Firestore
  const firestoreUsersSnap = await db.collection('users').get();
  console.log(`Firestore total users count: ${firestoreUsersSnap.docs.length}`);

  // 2. Get all users from Neon
  const pgRes = await pool.query(`SELECT uid, email, display_name, role, plan_type, ai_sparks, learning_profile, created_at, updated_at FROM users;`);
  console.log(`Neon total users count: ${pgRes.rows.length}`);

  const neonMap = new Map<string, any>();
  for (const row of pgRes.rows) {
    let lp = row.learning_profile;
    if (typeof lp === 'string') {
      try { lp = JSON.parse(lp); } catch (e) { lp = {}; }
    }
    neonMap.set(row.uid, { ...row, learning_profile: lp || {} });
  }

  console.log('\n================================================================================');
  console.log('USER GAMIFICATION COMPARISON (FIRESTORE vs NEON)');
  console.log('================================================================================\n');

  const comparisonTable: any[] = [];

  for (const doc of firestoreUsersSnap.docs) {
    const fsData = doc.data();
    const uid = doc.id;
    const fsLP = fsData.learningProfile || {};
    const fsStats = fsData.stats || {};

    const fsXP = fsData.xp ?? fsLP.xp ?? fsStats.xp ?? 0;
    const fsLevel = fsData.level ?? fsLP.level ?? fsStats.level ?? 1;
    const fsStreak = fsData.streak ?? fsLP.streak ?? fsStats.streak ?? 0;
    const fsMastery = fsData.mastery ?? fsLP.mastery ?? fsStats.mastery ?? 0;
    const fsAchievements = fsData.achievements ?? fsLP.achievements ?? fsData.unlockedAchievements ?? [];
    const fsBookmarks = fsData.bookmarks ?? fsLP.bookmarks ?? [];
    const fsStudyTime = fsData.studyTime ?? fsLP.studyTime ?? fsStats.studyTime ?? 0;

    const neonUser = neonMap.get(uid);
    const neonLP = neonUser?.learning_profile || {};

    const neonXP = neonLP.xp ?? 0;
    const neonLevel = neonLP.level ?? 1;
    const neonStreak = neonLP.streak ?? 0;
    const neonMastery = neonLP.mastery ?? 0;
    const neonAchievements = neonLP.achievements ?? [];
    const neonBookmarks = neonLP.bookmarks ?? [];
    const neonStudyTime = neonLP.studyTime ?? 0;

    comparisonTable.push({
      uid,
      email: fsData.email || neonUser?.email || 'N/A',
      displayName: fsData.displayName || fsData.display_name || neonUser?.display_name || uid,
      fs_xp: fsXP,
      neon_xp: neonXP,
      fs_level: fsLevel,
      neon_level: neonLevel,
      fs_streak: fsStreak,
      neon_streak: neonStreak,
      fs_mastery: fsMastery,
      neon_mastery: neonMastery,
      fs_achievements_count: Array.isArray(fsAchievements) ? fsAchievements.length : 0,
      neon_achievements_count: Array.isArray(neonAchievements) ? neonAchievements.length : 0,
      fs_bookmarks_count: Array.isArray(fsBookmarks) ? fsBookmarks.length : 0,
      neon_bookmarks_count: Array.isArray(neonBookmarks) ? neonBookmarks.length : 0,
      fs_studyTime: fsStudyTime,
      neon_studyTime: neonStudyTime,
    });
  }

  console.table(comparisonTable);

  // 3. Dry-run fenced backfill of learning_profile & diff for target user
  console.log('\n================================================================================');
  console.log('DRY-RUN FENCED BACKFILL DIFF FOR USER: olatunbosuncrowther17');
  console.log('================================================================================\n');

  // Find user with email or uid matching olatunbosuncrowther17
  let targetUid = 'olatunbosuncrowther17';
  let targetFsDoc = firestoreUsersSnap.docs.find(d => d.id === targetUid || d.data().email?.includes('olatunbosuncrowther17') || d.data().username === 'olatunbosuncrowther17');

  if (!targetFsDoc) {
    // Search all docs by email or name
    for (const d of firestoreUsersSnap.docs) {
      const data = d.data();
      if ((data.email && data.email.includes('olatunbosuncrowther17')) || (data.displayName && data.displayName.includes('olatunbosun'))) {
        targetFsDoc = d;
        targetUid = d.id;
        break;
      }
    }
  }

  if (targetFsDoc) {
    const fsData = targetFsDoc.data();
    const targetNeon = neonMap.get(targetUid) || neonMap.get(targetFsDoc.id);

    console.log(`Found Target Firestore Doc ID: ${targetFsDoc.id}`);
    console.log(`Firestore Raw Data keys:`, Object.keys(fsData));

    const fsLP = fsData.learningProfile || {};
    // User specification: xp 20, mastery 1.1=100 (if mastery in fs is 1.1 or scaled to 100)
    const proposedLP = {
      ...fsLP,
      xp: fsData.xp ?? fsLP.xp ?? 20,
      level: fsData.level ?? fsLP.level ?? 1,
      streak: fsData.streak ?? fsLP.streak ?? 0,
      mastery: fsData.mastery ?? fsLP.mastery ?? 100, // 1.1 converted or normalized to 100
      achievements: fsData.achievements ?? fsLP.achievements ?? [],
      bookmarks: fsData.bookmarks ?? fsLP.bookmarks ?? [],
      studyTime: fsData.studyTime ?? fsLP.studyTime ?? 0,
      updated_at: new Date().toISOString()
    };

    console.log('\nCurrent Neon learning_profile:');
    console.log(JSON.stringify(targetNeon?.learning_profile || {}, null, 2));

    console.log('\nProposed Backfilled learning_profile (Firestore Source):');
    console.log(JSON.stringify(proposedLP, null, 2));

    console.log('\nCalculated Diff for olatunbosuncrowther17:');
    const currentLP = targetNeon?.learning_profile || {};
    const diff: Record<string, { before: any; after: any }> = {};
    for (const key of Object.keys(proposedLP)) {
      if (JSON.stringify(currentLP[key]) !== JSON.stringify((proposedLP as any)[key])) {
        diff[key] = {
          before: currentLP[key] ?? null,
          after: (proposedLP as any)[key]
        };
      }
    }
    console.log(JSON.stringify(diff, null, 2));
  } else {
    console.log('Target user olatunbosuncrowther17 not found in Firestore docs.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error running comparison:', err);
  process.exit(1);
});
