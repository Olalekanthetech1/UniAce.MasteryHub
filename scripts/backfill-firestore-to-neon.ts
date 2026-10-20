/**
 * Backfill Firestore data to Neon PostgreSQL with Dry-Run and Live modes.
 * Usage:
 *   npx tsx scripts/backfill-firestore-to-neon.ts --dry-run
 *   npx tsx scripts/backfill-firestore-to-neon.ts --live
 */
import { getDb } from '../server/firebaseAdmin';
import { getPostgresPool } from '../server/postgresPool';
import dotenv from 'dotenv';

dotenv.config();

const isDryRun = process.argv.includes('--dry-run') || !process.argv.includes('--live');

async function runBackfill() {
  console.log(`\n======================================================`);
  console.log(`🚀 Starting Firestore -> Neon Backfill (Mode: ${isDryRun ? 'DRY-RUN' : 'LIVE'})`);
  console.log(`======================================================\n`);

  const db = getDb();
  if (!db) throw new Error('Firestore DB initialization failed');

  const pool = getPostgresPool();
  if (!pool) throw new Error('Neon Postgres connection failed');

  const stats: Record<string, { firestoreCount: number; neonBefore: number; migrated: number; neonAfter: number }> = {};

  // 1. Backfill Notifications -> user_notifications
  {
    const colName = 'notifications';
    const targetTable = 'user_notifications';
    console.log(`Checking ${colName} -> ${targetTable}...`);
    
    const beforeRes = await pool.query(`SELECT count(*)::int as cnt FROM ${targetTable}`);
    const neonBefore = beforeRes.rows[0].cnt;

    const snap = await db.collection(colName).get();
    const firestoreCount = snap.size;
    let migrated = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const id = doc.id;
      const uid = data.userId || data.uid;
      if (!uid) continue;

      const title = data.title || 'Notification';
      const message = data.message || '';
      const type = data.type || 'info';
      const read = Boolean(data.read);
      const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date());

      if (!isDryRun) {
        await pool.query(
          `INSERT INTO user_notifications (id, uid, title, message, type, read, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             message = EXCLUDED.message,
             type = EXCLUDED.type,
             read = EXCLUDED.read`,
          [id, uid, title, message, type, read, createdAt]
        );
      }
      migrated++;
    }

    const afterRes = isDryRun ? beforeRes : await pool.query(`SELECT count(*)::int as cnt FROM ${targetTable}`);
    stats[targetTable] = {
      firestoreCount,
      neonBefore,
      migrated,
      neonAfter: afterRes.rows[0].cnt
    };
  }

  // 2. Backfill chat_analytics
  {
    const colName = 'chat_analytics';
    const targetTable = 'chat_analytics';
    console.log(`Checking ${colName} -> ${targetTable}...`);

    const beforeRes = await pool.query(`SELECT count(*)::int as cnt FROM ${targetTable}`);
    const neonBefore = beforeRes.rows[0].cnt;

    const snap = await db.collection(colName).get();
    const firestoreCount = snap.size;
    let migrated = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const uid = data.uid || null;
      const query = data.query || '';
      const context = data.context || 'General Academic Tutor';
      const complexity = data.complexity || 'standard';
      const tokens = Number(data.tokens) || 0;
      const providerUsed = data.providerUsed || 'gemini_direct';
      const piiRedacted = Boolean(data.pii_redacted || false);
      const createdAt = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp ? new Date(data.timestamp) : new Date());

      if (!isDryRun) {
        await pool.query(
          `INSERT INTO chat_analytics (uid, query, context, complexity, tokens, provider_used, pii_redacted, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [uid, query, context, complexity, tokens, providerUsed, piiRedacted, createdAt]
        );
      }
      migrated++;
    }

    const afterRes = isDryRun ? beforeRes : await pool.query(`SELECT count(*)::int as cnt FROM ${targetTable}`);
    stats[targetTable] = {
      firestoreCount,
      neonBefore,
      migrated,
      neonAfter: afterRes.rows[0].cnt
    };
  }

  // 3. Backfill struggle_analytics
  {
    const colName = 'struggle_analytics';
    const targetTable = 'struggle_analytics';
    console.log(`Checking ${colName} -> ${targetTable}...`);

    const beforeRes = await pool.query(`SELECT count(*)::int as cnt FROM ${targetTable}`);
    const neonBefore = beforeRes.rows[0].cnt;

    const snap = await db.collection(colName).get();
    const firestoreCount = snap.size;
    let migrated = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const uid = data.uid || null;
      const courseId = data.courseId || null;
      const moduleId = data.moduleId || null;
      const subtopicId = data.subTopicId || null;
      const moduleTitle = data.moduleTitle || null;
      const subtopicTitle = data.subTopicTitle || null;
      const type = data.type || 'explain_simpler';
      const createdAt = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp ? new Date(data.timestamp) : new Date());

      if (!isDryRun) {
        await pool.query(
          `INSERT INTO struggle_analytics (uid, course_id, module_id, subtopic_id, module_title, subtopic_title, type, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [uid, courseId, moduleId, subtopicId, moduleTitle, subtopicTitle, type, createdAt]
        );
      }
      migrated++;
    }

    const afterRes = isDryRun ? beforeRes : await pool.query(`SELECT count(*)::int as cnt FROM ${targetTable}`);
    stats[targetTable] = {
      firestoreCount,
      neonBefore,
      migrated,
      neonAfter: afterRes.rows[0].cnt
    };
  }

  // 4. Backfill announcements (if any)
  {
    const colName = 'announcements';
    const targetTable = 'announcements';
    console.log(`Checking ${colName} -> ${targetTable}...`);

    const beforeRes = await pool.query(`SELECT count(*)::int as cnt FROM ${targetTable}`);
    const neonBefore = beforeRes.rows[0].cnt;

    const snap = await db.collection(colName).get();
    const firestoreCount = snap.size;
    let migrated = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const id = doc.id;
      const title = data.title || 'Announcement';
      const message = data.message || '';
      const severity = data.severity || 'info';
      const audience = data.audience || 'all';
      const active = data.active !== false;
      const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();

      if (!isDryRun) {
        await pool.query(
          `INSERT INTO announcements (id, title, message, severity, audience, active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, message = EXCLUDED.message, active = EXCLUDED.active`,
          [id, title, message, severity, audience, active, createdAt]
        );
      }
      migrated++;
    }

    const afterRes = isDryRun ? beforeRes : await pool.query(`SELECT count(*)::int as cnt FROM ${targetTable}`);
    stats[targetTable] = {
      firestoreCount,
      neonBefore,
      migrated,
      neonAfter: afterRes.rows[0].cnt
    };
  }

  // 5. Backfill system_config
  {
    const colName = 'system_config';
    const targetTable = 'system_config';
    console.log(`Checking ${colName} -> ${targetTable}...`);

    const beforeRes = await pool.query(`SELECT count(*)::int as cnt FROM ${targetTable}`);
    const neonBefore = beforeRes.rows[0].cnt;

    const snap = await db.collection(colName).get();
    const firestoreCount = snap.size;
    let migrated = 0;

    for (const doc of snap.docs) {
      const key = doc.id;
      const data = doc.data();

      if (!isDryRun) {
        await pool.query(
          `INSERT INTO system_config (key, data, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [key, JSON.stringify(data)]
        );
      }
      migrated++;
    }

    const afterRes = isDryRun ? beforeRes : await pool.query(`SELECT count(*)::int as cnt FROM ${targetTable}`);
    stats[targetTable] = {
      firestoreCount,
      neonBefore,
      migrated,
      neonAfter: afterRes.rows[0].cnt
    };
  }

  console.log(`\n======================================================`);
  console.log(`📊 PARITY AUDIT SUMMARY (${isDryRun ? 'DRY-RUN' : 'LIVE'})`);
  console.log(`======================================================`);
  console.table(stats);

  await pool.end();
}

runBackfill().catch(err => {
  console.error('Fatal backfill error:', err);
  process.exit(1);
});
