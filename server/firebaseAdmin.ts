
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { instrumentFirestoreInstance } from './dbTelemetry';

dotenv.config();

const currentFilename = typeof __filename !== 'undefined' ? __filename : path.join(process.cwd(), 'server', 'firebaseAdmin.ts');
const currentDirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(currentFilename);

let adminApp: admin.app.App | null = null;
let db: admin.firestore.Firestore | null = null;

try {
  let serviceAccount;
  const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT?.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  
  if (serviceAccountStr) {
    serviceAccount = JSON.parse(serviceAccountStr);
    adminApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    let databaseId = '(default)';
    try {
      // Look for config in the root directory
      const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.firestoreDatabaseId) {
          databaseId = config.firestoreDatabaseId;
        }
      }
    } catch (e) {
      console.warn('Could not read firebase-applet-config.json', e);
    }
    
    db = instrumentFirestoreInstance(getFirestore(adminApp, databaseId));
    db.settings({ ignoreUndefinedProperties: true });
    
    // Override app.firestore() and admin.firestore() to return the correct named db instance
    adminApp.firestore = () => db as admin.firestore.Firestore;
    try {
      (admin as any).firestore = Object.assign(() => db as admin.firestore.Firestore, admin.firestore);
    } catch {
      // Ignore if read-only property on namespace
    }
    
    console.log(`Firebase Admin Initialized Successfully with database: ${databaseId}`);
  } else {
    console.warn("FIREBASE_SERVICE_ACCOUNT is missing. Firebase Admin features will be disabled.");
  }
} catch (error) {
  console.error("CRITICAL: Failed to initialize Firebase Admin.", error);
}

export const isFirebaseInitialized = (): boolean => {
  return !!adminApp;
};

export const getAdminApp = (): admin.app.App | null => {
  return adminApp;
};

export const getDb = (): admin.firestore.Firestore | null => {
  return db;
};
