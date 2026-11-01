import crypto from 'crypto';
import { getSystemConfigDoc, setSystemConfigDoc } from '../systemConfigStore.js';

export type AcademicResearchDepth = 'adaptive';
export interface AcademicResearchSettings {
  enabled: boolean;
  cacheTtlHours: number;
  arxivMaxResults: number;
  defaultCourseAlignment: string;
  openAlexEmail?: string;
  providersEnabled: {
    arxiv: boolean;
    semanticScholar: boolean;
    openAlex: boolean;
    tavily: boolean;
  };
  researchDepth: AcademicResearchDepth;
  adaptiveMaxQueries: number;
  minimumUsefulSources: number;
  minimumRelevanceScore: number;
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
  minimumRelevanceScore: 0.25,
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
  const providers = (stored.providersEnabled && typeof stored.providersEnabled === 'object'
    ? stored.providersEnabled
    : {}) as Partial<AcademicResearchSettings['providersEnabled']>;
  const settings: AcademicResearchSettings = {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.enabled,
    cacheTtlHours: typeof stored.cacheTtlHours === 'number' ? stored.cacheTtlHours : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.cacheTtlHours,
    arxivMaxResults: typeof stored.arxivMaxResults === 'number' ? stored.arxivMaxResults : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.arxivMaxResults,
    defaultCourseAlignment: typeof stored.defaultCourseAlignment === 'string'
      ? stored.defaultCourseAlignment
      : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.defaultCourseAlignment,
    ...(typeof stored.openAlexEmail === 'string' ? { openAlexEmail: stored.openAlexEmail } : {}),
    providersEnabled: {
      arxiv: typeof providers.arxiv === 'boolean' ? providers.arxiv : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.providersEnabled.arxiv,
      semanticScholar: typeof providers.semanticScholar === 'boolean' ? providers.semanticScholar : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.providersEnabled.semanticScholar,
      openAlex: typeof providers.openAlex === 'boolean' ? providers.openAlex : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.providersEnabled.openAlex,
      tavily: typeof providers.tavily === 'boolean' ? providers.tavily : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.providersEnabled.tavily,
    },
    researchDepth: 'adaptive',
    adaptiveMaxQueries: typeof stored.adaptiveMaxQueries === 'number' ? stored.adaptiveMaxQueries : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.adaptiveMaxQueries,
    minimumUsefulSources: typeof stored.minimumUsefulSources === 'number' ? stored.minimumUsefulSources : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.minimumUsefulSources,
    minimumRelevanceScore: typeof stored.minimumRelevanceScore === 'number' ? stored.minimumRelevanceScore : DEFAULT_ACADEMIC_RESEARCH_SETTINGS.minimumRelevanceScore,
  };
  if (
    typeof settings.enabled !== 'boolean' ||
    !Number.isInteger(settings.cacheTtlHours) || settings.cacheTtlHours < 1 || settings.cacheTtlHours > 720 ||
    !Number.isInteger(settings.arxivMaxResults) || settings.arxivMaxResults < 1 || settings.arxivMaxResults > 20 ||
    !Number.isInteger(settings.adaptiveMaxQueries) || settings.adaptiveMaxQueries < 1 || settings.adaptiveMaxQueries > 2 ||
    !Number.isInteger(settings.minimumUsefulSources) || settings.minimumUsefulSources < 1 || settings.minimumUsefulSources > 10 ||
    !Number.isFinite(settings.minimumRelevanceScore) || settings.minimumRelevanceScore < 0 || settings.minimumRelevanceScore > 1 ||
    typeof settings.defaultCourseAlignment !== 'string' ||
    (settings.openAlexEmail !== undefined && typeof settings.openAlexEmail !== 'string') ||
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
  const {
    tavilyApiKey: incomingTavilyApiKey,
    semanticScholarApiKey: incomingSemanticScholarApiKey,
    ...settingsInput
  } = input;
  const incomingProviders = settingsInput.providersEnabled || {};
  const settings = normalizeSettings({
    ...current.settings,
    ...settingsInput,
    providersEnabled: {
      ...current.settings.providersEnabled,
      ...incomingProviders,
    },
  });

  const credentials = existing?.credentials && typeof existing.credentials === 'object'
    ? { ...(existing.credentials as Record<string, unknown>) }
    : {};

  const tavilyApiKey = typeof incomingTavilyApiKey === 'string' ? incomingTavilyApiKey.trim() : '';
  const semanticScholarApiKey = typeof incomingSemanticScholarApiKey === 'string' ? incomingSemanticScholarApiKey.trim() : '';
  if (tavilyApiKey) credentials.tavilyApiKey = encryptSecret(tavilyApiKey);
  if (semanticScholarApiKey) credentials.semanticScholarApiKey = encryptSecret(semanticScholarApiKey);

  await setSystemConfigDoc(CONFIG_KEY, {
    version: 1,
    settings,
    credentials,
  }, false);

  return loadAcademicResearchConfig(true);
}
