import { z } from 'zod';
import {
  decryptAcademicCredential,
  encryptAcademicCredential,
  type EncryptedAcademicCredential
} from '../academic/credentialVault.js';
import { getSystemSettingsDoc, setSystemSettingsDoc } from '../systemConfigStore.js';

const DEMO_NARRATION_CREDENTIALS_DOC = 'demo_narration_credentials';

const EncryptedCredentialSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm'),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  ciphertext: z.string().min(1)
}).strict();

const StoredCredentialsSchema = z.object({
  schemaVersion: z.literal(1),
  credentials: z.object({
    elevenLabsApiKey: EncryptedCredentialSchema.optional()
  }).strict()
}).strict();

type StoredCredentials = z.infer<typeof StoredCredentialsSchema>;

export interface DemoNarrationCredentialStatus {
  configured: boolean;
  source: 'admin_dashboard' | 'render_environment' | 'none';
  keyHint: string | null;
  encryptionReady: boolean;
  storageAvailable: boolean;
  decryptable: boolean;
}

async function readStoredCredentials(): Promise<StoredCredentials | null> {
  const raw = await getSystemSettingsDoc(DEMO_NARRATION_CREDENTIALS_DOC);
  if (!raw) return null;

  const parsed = StoredCredentialsSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean).join(', ');
    throw new Error(
      'Stored Demo Studio credentials are invalid. Invalid fields: ' +
      (fields || 'document shape') +
      '. No environment fallback was used.'
    );
  }
  return parsed.data;
}

function isEncryptionReady(): boolean {
  try {
    // A throwaway encryption verifies the configured server key without
    // persisting a value or revealing the key.
    encryptAcademicCredential('demo-narration-encryption-readiness-check');
    return true;
  } catch {
    return false;
  }
}

export async function getDemoNarrationCredentialStatus(): Promise<DemoNarrationCredentialStatus> {
  const stored = await readStoredCredentials();
  const encrypted = stored?.credentials.elevenLabsApiKey;
  const environmentKey = process.env.ELEVENLABS_API_KEY?.trim() || null;

  if (encrypted) {
    try {
      const plaintext = decryptAcademicCredential(encrypted as EncryptedAcademicCredential);
      return {
        configured: true,
        source: 'admin_dashboard',
        keyHint: plaintext ? '••••' + plaintext.slice(-4) : null,
        encryptionReady: isEncryptionReady(),
        storageAvailable: true,
        decryptable: true
      };
    } catch {
      return {
        configured: true,
        source: 'admin_dashboard',
        keyHint: null,
        encryptionReady: isEncryptionReady(),
        storageAvailable: true,
        decryptable: false
      };
    }
  }

  return {
    configured: Boolean(environmentKey),
    source: environmentKey ? 'render_environment' : 'none',
    keyHint: environmentKey ? '••••' + environmentKey.slice(-4) : null,
    encryptionReady: isEncryptionReady(),
    storageAvailable: true,
    decryptable: true
  };
}

/**
 * Resolve the provider key only inside the server process.
 * Admin Dashboard credentials take precedence over the Render environment
 * variable so a dashboard update takes effect without exposing the secret.
 */
export async function getDemoNarrationApiKey(): Promise<string | null> {
  const stored = await readStoredCredentials();
  const encrypted = stored?.credentials.elevenLabsApiKey;
  if (encrypted) {
    return decryptAcademicCredential(encrypted as EncryptedAcademicCredential);
  }
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

export async function saveDemoNarrationApiKey(apiKey: string): Promise<DemoNarrationCredentialStatus> {
  const normalized = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!normalized || normalized.length > 4096) {
    throw new Error('Enter a valid ElevenLabs API key between 1 and 4096 characters.');
  }

  const encrypted = encryptAcademicCredential(normalized);
  const next: StoredCredentials = {
    schemaVersion: 1,
    credentials: { elevenLabsApiKey: encrypted }
  };
  await setSystemSettingsDoc(DEMO_NARRATION_CREDENTIALS_DOC, next, false);
  return getDemoNarrationCredentialStatus();
}

/**
 * Clears only the Admin Dashboard-stored key. If ELEVENLABS_API_KEY remains
 * configured in Render, that environment value becomes the active fallback.
 */
export async function clearDemoNarrationApiKey(): Promise<DemoNarrationCredentialStatus> {
  const next: StoredCredentials = {
    schemaVersion: 1,
    credentials: {}
  };
  await setSystemSettingsDoc(DEMO_NARRATION_CREDENTIALS_DOC, next, false);
  return getDemoNarrationCredentialStatus();
}
