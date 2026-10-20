/**
 * UniAce Mastery Hub: Prune dev-admin Account & Ledger Rows Atomically
 */

import { getPostgresPool } from '../server/postgresPool';
import { getDb } from '../server/firebaseAdmin';

export async function pruneDevAdmin(): Promise<void> {
  console.log('--- Pruning dev-admin from Firestore and Neon ---');

  // 1. Delete from Firestore
  const db = getDb();
  if (db) {
    const docRef = db.collection('users').doc('dev-admin');
    const doc = await docRef.get();
    if (doc.exists) {
      await docRef.delete();
      console.log('✅ Deleted users/dev-admin from Firestore.');
    } else {
      console.log('ℹ️ dev-admin already absent in Firestore.');
    }
  }

  // 2. Delete from Neon
  const pool = getPostgresPool();
  if (!pool) throw new Error('Database pool unavailable');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM spark_transactions_ledger WHERE uid = $1;', ['dev-admin']);
    await client.query('DELETE FROM spark_escrow_locks WHERE uid = $1;', ['dev-admin']);
    await client.query('DELETE FROM spark_ledger WHERE user_id = $1;', ['dev-admin']);
    await client.query('DELETE FROM user_sparks_wallets WHERE uid = $1;', ['dev-admin']);
    const res = await client.query('DELETE FROM users WHERE uid = $1;', ['dev-admin']);
    await client.query('COMMIT');
    console.log(`✅ Deleted dev-admin from Neon (rows deleted: ${res.rowCount}).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].includes('prune-dev-admin')) {
  pruneDevAdmin()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Failed to prune dev-admin:', err);
      process.exit(1);
    });
}
