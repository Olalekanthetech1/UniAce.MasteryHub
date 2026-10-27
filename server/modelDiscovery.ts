import { getSystemSettingsDoc, setSystemSettingsDoc } from './systemConfigStore';

export interface ProviderModelOption {
  id: string;
  name?: string;
  contextWindow?: number;
  isVision?: boolean;
  description?: string;
  ownedBy?: string;
}

interface CacheEntry {
  timestamp: number;
  models: ProviderModelOption[];
}

const modelCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache TTL

function getProviderAliases(provider: string): string[] {
  const norm = provider.toLowerCase().trim();
  if (norm === 'gemini' || norm === 'gemini_direct') return ['gemini', 'gemini_direct'];
  if (norm === 'mistral' || norm === 'mistral_direct') return ['mistral', 'mistral_direct'];
  if (norm === 'openrouter' || norm === 'openrouter_free') return ['openrouter', 'openrouter_free'];
  return [norm];
}

async function persistDiscoveredModelsToStore(provider: string, models: ProviderModelOption[], requestId?: string) {
  try {
    if (models.length === 0) return;
    const aliases = getProviderAliases(provider);
    const now = Date.now();
    const payload: Record<string, any> = {};
    for (const alias of aliases) {
      payload[alias] = {
        models,
        count: models.length,
        updatedAt: now
      };
    }
    if (requestId) {
      payload.lastCompletedRequestId = requestId;
      payload.lastCompletedAt = now;
      payload.lastError = null;
    }
    await setSystemSettingsDoc('discovered_models', payload, true);
  } catch (err) {
    console.warn(`[ModelDiscovery] Failed to persist discovered models for ${provider}:`, err);
  }
}

/**
 * Normalizes and extracts active chat/text generation models from upstream AI provider APIs.
 */
export async function fetchProviderModels(
  provider: string,
  apiKeyOverride?: string,
  forceRefresh: boolean = false,
  requestId?: string
): Promise<{ models: ProviderModelOption[]; cached: boolean }> {
  const normalizedProvider = provider.toLowerCase().trim();
  const cacheKey = `${normalizedProvider}:${apiKeyOverride ? 'custom_key' : 'default'}`;

  if (!forceRefresh && modelCache.has(cacheKey)) {
    const entry = modelCache.get(cacheKey)!;
    if (Date.now() - entry.timestamp < CACHE_TTL_MS && entry.models.length > 0) {
      return { models: entry.models, cached: true };
    }
  }

  const apiKey = (apiKeyOverride && apiKeyOverride.trim().length > 0)
    ? apiKeyOverride.trim()
    : await getActiveKeyForProvider(normalizedProvider);

  if (!apiKey) {
    throw new Error(`No API key available for provider '${provider}'. Please provide an API key to discover available models.`);
  }

  let models: ProviderModelOption[] = [];

  switch (normalizedProvider) {
    case 'groq':
      models = await fetchGroqModels(apiKey);
      break;

    case 'gemini':
    case 'gemini_direct':
      models = await fetchGeminiModels(apiKey);
      break;

    case 'mistral':
    case 'mistral_direct':
      models = await fetchMistralModels(apiKey);
      break;

    case 'openrouter':
    case 'openrouter_free':
      models = await fetchOpenRouterModels(apiKey);
      break;

    case 'nvidia':
      models = await fetchNvidiaModels(apiKey);
      break;

    case 'cohere':
      models = await fetchCohereModels(apiKey);
      break;

    case 'huggingface':
      models = await fetchHuggingFaceModels(apiKey);
      break;

    default:
      throw new Error(`Unsupported provider for model discovery: ${provider}`);
  }

  // Deduplicate and sort alphabetically
  const uniqueMap = new Map<string, ProviderModelOption>();
  for (const m of models) {
    if (m.id && !uniqueMap.has(m.id)) {
      uniqueMap.set(m.id, m);
    }
  }
  const result = Array.from(uniqueMap.values()).sort((a, b) => a.id.localeCompare(b.id));

  // Update in-memory cache
  modelCache.set(cacheKey, {
    timestamp: Date.now(),
    models: result
  });

  // Persist live discovered models to Neon PostgreSQL system_config
  await persistDiscoveredModelsToStore(normalizedProvider, result, requestId);

  return { models: result, cached: false };
}

let discoveryWatcherInitialized = false;

export async function initModelDiscoverySync() {
  if (discoveryWatcherInitialized) return;
  discoveryWatcherInitialized = true;

  const providers = ['groq', 'gemini_direct', 'mistral_direct', 'openrouter', 'nvidia', 'cohere', 'huggingface'];
  for (const p of providers) {
    fetchProviderModels(p, undefined, true).catch((err) => {
      console.warn(`[ModelDiscovery] Startup sync skipped for ${p}: ${err.message}`);
    });
  }
}

/**
 * Retrieve active API key from Neon system_config (settings_api_keys) or environment variables
 */
async function getActiveKeyForProvider(provider: string): Promise<string | null> {
  // 1. Try Neon system_config settings_api_keys
  try {
    const data = await getSystemSettingsDoc('api_keys');
    if (data) {
      const provData = data[provider] || data[provider.replace('_direct', '')] || data[provider.replace('_free', '')] || data[`${provider}_direct`] || data[`${provider}_free`];
      if (provData && Array.isArray(provData.keys)) {
        const activeKeyObj = provData.keys.find((k: any) => k.key && !k.isExhausted) || provData.keys.find((k: any) => k.key);
        if (activeKeyObj && activeKeyObj.key) {
          return activeKeyObj.key.trim();
        }
      }
    }
  } catch (err) {
    console.warn(`[ModelDiscovery] Neon read failed for provider key:`, err);
  }

  // 2. Fallback to server process.env
  const envMap: Record<string, string | undefined> = {
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    gemini_direct: process.env.GEMINI_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    mistral_direct: process.env.MISTRAL_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    openrouter_free: process.env.OPENROUTER_API_KEY,
    nvidia: process.env.NVIDIA_API_KEY,
    cohere: process.env.COHERE_API_KEY,
    huggingface: process.env.HUGGINGFACE_API_KEY
  };

  return envMap[provider] || null;
}

/**
 * Safely parses response text as JSON, throwing descriptive errors if HTML or invalid markup is received
 */
async function parseJsonResponse<T>(res: Response, providerName: string): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  const rawText = await res.text().catch(() => '');

  if (!res.ok) {
    if (contentType.includes('text/html') || rawText.trim().startsWith('<')) {
      if (rawText.toLowerCase().includes('cloudflare') || res.status === 403) {
        throw new Error(`${providerName} model discovery blocked by Cloudflare security rules (403 HTML).`);
      }
      throw new Error(`${providerName} returned an HTML error page (Status: ${res.status}).`);
    }
    throw new Error(`${providerName} API returned ${res.status}: ${rawText || res.statusText}`);
  }

  if (contentType.includes('text/html') || rawText.trim().startsWith('<')) {
    if (rawText.toLowerCase().includes('cloudflare')) {
      throw new Error(`${providerName} model discovery blocked by Cloudflare security rules (HTML response received).`);
    }
    throw new Error(`${providerName} returned an HTML document instead of JSON data.`);
  }

  try {
    return JSON.parse(rawText) as T;
  } catch (err: any) {
    throw new Error(`${providerName} response could not be parsed as JSON: ${err.message || 'Invalid JSON format'}`);
  }
}

// 1. Groq Models Discovery (OpenAI Compatible)
async function fetchGroqModels(apiKey: string): Promise<ProviderModelOption[]> {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await parseJsonResponse<any>(res, 'Groq');
  if (!data || !Array.isArray(data.data)) {
    throw new Error('Invalid response format from Groq API');
  }

  return data.data
    .filter((m: any) => m.active !== false && !m.id.includes('whisper'))
    .map((m: any) => ({
      id: m.id,
      name: m.id,
      contextWindow: m.context_window || undefined,
      ownedBy: m.owned_by || 'Groq'
    }));
}

// 2. Google Gemini Models Discovery (Google Generative AI REST)
async function fetchGeminiModels(apiKey: string): Promise<ProviderModelOption[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' }
  });

  const data = await parseJsonResponse<any>(res, 'Gemini');
  if (!data || !Array.isArray(data.models)) {
    throw new Error('Invalid response format from Gemini API');
  }

  return data.models
    .filter((m: any) => {
      // Must support generateContent (filter out embedding-only or speech-only models)
      const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      return methods.includes('generateContent');
    })
    .map((m: any) => {
      // Strip 'models/' prefix
      const cleanId = m.name?.startsWith('models/') ? m.name.replace(/^models\//, '') : m.name;
      const isVision = m.displayName?.toLowerCase().includes('vision') || cleanId.includes('flash') || cleanId.includes('pro');
      return {
        id: cleanId,
        name: m.displayName || cleanId,
        contextWindow: m.inputTokenLimit || undefined,
        description: m.description || undefined,
        isVision,
        ownedBy: 'Google'
      };
    });
}

// 3. Mistral Models Discovery
async function fetchMistralModels(apiKey: string): Promise<ProviderModelOption[]> {
  const res = await fetch('https://api.mistral.ai/v1/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await parseJsonResponse<any>(res, 'Mistral');
  if (!data || !Array.isArray(data.data)) {
    throw new Error('Invalid response format from Mistral API');
  }

  return data.data
    .filter((m: any) => !m.id.includes('embed') && !m.id.includes('moderation'))
    .map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
      contextWindow: m.max_context_length || undefined,
      description: m.description || undefined,
      ownedBy: m.owned_by || 'Mistral AI'
    }));
}

// 4. OpenRouter Models Discovery
async function fetchOpenRouterModels(apiKey: string): Promise<ProviderModelOption[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://uniace.app',
      'X-Title': 'UniAce Mastery Hub'
    }
  });

  const data = await parseJsonResponse<any>(res, 'OpenRouter');
  if (!data || !Array.isArray(data.data)) {
    throw new Error('Invalid response format from OpenRouter API');
  }

  return data.data.map((m: any) => {
    const isVision = m.architecture?.modality?.includes('image') || false;
    return {
      id: m.id,
      name: m.name || m.id,
      contextWindow: m.context_length || undefined,
      description: m.description || undefined,
      isVision,
      ownedBy: 'OpenRouter'
    };
  });
}

// 5. NVIDIA NIM Models Discovery
async function fetchNvidiaModels(apiKey: string): Promise<ProviderModelOption[]> {
  const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await parseJsonResponse<any>(res, 'NVIDIA NIM');
  if (!data || !Array.isArray(data.data)) {
    throw new Error('Invalid response format from NVIDIA NIM API');
  }

  return data.data.map((m: any) => ({
    id: m.id,
    name: m.id,
    ownedBy: m.owned_by || 'NVIDIA'
  }));
}

// 6. Cohere Models Discovery
async function fetchCohereModels(apiKey: string): Promise<ProviderModelOption[]> {
  const res = await fetch('https://api.cohere.com/v1/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await parseJsonResponse<any>(res, 'Cohere');
  if (!data || !Array.isArray(data.models)) {
    throw new Error('Invalid response format from Cohere API');
  }

  return data.models
    .filter((m: any) => {
      const endpoints = Array.isArray(m.endpoints) ? m.endpoints : [];
      return endpoints.includes('chat') || endpoints.includes('generate');
    })
    .map((m: any) => ({
      id: m.name,
      name: m.name,
      contextWindow: m.context_length || undefined,
      ownedBy: 'Cohere'
    }));
}

// 7. Hugging Face Models Discovery
async function fetchHuggingFaceModels(apiKey: string): Promise<ProviderModelOption[]> {
  const res = await fetch('https://huggingface.co/api/models?pipeline_tag=text-generation&sort=downloads&direction=-1&limit=60', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  });

  const data = await parseJsonResponse<any[]>(res, 'HuggingFace');
  if (!Array.isArray(data)) {
    throw new Error('Invalid response format from HuggingFace API');
  }

  return data.map((m: any) => ({
    id: m.id,
    name: m.id,
    ownedBy: 'Hugging Face'
  }));
}
