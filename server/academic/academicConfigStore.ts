import crypto from 'crypto';
import { getSystemConfigDoc, setSystemConfigDoc } from '../systemConfigStore.js';

export type AcademicResearchDepth = 'adaptive';
export interface AcademicResearchSettings {
  enabled: boolean;
  cacheTtlHours: number;
  arxivMaxResults: number;
  defaultCourseAlignment: string;
  providersEnabled: {
    arxiv: boolean;
    semanticScholar: boolean;
    openAlex: boolean;
    tavily: boolean;
  };
  researchDepth: AcademicResearchDepth;
  adaptiveMaxQueries: number;
  minimumUsefulSources: number;
}
export interface AcademicResearchSecrets {
  semanticScholarApiKey?: string;
  tavilyApiKey?: string;
}
export interface AcademicResearchConfigRecord {
  settings: AcademicResearchSettings;
  secrets: AcademicResearchSecrets;
  tavilyApiKeyConfigured: boolean;
  semanticScholarApiKeyConfigured: boolean;
}

const CONFIG_KEY = 'academic_research_config_v1';

export const DEFAULT_ACADEMIC_RESEARCH_SETTINGS: AcademicResearchSettings = {
  enabled: true,
  cacheTtlHours: 24,
  arxivMaxResults: 5,
  defaultCourseAlignment: 'Source-backed course alignment',
  providersEnabled: {
    arxiv: true,
    semanticScholar: true,
    openAlex: true,
    tavily: false,
  },
  researchDepth: 'adaptive',
  adaptiveMaxQueries: 2,
  minimumUsefulSources: 3,
};

interface EncryptedSecret {
  algorithm: 'aes-256-gcm';
  version: 1;
  iv: string;
  authTag: string;
  ciphertext: string;
}

function getEncryptionKey(): Buffer {
  const raw = process.env.ACADEMIC_CONFIG_ENCRYPTION_KEY?.trim() || '';
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error(
      'ACADEMIC_CONFIG_ENCRYPTION_KEY must be configured as a 64-character hexadecimal key before provider credentials can be saved or decrypted.'
    );
  }
  return Buffer.from(raw, 'hex');
}

function encryptSecret(value: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    version: 1,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptSecret(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const encrypted = value as Partial<EncryptedSecret>;
  if (
    encrypted.algorithm !== 'aes-256-gcm' ||
    encrypted.version !== 1 ||
    typeof encrypted.iv !== 'string' ||
    typeof encrypted.authTag !== 'string' ||
    typeof encrypted.ciphertext !== 'string'
  ) {
    throw new Error('Stored academic provider credential has an unsupported or invalid encrypted format.');
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(encrypted.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Academic provider credential could not be decrypted. Verify ACADEMIC_CONFIG_ENCRYPTION_KEY and restore the original key if it changed.');
  }
}

function normalizeSettings(value: unknown): AcademicResearchSettings {
  const stored = value && typeof value === 'object' ? value as Partial<AcademicResearchSettings> : {};
  const providers = stored.providersEnabled || {};
  const settings: AcademicResearchSettings = {
    ...DEFAULT_ACADEMIC_RESEARCH_SETTINGS,
    ...stored,
    providersEnabled: {
      ...DEFAULT_ACADEMIC_RESEARCH_SETTINGS.providersEnabled,
      ...providers,
    },
    researchDepth: 'adaptive',
  };
  if (
    typeof settings.enabled !== 'boolean' ||
    !Number.isInteger(settings.cacheTtlHours) || settings.cacheTtlHours < 1 || settings.cacheTtlHours > 720 ||
    !Number.isInteger(settings.arxivMaxResults) || settings.arxivMaxResults < 1 || settings.arxivMaxResults > 20 ||
    !Number.isInteger(settings.adaptiveMaxQueries) || settings.adaptiveMaxQueries < 1 || settings.adaptiveMaxQueries > 3 ||
    !Number.isInteger(settings.minimumUsefulSources) || settings.minimumUsefulSources < 1 || settings.minimumUsefulSources > 10 ||
    typeof settings.defaultCourseAlignment !== 'string' ||
    Object.values(settings.providersEnabled).some(flag => typeof flag !== 'boolean')
  ) {
    throw new Error('Academic research configuration contains invalid settings.');
  }
  return settings;
}

export async function loadAcademicResearchConfig(forceRefresh = false): Promise<AcademicResearchConfigRecord> {
  const stored = await getSystemConfigDoc(CONFIG_KEY, forceRefresh);
  if (!stored) {
    return {
      settings: { ...DEFAULT_ACADEMIC_RESEARCH_SETTINGS, providersEnabled: { ...DEFAULT_ACADEMIC_RESEARCH_SETTINGS.providersEnabled } },
      secrets: {},
      tavilyApiKeyConfigured: false,
      semanticScholarApiKeyConfigured: false,
    };
  }

  const credentials = stored.credentials && typeof stored.credentials === 'object'
    ? stored.credentials as Record<string, unknown>
    : {};
  const tavilyApiKey = decryptSecret(credentials.tavilyApiKey);
  const semanticScholarApiKey = decryptSecret(credentials.semanticScholarApiKey);
  const secrets: AcademicResearchSecrets = {
    ...(tavilyApiKey ? { tavilyApiKey } : {}),
    ...(semanticScholarApiKey ? { semanticScholarApiKey } : {}),
  };

  return {
    settings: normalizeSettings(stored.settings),
    secrets,
    tavilyApiKeyConfigured: Boolean(tavilyApiKey),
    semanticScholarApiKeyConfigured: Boolean(semanticScholarApiKey),
  };
}

export async function saveAcademicResearchConfig(
  input: Partial<AcademicResearchSettings> & AcademicResearchSecrets
): Promise<AcademicResearchConfigRecord> {
  const existing = await getSystemConfigDoc(CONFIG_KEY, true);
  const current = await loadAcademicResearchConfig(true);
  const incomingProviders = input.providersEnabled || {};
  const settings = normalizeSettings({
    ...current.settings,
    ...input,
    providersEnabled: {
      ...current.settings.providersEnabled,
      ...incomingProviders,
    },
  });

  const credentials = existing?.credentials && typeof existing.credentials === 'object'
    ? { ...(existing.credentials as Record<string, unknown>) }
    : {};

  const tavilyApiKey = typeof input.tavilyApiKey === 'string' ? input.tavilyApiKey.trim() : '';
  const semanticScholarApiKey = typeof input.semanticScholarApiKey === 'string' ? input.semanticScholarApiKey.trim() : '';
  if (tavilyApiKey) credentials.tavilyApiKey = encryptSecret(tavilyApiKey);
  if (semanticScholarApiKey) credentials.semanticScholarApiKey = encryptSecret(semanticScholarApiKey);

  await setSystemConfigDoc(CONFIG_KEY, {
    version: 1,
    settings,
    credentials,
  }, false);

  return loadAcademicResearchConfig(true);
}
