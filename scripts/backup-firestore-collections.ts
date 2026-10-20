/**
 * UniAce Mastery Hub: Stage 1 Firestore Collections Backup Script
 * Exports full pre-migration snapshots of key Firestore collections to a local JSON archive.
 */

import fs from 'fs';
import path from 'path';
import { getDb } from '../server/firebaseAdmin';

export async function backupFirestoreCollections() {
  console.log('================================================================');
  console.log('📦 Phase 5 Stage 1: Creating Pre-Migration Firestore Backup');
  console.log('================================================================\n');

  const db = getDb();
  if (!db) {
    console.warn('⚠️ Admin Firestore SDK not configured or disabled. Skipping export.');
    return;
  }

  const backupDir = path.join(process.cwd(), '.aistudio', 'artifacts', 'firestore_backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const collections = ['users', 'system_logs', 'courses', 'chat_analytics', 'system_config'];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `firestore_backup_${timestamp}.json`);

  const backupData: Record<string, any[]> = {};

  for (const colName of collections) {
    try {
      console.log(`fetching collection: ${colName}...`);
      const snapshot = await db.collection(colName).get();
      backupData[colName] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      console.log(`  -> Exported ${snapshot.size} documents from '${colName}'`);
    } catch (err: any) {
      console.error(`  ❌ Error exporting collection '${colName}':`, err.message);
      backupData[colName] = [];
    }
  }

  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`\n✅ Pre-migration Firestore backup written to:\n   ${backupPath}`);
}

if (process.argv[1] && process.argv[1].includes('backup-firestore-collections')) {
  backupFirestoreCollections()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Firestore Backup failed:', err);
      process.exit(1);
    });
}
