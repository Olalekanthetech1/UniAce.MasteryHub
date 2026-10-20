import { getPostgresPool } from '../server/postgresPool';
import { getAdminApp } from '../server/firebaseAdmin';
import crypto from 'crypto';

async function backfill() {
  const isLive = process.argv.includes('--live');
  const pool = getPostgresPool();
  const app = getAdminApp();
  const db = app?.firestore();

  if (!pool || !db) {
    console.error('Missing DB connection');
    process.exit(1);
  }

  console.log(`=== STARTING ${isLive ? 'LIVE BACKFILL' : 'DRY-RUN BACKFILL'} ===`);

  // 1. Backfill notifications
  console.log('\n--- 1. Notifications Backfill ---');
  const notifSnap = await db.collection('notifications').get();
  console.log(`Found ${notifSnap.size} notifications in Firestore`);
  let notifInserted = 0;
  for (const doc of notifSnap.docs) {
    const d = doc.data();
    const id = doc.id;
    const uid = d.userId || d.uid || 'global';
    const title = d.title || 'Notification';
    const message = d.message || '';
    const type = d.type || 'info';
    const read = Boolean(d.read || false);
    const createdAt = d.timestamp?.toDate ? d.timestamp.toDate().toISOString() : (d.createdAt || new Date().toISOString());

    if (isLive) {
      await pool.query(
        `INSERT INTO user_notifications (id, uid, title, message, type, read, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, message = EXCLUDED.message, read = EXCLUDED.read`,
        [id, uid, title, message, type, read, createdAt]
      );
    }
    notifInserted++;
  }
  console.log(`Notifications processed: ${notifInserted} (${isLive ? 'committed to Neon' : 'dry-run simulated'})`);

  // 2. Backfill spaced_repetition and flashcards from user subcollections
  console.log('\n--- 2. SRS & Flashcards Subcollections Backfill ---');
  const usersSnap = await db.collection('users').get();
  let srsCount = 0;
  let flashcardCount = 0;

  for (const uDoc of usersSnap.docs) {
    const uid = uDoc.id;

    // A. spaced_repetition
    const srsSnap = await uDoc.ref.collection('spaced_repetition').get();
    for (const doc of srsSnap.docs) {
      const d = doc.data();
      const cardId = d.topicId || doc.id;
      const courseId = d.courseId || 'general';
      const id = `srs_${uid}_${cardId.replace(/[^a-zA-Z0-9_\-]/g, '_')}`;
      const box = Number(d.repetitions || d.repetition || 1);
      const easeFactor = Number(d.easinessFactor || d.efactor || 2.5);
      const reviewCount = Number(d.repetitions || 0);
      const nextReviewAt = d.nextReviewDate?.toDate ? d.nextReviewDate.toDate().toISOString() : (d.nextReviewDate || new Date().toISOString());
      const updatedAt = d.lastReviewed?.toDate ? d.lastReviewed.toDate().toISOString() : (d.lastReviewed || new Date().toISOString());

      if (isLive) {
        await pool.query(
          `INSERT INTO user_spaced_repetition (id, uid, card_id, course_id, box, next_review_at, review_count, ease_factor, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
           ON CONFLICT (id) DO UPDATE SET
             box = EXCLUDED.box,
             next_review_at = EXCLUDED.next_review_at,
             review_count = EXCLUDED.review_count,
             ease_factor = EXCLUDED.ease_factor,
             updated_at = EXCLUDED.updated_at`,
          [id, uid, cardId, courseId, box, nextReviewAt, reviewCount, easeFactor, updatedAt]
        );
      }
      srsCount++;
    }

    // B. flashcards
    const fcSnap = await uDoc.ref.collection('flashcards').get();
    for (const doc of fcSnap.docs) {
      const d = doc.data();
      const cardId = doc.id;
      const courseId = d.courseId || 'general';
      const id = `fc_${uid}_${cardId.replace(/[^a-zA-Z0-9_\-]/g, '_')}`;
      const box = Number(d.repetition || d.repetitions || 1);
      const easeFactor = Number(d.efactor || d.easinessFactor || 2.5);
      const reviewCount = Number(d.repetition || d.repetitions || 0);
      const nextReviewAt = d.nextReviewDate?.toDate ? d.nextReviewDate.toDate().toISOString() : (d.nextReviewDate || new Date().toISOString());
      const updatedAt = d.lastReviewed?.toDate ? d.lastReviewed.toDate().toISOString() : (d.lastReviewed || new Date().toISOString());

      if (isLive) {
        await pool.query(
          `INSERT INTO user_spaced_repetition (id, uid, card_id, course_id, box, next_review_at, review_count, ease_factor, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
           ON CONFLICT (id) DO UPDATE SET
             box = EXCLUDED.box,
             next_review_at = EXCLUDED.next_review_at,
             review_count = EXCLUDED.review_count,
             ease_factor = EXCLUDED.ease_factor,
             updated_at = EXCLUDED.updated_at`,
          [id, uid, cardId, courseId, box, nextReviewAt, reviewCount, easeFactor, updatedAt]
        );
      }
      flashcardCount++;
    }
  }

  console.log(`SRS records processed: ${srsCount}`);
  console.log(`Flashcards processed into user_spaced_repetition: ${flashcardCount}`);

  // Final count verification
  const finalNotif = await pool.query('SELECT count(*)::int as cnt FROM user_notifications');
  const finalSrs = await pool.query('SELECT count(*)::int as cnt FROM user_spaced_repetition');
  console.log('\n=== FINAL NEON COUNTS ===');
  console.log(`user_notifications: ${finalNotif.rows[0].cnt}`);
  console.log(`user_spaced_repetition: ${finalSrs.rows[0].cnt}`);

  process.exit(0);
}

backfill();
