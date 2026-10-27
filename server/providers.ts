import { z } from 'zod';
import { getSystemSettingsDoc, setSystemSettingsDoc } from './systemConfigStore';
import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { Mistral } from '@mistralai/mistralai';
import { CohereClient } from "cohere-ai";
import { HfInference } from "@huggingface/inference";
import OpenAI from "openai";

export interface ModelResponse {
  text: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason: string;
  upstreamModel?: string | null;
}

export interface ModelCallOptions {
  complexity: 'high' | 'standard';
  jsonMode?: boolean;
  model?: string;
  signal?: AbortSignal;
  temperature?: number;
}

export interface ModelProvider {
  readonly name: string;
  generate(messages: any[], options: ModelCallOptions): Promise<ModelResponse>;
  stream(messages: any[], options: ModelCallOptions, onChunk: (chunk: string) => void): Promise<ModelResponse>;
}

export function createStreamAbortError(reason = 'Client disconnected mid-stream'): Error {
  const err = new Error(`STREAM_ABORTED: ${reason}`) as any;
  err.code = 'STREAM_ABORTED';
  err.isRetryable = false;
  return err;
}

export function isClientAbortError(error: any, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const msg = (error?.message || String(error || '')).toUpperCase();
  return (
    error?.code === 'CLIENT_DISCONNECTED' ||
    error?.code === 'STREAM_ABORTED' ||
    msg.includes('CLIENT_DISCONNECTED') ||
    msg.includes('STREAM_ABORTED')
  );
}

export function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(createStreamAbortError('Signal already aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(createStreamAbortError('Client disconnected or aborted request'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

const ProviderResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string()
    }),
    finish_reason: z.string().nullable().optional()
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional()
  }).optional().nullable()
});

async function fetchWithTimeout(url: string, options: any, timeout = 60000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

class ModelProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly isRetryable: boolean = true
  ) {
    super(message);
    this.name = 'ModelProviderError';
  }
}

function isKeyInvalidOrExhaustedError(error: any): boolean {
  const status = error?.status || error?.statusCode;
  const rawMsg = (error?.message || String(error)).toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    rawMsg.includes('api key not valid') ||
    rawMsg.includes('api_key_invalid') ||
    rawMsg.includes('invalid_api_key') ||
    rawMsg.includes('unauthorized') ||
    rawMsg.includes('permission denied')
  );
}

async function retry<T>(fn: () => Promise<T>, providerName: string, retries = 3, delay = 1200, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    throw createStreamAbortError('Request aborted before provider attempt');
  }
  try {
    return await raceWithAbort(fn(), signal);
  } catch (error: any) {
    if (isClientAbortError(error, signal)) {
      throw error;
    }
    const rawMsg = (error.message || String(error)).toLowerCase();
    const statusCode = error.statusCode || error.status || (error.message?.match(/\b(\d{3})\b/)?.[1] ? parseInt(error.message.match(/\b(\d{3})\b/)[1]) : undefined);

    // Fail-fast when all keys in the rotator pool are exhausted
    if (error.message === 'ALL_KEYS_EXHAUSTED' || rawMsg.includes('no valid api keys available')) {
      throw new ModelProviderError('All API keys for ' + providerName + ' are exhausted or invalid.', providerName, 401, false);
    }

    const isNotFound = statusCode === 404 || 
                       rawMsg.includes('not found') || 
                       rawMsg.includes('not_found') || 
                       rawMsg.includes('does not exist') || 
                       rawMsg.includes('is not supported') || 
                       rawMsg.includes('unsupported model');

    const isUnauthorized = statusCode === 401 || 
                           statusCode === 403 || 
                           rawMsg.includes('invalid_api_key') || 
                           rawMsg.includes('api_key_invalid') ||
                           rawMsg.includes('unauthorized') || 
                           rawMsg.includes('permission denied') || 
                           rawMsg.includes('api key not valid');

    const isBadRequest = !isUnauthorized &&
                         (statusCode === 400 || rawMsg.includes('bad request') || rawMsg.includes('invalid argument')) && 
                         !rawMsg.includes('rate limit') && 
                         !rawMsg.includes('too many requests') && 
                         !rawMsg.includes('quota');

    // Fail fast immediately on model/request syntax errors
    if (isNotFound || isBadRequest) {
      console.warn(`[${providerName}] Fail-fast triggered: non-retryable error (status: ${statusCode}): ${error.message}`);
      throw new ModelProviderError(error.message, providerName, statusCode, false);
    }

    // If a key failed with auth/invalid_api_key, rotate immediately to the next key in the pool if retries remain
    if (isUnauthorized && retries > 0) {
      console.warn(`[${providerName}] Invalid/unauthorized API key encountered, rotating to next key in pool (${retries} attempts left)...`);
      await new Promise(resolve => setTimeout(resolve, 150));
      return retry(fn, providerName, retries - 1, delay, signal);
    }

    // Retry transient errors: 429 (rate limits), 5xx (server errors), and network timeouts
    const isRateLimit = statusCode === 429 || rawMsg.includes('rate limit') || rawMsg.includes('quota') || rawMsg.includes('too many requests');
    const isServer5xx = statusCode && statusCode >= 500 && statusCode <= 599;
    const isNetworkOrTimeout = error.name === 'AbortError' || rawMsg.includes('timeout') || rawMsg.includes('econnreset') || rawMsg.includes('fetch failed');

    const canRetry = (isRateLimit || isServer5xx || isNetworkOrTimeout) && retries > 0;

    if (!canRetry) {
      throw new ModelProviderError(error.message, providerName, statusCode, false);
    }

    // Parse Retry-After header or delay if available
    let retryAfterMs = 0;
    if (error.headers && typeof error.headers.get === 'function') {
      const headerVal = error.headers.get('retry-after');
      if (headerVal) {
        const parsedSec = parseInt(headerVal, 10);
        if (!isNaN(parsedSec)) {
          retryAfterMs = Math.min(parsedSec * 1000, 10000);
        }
      }
    }

    const deterministicOffset = ((retries % 3) + 1) * 150;
    const waitTime = retryAfterMs > 0 ? retryAfterMs : Math.min((isRateLimit ? delay * 2 : delay) + deterministicOffset, 6000);

    console.warn(`[${providerName}] Retrying transient error (${retries} retries left) in ${Math.round(waitTime)}ms: ${error.message}`);
    await raceWithAbort(new Promise(resolve => setTimeout(resolve, waitTime)), signal);
    return retry(fn, providerName, retries - 1, waitTime * 1.5, signal);
  }
}

import { dbTelemetry } from './dbTelemetry';

let sharedApiKeysSnapshotCache: { data: Record<string, any> | null; fetchedAt: number } = {
  data: null,
  fetchedAt: 0
};
const API_KEYS_CACHE_TTL_MS = 60 * 1000;
const lastExhaustedWriteByProviderKey = new Map<string, number>();

export class DynamicKeyRotator {
  private providerName: string;
  private fallbackKeys: string[];
  private dbKeys: string[] = [];
  private currentIndex: number = 0;
  private lastFetchTime: number = 0;
  private exhaustedKeys: Set<string> = new Set();
  private configuredModel: string = '';
  private configuredFallbackModel: string = '';

  constructor(providerName: string, fallbackKeyString: string = '') {
    this.providerName = providerName;
    this.fallbackKeys = fallbackKeyString.split(',').map(k => k.trim()).filter(k => k.length > 0);
  }

  hasConfiguredModel(): boolean {
    return Boolean(this.configuredModel && this.configuredModel.trim().length > 0);
  }

  updateFromData(providerData: any) {
    if (!providerData) return;
    this.configuredModel = providerData.model || '';
    this.configuredFallbackModel = providerData.fallbackModel || '';
    if (Array.isArray(providerData.keys)) {
      this.dbKeys = providerData.keys
        .filter((k: any) => k && k.key && k.key.trim().length > 0)
        .map((k: any) => k.key.trim());
      for (const k of providerData.keys) {
        if (k && k.isExhausted) {
          this.exhaustedKeys.add(k.key.trim());
        } else if (k && k.key) {
          this.exhaustedKeys.delete(k.key.trim());
        }
      }
    }
    this.lastFetchTime = Date.now();
  }

  async fetchKeys(force: boolean = false) {
    const now = Date.now();
    if (!force && this.lastFetchTime > 0 && now - this.lastFetchTime < API_KEYS_CACHE_TTL_MS) {
      return;
    }
    try {
      let data: Record<string, any> | null = null;
      if (!force && sharedApiKeysSnapshotCache.fetchedAt > 0 && now - sharedApiKeysSnapshotCache.fetchedAt < API_KEYS_CACHE_TTL_MS) {
        data = sharedApiKeysSnapshotCache.data;
      } else {
        data = await getSystemSettingsDoc('api_keys', force);
        sharedApiKeysSnapshotCache = { data, fetchedAt: now };
      }

      if (data && data[this.providerName]) {
        this.configuredModel = data[this.providerName].model || '';
        this.configuredFallbackModel = data[this.providerName].fallbackModel || '';

        if (Array.isArray(data[this.providerName].keys)) {
          let needsUpdate = false;
          const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

          const updatedKeys = data[this.providerName].keys.map((k: any) => {
            if (k.isExhausted && k.exhaustedAt) {
              const exhaustedDate = new Date(k.exhaustedAt);
              const currentDate = new Date(now);
              const isNewDay =
                exhaustedDate.getUTCDate() !== currentDate.getUTCDate() ||
                exhaustedDate.getUTCMonth() !== currentDate.getUTCMonth() ||
                exhaustedDate.getUTCFullYear() !== currentDate.getUTCFullYear();
              const isPast24h = now - k.exhaustedAt > TWENTY_FOUR_HOURS;

              if (isNewDay || isPast24h) {
                needsUpdate = true;
                const { exhaustedAt, ...rest } = k;
                return { ...rest, isExhausted: false };
              }
            }
            return k;
          });

          if (needsUpdate) {
            data[this.providerName] = {
              ...data[this.providerName],
              keys: updatedKeys
            };
            await setSystemSettingsDoc('api_keys', { [this.providerName]: data[this.providerName] }, true);
          } else {
            dbTelemetry.recordSuppressedWrite('system_settings', 'unchanged_api_key_reset_check', 1);
          }

          this.dbKeys = data[this.providerName].keys
            .filter((k: any) => k.key && k.key.trim().length > 0)
            .map((k: any) => k.key.trim());

          for (const k of data[this.providerName].keys) {
            if (k.isExhausted) {
              this.exhaustedKeys.add(k.key.trim());
            } else {
              this.exhaustedKeys.delete(k.key.trim());
            }
          }
        }
      }
      this.lastFetchTime = now;
    } catch (e) {
      console.error(`Failed to fetch keys for ${this.providerName}`, e);
    }
  }

  async getModel(): Promise<string> {
    await this.fetchKeys(false);
    return (this.configuredModel || '').trim();
  }

  async getFallbackModel(): Promise<string> {
    await this.fetchKeys(false);
    const fallback = (this.configuredFallbackModel || '').trim();
    const primary = (this.configuredModel || '').trim();
    if (fallback && fallback.toLowerCase() === primary.toLowerCase()) {
      return '';
    }
    return fallback;
  }

  async getNextKey(): Promise<string> {
    await this.fetchKeys(false);
    const combinedKeys = this.dbKeys.length > 0
      ? [...this.dbKeys, ...this.fallbackKeys]
      : [...this.fallbackKeys];
    const allKeys = Array.from(new Set(combinedKeys));

    const activeKeys = allKeys.filter(k =>
      k &&
      k.length > 5 &&
      !k.includes('TODO') &&
      !k.includes('YOUR_') &&
      !k.includes('MY_GEMINI_API_KEY') &&
      !k.includes('PLACEHOLDER') &&
      !k.includes('<') &&
      !k.includes('>')
    );

    if (activeKeys.length === 0) {
      const msg = `No valid API keys available for provider: ${this.providerName}. ${allKeys.length > 0 ? 'The provided keys appear to be placeholders.' : 'Please configure them in the Admin Dashboard or environment variables.'}`;
      console.error(msg);
      throw new Error(msg);
    }

    let key = activeKeys[this.currentIndex % activeKeys.length];
    let attempts = 0;
    while (this.exhaustedKeys.has(key) && attempts < activeKeys.length) {
      this.currentIndex = (this.currentIndex + 1) % activeKeys.length;
      key = activeKeys[this.currentIndex % activeKeys.length];
      attempts++;
    }

    if (attempts >= activeKeys.length) {
      throw new Error('ALL_KEYS_EXHAUSTED');
    }

    this.currentIndex = (this.currentIndex + 1) % activeKeys.length;
    return key;
  }

  async markKeyExhausted(key: string) {
    const trimmedKey = (key || '').trim();
    const wasAlreadyExhaustedInMemory = this.exhaustedKeys.has(trimmedKey);
    this.exhaustedKeys.add(trimmedKey);

    // If this key is not a DB-managed key (e.g. env fallback key), or was already marked exhausted within 60s, skip DB write
    const throttleKey = `${this.providerName}:${trimmedKey}`;
    const lastWriteAt = lastExhaustedWriteByProviderKey.get(throttleKey) || 0;
    const now = Date.now();
    if (wasAlreadyExhaustedInMemory || !this.dbKeys.includes(trimmedKey) || now - lastWriteAt < API_KEYS_CACHE_TTL_MS) {
      dbTelemetry.recordSuppressedWrite('system_settings', 'duplicate_or_env_key_exhausted_write', 1);
      return;
    }

    try {
      const data = await getSystemSettingsDoc('api_keys', true);
      if (data && data[this.providerName] && Array.isArray(data[this.providerName].keys)) {
        let actuallyChanged = false;
        const updatedKeys = data[this.providerName].keys.map((k: any) => {
          if (k && typeof k.key === 'string' && k.key.trim() === trimmedKey) {
            if (!k.isExhausted) {
              actuallyChanged = true;
              return { ...k, isExhausted: true, exhaustedAt: now };
            }
          }
          return k;
        });
        if (actuallyChanged) {
          lastExhaustedWriteByProviderKey.set(throttleKey, now);
          const updatedProviderEntry = {
            ...data[this.providerName],
            keys: updatedKeys
          };
          await setSystemSettingsDoc('api_keys', { [this.providerName]: updatedProviderEntry }, true);
          if (sharedApiKeysSnapshotCache.data && sharedApiKeysSnapshotCache.data[this.providerName]) {
            sharedApiKeysSnapshotCache.data[this.providerName].keys = updatedKeys;
          }
        } else {
          dbTelemetry.recordSuppressedWrite('system_settings', 'key_already_marked_exhausted_in_db', 1);
        }
      }
    } catch (e) {
      console.error(`Failed to update exhausted state for ${this.providerName}`, e);
    }
  }
}

export class GeminiDirectProvider implements ModelProvider {
  private rotator: DynamicKeyRotator;
  public readonly name = 'gemini_direct';

  constructor(apiKey: string = '') {
    this.rotator = new DynamicKeyRotator('gemini_direct', apiKey);
  }

  public async getApiKey(): Promise<string> {
    return await this.rotator.getNextKey();
  }

  public async markKeyExhausted(key: string): Promise<void> {
    await this.rotator.markKeyExhausted(key);
  }

  private transformMessagesToGemini(messages: any[]) {
    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const transformContent = (content: any) => {
      if (typeof content === 'string') {
        return [{ text: content }];
      }
      if (Array.isArray(content)) {
        return content.map(part => {
          if (part.type === 'text') {
            return { text: part.text };
          }
          if (part.type === 'image_url' || part.type === 'file') {
            const url = part.image_url?.url || part.file_url?.url;
            if (!url) return { text: '' };
            const matches = url.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              return {
                inlineData: {
                  mimeType: matches[1],
                  data: matches[2]
                }
              };
            }
          }
          return { text: JSON.stringify(part) };
        });
      }
      return [{ text: String(content) }];
    };

    const contents = otherMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: transformContent(m.content)
    }));

    const systemInstruction = systemMessage ? 
      (typeof systemMessage.content === 'string' ? systemMessage.content : JSON.stringify(systemMessage.content)) : 
      undefined;

    return { contents, systemInstruction };
  }

  private ensureJsonInMessages(messages: any[]) {
    if (!messages || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    const jsonRequirement = " (Your response MUST be a valid JSON object. Ensure the word 'json' is present in your internal reasoning if applicable, and the output is strictly JSON.)";
    
    if (typeof lastMessage.content === 'string') {
      if (!lastMessage.content.toLowerCase().includes('json')) {
        lastMessage.content += jsonRequirement;
      }
    } else if (Array.isArray(lastMessage.content)) {
      const hasJson = lastMessage.content.some((part: any) => 
        part.type === 'text' && part.text.toLowerCase().includes('json')
      );
      if (!hasJson) {
        lastMessage.content.push({ type: 'text', text: jsonRequirement });
      }
    }
  }

  async generate(messages: any[], options: ModelCallOptions): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      let primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      if (!primaryModel) {
        await this.rotator.fetchKeys(true);
        primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      }
      if (!primaryModel) {
        throw new ModelProviderError(
          'No active primary model configured for Gemini. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const fallbackModel = (await this.rotator.getFallbackModel() || '').trim();
      const ai = new GoogleGenAI({ apiKey });
      const { contents, systemInstruction } = this.transformMessagesToGemini(messages);
      
      if (options.jsonMode) {
        this.ensureJsonInMessages(messages);
      }

      const executeGenerate = async (targetModel: string) => {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new ModelProviderError(`Gemini request timed out after 60s for model ${targetModel}`, 'gemini_direct', 408, true)), 60000)
        );

        const response = await raceWithAbort(Promise.race([
          ai.models.generateContent({
            model: targetModel,
            contents,
            config: {
              systemInstruction,
              responseMimeType: options.jsonMode ? "application/json" : "text/plain",
              temperature: options.temperature ?? 0.5,
              maxOutputTokens: 8192,
            }
          }),
          timeoutPromise
        ]), options?.signal);

        if (!response.text) throw new Error('Empty response from Gemini');
        const upstreamModel = typeof (response as any)?.modelVersion === 'string' && (response as any).modelVersion.trim()
          ? (response as any).modelVersion.trim()
          : null;

        return {
          text: response.text,
          usage: {
            promptTokens: response.usageMetadata?.promptTokenCount || 0,
            completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata?.totalTokenCount || 0
          },
          finishReason: 'stop',
          upstreamModel
        };
      };

      try {
        return await executeGenerate(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.status || error.statusCode;
        if (isKeyInvalidOrExhaustedError(error)) {
          await this.rotator.markKeyExhausted(apiKey);
        }
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429 || status === 503)) {
          console.warn(`[GeminiDirect] Primary model '${primaryModel}' failed with status ${status}. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeGenerate(fallbackModel);
          } catch (fallbackErr: any) {
            if (isClientAbortError(fallbackErr, options?.signal)) throw fallbackErr;
            if (isKeyInvalidOrExhaustedError(fallbackErr)) {
              await this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackErr;
          }
        }
        throw error;
      }
    }, 'GeminiDirect', 3, 1200, options?.signal);
  }

  async stream(messages: any[], options: ModelCallOptions, onChunk: (chunk: string) => void): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      let primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      if (!primaryModel) {
        await this.rotator.fetchKeys(true);
        primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      }
      if (!primaryModel) {
        throw new ModelProviderError(
          'No active primary model configured for Gemini. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const fallbackModel = (await this.rotator.getFallbackModel() || '').trim();
      const ai = new GoogleGenAI({ apiKey });
      if (options?.jsonMode) {
        this.ensureJsonInMessages(messages);
      }
      const { contents, systemInstruction } = this.transformMessagesToGemini(messages);

      const executeStream = async (targetModel: string) => {
        if (options?.signal?.aborted) {
          throw createStreamAbortError('Gemini stream aborted before start');
        }
        const result = await raceWithAbort(ai.models.generateContentStream({
          model: targetModel,
          contents,
          config: {
            systemInstruction,
            responseMimeType: options?.jsonMode ? "application/json" : "text/plain",
            temperature: options?.temperature ?? 0.5,
            maxOutputTokens: 8192,
          }
        }), options?.signal);

        let fullText = '';
        let upstreamModel: string | null = null;
        for await (const chunk of result) {
          if (options?.signal?.aborted) {
            throw createStreamAbortError('Gemini stream aborted mid-generation');
          }
          if (!upstreamModel && typeof (chunk as any)?.modelVersion === 'string' && (chunk as any).modelVersion.trim()) {
            upstreamModel = (chunk as any).modelVersion.trim();
          }
          const text = chunk.text;
          if (text) {
            fullText += text;
            onChunk(text);
          }
        }

        return {
          text: fullText,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
          upstreamModel
        };
      };

      try {
        return await executeStream(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.status || error.statusCode;
        if (isKeyInvalidOrExhaustedError(error)) {
          await this.rotator.markKeyExhausted(apiKey);
        }
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429 || status === 503)) {
          console.warn(`[GeminiDirect Stream] Primary model '${primaryModel}' failed with status ${status}. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeStream(fallbackModel);
          } catch (fallbackErr: any) {
            if (isClientAbortError(fallbackErr, options?.signal)) throw fallbackErr;
            if (isKeyInvalidOrExhaustedError(fallbackErr)) {
              await this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackErr;
          }
        }
        throw error;
      }
    }, 'GeminiDirect', 3, 1200, options?.signal);
  }
}



export class OpenRouterFreeProvider implements ModelProvider {
  private rotator: DynamicKeyRotator;
  public readonly name = 'openrouter_free';

  constructor(apiKey: string = '') {
    this.rotator = new DynamicKeyRotator('openrouter', apiKey);
  }

  private ensureJsonInMessages(messages: any[]) {
    if (!messages || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    const jsonRequirement = " (Your response MUST be a valid JSON object. Ensure the word 'json' is present in your internal reasoning if applicable, and the output is strictly JSON.)";
    
    if (typeof lastMessage.content === 'string') {
      if (!lastMessage.content.toLowerCase().includes('json')) {
        lastMessage.content += jsonRequirement;
      }
    } else if (Array.isArray(lastMessage.content)) {
      const hasJson = lastMessage.content.some((part: any) => 
        part.type === 'text' && part.text.toLowerCase().includes('json')
      );
      if (!hasJson) {
        lastMessage.content.push({ type: 'text', text: jsonRequirement });
      }
    }
  }

  async generate(messages: any[], options: ModelCallOptions): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      let model = (await this.rotator.getModel()).trim();
      if (!model) throw new Error('Primary model not configured for openrouter. Please configure it in settings.');
      let fallbackModel = (await this.rotator.getFallbackModel()).trim();
      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: apiKey,
        defaultHeaders: {
          "HTTP-Referer": "https://uniace.app",
          "X-Title": "UniAce Learning App",
        }
      });

      if (options.jsonMode) {
        this.ensureJsonInMessages(messages);
      }

      try {
        // Try free model first
        const response = await openai.chat.completions.create({
          model: model,
          messages: messages,
          max_tokens: 8192,
          temperature: options.temperature ?? 0.5,
          response_format: options.jsonMode ? { type: "json_object" } : undefined
        }, { signal: options?.signal });

        return {
          text: response.choices[0]?.message?.content || '',
          usage: {
            promptTokens: response.usage?.prompt_tokens || 0,
            completionTokens: response.usage?.completion_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0
          },
          finishReason: response.choices[0]?.finish_reason || 'stop',
          upstreamModel: typeof (response as any)?.model === 'string' && (response as any).model.trim() ? (response as any).model.trim() : null
        };
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        // If rate limited (429), fallback to paid model
        if (error.status === 429) {
          if (!fallbackModel) throw error;
          console.log(`[OpenRouterFree] Rate limit hit on ${model}, falling back to ${fallbackModel}`);
          try {
            const paidResponse = await openai.chat.completions.create({
              model: fallbackModel,
              messages: messages,
              max_tokens: 8192,
              temperature: options.temperature ?? 0.5,
              response_format: options.jsonMode ? { type: "json_object" } : undefined
            }, { signal: options?.signal });

            return {
              text: paidResponse.choices[0]?.message?.content || '',
              usage: {
                promptTokens: paidResponse.usage?.prompt_tokens || 0,
                completionTokens: paidResponse.usage?.completion_tokens || 0,
                totalTokens: paidResponse.usage?.total_tokens || 0
              },
              finishReason: paidResponse.choices[0]?.finish_reason || 'stop',
              upstreamModel: typeof (paidResponse as any)?.model === 'string' && (paidResponse as any).model.trim() ? (paidResponse as any).model.trim() : null
            };
          } catch (paidError: any) {
             if (isClientAbortError(paidError, options?.signal)) throw paidError;
             if (paidError.status === 401 || paidError.status === 403 || paidError.status === 429) {
               this.rotator.markKeyExhausted(apiKey);
             }
             throw paidError;
          }
        }
        
        if (error.status === 401 || error.status === 403) {
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'OpenRouterFree', 3, 1200, options?.signal);
  }

  async stream(messages: any[], options: ModelCallOptions, onChunk: (chunk: string) => void): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      let model = (await this.rotator.getModel()).trim();
      if (!model) throw new Error('Primary model not configured for openrouter. Please configure it in settings.');
      let fallbackModel = (await this.rotator.getFallbackModel()).trim();

      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: apiKey,
        defaultHeaders: {
          "HTTP-Referer": "https://uniace.app",
          "X-Title": "UniAce Learning App",
        }
      });

      try {
        // Try free model first
        const stream = await openai.chat.completions.create({
          model: model,
          messages: messages,
          max_tokens: 8192,
          temperature: 0.5,
          stream: true
        }, { signal: options?.signal });

        let fullText = '';
        let hasStartedThinking = false;
        let hasFinishedThinking = false;
        let upstreamModel: string | null = null;

        for await (const chunk of stream) {
          if (options?.signal?.aborted) {
            try { (stream as any).controller?.abort(); } catch {}
            throw createStreamAbortError('OpenRouter stream aborted mid-generation');
          }
          if (!upstreamModel && typeof (chunk as any)?.model === 'string' && (chunk as any).model.trim()) {
            upstreamModel = (chunk as any).model.trim();
          }
          const delta = chunk.choices[0]?.delta as any;
          const reasoning = delta?.reasoning_content || delta?.reasoning || '';
          const content = delta?.content || '';

          if (options?.complexity === 'high' && reasoning) {
            if (!hasStartedThinking) {
              onChunk('<think>');
              hasStartedThinking = true;
            }
            onChunk(reasoning);
          }
          if (content) {
            if (hasStartedThinking && !hasFinishedThinking) {
              onChunk('</think>');
              hasFinishedThinking = true;
            }
            fullText += content;
            onChunk(content);
          }
        }

        if (hasStartedThinking && !hasFinishedThinking) {
          onChunk('</think>');
          hasFinishedThinking = true;
        }

        return {
          text: fullText,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
          upstreamModel
        };
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        // If rate limited (429), fallback to paid model
        if (error.status === 429) {
          if (!fallbackModel) throw error;
          console.log(`[OpenRouterFree Stream] Rate limit hit on ${model}, falling back to ${fallbackModel}`);
          try {
            const paidStream = await openai.chat.completions.create({
              model: fallbackModel,
              messages: messages,
              max_tokens: 8192,
              temperature: options.temperature ?? 0.5,
              stream: true
            }, { signal: options?.signal });

            let fullText = '';
            let hasStartedThinking = false;
            let hasFinishedThinking = false;
            let paidUpstreamModel: string | null = null;

            for await (const chunk of paidStream) {
              if (options?.signal?.aborted) {
                try { (paidStream as any).controller?.abort(); } catch {}
                throw createStreamAbortError('OpenRouter fallback stream aborted mid-generation');
              }
              if (!paidUpstreamModel && typeof (chunk as any)?.model === 'string' && (chunk as any).model.trim()) {
                paidUpstreamModel = (chunk as any).model.trim();
              }
              const delta = chunk?.choices?.[0]?.delta as any;
              const reasoning = delta?.reasoning_content || delta?.reasoning || '';
              const content = delta?.content || '';

              if (options?.complexity === 'high' && reasoning) {
                if (!hasStartedThinking) {
                  onChunk('<think>');
                  hasStartedThinking = true;
                }
                onChunk(reasoning);
              }
              if (content) {
                if (hasStartedThinking && !hasFinishedThinking) {
                  onChunk('</think>');
                  hasFinishedThinking = true;
                }
                fullText += content;
                onChunk(content);
              }
            }

            if (hasStartedThinking && !hasFinishedThinking) {
              onChunk('</think>');
              hasFinishedThinking = true;
            }

            return {
              text: fullText,
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: 'stop',
              upstreamModel: paidUpstreamModel
            };
          } catch (paidError: any) {
            if (isClientAbortError(paidError, options?.signal)) throw paidError;
            if (paidError.status === 401 || paidError.status === 403 || paidError.status === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw paidError;
          }
        }

        if (error.status === 401 || error.status === 403) {
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'OpenRouterFree', 3, 1200, options?.signal);
  }
}

export class MistralProvider implements ModelProvider {
  private rotator: DynamicKeyRotator;
  public readonly name = 'mistral_direct';

  constructor(apiKey: string = '') {
    this.rotator = new DynamicKeyRotator('mistral_direct', apiKey);
  }

  private ensureJsonInMessages(messages: any[]) {
    if (!messages || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    const jsonRequirement = " (Your response MUST be a valid JSON object. Ensure the word 'json' is present in your internal reasoning if applicable, and the output is strictly JSON.)";
    
    if (typeof lastMessage.content === 'string') {
      if (!lastMessage.content.toLowerCase().includes('json')) {
        lastMessage.content += jsonRequirement;
      }
    } else if (Array.isArray(lastMessage.content)) {
      const hasJson = lastMessage.content.some((part: any) => 
        part.type === 'text' && part.text.toLowerCase().includes('json')
      );
      if (!hasJson) {
        lastMessage.content.push({ type: 'text', text: jsonRequirement });
      }
    }
  }

  async generate(messages: any[], options: ModelCallOptions): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      const primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      if (!primaryModel) {
        throw new ModelProviderError(
          'No active primary model configured for Mistral. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const fallbackModel = (await this.rotator.getFallbackModel() || '').trim();
      const mistral = new Mistral({ apiKey: apiKey });

      if (options.jsonMode) {
        this.ensureJsonInMessages(messages);
      }

      const executeGenerate = async (targetModel: string) => {
        const response = await raceWithAbort(mistral.chat.complete({
          model: targetModel,
          temperature: options.temperature ?? 0.5,
          maxTokens: 8192,
          messages: messages,
          responseFormat: options.jsonMode ? { type: "json_object" } : undefined
        }), options?.signal);

        return {
          text: response.choices?.[0]?.message?.content as string || '',
          usage: {
            promptTokens: response.usage?.promptTokens || 0,
            completionTokens: response.usage?.completionTokens || 0,
            totalTokens: response.usage?.totalTokens || 0
          },
          finishReason: response.choices?.[0]?.finishReason || 'stop',
          upstreamModel: typeof (response as any)?.model === 'string' && (response as any).model.trim() ? (response as any).model.trim() : null
        };
      };

      try {
        return await executeGenerate(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.status || error.statusCode;
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429)) {
          console.warn(`[Mistral] Primary model '${primaryModel}' failed with status ${status}. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeGenerate(fallbackModel);
          } catch (fallbackErr: any) {
            if (isClientAbortError(fallbackErr, options?.signal)) throw fallbackErr;
            const fbStatus = fallbackErr.status || fallbackErr.statusCode;
            if (fbStatus === 401 || fbStatus === 403 || fbStatus === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackErr;
          }
        }

        if (status === 401 || status === 403 || status === 429) {
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'Mistral', 3, 1200, options?.signal);
  }

  async stream(messages: any[], options: ModelCallOptions, onChunk: (chunk: string) => void): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      const primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      if (!primaryModel) {
        throw new ModelProviderError(
          'No active primary model configured for Mistral. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const fallbackModel = (await this.rotator.getFallbackModel() || '').trim();
      const mistral = new Mistral({ apiKey: apiKey });

      if (options.jsonMode) {
        this.ensureJsonInMessages(messages);
      }

      const executeStream = async (targetModel: string) => {
        if (options?.signal?.aborted) {
          throw createStreamAbortError('Mistral stream aborted before start');
        }
        const stream = await raceWithAbort(mistral.chat.stream({
          model: targetModel,
          temperature: options.temperature ?? 0.5,
          maxTokens: 8192,
          messages: messages,
          responseFormat: options.jsonMode ? { type: "json_object" } : undefined
        }), options?.signal);

        let fullText = '';
        let upstreamModel: string | null = null;
        for await (const chunk of stream) {
          if (options?.signal?.aborted) {
            throw createStreamAbortError('Mistral stream aborted mid-generation');
          }
          if (!upstreamModel && typeof (chunk as any)?.data?.model === 'string' && (chunk as any).data.model.trim()) {
            upstreamModel = (chunk as any).data.model.trim();
          }
          const content = chunk?.data?.choices?.[0]?.delta?.content as string || '';
          if (content) {
            fullText += content;
            onChunk(content);
          }
        }

        return {
          text: fullText,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
          upstreamModel
        };
      };

      try {
        return await executeStream(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.status || error.statusCode;
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429)) {
          console.warn(`[Mistral Stream] Primary model '${primaryModel}' failed with status ${status}. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeStream(fallbackModel);
          } catch (fallbackErr: any) {
            if (isClientAbortError(fallbackErr, options?.signal)) throw fallbackErr;
            const fbStatus = fallbackErr.status || fallbackErr.statusCode;
            if (fbStatus === 401 || fbStatus === 403 || fbStatus === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackErr;
          }
        }

        if (status === 401 || status === 403 || status === 429) {
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'Mistral', 3, 1200, options?.signal);
  }
}

export class GroqProvider implements ModelProvider {
  private rotator: DynamicKeyRotator;
  public readonly name = 'groq';

  constructor(apiKey: string = '') {
    this.rotator = new DynamicKeyRotator('groq', apiKey);
  }

  private ensureJsonInMessages(messages: any[]) {
    if (!messages || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    const jsonRequirement = " (Your response MUST be a valid JSON object. Ensure the word 'json' is present in your internal reasoning if applicable, and the output is strictly JSON.)";
    
    if (typeof lastMessage.content === 'string') {
      if (!lastMessage.content.toLowerCase().includes('json')) {
        lastMessage.content += jsonRequirement;
      }
    } else if (Array.isArray(lastMessage.content)) {
      const hasJson = lastMessage.content.some((part: any) => 
        part.type === 'text' && part.text.toLowerCase().includes('json')
      );
      if (!hasJson) {
        lastMessage.content.push({ type: 'text', text: jsonRequirement });
      }
    }
  }

  async generate(messages: any[], options: ModelCallOptions): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      const primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      if (!primaryModel) {
        throw new ModelProviderError(
          'No active primary model configured for Groq. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const fallbackModel = (await this.rotator.getFallbackModel() || '').trim();
      const groq = new Groq({ apiKey: apiKey, timeout: 60000 });

      // Truncate messages for Groq to avoid TPM limits (especially for 8b model)
      // Free tier TPM is often 6000. We target 5000 to be safe and leave room for response.
      const maxTokens = options.complexity === 'high' ? 5000 : 3000;
      const truncatedMessages = this.truncateMessages(messages, maxTokens);

      if (options.jsonMode) {
        this.ensureJsonInMessages(truncatedMessages);
      }

      const executeGenerate = async (targetModel: string) => {
        const response = await groq.chat.completions.create({
          model: targetModel,
          temperature: options.temperature ?? 0.5,
          max_tokens: options.complexity === 'high' ? 4096 : 2048,
          messages: truncatedMessages,
          response_format: options.jsonMode ? { type: "json_object" } : undefined
        }, { signal: options?.signal });

        return {
          text: response.choices[0]?.message?.content || '',
          usage: {
            promptTokens: response.usage?.prompt_tokens || 0,
            completionTokens: response.usage?.completion_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0
          },
          finishReason: response.choices[0]?.finish_reason || 'stop',
          upstreamModel: typeof (response as any)?.model === 'string' && (response as any).model.trim() ? (response as any).model.trim() : null
        };
      };

      try {
        return await executeGenerate(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.status || error.statusCode;
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429)) {
          console.warn(`[Groq] Primary model '${primaryModel}' failed with status ${status}. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeGenerate(fallbackModel);
          } catch (fallbackErr: any) {
            if (isClientAbortError(fallbackErr, options?.signal)) throw fallbackErr;
            const fbStatus = fallbackErr.status || fallbackErr.statusCode;
            if (fbStatus === 401 || fbStatus === 403 || fbStatus === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackErr;
          }
        }

        if (status === 401 || status === 403 || status === 429) {
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'Groq', 3, 1200, options?.signal);
  }

  async stream(messages: any[], options: ModelCallOptions, onChunk: (chunk: string) => void): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      const primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      if (!primaryModel) {
        throw new ModelProviderError(
          'No active primary model configured for Groq. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const fallbackModel = (await this.rotator.getFallbackModel() || '').trim();
      const groq = new Groq({ apiKey: apiKey, timeout: 60000 });

      // Truncate messages for Groq to avoid TPM limits
      const maxTokens = options.complexity === 'high' ? 4000 : 2500;
      const truncatedMessages = this.truncateMessages(messages, maxTokens);
      if (options.jsonMode) {
        this.ensureJsonInMessages(truncatedMessages);
      }

      const executeStream = async (targetModel: string) => {
        const stream = await groq.chat.completions.create({
          model: targetModel,
          temperature: options.temperature ?? 0.5,
          max_tokens: options.complexity === 'high' ? 4096 : 2048,
          messages: truncatedMessages,
          stream: true
        }, { signal: options?.signal });

        let fullText = '';
        let hasStartedThinking = false;
        let hasFinishedThinking = false;
        let upstreamModel: string | null = null;

        for await (const chunk of stream) {
          if (options?.signal?.aborted) {
            try { (stream as any).controller?.abort(); } catch {}
            throw createStreamAbortError('Groq stream aborted mid-generation');
          }
          if (!upstreamModel && typeof (chunk as any)?.model === 'string' && (chunk as any).model.trim()) {
            upstreamModel = (chunk as any).model.trim();
          }
          const delta = chunk?.choices?.[0]?.delta as any;
          const reasoning = delta?.reasoning_content || delta?.reasoning || '';
          const content = delta?.content || '';

          if (options?.complexity === 'high' && reasoning) {
            if (!hasStartedThinking) {
              onChunk('<think>');
              hasStartedThinking = true;
            }
            onChunk(reasoning);
          }
          if (content) {
            if (hasStartedThinking && !hasFinishedThinking) {
              onChunk('</think>');
              hasFinishedThinking = true;
            }
            fullText += content;
            onChunk(content);
          }
        }

        if (hasStartedThinking && !hasFinishedThinking) {
          onChunk('</think>');
          hasFinishedThinking = true;
        }

        return {
          text: fullText,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
          upstreamModel
        };
      };

      try {
        return await executeStream(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.status || error.statusCode;
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429)) {
          console.warn(`[Groq Stream] Primary model '${primaryModel}' failed with status ${status}. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeStream(fallbackModel);
          } catch (fallbackErr: any) {
            if (isClientAbortError(fallbackErr, options?.signal)) throw fallbackErr;
            const fbStatus = fallbackErr.status || fallbackErr.statusCode;
            if (fbStatus === 401 || fbStatus === 403 || fbStatus === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackErr;
          }
        }

        if (status === 401 || status === 403 || status === 429) {
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'Groq', 3, 1200, options?.signal);
  }

  private truncateMessages(messages: any[], maxTokens: number): any[] {
    if (!messages || messages.length === 0) return [];
    
    // Conservative estimate: 1 token ≈ 3.5 characters
    let currentTokens = 0;
    const truncated = [];
    
    // Always keep the system message if it exists
    const systemMessage = messages.find(m => m.role === 'system');
    let systemTokens = 0;
    if (systemMessage) {
      systemTokens = Math.ceil((systemMessage.content?.length || 0) / 3.5);
      // If system message alone is too big, truncate it (rare but possible)
      if (systemTokens > maxTokens * 0.4) {
        const allowedChars = Math.floor(maxTokens * 0.4 * 3.5);
        systemMessage.content = systemMessage.content.substring(0, allowedChars) + "... [truncated]";
        systemTokens = Math.ceil(systemMessage.content.length / 3.5);
      }
      currentTokens += systemTokens;
    }

    // Process other messages from newest to oldest
    const otherMessages = messages.filter(m => m.role !== 'system');
    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      let estimatedTokens = Math.ceil(content.length / 3.5);
      
      // If the very first (newest) message is too large, truncate it
      if (i === otherMessages.length - 1 && currentTokens + estimatedTokens > maxTokens) {
        const allowedTokens = maxTokens - currentTokens;
        if (allowedTokens > 100) {
          const allowedChars = Math.floor(allowedTokens * 3.5);
          content = content.substring(0, allowedChars) + "... [truncated]";
          estimatedTokens = Math.ceil(content.length / 3.5);
          msg.content = content;
        } else {
          // Too little space left, skip this message
          continue;
        }
      }

      if (currentTokens + estimatedTokens > maxTokens) {
        break;
      }
      
      currentTokens += estimatedTokens;
      truncated.unshift(msg);
    }
    
    if (systemMessage) {
      truncated.unshift(systemMessage);
    }
    
    return truncated;
  }
}

export class CohereProvider implements ModelProvider {
  private rotator: DynamicKeyRotator;
  public readonly name = 'cohere';

  constructor(apiKey: string = '') {
    this.rotator = new DynamicKeyRotator('cohere', apiKey);
  }

  private ensureJsonInMessages(messages: any[]) {
    if (!messages || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    const jsonRequirement = " (Your response MUST be a valid JSON object. Ensure the word 'json' is present in your internal reasoning if applicable, and the output is strictly JSON.)";
    
    if (typeof lastMessage.content === 'string') {
      if (!lastMessage.content.toLowerCase().includes('json')) {
        lastMessage.content += jsonRequirement;
      }
    } else if (Array.isArray(lastMessage.content)) {
      const hasJson = lastMessage.content.some((part: any) => 
        part.type === 'text' && part.text.toLowerCase().includes('json')
      );
      if (!hasJson) {
        lastMessage.content.push({ type: 'text', text: jsonRequirement });
      }
    }
  }

  async generate(messages: any[], options: ModelCallOptions): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      const primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      if (!primaryModel) {
        throw new ModelProviderError(
          'No active primary model configured for Cohere. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const fallbackModel = (await this.rotator.getFallbackModel() || '').trim();
      const cohere = new CohereClient({ token: apiKey });
      
      if (options.jsonMode) {
        this.ensureJsonInMessages(messages);
      }

      const chatHistory = messages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'CHATBOT' : (m.role === 'system' ? 'SYSTEM' : 'USER'),
        message: m.content
      }));
      const lastMessage = messages[messages.length - 1].content;

      const executeGenerate = async (targetModel: string) => {
        const response = await raceWithAbort(cohere.chat({
          model: targetModel,
          message: lastMessage,
          chatHistory: chatHistory as any,
          temperature: options.temperature ?? 0.5,
        }), options?.signal);

        return {
          text: response.text,
          usage: {
            promptTokens: response.meta?.billedUnits?.inputTokens || 0,
            completionTokens: response.meta?.billedUnits?.outputTokens || 0,
            totalTokens: (response.meta?.billedUnits?.inputTokens || 0) + (response.meta?.billedUnits?.outputTokens || 0)
          },
          finishReason: response.finishReason || 'COMPLETE',
          upstreamModel: typeof (response as any)?.meta?.model === 'string' ? (response as any).meta.model : null
        };
      };

      try {
        return await executeGenerate(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.statusCode || error.status;
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429)) {
          console.warn(`[Cohere] Primary model '${primaryModel}' failed with status ${status}. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeGenerate(fallbackModel);
          } catch (fallbackErr: any) {
            if (isClientAbortError(fallbackErr, options?.signal)) throw fallbackErr;
            const fbStatus = fallbackErr.statusCode || fallbackErr.status;
            if (fbStatus === 401 || fbStatus === 403 || fbStatus === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackErr;
          }
        }

        if (status === 401 || status === 403 || status === 429) {
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'Cohere', 3, 1200, options?.signal);
  }

  async stream(messages: any[], options: ModelCallOptions, onChunk: (chunk: string) => void): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      const primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      if (!primaryModel) {
        throw new ModelProviderError(
          'No active primary model configured for Cohere. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const fallbackModel = (await this.rotator.getFallbackModel() || '').trim();
      const cohere = new CohereClient({ token: apiKey });
      
      const chatHistory = messages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'CHATBOT' : (m.role === 'system' ? 'SYSTEM' : 'USER'),
        message: m.content
      }));
      const lastMessage = messages[messages.length - 1].content;

      const executeStream = async (targetModel: string) => {
        if (options?.signal?.aborted) {
          throw createStreamAbortError('Cohere stream aborted before start');
        }
        const stream = await raceWithAbort(cohere.chatStream({
          model: targetModel,
          message: lastMessage,
          chatHistory: chatHistory as any,
          temperature: options.temperature ?? 0.5,
        }), options?.signal);

        let fullText = '';
        let upstreamModel: string | null = null;
        for await (const chunk of stream) {
          if (options?.signal?.aborted) {
            throw createStreamAbortError('Cohere stream aborted mid-generation');
          }
          if (!upstreamModel && typeof (chunk as any)?.response?.meta?.model === 'string') {
            upstreamModel = (chunk as any).response.meta.model;
          }
          if (chunk.eventType === 'text-generation') {
            fullText += chunk.text;
            onChunk(chunk.text);
          }
        }

        return {
          text: fullText,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'COMPLETE',
          upstreamModel
        };
      };

      try {
        return await executeStream(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.statusCode || error.status;
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429)) {
          console.warn(`[Cohere Stream] Primary model '${primaryModel}' failed with status ${status}. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeStream(fallbackModel);
          } catch (fallbackErr: any) {
            if (isClientAbortError(fallbackErr, options?.signal)) throw fallbackErr;
            const fbStatus = fallbackErr.statusCode || fallbackErr.status;
            if (fbStatus === 401 || fbStatus === 403 || fbStatus === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackErr;
          }
        }

        if (status === 401 || status === 403 || status === 429) {
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'Cohere', 3, 1200, options?.signal);
  }
}

export class HuggingFaceProvider implements ModelProvider {
  private rotator: DynamicKeyRotator;
  public readonly name = 'huggingface';

  constructor(apiKey: string = '') {
    this.rotator = new DynamicKeyRotator('huggingface', apiKey);
  }

  async generate(messages: any[], options: ModelCallOptions): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      const primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      if (!primaryModel) {
        throw new ModelProviderError(
          'No active primary model configured for Hugging Face. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const fallbackModel = (await this.rotator.getFallbackModel() || '').trim();
      const hf = new HfInference(apiKey);

      const executeGenerate = async (targetModel: string) => {
        try {
          const response = await raceWithAbort(hf.chatCompletion({
            model: targetModel,
            messages: messages,
            max_tokens: 4096,
            temperature: options.temperature ?? 0.5
          }), options?.signal);

          return {
            text: response.choices[0]?.message?.content || '',
            usage: {
              promptTokens: response.usage?.prompt_tokens || 0,
              completionTokens: response.usage?.completion_tokens || 0,
              totalTokens: response.usage?.total_tokens || 0
            },
            finishReason: response.choices[0]?.finish_reason || 'stop',
            upstreamModel: typeof (response as any)?.model === 'string' && (response as any).model.trim() ? (response as any).model.trim() : null
          };
        } catch (error: any) {
          if (isClientAbortError(error, options?.signal)) throw error;
          const errMsg = error?.message || '';
          if (errMsg.includes('Unexpected token') && (errMsg.includes('<') || errMsg.includes('doctype') || errMsg.includes('JSON'))) {
            throw new Error(`Hugging Face returned an HTML error page (404 Not Found) instead of JSON. This means the model ID "${targetModel}" is invalid or is not deployed on Hugging Face's Serverless Inference API.`);
          }
          throw error;
        }
      };

      try {
        return await executeGenerate(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.status || error.statusCode;
        const isQuotaError = status === 401 || status === 403 || status === 429 || 
                           error.message?.toLowerCase().includes('limit') ||
                           error.message?.toLowerCase().includes('quota') ||
                           error.message?.toLowerCase().includes('http error');
        
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429 || isQuotaError)) {
          console.warn(`[HuggingFace] Primary model '${primaryModel}' failed. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeGenerate(fallbackModel);
          } catch (fallbackErr: any) {
            if (isClientAbortError(fallbackErr, options?.signal)) throw fallbackErr;
            const fbStatus = fallbackErr.status || fallbackErr.statusCode;
            if (fbStatus === 401 || fbStatus === 403 || fbStatus === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackErr;
          }
        }

        if (isQuotaError) {
          console.warn(`[HuggingFace] Marking key as exhausted due to error: ${error.message}`);
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'HuggingFace', 3, 1200, options?.signal);
  }

  async stream(messages: any[], options: ModelCallOptions, onChunk: (chunk: string) => void): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      const primaryModel = (options.model || await this.rotator.getModel() || '').trim();
      if (!primaryModel) {
        throw new ModelProviderError(
          'No active primary model configured for Hugging Face. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const fallbackModel = (await this.rotator.getFallbackModel() || '').trim();
      const hf = new HfInference(apiKey);

      const executeStream = async (targetModel: string) => {
        try {
          if (options?.signal?.aborted) {
            throw createStreamAbortError('HuggingFace stream aborted before start');
          }
          const stream = hf.chatCompletionStream({
            model: targetModel,
            messages: messages,
            max_tokens: 4096,
            temperature: options.temperature ?? 0.5
          });

          let fullText = '';
          let upstreamModel: string | null = null;
          for await (const chunk of stream) {
            if (options?.signal?.aborted) {
              throw createStreamAbortError('HuggingFace stream aborted mid-generation');
            }
            if (!upstreamModel && typeof (chunk as any)?.model === 'string' && (chunk as any).model.trim()) {
              upstreamModel = (chunk as any).model.trim();
            }
            const content = chunk?.choices?.[0]?.delta?.content || '';
            if (content) {
              fullText += content;
              onChunk(content);
            }
          }

          return {
            text: fullText,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: 'stop',
            upstreamModel
          };
        } catch (error: any) {
          if (isClientAbortError(error, options?.signal)) throw error;
          const errMsg = error?.message || '';
          if (errMsg.includes('Unexpected token') && (errMsg.includes('<') || errMsg.includes('doctype') || errMsg.includes('JSON'))) {
            throw new Error(`Hugging Face returned an HTML error page (404 Not Found) instead of JSON. This means the model ID "${targetModel}" is invalid or is not deployed on Hugging Face's Serverless Inference API.`);
          }
          throw error;
        }
      };

      try {
        return await executeStream(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.status || error.statusCode;
        const isQuotaError = status === 401 || status === 403 || status === 429 || 
                           error.message?.toLowerCase().includes('limit') ||
                           error.message?.toLowerCase().includes('quota') ||
                           error.message?.toLowerCase().includes('http error');
        
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429 || isQuotaError)) {
          console.warn(`[HuggingFace Stream] Primary model '${primaryModel}' failed. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeStream(fallbackModel);
          } catch (fallbackErr: any) {
            if (isClientAbortError(fallbackErr, options?.signal)) throw fallbackErr;
            const fbStatus = fallbackErr.status || fallbackErr.statusCode;
            if (fbStatus === 401 || fbStatus === 403 || fbStatus === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackErr;
          }
        }

        if (isQuotaError) {
          console.warn(`[HuggingFace] Marking key as exhausted due to error: ${error.message}`);
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'HuggingFace', 3, 1200, options?.signal);
  }
}

export class NvidiaProvider implements ModelProvider {
  private rotator: DynamicKeyRotator;
  public readonly name = 'nvidia';

  constructor(apiKey: string = '') {
    this.rotator = new DynamicKeyRotator('nvidia', apiKey);
  }

  private ensureJsonInMessages(messages: any[]) {
    if (!messages || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    const jsonRequirement = " (Your response MUST be a valid JSON object. Ensure the output is strictly valid JSON with no markdown backticks unless part of JSON strings.)";
    
    if (typeof lastMessage.content === 'string') {
      if (!lastMessage.content.toLowerCase().includes('json')) {
        lastMessage.content += jsonRequirement;
      }
    } else if (Array.isArray(lastMessage.content)) {
      const hasJson = lastMessage.content.some((part: any) => 
        part.type === 'text' && part.text.toLowerCase().includes('json')
      );
      if (!hasJson) {
        lastMessage.content.push({ type: 'text', text: jsonRequirement });
      }
    }
  }

  private normalizeNvidiaModel(model: string): string {
    if (!model) return '';
    const trimmed = model.trim();
    // Keep exact format if it already includes prefix or vendor slash
    if (trimmed.includes('/')) return trimmed;
    return `nvidia/${trimmed}`;
  }

  async generate(messages: any[], options: ModelCallOptions): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      const rawPrimary = (options?.model || await this.rotator.getModel() || '').trim();
      if (!rawPrimary) {
        throw new ModelProviderError(
          'No active primary model configured for NVIDIA NIM. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const primaryModel = this.normalizeNvidiaModel(rawPrimary);
      const rawFallback = (await this.rotator.getFallbackModel() || '').trim();
      const fallbackModel = rawFallback ? this.normalizeNvidiaModel(rawFallback) : '';
      
      const openai = new OpenAI({
        baseURL: "https://integrate.api.nvidia.com/v1",
        apiKey: apiKey,
        timeout: 60000,
      });

      if (options.jsonMode) {
        this.ensureJsonInMessages(messages);
      }

      const executeGenerate = async (targetModel: string) => {
        const response = await openai.chat.completions.create({
          model: targetModel,
          messages: messages,
          max_tokens: 8192,
          temperature: options.temperature ?? 0.5,
          response_format: options.jsonMode ? { type: "json_object" } : undefined
        }, { signal: options?.signal });

        return {
          text: response.choices[0]?.message?.content || '',
          usage: {
            promptTokens: response.usage?.prompt_tokens || 0,
            completionTokens: response.usage?.completion_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0
          },
          finishReason: response.choices[0]?.finish_reason || 'stop',
          upstreamModel: typeof (response as any)?.model === 'string' && (response as any).model.trim() ? (response as any).model.trim() : null
        };
      };

      try {
        return await executeGenerate(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.status || error.statusCode;
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429)) {
          console.warn(`[Nvidia] Primary model '${primaryModel}' failed with status ${status}. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeGenerate(fallbackModel);
          } catch (fallbackError: any) {
            if (isClientAbortError(fallbackError, options?.signal)) throw fallbackError;
            const fbStatus = fallbackError.status || fallbackError.statusCode;
            if (fbStatus === 401 || fbStatus === 403 || fbStatus === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackError;
          }
        }
        if (status === 401 || status === 403 || status === 429) {
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'Nvidia', 3, 1200, options?.signal);
  }

  async stream(messages: any[], options: ModelCallOptions, onChunk: (chunk: string) => void): Promise<ModelResponse> {
    return retry(async () => {
      const apiKey = await this.rotator.getNextKey();
      const rawPrimary = (options?.model || await this.rotator.getModel() || '').trim();
      if (!rawPrimary) {
        throw new ModelProviderError(
          'No active primary model configured for NVIDIA NIM. Please configure and select an active model in Admin API Key Manager.',
          this.name,
          500,
          false
        );
      }
      const primaryModel = this.normalizeNvidiaModel(rawPrimary);
      const rawFallback = (await this.rotator.getFallbackModel() || '').trim();
      const fallbackModel = rawFallback ? this.normalizeNvidiaModel(rawFallback) : '';

      const openai = new OpenAI({
        baseURL: "https://integrate.api.nvidia.com/v1",
        apiKey: apiKey,
        timeout: 60000,
      });

      if (options.jsonMode) {
        this.ensureJsonInMessages(messages);
      }

      const executeStream = async (targetModel: string) => {
        const stream = await openai.chat.completions.create({
          model: targetModel,
          messages: messages,
          max_tokens: 8192,
          temperature: options.temperature ?? 0.5,
          stream: true,
          response_format: options.jsonMode ? { type: "json_object" } : undefined
        }, { signal: options?.signal });

        let fullText = '';
        let hasStartedThinking = false;
        let hasFinishedThinking = false;
        let upstreamModel: string | null = null;

        for await (const chunk of stream) {
          if (options?.signal?.aborted) {
            try { (stream as any).controller?.abort(); } catch {}
            throw createStreamAbortError('Nvidia stream aborted mid-generation');
          }
          if (!upstreamModel && typeof (chunk as any)?.model === 'string' && (chunk as any).model.trim()) {
            upstreamModel = (chunk as any).model.trim();
          }
          const delta = chunk?.choices?.[0]?.delta as any;
          const reasoning = delta?.reasoning_content || delta?.reasoning || '';
          const content = delta?.content || '';
          
          if (options?.complexity === 'high' && reasoning) {
            if (!hasStartedThinking) {
              onChunk('<think>');
              hasStartedThinking = true;
            }
            onChunk(reasoning);
          }
          if (content) {
            if (hasStartedThinking && !hasFinishedThinking) {
              onChunk('</think>');
              hasFinishedThinking = true;
            }
            fullText += content;
            onChunk(content);
          }
        }

        if (hasStartedThinking && !hasFinishedThinking) {
          onChunk('</think>');
          hasFinishedThinking = true;
        }

        return {
          text: fullText,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
          upstreamModel
        };
      };

      try {
        return await executeStream(primaryModel);
      } catch (error: any) {
        if (isClientAbortError(error, options?.signal)) throw error;
        const status = error.status || error.statusCode;
        if (fallbackModel && fallbackModel !== primaryModel && (status === 404 || status === 429)) {
          console.warn(`[Nvidia Stream] Primary model '${primaryModel}' failed with status ${status}. Attempting configured fallback '${fallbackModel}'...`);
          try {
            return await executeStream(fallbackModel);
          } catch (fallbackError: any) {
            if (isClientAbortError(fallbackError, options?.signal)) throw fallbackError;
            const fbStatus = fallbackError.status || fallbackError.statusCode;
            if (fbStatus === 401 || fbStatus === 403 || fbStatus === 429) {
              this.rotator.markKeyExhausted(apiKey);
            }
            throw fallbackError;
          }
        }
        if (status === 401 || status === 403 || status === 429) {
          this.rotator.markKeyExhausted(apiKey);
        }
        throw error;
      }
    }, 'Nvidia', 3, 1200, options?.signal);
  }
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private readonly threshold = 2; // Trip after 2 consecutive failures
  private readonly resetTimeout = 120000; // 2 minutes cooldown
  private trippedReason = '';

  constructor(private provider: ModelProvider) {}

  get name() {
    return this.provider.name;
  }

  getReason() {
    return this.trippedReason;
  }

  async generate(messages: any[], options: ModelCallOptions): Promise<ModelResponse> {
    if (this.isOpen()) {
      throw new ModelProviderError(`Circuit breaker OPEN for ${this.provider.name} (${this.trippedReason || 'in cooldown'})`, this.provider.name, 503, false);
    }

    try {
      const response = await this.provider.generate(messages, options);
      this.onSuccess();
      return response;
    } catch (error) {
      if (!isClientAbortError(error, options?.signal)) {
        this.onFailure(error);
      }
      throw error;
    }
  }

  async stream(messages: any[], options: ModelCallOptions, onChunk: (chunk: string) => void): Promise<ModelResponse> {
    if (this.isOpen()) {
      throw new ModelProviderError(`Circuit breaker OPEN for ${this.provider.name} (${this.trippedReason || 'in cooldown'})`, this.provider.name, 503, false);
    }

    try {
      const response = await this.provider.stream(messages, options, onChunk);
      this.onSuccess();
      return response;
    } catch (error) {
      if (!isClientAbortError(error, options?.signal)) {
        this.onFailure(error);
      }
      throw error;
    }
  }

  public isOpen(): boolean {
    if (this.failures >= this.threshold) {
      if (this.trippedReason?.includes('No active primary model')) {
        const rotator = (this.provider as any)?.rotator;
        if (rotator && typeof rotator.hasConfiguredModel === 'function' && rotator.hasConfiguredModel()) {
          console.log(`[CircuitBreaker] Auto-resetting breaker for ${this.provider.name} because model is now configured.`);
          this.reset();
          return false;
        }
      }
      const now = Date.now();
      if (now - this.lastFailureTime > this.resetTimeout) {
        // Half-open state
        this.failures = this.threshold - 1;
        return false;
      }
      return true;
    }
    return false;
  }

  public getStatus() {
    const open = this.isOpen();
    return {
      name: this.provider.name,
      isOpen: open,
      state: open ? 'OPEN' : (this.failures > 0 ? 'HALF_OPEN' : 'CLOSED'),
      failures: this.failures,
      threshold: this.threshold,
      trippedReason: this.trippedReason,
      cooldownRemainingSeconds: open ? Math.max(0, Math.round((this.resetTimeout - (Date.now() - this.lastFailureTime)) / 1000)) : 0
    };
  }

  public reset() {
    this.failures = 0;
    this.trippedReason = '';
    this.lastFailureTime = 0;
  }

  private onSuccess() {
    this.failures = 0;
    this.trippedReason = '';
  }

  private onFailure(error?: any) {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.trippedReason = error?.message || 'Consecutive failures';
    console.warn(`[CircuitBreaker] Recorded failure ${this.failures}/${this.threshold} for ${this.provider.name}: ${this.trippedReason}`);
  }
}
