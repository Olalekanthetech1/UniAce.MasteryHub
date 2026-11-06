import { z } from 'zod';
import {
  decryptAcademicCredential,
  encryptAcademicCredential,
  type EncryptedAcademicCredential
} from '../academic/credentialVault.js';
import { getSystemSettingsDoc, setSystemSettingsDoc } from '../systemConfigStore.js';

const CLOUDINARY_CREDENTIALS_DOC = 'demo_studio_cloudinary_credentials';
const DEFAULT_FOLDER_PREFIX = 'marketing-demo-studio';

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
    cloudinary: EncryptedCredentialSchema.optional()
  }).strict()
}).strict();

const CloudinaryConfigSchema = z.object({
  cloudName: z.string().min(2).max(64),
  apiKey: z.string().min(1).max(4096),
  apiSecret: z.string().min(1).max(4096),
  folderPrefix: z.string().min(1).max(180)
}).strict();

export type CloudinaryMediaConfig = z.infer<typeof CloudinaryConfigSchema>;
type StoredCredentials = z.infer<typeof StoredCredentialsSchema>;

export interface CloudinaryCredentialStatus {
  configured: boolean;
  source: 'admin_dashboard' | 'render_environment' | 'none';
  cloudName: string | null;
  apiKeyHint: string | null;
  folderPrefix: string;
  encryptionReady: boolean;
  storageAvailable: boolean;
  decryptable: boolean;
  environmentIncomplete: boolean;
}

export function normalizeCloudinaryFolderPrefix(value: string): string {
  const normalized = value.trim().replace(new RegExp('^/+|/+$', 'g'), '').split('/').map((segment) => segment.trim()).join('/');
  if (
    !normalized ||
    normalized.length > 180 ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
    !/^[A-Za-z0-9 _/-]+$/.test(normalized)
  ) {
    throw new Error('Enter a valid Cloudinary folder path using letters, numbers, spaces, hyphens, underscores and forward slashes.');
  }
  return normalized;
}

export function normalizeCloudinaryConfig(input: unknown): CloudinaryMediaConfig {
  const parsed = CloudinaryConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('Cloudinary Cloud name, API key, API secret and a valid folder path are required.');
  }

  const cloudName = parsed.data.cloudName.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(cloudName)) {
    throw new Error('The Cloudinary Cloud name must contain 2–64 lowercase letters, numbers, underscores or hyphens.');
  }

  const apiKey = parsed.data.apiKey.trim();
  const apiSecret = parsed.data.apiSecret.trim();
  if (!apiKey || !apiSecret) {
    throw new Error('Both the Cloudinary API key and API secret are required.');
  }

  return {
    cloudName,
    apiKey,
    apiSecret,
    folderPrefix: normalizeCloudinaryFolderPrefix(parsed.data.folderPrefix)
  };
}

async function readStoredCredentials(): Promise<StoredCredentials | null> {
  const raw = await getSystemSettingsDoc(CLOUDINARY_CREDENTIALS_DOC);
  if (!raw) return null;

  const parsed = StoredCredentialsSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean).join(', ');
    throw new Error(
      'Stored Cloudinary credentials are invalid. Invalid fields: ' +
      (fields || 'document shape') +
      '. No environment fallback was used.'
    );
  }
  return parsed.data;
}

function isEncryptionReady(): boolean {
  try {
    encryptAcademicCredential('cloudinary-encryption-readiness-check');
    return true;
  } catch {
    return false;
  }
}

function readEnvironmentConfig(): CloudinaryMediaConfig | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) return null;

  return normalizeCloudinaryConfig({
    cloudName,
    apiKey,
    apiSecret,
    folderPrefix: process.env.CLOUDINARY_DEMO_STUDIO_FOLDER?.trim() || DEFAULT_FOLDER_PREFIX
  });
}

function hasPartialEnvironmentConfig(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() ||
    process.env.CLOUDINARY_API_KEY?.trim() ||
    process.env.CLOUDINARY_API_SECRET?.trim()
  ) && !(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
    process.env.CLOUDINARY_API_KEY?.trim() &&
    process.env.CLOUDINARY_API_SECRET?.trim()
  );
}

async function resolveCloudinaryConfig(): Promise<{
  config: CloudinaryMediaConfig | null;
  source: CloudinaryCredentialStatus['source'];
  decryptable: boolean;
}> {
  const stored = await readStoredCredentials();
  const encrypted = stored?.credentials.cloudinary;

  if (encrypted) {
    try {
      const plaintext = decryptAcademicCredential(encrypted as EncryptedAcademicCredential);
      const parsed = JSON.parse(plaintext);
      return {
        config: normalizeCloudinaryConfig(parsed),
        source: 'admin_dashboard',
        decryptable: true
      };
    } catch {
      return { config: null, source: 'admin_dashboard', decryptable: false };
    }
  }

  const environmentConfig = readEnvironmentConfig();
  return {
    config: environmentConfig,
    source: environmentConfig ? 'render_environment' : 'none',
    decryptable: true
  };
}

export async function getCloudinaryMediaConfig(): Promise<CloudinaryMediaConfig | null> {
  const resolved = await resolveCloudinaryConfig();
  if (resolved.source === 'admin_dashboard' && !resolved.decryptable) {
    throw new Error('The stored Cloudinary credentials cannot be decrypted. Verify the original ACADEMIC_RESEARCH_ENCRYPTION_KEY and stored credential integrity.');
  }
  return resolved.config;
}

export async function getCloudinaryCredentialStatus(): Promise<CloudinaryCredentialStatus> {
  const resolved = await resolveCloudinaryConfig();
  return {
    configured: Boolean(resolved.config) || (resolved.source === 'admin_dashboard' && !resolved.decryptable),
    source: resolved.source,
    cloudName: resolved.config?.cloudName || null,
    apiKeyHint: resolved.config?.apiKey ? '••••' + resolved.config.apiKey.slice(-4) : null,
    folderPrefix: resolved.config?.folderPrefix || process.env.CLOUDINARY_DEMO_STUDIO_FOLDER?.trim() || DEFAULT_FOLDER_PREFIX,
    encryptionReady: isEncryptionReady(),
    storageAvailable: true,
    decryptable: resolved.decryptable,
    environmentIncomplete: hasPartialEnvironmentConfig()
  };
}

export async function saveCloudinaryMediaConfig(input: unknown): Promise<CloudinaryCredentialStatus> {
  const config = normalizeCloudinaryConfig(input);
  const encrypted = encryptAcademicCredential(JSON.stringify(config));
  const next: StoredCredentials = {
    schemaVersion: 1,
    credentials: { cloudinary: encrypted }
  };
  await setSystemSettingsDoc(CLOUDINARY_CREDENTIALS_DOC, next, false);
  return getCloudinaryCredentialStatus();
}

/**
 * Removes only the Admin Dashboard credential. A complete Render environment
 * configuration becomes active if one is present.
 */
export async function clearCloudinaryMediaConfig(): Promise<CloudinaryCredentialStatus> {
  const next: StoredCredentials = {
    schemaVersion: 1,
    credentials: {}
  };
  await setSystemSettingsDoc(CLOUDINARY_CREDENTIALS_DOC, next, false);
  return getCloudinaryCredentialStatus();
}
