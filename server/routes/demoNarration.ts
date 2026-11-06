import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { z } from 'zod';
import { getCloudinaryMediaConfig } from '../services/cloudinaryCredentials.js';
import {
  createCloudinaryVideoUploadSignature,
  verifyCloudinaryVideoUpload,
  downloadCloudinaryAuthenticatedAsset,
  uploadCloudinaryLocalAsset,
  fetchCloudinaryAuthenticatedAsset,
  deleteCloudinaryAsset,
  deleteCloudinaryAssetByPublicId,
  type CloudinaryAsset
} from '../services/cloudinaryDemoStudio.js';
import { getSystemSettingsDoc, setSystemSettingsDoc } from '../systemConfigStore.js';
import {
  buildSrtFromAlignment,
  sanitizeDemoVideoFileName,
  type ElevenLabsAlignment
} from '../services/demoNarration.js';
import {
  clearDemoNarrationApiKey,
  getDemoNarrationApiKey,
  getDemoNarrationCredentialStatus,
  saveDemoNarrationApiKey
} from '../services/demoNarrationCredentials.js';

const configuredUploadBytes = Number(process.env.DEMO_NARRATION_MAX_UPLOAD_BYTES);
const MAX_UPLOAD_BYTES = Number.isSafeInteger(configuredUploadBytes) && configuredUploadBytes > 0
  ? configuredUploadBytes
  : 250 * 1024 * 1024;
const configuredScriptCharacters = Number(process.env.DEMO_NARRATION_MAX_SCRIPT_CHARACTERS);
const MAX_SCRIPT_CHARACTERS = Number.isSafeInteger(configuredScriptCharacters) && configuredScriptCharacters >= 100
  ? configuredScriptCharacters
  : 20000;
const configuredDurationSeconds = Number(process.env.DEMO_NARRATION_MAX_DURATION_SECONDS);
const MAX_DURATION_SECONDS = Number.isSafeInteger(configuredDurationSeconds) && configuredDurationSeconds > 0
  ? configuredDurationSeconds
  : 15 * 60;
const UPLOAD_TTL_MS = 20 * 60 * 1000;
const JOB_TTL_MS = 30 * 60 * 1000;
const DOWNLOAD_TICKET_TTL_MS = 2 * 60 * 1000;
const TEMP_ROOT = path.join(os.tmpdir(), 'uniace-demo-narration');

type JobStatus = 'generating_audio' | 'narration_ready' | 'rendering' | 'completed' | 'failed' | 'cancelled';

interface UploadRecord {
  id: string;
  ownerId: string;
  folder: string;
  sourcePath: string;
  originalName: string;
  mimeType: string;
  expectedSize: number;
  receivedBytes: number;
  complete: boolean;
  cloudinaryFolder: string;
  cloudinaryPublicId: string;
  cloudinaryAsset: CloudinaryAsset | null;
  expiresAt: number;
}

interface NarrationJob {
  id: string;
  ownerId: string;
  folder: string;
  sourcePath: string;
  cloudinaryFolder: string;
  sourceAsset: CloudinaryAsset | null;
  audioAsset: CloudinaryAsset | null;
  outputAsset: CloudinaryAsset | null;
  subtitleAsset: CloudinaryAsset | null;
  audioPath: string;
  subtitlePath: string | null;
  outputPath: string;
  originalName: string;
  safeBaseName: string;
  script: string;
  modelId: string;
  voiceId: string;
  originalAudioMode: 'mix' | 'duck' | 'narration_only';
  originalAudioVolume: number;
  narrationVolume: number;
  subtitlesEnabled: boolean;
  aspectRatio: 'source' | '16:9' | '9:16' | '1:1';
  resolution: 'source' | '720p' | '1080p';
  status: JobStatus;
  stage: string;
  statusMessage: string;
  progressPercent: number | null;
  error: string | null;
  characterCost: string | null;
  requestId: string | null;
  durationSeconds: number | null;
  outputBytes: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
  createdAt: string;
  expiresAt: number;
  abortController: AbortController | null;
  child: ChildProcessWithoutNullStreams | null;
  downloadTicketHash: string | null;
  downloadTicketExpiresAt: number;
  cleanupStarted: boolean;
}

const uploads = new Map<string, UploadRecord>();
const jobs = new Map<string, NarrationJob>();
const UploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(120),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES)
}).strict();

const VoiceSettingsSchema = z.object({
  stability: z.number().min(0).max(1).optional(),
  similarity_boost: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  use_speaker_boost: z.boolean().optional(),
  speed: z.number().min(0.7).max(1.2).optional()
}).strict().refine((settings) => Object.keys(settings).length > 0, {
  message: 'At least one provider-supported voice setting is required when custom settings are supplied.'
});

const CreateJobSchema = z.object({
  uploadId: z.string().uuid(),
  voiceId: z.string().trim().min(1).max(180),
  modelId: z.string().trim().min(1).max(120),
  script: z.string().trim().min(5).max(MAX_SCRIPT_CHARACTERS),
  voiceSettings: VoiceSettingsSchema.optional(),
  originalAudioMode: z.enum(['mix', 'duck', 'narration_only']),
  originalAudioVolume: z.number().min(0).max(1),
  narrationVolume: z.number().min(0.1).max(2),
  subtitles: z.boolean(),
  aspectRatio: z.enum(['source', '16:9', '9:16', '1:1']),
  resolution: z.enum(['source', '720p', '1080p'])
}).strict();

const PreviewSchema = z.object({
  text: z.string().trim().min(2).max(2500),
  modelId: z.string().trim().min(1).max(120),
  voiceSettings: VoiceSettingsSchema.optional()
}).strict();

const CredentialUpdateSchema = z.object({
  apiKey: z.string().trim().min(1).max(4096)
}).strict();

async function getApiKey(): Promise<string | null> {
  return getDemoNarrationApiKey();
}

function safeProviderMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const detail = parsed?.detail?.message || parsed?.detail || parsed?.message || parsed?.error;
    if (typeof detail === 'string' && detail.trim()) return detail.trim().slice(0, 320);
  } catch {
    // Provider may return non-JSON text; do not expose an unbounded body.
  }
  return 'The provider returned an error response. Check the ElevenLabs account and API permissions.';
}

async function providerJson(url: string, apiKey: string): Promise<any> {
  const response = await fetch(url, {
    headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error: any = new Error(safeProviderMessage(body));
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function ownerMatches(ownerId: string, req: express.Request): boolean {
  return Boolean((req as any).user?.uid && (req as any).user.uid === ownerId);
}

async function requireApiKey(res: express.Response): Promise<string | null> {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      res.status(503).json({
        error: 'ElevenLabs is not configured. Save and verify a key in Admin Dashboard → Settings, or configure ELEVENLABS_API_KEY in the Render service environment.'
      });
      return null;
    }
    return apiKey;
  } catch (error: any) {
    res.status(503).json({
      error: 'The ElevenLabs credential could not be read from the secure server store.',
      detail: typeof error?.message === 'string' ? error.message.slice(0, 300) : 'Credential storage is unavailable.'
    });
    return null;
  }
}

function sendProviderError(res: express.Response, error: any): void {
  const status = error?.status === 401 || error?.status === 403 ? 502 :
    error?.status === 429 ? 429 : 502;
  res.status(status).json({
    error: 'ElevenLabs request failed.',
    detail: typeof error?.message === 'string'
      ? error.message.slice(0, 320)
      : 'The provider request did not complete.'
  });
}

function getUploadExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const allowed = new Set(['.mp4', '.m4v', '.mov', '.webm', '.ogv', '.3gp', '.3g2']);
  if (!allowed.has(extension)) {
    throw new Error('Unsupported video extension. Use MP4, M4V, MOV, WebM, OGV or 3GP.');
  }
  return extension;
}

async function ensureTempRoot(): Promise<void> {
  await fs.promises.mkdir(TEMP_ROOT, { recursive: true, mode: 0o700 });
}

async function probeVideo(filePath: string): Promise<{
  duration: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}> {
  const binary = process.env.FFPROBE_PATH || 'ffprobe';
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json',
    filePath
  ];
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Video metadata verification timed out.'));
    }, 30000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error('FFprobe is unavailable on the server. Install FFmpeg and FFprobe in the Render runtime.'));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error('The uploaded file is not a readable video. ' + stderr.slice(-300)));
      else resolve(stdout);
    });
  });

  const parsed = JSON.parse(output);
  const duration = Number(parsed?.format?.duration);
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const videoStream = streams.find((stream: any) => stream.codec_type === 'video');
  if (!Number.isFinite(duration) || duration <= 0 || !videoStream) {
    throw new Error('The server could not verify a valid video stream and duration.');
  }
  const maxDuration = MAX_DURATION_SECONDS;
  if (duration > maxDuration) {
    throw new Error('This recording exceeds the server rendering duration limit of ' + Math.round(maxDuration / 60) + ' minutes.');
  }
  return {
    duration,
    width: typeof videoStream.width === 'number' && Number.isFinite(videoStream.width) && videoStream.width > 0 ? videoStream.width : null,
    height: typeof videoStream.height === 'number' && Number.isFinite(videoStream.height) && videoStream.height > 0 ? videoStream.height : null,
    hasAudio: streams.some((stream: any) => stream.codec_type === 'audio')
  };
}

function runCommand(binary: string, args: string[], timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Media verification timed out.'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-2500); });
    child.on('error', () => {
      clearTimeout(timeout);
      reject(new Error('The FFmpeg executable is unavailable on this server.'));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error('Media processing failed. ' + stderr.slice(-500)));
    });
  });
}

function buildVideoFilter(
  aspectRatio: NarrationJob['aspectRatio'],
  resolution: NarrationJob['resolution'],
  sourceWidth: number,
  sourceHeight: number
): string | null {
  if (aspectRatio === 'source' && resolution === 'source') return null;

  if (aspectRatio === 'source') {
    const height = resolution === '720p' ? 720 : 1080;
    return 'scale=-2:min(ih\\,' + height + '):force_original_aspect_ratio=decrease';
  }

  const base = resolution === '720p'
    ? 720
    : resolution === '1080p'
      ? 1080
      : Math.min(sourceWidth, sourceHeight);
  let width = base;
  let height = base;
  if (aspectRatio === '16:9') {
    width = Math.round(base * 16 / 9);
    height = base;
  } else if (aspectRatio === '9:16') {
    width = base;
    height = Math.round(base * 16 / 9);
  }
  return 'scale=' + width + ':' + height +
    ':force_original_aspect_ratio=decrease,pad=' + width + ':' + height +
    ':(ow-iw)/2:(oh-ih)/2,setsar=1';
}

function updateProgressFromFfmpeg(job: NarrationJob, line: string, duration: number): void {
  if (!line.startsWith('out_time_ms=')) return;
  const raw = Number(line.slice('out_time_ms='.length));
  if (!Number.isFinite(raw) || duration <= 0) return;
  // FFmpeg reports out_time_ms in microseconds despite the legacy field name.
  const elapsedSeconds = raw / 1_000_000;
  job.progressPercent = Math.min(99, Math.max(0, Math.floor(elapsedSeconds / duration * 100)));
  job.statusMessage = 'Rendering video: ' + job.progressPercent + '% of verified source duration processed.';
}

function makeJobSnapshot(job: NarrationJob) {
  return {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    statusMessage: job.statusMessage,
    progressPercent: job.progressPercent,
    error: job.error,
    characterCost: job.characterCost,
    requestId: job.requestId,
    durationSeconds: job.durationSeconds,
    outputBytes: job.outputBytes,
    outputWidth: job.outputWidth,
    outputHeight: job.outputHeight,
    mediaStorage: {
      provider: 'Cloudinary',
      sourceStored: Boolean(job.sourceAsset),
      narrationStored: Boolean(job.audioAsset),
      videoStored: Boolean(job.outputAsset),
      subtitlesStored: Boolean(job.subtitleAsset),
      delivery: 'authenticated'
    },
    expiresAt: new Date(job.expiresAt).toISOString()
  };
}


const JOB_STORAGE_PREFIX = 'demo_studio_narration_job_';

async function persistJob(job: NarrationJob): Promise<void> {
  await setSystemSettingsDoc(JOB_STORAGE_PREFIX + job.id, {
    schemaVersion: 1,
    ownerId: job.ownerId,
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    statusMessage: job.statusMessage,
    progressPercent: job.progressPercent,
    error: job.error,
    characterCost: job.characterCost,
    requestId: job.requestId,
    durationSeconds: job.durationSeconds,
    outputBytes: job.outputBytes,
    outputWidth: job.outputWidth,
    outputHeight: job.outputHeight,
    originalName: job.originalName,
    safeBaseName: job.safeBaseName,
    createdAt: job.createdAt,
    cloudinaryFolder: job.cloudinaryFolder,
    sourceAsset: job.sourceAsset,
    audioAsset: job.audioAsset,
    outputAsset: job.outputAsset,
    subtitleAsset: job.subtitleAsset,
    expiresAt: job.expiresAt
  }, false);
}

async function restorePersistedJob(jobId: string): Promise<NarrationJob | null> {
  const raw: any = await getSystemSettingsDoc(JOB_STORAGE_PREFIX + jobId);
  if (!raw || raw.deleted === true || raw.schemaVersion !== 1 ||
      raw.jobId !== jobId || typeof raw.ownerId !== 'string') return null;
  const statusValues: JobStatus[] = ['generating_audio', 'narration_ready', 'rendering', 'completed', 'failed', 'cancelled'];
  if (!statusValues.includes(raw.status)) return null;
  const folder = path.join(TEMP_ROOT, 'restored-' + jobId);
  const originalName = typeof raw.originalName === 'string' ? raw.originalName : 'uniace-demo-video';
  const extension = path.extname(originalName).toLowerCase() || '.mp4';
  const job: NarrationJob = {
    id: jobId,
    ownerId: raw.ownerId,
    folder,
    sourcePath: path.join(folder, 'source' + extension),
    cloudinaryFolder: typeof raw.cloudinaryFolder === 'string' ? raw.cloudinaryFolder : 'marketing-demo-studio',
    sourceAsset: raw.sourceAsset && typeof raw.sourceAsset.assetId === 'string' ? raw.sourceAsset as CloudinaryAsset : null,
    audioAsset: raw.audioAsset && typeof raw.audioAsset.assetId === 'string' ? raw.audioAsset as CloudinaryAsset : null,
    outputAsset: raw.outputAsset && typeof raw.outputAsset.assetId === 'string' ? raw.outputAsset as CloudinaryAsset : null,
    subtitleAsset: raw.subtitleAsset && typeof raw.subtitleAsset.assetId === 'string' ? raw.subtitleAsset as CloudinaryAsset : null,
    audioPath: path.join(folder, 'narration.mp3'),
    subtitlePath: raw.subtitleAsset ? path.join(folder, 'narration.srt') : null,
    outputPath: path.join(folder, (typeof raw.safeBaseName === 'string' ? raw.safeBaseName : 'uniace-demo') + '-narrated.mp4'),
    originalName,
    safeBaseName: typeof raw.safeBaseName === 'string' ? raw.safeBaseName : 'uniace-demo',
    script: '',
    modelId: '',
    voiceId: '',
    originalAudioMode: 'duck',
    originalAudioVolume: 0.16,
    narrationVolume: 1,
    subtitlesEnabled: Boolean(raw.subtitleAsset),
    aspectRatio: 'source',
    resolution: 'source',
    status: raw.status as JobStatus,
    stage: typeof raw.stage === 'string' ? raw.stage : String(raw.status),
    statusMessage: typeof raw.statusMessage === 'string' ? raw.statusMessage : 'Recovered saved Demo Studio media metadata.',
    progressPercent: typeof raw.progressPercent === 'number' ? raw.progressPercent : null,
    error: typeof raw.error === 'string' ? raw.error : null,
    characterCost: typeof raw.characterCost === 'string' ? raw.characterCost : null,
    requestId: typeof raw.requestId === 'string' ? raw.requestId : null,
    durationSeconds: typeof raw.durationSeconds === 'number' ? raw.durationSeconds : null,
    outputBytes: typeof raw.outputBytes === 'number' ? raw.outputBytes : null,
    outputWidth: typeof raw.outputWidth === 'number' ? raw.outputWidth : null,
    outputHeight: typeof raw.outputHeight === 'number' ? raw.outputHeight : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : Date.now() + JOB_TTL_MS,
    abortController: null,
    child: null,
    downloadTicketHash: null,
    downloadTicketExpiresAt: 0,
    cleanupStarted: false
  };
  if (job.status === 'generating_audio' || job.status === 'rendering') {
    job.status = 'failed';
    job.stage = 'interrupted';
    job.progressPercent = null;
    job.error = 'This active processing stage was interrupted by a server restart. Verified Cloudinary source and generated media remain stored; delete them when no longer needed.';
    job.statusMessage = 'Processing was interrupted. Verified Cloudinary asset references were recovered.';
    await persistJob(job);
  }
  return job;
}

async function streamCloudinaryAsset(
  asset: CloudinaryAsset,
  res: express.Response,
  contentType: string,
  attachmentName?: string
): Promise<void> {
  const response = await fetchCloudinaryAuthenticatedAsset(asset);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(asset.bytes));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (attachmentName) res.attachment(attachmentName);
  await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), res);
}

async function removeFolder(folder: string): Promise<void> {
  await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => undefined);
}

async function cleanupJob(job: NarrationJob): Promise<void> {
  job.abortController?.abort();
  if (job.child && !job.child.killed) job.child.kill('SIGTERM');
  jobs.delete(job.id);
  if (!job.cleanupStarted) {
    job.cleanupStarted = true;
    await removeFolder(job.folder);
  }
}

async function probeAudioDuration(filePath: string): Promise<number> {
  const binary = process.env.FFPROBE_PATH || 'ffprobe';
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Narration audio metadata verification timed out.'));
    }, 20000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-1500); });
    child.on('error', () => {
      clearTimeout(timeout);
      reject(new Error('FFprobe is unavailable. Narration duration cannot be verified.'));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error('Generated narration audio could not be inspected. ' + stderr.slice(-250)));
      else resolve(stdout.trim());
    });
  });
  const duration = Number(output);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('ElevenLabs audio did not contain a verifiable positive duration.');
  }
  return duration;
}

async function createNarrationAudio(job: NarrationJob, input: z.infer<typeof CreateJobSchema>): Promise<void> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('No ElevenLabs API key is configured in Admin Dashboard or the Render environment.');
  await fs.promises.mkdir(job.folder, { recursive: true, mode: 0o700 });
  if (!job.sourceAsset) throw new Error('The verified Cloudinary source asset is missing from this narration job.');
  const sourceStat = await fs.promises.stat(job.sourcePath).catch(() => null);
  if (!sourceStat) await downloadCloudinaryAuthenticatedAsset(job.sourceAsset, job.sourcePath);
  const metadata = await probeVideo(job.sourcePath);
  job.durationSeconds = metadata.duration;
  job.stage = 'generating_audio';
  job.statusMessage = 'Generating narration with the selected ElevenLabs voice.';

  const controller = new AbortController();
  job.abortController = controller;
  const endpoint = 'https://api.elevenlabs.io/v1/text-to-speech/' +
    encodeURIComponent(job.voiceId) + '/with-timestamps?output_format=mp3_44100_128';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      text: input.script,
      model_id: job.modelId,
      ...(input.voiceSettings ? {
        voice_settings: {
          ...(typeof input.voiceSettings.stability === 'number' ? { stability: input.voiceSettings.stability } : {}),
          ...(typeof input.voiceSettings.similarity_boost === 'number' ? { similarity_boost: input.voiceSettings.similarity_boost } : {}),
          ...(typeof input.voiceSettings.style === 'number' ? { style: input.voiceSettings.style } : {}),
          ...(typeof input.voiceSettings.use_speaker_boost === 'boolean' ? { use_speaker_boost: input.voiceSettings.use_speaker_boost } : {}),
          ...(typeof input.voiceSettings.speed === 'number' ? { speed: input.voiceSettings.speed } : {})
        }
      } : {})
    }),
    signal: controller.signal
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('ElevenLabs speech generation failed (' + response.status + '): ' + safeProviderMessage(body));
  }

  const payload: any = await response.json();
  if (typeof payload?.audio_base64 !== 'string' || !payload.audio_base64.trim()) {
    throw new Error('ElevenLabs returned no audio data. The narration was not marked as generated.');
  }
  const audio = Buffer.from(payload.audio_base64, 'base64');
  if (audio.length < 100) throw new Error('ElevenLabs returned an incomplete audio file.');
  await fs.promises.writeFile(job.audioPath, audio, { mode: 0o600 });
  const narrationDuration = await probeAudioDuration(job.audioPath);
  if (job.durationSeconds && narrationDuration > job.durationSeconds + 0.15) {
    throw new Error(
      'The generated narration is ' + narrationDuration.toFixed(1) +
      ' seconds, but the source video is ' + job.durationSeconds.toFixed(1) +
      ' seconds. Shorten the approved script or adjust the voice speed before rendering. The video will not be silently cut off.'
    );
  }

  const alignment = payload.alignment || payload.normalized_alignment;
  if (job.subtitlesEnabled) {
    if (!alignment) {
      throw new Error('ElevenLabs did not return timing data. Subtitles cannot be generated for this request.');
    }
    const srt = buildSrtFromAlignment(alignment as ElevenLabsAlignment);
    job.subtitlePath = path.join(job.folder, 'narration.srt');
    await fs.promises.writeFile(job.subtitlePath, srt, { encoding: 'utf8', mode: 0o600 });
  }

  job.audioAsset = await uploadCloudinaryLocalAsset({
    filePath: job.audioPath,
    folder: job.cloudinaryFolder,
    publicId: job.id + '-narration-audio',
    resourceType: 'video'
  });
  if (job.subtitlePath) {
    job.subtitleAsset = await uploadCloudinaryLocalAsset({
      filePath: job.subtitlePath,
      folder: job.cloudinaryFolder,
      publicId: job.id + '-narration-subtitles.srt',
      resourceType: 'raw'
    });
  }
  job.characterCost = response.headers.get('character-cost');
  job.requestId = response.headers.get('request-id');
  job.abortController = null;
  job.status = 'narration_ready';
  job.stage = 'narration_ready';
  job.statusMessage = 'Narration audio is ready for review. Listen before rendering the final video.';
  job.progressPercent = null;
  job.expiresAt = Date.now() + JOB_TTL_MS;
  await persistJob(job);
}

async function renderVideo(job: NarrationJob): Promise<void> {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  job.status = 'rendering';
  job.stage = 'rendering';
  job.statusMessage = 'Preparing server-side video rendering.';
  job.progressPercent = 0;

  await fs.promises.mkdir(job.folder, { recursive: true, mode: 0o700 });
  if (!job.sourceAsset || !job.audioAsset) {
    throw new Error('The verified Cloudinary source video and narration audio are required before rendering.');
  }
  if (!(await fs.promises.stat(job.sourcePath).catch(() => null))) {
    await downloadCloudinaryAuthenticatedAsset(job.sourceAsset, job.sourcePath);
  }
  if (!(await fs.promises.stat(job.audioPath).catch(() => null))) {
    await downloadCloudinaryAuthenticatedAsset(job.audioAsset, job.audioPath);
  }
  if (job.subtitlePath && !(await fs.promises.stat(job.subtitlePath).catch(() => null))) {
    if (!job.subtitleAsset) throw new Error('The timed subtitle file is not available in local storage or Cloudinary.');
    await downloadCloudinaryAuthenticatedAsset(job.subtitleAsset, job.subtitlePath);
  }
  const metadata = await probeVideo(job.sourcePath);
  if (!metadata.width || !metadata.height) {
    throw new Error('The source video dimensions could not be verified. Rendering stopped without guessing an output size.');
  }
  const filter = buildVideoFilter(job.aspectRatio, job.resolution, metadata.width, metadata.height);
  const args = ['-y', '-i', job.sourcePath, '-i', job.audioPath];

  let audioMap: string[] = [];
  if ((job.originalAudioMode === 'mix' || job.originalAudioMode === 'duck') && metadata.hasAudio) {
    const originalVolume = job.originalAudioVolume.toFixed(3);
    const narrationVolume = job.narrationVolume.toFixed(3);
    if (job.originalAudioMode === 'duck') {
      args.push(
        '-filter_complex',
        '[0:a:0]volume=' + originalVolume + '[background];' +
        '[1:a:0]volume=' + narrationVolume + '[narration];' +
        '[background][narration]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=420[ducked];' +
        '[ducked][narration]amix=inputs=2:duration=longest:dropout_transition=2[mixed]'
      );
    } else {
      args.push(
        '-filter_complex',
        '[0:a:0]volume=' + originalVolume + '[original];' +
        '[1:a:0]volume=' + narrationVolume + '[narration];' +
        '[original][narration]amix=inputs=2:duration=longest:dropout_transition=2[mixed]'
      );
    }
    audioMap = ['-map', '[mixed]'];
  } else {
    audioMap = ['-map', '1:a:0'];
  }

  if (filter) args.push('-vf', filter);
  args.push('-map', '0:v:0', ...audioMap);
  if (job.subtitlePath) {
    args.push('-i', job.subtitlePath, '-map', '2:0', '-c:s', 'mov_text');
  } else {
    args.push('-sn');
  }
  args.push(
    '-t', metadata.duration.toFixed(3),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    job.outputPath
  );

  job.statusMessage = 'FFmpeg is encoding the video and combining the selected audio tracks.';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    job.child = child;
    let stdoutBuffer = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      lines.forEach((line) => updateProgressFromFfmpeg(job, line, metadata.duration));
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on('error', () => {
      job.child = null;
      reject(new Error('FFmpeg is unavailable on this server. Install FFmpeg in the Render runtime before rendering.'));
    });
    child.on('close', (code) => {
      job.child = null;
      if (job.status === 'cancelled') {
        reject(new Error('Rendering was cancelled.'));
      } else if (code !== 0) {
        reject(new Error('FFmpeg could not render the video. ' + stderr.slice(-700)));
      } else {
        resolve();
      }
    });
  });

  job.stage = 'verifying_output';
  job.statusMessage = 'Verifying the completed MP4 before making it available.';
  job.progressPercent = null;
  const stat = await fs.promises.stat(job.outputPath).catch(() => null);
  if (!stat || stat.size <= 1024) {
    throw new Error('FFmpeg exited without producing a valid video file.');
  }
  await runCommand(ffmpeg, ['-v', 'error', '-i', job.outputPath, '-f', 'null', '-'], Math.max(60000, metadata.duration * 5000));

  const outputMetadata = await probeVideo(job.outputPath);
  job.outputAsset = await uploadCloudinaryLocalAsset({
    filePath: job.outputPath,
    folder: job.cloudinaryFolder,
    publicId: job.id + '-narrated-video',
    resourceType: 'video'
  });
  job.status = 'completed';
  job.stage = 'completed';
  job.progressPercent = 100;
  job.outputBytes = stat.size;
  job.outputWidth = outputMetadata.width;
  job.outputHeight = outputMetadata.height;
  job.statusMessage = 'The final MP4 and enabled SRT passed verification and are stored as protected Cloudinary assets.';
  job.expiresAt = Date.now() + JOB_TTL_MS;
  await persistJob(job);
}

async function getOwnedJob(req: express.Request, res: express.Response): Promise<NarrationJob | null> {
  const jobId = String(req.params.jobId || '');
  let job = jobs.get(jobId);
  if (!job) {
    try {
      job = await restorePersistedJob(jobId) || undefined;
      if (job) jobs.set(job.id, job);
    } catch (error: any) {
      res.status(503).json({ error: 'Saved Demo Studio media metadata could not be read from Neon.', detail: String(error?.message || '').slice(0, 240) });
      return null;
    }
  }
  if (!job || !ownerMatches(job.ownerId, req)) {
    res.status(404).json({ error: 'Narration job not found or no longer available.' });
    return null;
  }
  // Job metadata and its Cloudinary asset references are durable. The processing TTL
  // only controls local temporary files, not whether administrators can inspect/delete assets.
  return job;
}

async function cleanExpiredItems(): Promise<void> {
  const now = Date.now();
  for (const upload of uploads.values()) {
    if (upload.expiresAt <= now) {
      try {
        if (upload.cloudinaryAsset) {
          await deleteCloudinaryAsset(upload.cloudinaryAsset);
        } else {
          // The browser may have completed the Cloudinary upload but failed before
          // the server could verify and attach the immutable asset ID.
          await deleteCloudinaryAssetByPublicId(upload.cloudinaryPublicId, 'video');
        }
        uploads.delete(upload.id);
        await removeFolder(upload.folder);
      } catch (error: any) {
        console.warn('[DemoNarration] Expired Cloudinary upload cleanup will retry:', error?.message || error);
      }
    }
  }
  for (const job of jobs.values()) {
    if (job.expiresAt <= now && job.status !== 'rendering' && job.status !== 'generating_audio') {
      await cleanupJob(job);
    }
  }
}

export function setupDemoNarrationRoutes(app: express.Express): void {
  void ensureTempRoot().then(async () => {
    // Temporary media from an earlier process must not be treated as an active job.
    const entries = await fs.promises.readdir(TEMP_ROOT, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map((entry) => removeFolder(path.join(TEMP_ROOT, entry.name))));
  }).catch((error) => {
    console.error('[DemoNarration] Temporary directory initialization failed:', error?.message || error);
  });

  const cleanupTimer = setInterval(() => {
    void cleanExpiredItems().catch((error) => {
      console.warn('[DemoNarration] Temporary file cleanup encountered an error:', error?.message || error);
    });
  }, 60000);
  cleanupTimer.unref?.();

  app.get('/api/admin/demo-narration/credentials', async (_req, res) => {
    try {
      const credential = await getDemoNarrationCredentialStatus();
      res.set('Cache-Control', 'private, no-store');
      return res.json(credential);
    } catch (error: any) {
      return res.status(503).json({
        error: 'The secure ElevenLabs credential store is unavailable.',
        storageAvailable: false,
        detail: typeof error?.message === 'string' ? error.message.slice(0, 300) : 'Neon system configuration could not be read.'
      });
    }
  });

  app.put('/api/admin/demo-narration/credentials', async (req, res) => {
    const parsed = CredentialUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A non-empty ElevenLabs API key is required.' });
    }

    try {
      const current = await getDemoNarrationCredentialStatus();
      if (!current.storageAvailable) {
        return res.status(503).json({ error: 'Neon credential storage is unavailable. The key was not saved.' });
      }
      if (!current.encryptionReady) {
        return res.status(503).json({
          error: 'Server-side credential encryption is not configured. Set ACADEMIC_RESEARCH_ENCRYPTION_KEY on the UniAce Render service before saving provider credentials.'
        });
      }

      const validation = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': parsed.data.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000)
      });
      if (!validation.ok) {
        const status = validation.status === 401 || validation.status === 403 ? 400 :
          validation.status === 429 ? 429 : 502;
        return res.status(status).json({
          error: validation.status === 401 || validation.status === 403
            ? 'ElevenLabs rejected this API key. Check that the key is valid and has account access.'
            : validation.status === 429
              ? 'ElevenLabs rate-limited the verification request. Try again shortly.'
              : 'ElevenLabs could not verify this key right now. No credential was saved.'
        });
      }

      const account: any = await validation.json();
      const credential = await saveDemoNarrationApiKey(parsed.data.apiKey);
      return res.json({
        success: true,
        credential,
        account: {
          tier: typeof account?.tier === 'string' ? account.tier : null,
          status: typeof account?.status === 'string' ? account.status : null,
          characterCount: typeof account?.character_count === 'number' ? account.character_count : null,
          characterLimit: typeof account?.character_limit === 'number' ? account.character_limit : null
        }
      });
    } catch (error: any) {
      console.error('[DemoNarration] Secure API key save failed:', error?.message || error);
      return res.status(503).json({
        error: 'The ElevenLabs key could not be verified and stored securely.',
        detail: typeof error?.message === 'string' ? error.message.slice(0, 300) : 'Secure credential storage failed.'
      });
    }
  });

  app.delete('/api/admin/demo-narration/credentials', async (_req, res) => {
    try {
      const credential = await clearDemoNarrationApiKey();
      res.set('Cache-Control', 'private, no-store');
      return res.json({ success: true, credential });
    } catch (error: any) {
      return res.status(503).json({
        error: 'The Admin Dashboard-stored ElevenLabs key could not be cleared.',
        detail: typeof error?.message === 'string' ? error.message.slice(0, 300) : 'Secure credential storage failed.'
      });
    }
  });

  app.get('/api/admin/demo-narration/status', async (_req, res) => {
    const ffmpegAvailable = await runCommand(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], 10000)
      .then(() => true).catch(() => false);
    const ffprobeAvailable = await runCommand(process.env.FFPROBE_PATH || 'ffprobe', ['-version'], 10000)
      .then(() => true).catch(() => false);
    let credential: Awaited<ReturnType<typeof getDemoNarrationCredentialStatus>> | null = null;
    let credentialError: string | null = null;
    let cloudinaryConfigured = false;
    try { cloudinaryConfigured = Boolean(await getCloudinaryMediaConfig()); } catch { cloudinaryConfigured = false; }
    try {
      credential = await getDemoNarrationCredentialStatus();
    } catch (error: any) {
      credentialError = typeof error?.message === 'string' ? error.message.slice(0, 300) : 'Credential storage is unavailable.';
    }
    res.set('Cache-Control', 'private, no-store');
    res.json({
      configured: credential?.configured === true,
      credentialSource: credential?.source || null,
      credentialKeyHint: credential?.keyHint || null,
      credentialStorageAvailable: credential?.storageAvailable === true,
      credentialEncryptionReady: credential?.encryptionReady === true,
      credentialDecryptable: credential?.decryptable === true,
      credentialError,
      provider: 'ElevenLabs',
      ffmpegAvailable,
      ffprobeAvailable,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      cloudinaryConfigured,
      maxScriptCharacters: MAX_SCRIPT_CHARACTERS,
      maxDurationSeconds: MAX_DURATION_SECONDS
    });
  });

  app.get('/api/admin/demo-narration/voices', async (req, res) => {
    const apiKey = await requireApiKey(res);
    if (!apiKey) return;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const pageToken = typeof req.query.next_page_token === 'string' ? req.query.next_page_token.slice(0, 500) : '';
    const url = new URL('https://api.elevenlabs.io/v2/voices');
    url.searchParams.set('page_size', '100');
    if (search) url.searchParams.set('search', search);
    if (pageToken) url.searchParams.set('next_page_token', pageToken);
    try {
      const data = await providerJson(url.toString(), apiKey);
      const voices = Array.isArray(data?.voices) ? data.voices.map((voice: any) => ({
        voiceId: voice.voice_id,
        name: voice.name,
        category: voice.category || null,
        description: voice.description || null,
        labels: voice.labels && typeof voice.labels === 'object' ? voice.labels : {},
        previewUrl: typeof voice.preview_url === 'string' ? voice.preview_url : null,
        settings: voice.settings && typeof voice.settings === 'object' ? voice.settings : null,
        isOwner: voice.is_owner === true
      })).filter((voice: any) => typeof voice.voiceId === 'string' && typeof voice.name === 'string') : [];
      res.set('Cache-Control', 'private, no-store');
      return res.json({
        voices,
        hasMore: data?.has_more === true,
        nextPageToken: typeof data?.next_page_token === 'string' ? data.next_page_token : null
      });
    } catch (error: any) {
      console.error('[DemoNarration] ElevenLabs voice discovery failed:', error?.message || error);
      return sendProviderError(res, error);
    }
  });

  app.get('/api/admin/demo-narration/models', async (_req, res) => {
    const apiKey = await requireApiKey(res);
    if (!apiKey) return;
    try {
      const models = await providerJson('https://api.elevenlabs.io/v1/models', apiKey);
      const supported = Array.isArray(models)
        ? models.filter((model: any) => model?.can_do_text_to_speech === true).map((model: any) => ({
            modelId: model.model_id,
            name: model.name || model.model_id,
            description: model.description || null,
            maximumTextLength: typeof model.maximum_text_length_per_request === 'number' &&
              Number.isFinite(model.maximum_text_length_per_request) &&
              model.maximum_text_length_per_request > 0
              ? model.maximum_text_length_per_request
              : null,
            canUseStyle: typeof model.can_use_style === 'boolean' ? model.can_use_style : null,
            canUseSpeakerBoost: typeof model.can_use_speaker_boost === 'boolean' ? model.can_use_speaker_boost : null,
            requiresAlphaAccess: typeof model.requires_alpha_access === 'boolean' ? model.requires_alpha_access : null,
            tokenCostFactor: typeof model.token_cost_factor === 'number' && Number.isFinite(model.token_cost_factor)
              ? model.token_cost_factor
              : null,
            languages: Array.isArray(model.languages)
              ? model.languages.map((language: any) => ({
                  languageId: language.language_id || null,
                  name: language.name || null
                }))
              : []
          }))
        : [];
      res.set('Cache-Control', 'private, no-store');
      return res.json({ models: supported });
    } catch (error: any) {
      console.error('[DemoNarration] ElevenLabs model discovery failed:', error?.message || error);
      return sendProviderError(res, error);
    }
  });

  app.get('/api/admin/demo-narration/account', async (_req, res) => {
    const apiKey = await requireApiKey(res);
    if (!apiKey) return;
    try {
      const account = await providerJson('https://api.elevenlabs.io/v1/user/subscription', apiKey);
      return res.json({
        tier: account?.tier || null,
        status: account?.status || null,
        characterCount: typeof account?.character_count === 'number' && Number.isFinite(account.character_count)
          ? account.character_count
          : null,
        characterLimit: typeof account?.character_limit === 'number' && Number.isFinite(account.character_limit)
          ? account.character_limit
          : null,
        nextResetAt: typeof account?.next_character_count_reset_unix === 'number' &&
          Number.isFinite(account.next_character_count_reset_unix) &&
          account.next_character_count_reset_unix > 0
          ? new Date(account.next_character_count_reset_unix * 1000).toISOString()
          : null,
        overageEnabled: account?.can_extend_character_limit === true,
        voiceSlotsUsed: typeof account?.voice_slots_used === 'number' && Number.isFinite(account.voice_slots_used)
          ? account.voice_slots_used
          : null,
        voiceLimit: typeof account?.voice_limit === 'number' && Number.isFinite(account.voice_limit)
          ? account.voice_limit
          : null
      });
    } catch (error: any) {
      console.error('[DemoNarration] ElevenLabs account details failed:', error?.message || error);
      return sendProviderError(res, error);
    }
  });

  app.post('/api/admin/demo-narration/voices/:voiceId/preview', async (req, res) => {
    const apiKey = await requireApiKey(res);
    if (!apiKey) return;
    const parsed = PreviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Preview text, model and supported voice settings are required.' });
    try {
      const endpoint = 'https://api.elevenlabs.io/v1/text-to-speech/' +
        encodeURIComponent(req.params.voiceId) + '/stream?output_format=mp3_44100_128';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: parsed.data.text,
          model_id: parsed.data.modelId,
          voice_settings: parsed.data.voiceSettings
        }),
        signal: AbortSignal.timeout(90000)
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error: any = new Error(safeProviderMessage(body));
        error.status = response.status;
        throw error;
      }
      if (!response.body) return res.status(502).json({ error: 'ElevenLabs returned an empty preview stream.' });
      res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, no-store');
      const cost = response.headers.get('character-cost');
      if (cost) res.setHeader('X-ElevenLabs-Character-Cost', cost);
      const requestId = response.headers.get('request-id');
      if (requestId) res.setHeader('X-ElevenLabs-Request-Id', requestId);
      const reader = response.body.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (next.value) res.write(Buffer.from(next.value));
        }
        return res.end();
      } catch (error) {
        res.destroy(error as Error);
        return;
      }
    } catch (error: any) {
      console.error('[DemoNarration] Voice preview failed:', error?.message || error);
      if (!res.headersSent) return sendProviderError(res, error);
    }
  });

  app.post('/api/admin/demo-narration/uploads', async (req, res) => {
    const parsed = UploadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'A valid video filename, MIME type and exact file size are required.' });
    const { fileName, mimeType, size } = parsed.data;
    if (!mimeType.toLowerCase().startsWith('video/')) {
      return res.status(415).json({ error: 'The uploaded source must declare a video MIME type.' });
    }

    let extension: string;
    try {
      extension = getUploadExtension(fileName);
    } catch (error: any) {
      return res.status(415).json({ error: error.message });
    }

    try {
      const config = await getCloudinaryMediaConfig();
      if (!config) return res.status(503).json({ error: 'Cloudinary is not configured. Open Admin Dashboard → Settings → Cloudinary and verify the credentials before uploading a Demo Studio video.' });
      await ensureTempRoot();
      const id = crypto.randomUUID();
      const folder = await fs.promises.mkdtemp(path.join(TEMP_ROOT, 'upload-'));
      const publicId = 'source-' + id;
      const uploadSignature = await createCloudinaryVideoUploadSignature({ publicId, folder: config.folderPrefix });
      const upload: UploadRecord = {
        id,
        ownerId: String((req as any).user.uid),
        folder,
        sourcePath: path.join(folder, 'source' + extension),
        originalName: fileName,
        mimeType,
        expectedSize: size,
        receivedBytes: 0,
        complete: false,
        cloudinaryFolder: config.folderPrefix,
        cloudinaryPublicId: config.folderPrefix.replace(/\\/+$/, '') + '/' + publicId,
        cloudinaryAsset: null,
        expiresAt: Date.now() + UPLOAD_TTL_MS
      };
      uploads.set(id, upload);
      return res.status(201).json({ uploadId: id, uploadSignature, maxUploadBytes: MAX_UPLOAD_BYTES, expiresAt: new Date(upload.expiresAt).toISOString() });
    } catch (error: any) {
      console.error('[DemoNarration] Cloudinary upload allocation failed:', error?.message || error);
      return res.status(503).json({ error: 'Cloudinary upload could not be prepared. Verify the Demo Studio Cloudinary credentials and try again.', detail: String(error?.message || '').slice(0, 220) });
    }
  });

  app.delete('/api/admin/demo-narration/uploads/:uploadId', async (req, res) => {
    const upload = uploads.get(req.params.uploadId);
    if (!upload || !ownerMatches(upload.ownerId, req)) {
      return res.status(404).json({ error: 'Temporary upload session not found or expired.' });
    }
    uploads.delete(upload.id);
    try {
      if (upload.cloudinaryAsset) {
        await deleteCloudinaryAsset(upload.cloudinaryAsset);
      } else {
        await deleteCloudinaryAssetByPublicId(upload.cloudinaryPublicId, 'video');
      }
      await removeFolder(upload.folder);
      return res.json({ deleted: true });
    } catch (error: any) {
      return res.status(503).json({ error: 'The upload session was closed but its Cloudinary source asset could not be deleted.', detail: String(error?.message || '').slice(0, 220) });
    }
  });

  app.post('/api/admin/demo-narration/uploads/:uploadId/complete', async (req, res) => {
    const upload = uploads.get(req.params.uploadId);
    if (!upload || !ownerMatches(upload.ownerId, req)) {
      return res.status(404).json({ error: 'Cloudinary upload session not found or expired.' });
    }
    if (upload.complete) return res.status(409).json({ error: 'This Cloudinary upload session has already been verified.' });
    const payload = z.object({
      assetId: z.string().trim().min(8).max(120),
      publicId: z.string().trim().min(1).max(240)
    }).strict().safeParse(req.body);
    if (!payload.success || payload.data.publicId !== upload.cloudinaryPublicId) {
      return res.status(400).json({ error: 'Cloudinary upload identity did not match the signed upload session.' });
    }
    try {
      const asset = await verifyCloudinaryVideoUpload({
        assetId: payload.data.assetId,
        publicId: payload.data.publicId,
        expectedBytes: upload.expectedSize
      });
      if (!asset.duration || !asset.width || !asset.height) {
        throw new Error('Cloudinary did not return verified video duration and dimensions.');
      }
      upload.cloudinaryAsset = asset;
      upload.receivedBytes = asset.bytes;
      upload.complete = true;
      upload.expiresAt = Date.now() + UPLOAD_TTL_MS;
      return res.status(200).json({
        verified: true,
        asset: {
          bytes: asset.bytes,
          duration: asset.duration,
          width: asset.width,
          height: asset.height,
          format: asset.format,
          delivery: asset.deliveryType
        }
      });
    } catch (error: any) {
      return res.status(422).json({
        error: 'Cloudinary did not verify the uploaded source video. The narration job cannot start.',
        detail: String(error?.message || '').slice(0, 260)
      });
    }
  });

  app.post('/api/admin/demo-narration/jobs', async (req, res) => {
    const apiKey = await requireApiKey(res);
    if (!apiKey) return;
    const parsed = CreateJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'The narration job did not match the required schema. Check the voice, model, script and audio settings.'
      });
    }

    const upload = uploads.get(parsed.data.uploadId);
    if (!upload || !ownerMatches(upload.ownerId, req) || !upload.complete || !upload.cloudinaryAsset) {
      return res.status(409).json({ error: 'The source video has not been uploaded to and verified by Cloudinary.' });
    }

    try {
      const models = await providerJson('https://api.elevenlabs.io/v1/models', apiKey);
      const selectedModel = Array.isArray(models)
        ? models.find((model: any) => model?.model_id === parsed.data.modelId && model?.can_do_text_to_speech === true)
        : null;
      if (!selectedModel) {
        return res.status(400).json({ error: 'The selected model is not currently available for text-to-speech on this ElevenLabs account.' });
      }
      const maximumTextLength = Number(selectedModel.maximum_text_length_per_request);
      if (Number.isFinite(maximumTextLength) && parsed.data.script.length > maximumTextLength) {
        return res.status(413).json({
          error: 'The approved narration exceeds this live model limit of ' + maximumTextLength + ' characters. Select a model with a higher verified limit or shorten the script.'
        });
      }

      const jobId = crypto.randomUUID();
      const safeBaseName = sanitizeDemoVideoFileName(upload.originalName);
      const job: NarrationJob = {
        id: jobId,
        ownerId: upload.ownerId,
        folder: upload.folder,
        sourcePath: upload.sourcePath,
        cloudinaryFolder: upload.cloudinaryFolder,
        sourceAsset: upload.cloudinaryAsset,
        audioAsset: null,
        outputAsset: null,
        subtitleAsset: null,
        audioPath: path.join(upload.folder, 'narration.mp3'),
        subtitlePath: null,
        outputPath: path.join(upload.folder, safeBaseName + '-narrated.mp4'),
        originalName: upload.originalName,
        safeBaseName,
        script: parsed.data.script,
        modelId: parsed.data.modelId,
        voiceId: parsed.data.voiceId,
        originalAudioMode: parsed.data.originalAudioMode,
        originalAudioVolume: parsed.data.originalAudioVolume,
        narrationVolume: parsed.data.narrationVolume,
        subtitlesEnabled: parsed.data.subtitles,
        aspectRatio: parsed.data.aspectRatio,
        resolution: parsed.data.resolution,
        status: 'generating_audio',
        stage: 'validating_video',
        statusMessage: 'Verifying the uploaded video and preparing the selected ElevenLabs voice.',
        progressPercent: null,
        error: null,
        characterCost: null,
        requestId: null,
        durationSeconds: null,
        outputBytes: null,
        outputWidth: null,
        outputHeight: null,
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + JOB_TTL_MS,
        abortController: null,
        child: null,
        downloadTicketHash: null,
        downloadTicketExpiresAt: 0,
        cleanupStarted: false
      };
      uploads.delete(upload.id);
      jobs.set(jobId, job);
      try {
        await persistJob(job);
      } catch (error: any) {
        jobs.delete(jobId);
        return res.status(503).json({ error: 'Neon could not save the Demo Studio media record. No narration job was started.', detail: String(error?.message || '').slice(0, 220) });
      }
      setImmediate(() => {
        void createNarrationAudio(job, parsed.data).catch(async (error: any) => {
          if (job.status === 'cancelled') return;
          job.status = 'failed';
          job.stage = 'failed';
          job.error = error?.message || 'Narration generation failed.';
          job.statusMessage = 'Narration generation failed. Temporary media will be removed.';
          job.progressPercent = null;
          job.expiresAt = Date.now() + JOB_TTL_MS;
          job.cleanupStarted = true;
          await persistJob(job).catch(() => undefined);
          await removeFolder(job.folder);
        });
      });
      return res.status(202).json(makeJobSnapshot(job));
    } catch (error: any) {
      console.error('[DemoNarration] Job creation failed:', error?.message || error);
      return sendProviderError(res, error);
    }
  });

  app.delete('/api/admin/demo-narration/jobs/:jobId/assets', async (req, res) => {
    const job = await getOwnedJob(req, res);
    if (!job) return;
    const assets = [job.sourceAsset, job.audioAsset, job.outputAsset, job.subtitleAsset].filter(Boolean) as CloudinaryAsset[];
    const failures: string[] = [];
    for (const asset of assets) {
      try {
        await deleteCloudinaryAsset(asset);
        if (job.sourceAsset?.assetId === asset.assetId) job.sourceAsset = null;
        if (job.audioAsset?.assetId === asset.assetId) job.audioAsset = null;
        if (job.outputAsset?.assetId === asset.assetId) job.outputAsset = null;
        if (job.subtitleAsset?.assetId === asset.assetId) job.subtitleAsset = null;
      } catch (error: any) {
        failures.push(asset.publicId + ': ' + String(error?.message || 'delete failed').slice(0, 160));
      }
    }
    if (failures.length) {
      await persistJob(job).catch(() => undefined);
      return res.status(502).json({ error: 'Some Demo Studio media assets could not be removed from Cloudinary.', failures });
    }
    await setSystemSettingsDoc(JOB_STORAGE_PREFIX + job.id, { schemaVersion: 1, deleted: true, jobId: job.id }, false);
    await cleanupJob(job);
    return res.json({ deleted: true, deletedAssets: assets.length, jobId: job.id });
  });

  app.get('/api/admin/demo-narration/jobs/:jobId', async (req, res) => {
    const job = await getOwnedJob(req, res);
    if (!job) return;
    res.set('Cache-Control', 'private, no-store');
    return res.json(makeJobSnapshot(job));
  });

  app.get('/api/admin/demo-narration/voices/:voiceId/settings', async (req, res) => {
    const apiKey = await requireApiKey(res);
    if (!apiKey) return;
    try {
      const settings = await providerJson(
        'https://api.elevenlabs.io/v1/voices/' + encodeURIComponent(req.params.voiceId) + '/settings',
        apiKey
      );
      return res.json({ settings });
    } catch (error: any) {
      console.error('[DemoNarration] Live voice settings lookup failed:', error?.message || error);
      return sendProviderError(res, error);
    }
  });

  app.get('/api/admin/demo-narration/jobs/:jobId/audio', async (req, res) => {
    const job = await getOwnedJob(req, res);
    if (!job) return;
    if (!['narration_ready', 'rendering', 'completed'].includes(job.status)) {
      return res.status(409).json({ error: 'Narration audio is not ready yet.' });
    }
    if (!job.audioAsset) return res.status(404).json({ error: 'The generated narration audio is not stored in Cloudinary.' });
    try {
      await streamCloudinaryAsset(job.audioAsset, res, 'audio/mpeg');
    } catch (error: any) {
      if (!res.headersSent) return res.status(502).json({ error: 'The protected Cloudinary narration preview could not be loaded.', detail: String(error?.message || '').slice(0, 220) });
      res.destroy(error);
    }
  });

  app.get('/api/admin/demo-narration/jobs/:jobId/video-preview', async (req, res) => {
    const job = await getOwnedJob(req, res);
    if (!job) return;
    if (job.status !== 'completed' || !job.outputBytes || !job.outputAsset) {
      return res.status(409).json({ error: 'The final video has not passed verification and is not stored in Cloudinary.' });
    }
    try {
      await streamCloudinaryAsset(job.outputAsset, res, 'video/mp4');
    } catch (error: any) {
      if (!res.headersSent) return res.status(502).json({ error: 'The protected Cloudinary MP4 preview could not be loaded.', detail: String(error?.message || '').slice(0, 220) });
      res.destroy(error);
    }
  });

  app.get('/api/admin/demo-narration/jobs/:jobId/subtitles', async (req, res) => {
    const job = await getOwnedJob(req, res);
    if (!job) return;
    if (!job.subtitleAsset) {
      return res.status(404).json({ error: 'This narration job has no generated Cloudinary subtitle asset.' });
    }
    try {
      await streamCloudinaryAsset(job.subtitleAsset, res, 'application/x-subrip; charset=utf-8', job.safeBaseName + '-narration.srt');
    } catch (error: any) {
      if (!res.headersSent) return res.status(502).json({ error: 'The protected Cloudinary subtitle file could not be loaded.', detail: String(error?.message || '').slice(0, 220) });
      res.destroy(error);
    }
  });

  app.post('/api/admin/demo-narration/jobs/:jobId/render', async (req, res) => {
    const job = await getOwnedJob(req, res);
    if (!job) return;
    if (job.status !== 'narration_ready') {
      return res.status(409).json({ error: 'The narration must finish successfully before video rendering can start.' });
    }
    job.status = 'rendering';
    job.stage = 'rendering';
    job.progressPercent = 0;
    job.statusMessage = 'Starting FFmpeg video rendering.';
    void persistJob(job).catch((error) => console.warn('[DemoNarration] Could not persist render start:', error?.message || error));
    setImmediate(() => {
      void renderVideo(job).catch(async (error: any) => {
        if (job.status === 'cancelled') return;
        job.status = 'failed';
        job.stage = 'failed';
        job.error = error?.message || 'Video rendering failed.';
        job.statusMessage = 'Video rendering failed. Temporary media will be removed.';
        job.progressPercent = null;
        job.expiresAt = Date.now() + JOB_TTL_MS;
        job.cleanupStarted = true;
        await persistJob(job).catch(() => undefined);
        await removeFolder(job.folder);
      });
    });
    return res.status(202).json(makeJobSnapshot(job));
  });

  app.delete('/api/admin/demo-narration/jobs/:jobId', async (req, res) => {
    const job = await getOwnedJob(req, res);
    if (!job) return;
    if (job.status === 'completed') {
      return res.status(409).json({ error: 'The completed media cannot be cancelled. Use the explicit media deletion action instead.' });
    }
    job.status = 'cancelled';
    job.stage = 'cancelled';
    job.statusMessage = 'The administrator cancelled this narration job.';
    await persistJob(job).catch(() => undefined);
    await cleanupJob(job);
    return res.json({ cancelled: true, assetsPreserved: Boolean(job.sourceAsset), jobId: job.id });
  });

  app.post('/api/admin/demo-narration/jobs/:jobId/download-ticket', async (req, res) => {
    const job = await getOwnedJob(req, res);
    if (!job) return;
    if (job.status !== 'completed' || !job.outputBytes || !job.outputAsset) {
      return res.status(409).json({ error: 'The final video has not passed verification and is not stored in Cloudinary.' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    job.downloadTicketHash = crypto.createHash('sha256').update(token).digest('hex');
    job.downloadTicketExpiresAt = Date.now() + DOWNLOAD_TICKET_TTL_MS;
    return res.json({
      url: '/api/demo-narration/download/' + encodeURIComponent(job.id) + '?ticket=' + encodeURIComponent(token),
      expiresAt: new Date(job.downloadTicketExpiresAt).toISOString()
    });
  });

  app.get('/api/demo-narration/download/:jobId', async (req, res) => {
    const job = jobs.get(req.params.jobId);
    const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
    const ticketHash = crypto.createHash('sha256').update(ticket).digest('hex');
    const storedHash = job?.downloadTicketHash;
    const validTicket = Boolean(
      job &&
      storedHash &&
      ticket &&
      job.downloadTicketExpiresAt > Date.now() &&
      storedHash.length === ticketHash.length &&
      crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(ticketHash))
    );
    if (!job || job.status !== 'completed' || !validTicket) {
      return res.status(404).json({ error: 'This temporary download link is invalid, expired or already used.' });
    }
    job.downloadTicketHash = null;
    res.setHeader('Cache-Control', 'no-store, private');
    try {
      if (!job.outputAsset) return res.status(404).json({ error: 'The protected Cloudinary output asset is unavailable.' });
      await streamCloudinaryAsset(job.outputAsset, res, 'video/mp4', job.safeBaseName + '-narrated.mp4');
      await cleanupJob(job);
    } catch (error: any) {
      console.warn('[DemoNarration] Protected Cloudinary download failed:', error?.message || error);
      if (!res.headersSent) res.status(502).json({ error: 'The protected Cloudinary video could not be downloaded.' });
      else res.destroy(error);
    }
  });
}
