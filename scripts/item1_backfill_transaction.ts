import { getPostgresPool } from '../server/postgresPool';
import { getDb } from '../server/firebaseAdmin';

async function executeBackfill() {
  const pool = getPostgresPool();
  const db = getDb();

  if (!pool || !db) {
    console.error('Database connection unavailable');
    process.exit(1);
  }

  console.log('=== ITEM 1: LEARNING_PROFILE BACKFILL WITH RESTORE POINT ===\n');

  // Step 1: Create Restore Point Table in Neon
  const backupTimestamp = Date.now();
  const backupTableName = `users_learning_profile_backup_${backupTimestamp}`;
  console.log(`1. Creating Restore Point table: ${backupTableName}...`);
  await pool.query(`
    CREATE TABLE ${backupTableName} AS 
    SELECT uid, email, learning_profile, updated_at 
    FROM users;
  `);
  const backupCountRes = await pool.query(`SELECT COUNT(*) as cnt FROM ${backupTableName};`);
  console.log(`   Restore point created successfully with ${backupCountRes.rows[0].cnt} user records.\n`);

  // Step 2: Fetch all Firestore users
  console.log('2. Fetching Firestore users state...');
  const fsSnap = await db.collection('users').get();
  const fsUsersMap = new Map<string, any>();
  const fsEmailMap = new Map<string, any>();

  fsSnap.docs.forEach(doc => {
    const data = doc.data();
    fsUsersMap.set(doc.id, data);
    if (data.email) {
      fsEmailMap.set(data.email.toLowerCase().trim(), data);
    }
  });
  console.log(`   Fetched ${fsSnap.size} Firestore documents.\n`);

  // Step 3: Fetch current Neon users
  const neonUsersRes = await pool.query(`SELECT uid, email, learning_profile FROM users ORDER BY created_at ASC;`);
  const neonUsers = neonUsersRes.rows;
  console.log(`3. Preparing backfill in ONE single Neon transaction for ${neonUsers.length} users...\n`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const user of neonUsers) {
      const fsData = fsUsersMap.get(user.uid) || (user.email ? fsEmailMap.get(user.email.toLowerCase().trim()) : null);
      if (!fsData) continue;

      const currentProfile = user.learning_profile || {};

      // Numeric fields: strictly GREATEST (never lower)
      const currentXp = Number(currentProfile.xp || 0);
      const fsXp = Number(fsData.xp || 0);
      const targetXp = Math.max(currentXp, fsXp);

      const currentLevel = Number(currentProfile.level || 1);
      const fsLevel = Number(fsData.level || 1);
      const targetLevel = Math.max(currentLevel, fsLevel);

      const currentStreak = Number(currentProfile.streak ?? currentProfile.streakDays ?? 0);
      const fsStreak = Number(fsData.streak ?? fsData.streakDays ?? 0);
      const targetStreak = Math.max(currentStreak, fsStreak);

      // Achievements: union by ID
      const currentAch = Array.isArray(currentProfile.achievements) ? currentProfile.achievements : [];
      const fsAch = Array.isArray(fsData.achievements) ? fsData.achievements : [];
      const achMap = new Map<string, any>();
      currentAch.forEach((a: any) => { if (a && a.id) achMap.set(a.id, a); });
      fsAch.forEach((a: any) => { if (a && a.id && !achMap.has(a.id)) achMap.set(a.id, a); });
      const targetAchievements = Array.from(achMap.values());

      // lastStudyDate: latest valid date
      let targetLastStudyDate = currentProfile.lastStudyDate || null;
      if (fsData.lastStudyDate) {
        if (!targetLastStudyDate || new Date(fsData.lastStudyDate).getTime() > new Date(targetLastStudyDate).getTime()) {
          targetLastStudyDate = fsData.lastStudyDate;
        }
      }

      // Department & Curriculum parameters (strictly copied from Firestore where present, never invented)
      const targetDepartment = fsData.department || currentProfile.department || null;
      const targetFaculty = fsData.faculty || currentProfile.faculty || null;
      const targetAcademicLevel = fsData.academic_level || fsData.academicLevel || currentProfile.academic_level || currentProfile.academicLevel || null;
      const targetSemester = fsData.semester || currentProfile.semester || null;
      const targetOnboarding = fsData.onboarding || currentProfile.onboarding || null;

      const updatedProfile = {
        ...currentProfile,
        xp: targetXp,
        level: targetLevel,
        streak: targetStreak,
        streakDays: targetStreak,
        achievements: targetAchievements,
        lastStudyDate: targetLastStudyDate,
        ...(targetDepartment ? { department: targetDepartment } : {}),
        ...(targetFaculty ? { faculty: targetFaculty } : {}),
        ...(targetAcademicLevel ? { academic_level: targetAcademicLevel, academicLevel: targetAcademicLevel } : {}),
        ...(targetSemester ? { semester: targetSemester } : {}),
        ...(targetOnboarding ? { onboarding: targetOnboarding } : {})
      };

      await client.query(
        `UPDATE users 
         SET learning_profile = $1::jsonb, updated_at = NOW() 
         WHERE uid = $2;`,
        [JSON.stringify(updatedProfile), user.uid]
      );
    }

    await client.query('COMMIT');
    console.log('✅ Transaction COMMITTED successfully.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:', err);
    throw err;
  } finally {
    client.release();
  }

  // Step 4: Verification with fresh table output
  console.log('=== VERIFICATION: FRESH TABLE AUDIT (POST-BACKFILL) ===');
  console.log('------------------------------------------------------------------------------------------------------------------------');
  console.log('| #  | Email                               | XP     | Lvl | Strk | Department                       | Level | Semester    |');
  console.log('------------------------------------------------------------------------------------------------------------------------');

  const verifyRes = await pool.query(`
    SELECT uid, email, 
           (learning_profile->>'xp')::int as xp,
           (learning_profile->>'level')::int as level,
           COALESCE((learning_profile->>'streak')::int, (learning_profile->>'streakDays')::int, 0) as streak,
           learning_profile->>'department' as department,
           learning_profile->>'academic_level' as academic_level,
           learning_profile->>'semester' as semester,
           jsonb_array_length(COALESCE(learning_profile->'achievements', '[]'::jsonb)) as ach_count
    FROM users
    WHERE email NOT LIKE 'test_%'
    ORDER BY created_at ASC;
  `);

  verifyRes.rows.forEach((r, idx) => {
    const num = String(idx + 1).padEnd(2);
    const email = (r.email || r.uid).padEnd(35);
    const xp = String(r.xp || 0).padEnd(6);
    const lvl = String(r.level || 1).padEnd(3);
    const strk = String(r.streak || 0).padEnd(4);
    const dept = (r.department || 'None').padEnd(32);
    const aLvl = (r.academic_level || 'None').padEnd(5);
    const sem = (r.semester || 'None').padEnd(11);
    console.log(`| ${num} | ${email} | ${xp} | ${lvl} | ${strk} | ${dept} | ${aLvl} | ${sem} |`);
  });
  console.log('------------------------------------------------------------------------------------------------------------------------');

  await pool.end();
  process.exit(0);
}

executeBackfill().catch(err => {
  console.error(err);
  process.exit(1);
});
