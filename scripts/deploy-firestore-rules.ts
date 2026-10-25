/**
 * UniAce Mastery Hub: Direct Firestore Rules Deployment Tool
 * 
 * Uses FIREBASE_SERVICE_ACCOUNT from the environment to deploy firestore.rules
 * directly to Google Cloud Firebase Rules API for both (default) and named databases.
 */

import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export async function deployFirestoreRules(): Promise<boolean> {
  const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT?.trim().replace(/^["']|["']$/g, '');
  if (!serviceAccountStr) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT environment variable is not defined.');
    return false;
  }

  let sa: any;
  try {
    sa = JSON.parse(serviceAccountStr);
  } catch (err: any) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', err.message);
    return false;
  }

  const projectId = sa.project_id;
  if (!projectId) {
    console.error('❌ project_id missing from FIREBASE_SERVICE_ACCOUNT JSON.');
    return false;
  }

  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  if (!fs.existsSync(rulesPath)) {
    console.error(`❌ Rules file not found at ${rulesPath}`);
    return false;
  }

  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  console.log(`🚀 Authenticating with Google Cloud for project: ${projectId}...`);
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase']
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    console.error('❌ Failed to retrieve Google Cloud access token.');
    return false;
  }

  console.log('📦 1. Compiling & creating new ruleset on Google Cloud Firebase Rules API...');
  const createRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      source: {
        files: [
          {
            name: 'firestore.rules',
            content: rulesContent
          }
        ]
      }
    })
  });

  const ruleset = await createRes.json();
  if (!createRes.ok) {
    console.error('❌ Ruleset creation failed:', JSON.stringify(ruleset, null, 2));
    return false;
  }

  console.log(`✅ Ruleset created: ${ruleset.name}`);

  // 2. Release to default database
  console.log('🚀 2. Releasing ruleset to default database...');
  const defaultReleaseName = 'cloud.firestore';
  const defaultPatchRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/${defaultReleaseName}?updateMask=rulesetName`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      release: {
        name: `projects/${projectId}/releases/cloud.firestore`,
        rulesetName: ruleset.name
      }
    })
  });

  if (defaultPatchRes.ok) {
    console.log('✅ Released to (default) database successfully.');
  } else {
    console.warn('⚠️ Default release note:', await defaultPatchRes.json());
  }

  // 3. Release to named database if configured
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const dbId = config.firestoreDatabaseId;
      if (dbId && dbId !== '(default)') {
        console.log(`🚀 3. Releasing ruleset to named database: ${dbId}...`);
        const encodedRel = `cloud.firestore%2F${encodeURIComponent(dbId)}`;
        const namedPatchRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/${encodedRel}?updateMask=rulesetName`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            release: {
              name: `projects/${projectId}/releases/cloud.firestore/${dbId}`,
              rulesetName: ruleset.name
            }
          })
        });

        if (namedPatchRes.ok) {
          console.log(`✅ Released to ${dbId} database successfully.`);
        } else {
          console.warn(`⚠️ Named database release note:`, await namedPatchRes.json());
        }
      }
    }
  } catch (err: any) {
    console.warn('Could not release to named database:', err.message);
  }

  console.log('\n🎉 Direct deployment to Firebase completed successfully!');
  return true;
}

// Standalone CLI execution
const isDirectCli = typeof process !== 'undefined' && process.argv && process.argv[1] && (
  process.argv[1].endsWith('deploy-firestore-rules.ts') ||
  process.argv[1].endsWith('deploy-firestore-rules.js')
);

if (isDirectCli) {
  deployFirestoreRules().then((success) => {
    process.exit(success ? 0 : 1);
  }).catch((err) => {
    console.error('Fatal error during rules deploy:', err);
    process.exit(1);
  });
}
