import { getAdminApp } from '../server/firebaseAdmin';

async function probe() {
  const app = getAdminApp();
  if (!app) {
    console.log('Firebase Admin App not initialized');
    process.exit(1);
  }
  const db = app.firestore();
  
  const collectionsToCheck = [
    'user_course_progress',
    'user_study_batches',
    'user_lesson_completions',
    'user_quiz_attempts',
    'quiz_attempts',
    'progress'
  ];

  console.log('Probing Firestore collections...');
  for (const col of collectionsToCheck) {
    const snap = await db.collection(col).limit(5).get().catch((e: any) => ({ empty: true, size: 0, docs: [] } as any));
    console.log(`Collection "${col}": count = ${snap.docs?.length || 0}`);
    if (snap.docs && snap.docs.length > 0) {
      console.log(`  Sample doc ${snap.docs[0].id}:`, JSON.stringify(snap.docs[0].data()).slice(0, 150));
    }
  }

  // Also check subcollections under users if any
  const usersSnap = await db.collection('users').limit(3).get().catch(() => ({ docs: [] } as any));
  console.log(`Users sample count: ${usersSnap.docs.length}`);
  for (const u of usersSnap.docs) {
    const subcols = await u.ref.listCollections().catch(() => []);
    if (subcols.length > 0) {
      console.log(`  User ${u.id} subcollections:`, subcols.map((c: any) => c.id));
    }
  }
}

probe().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
