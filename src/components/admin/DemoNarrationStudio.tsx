import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { DemoScenario } from '../../services/demoReelService';
import toast from 'react-hot-toast';
import {
  AudioLines,
  CheckCircle2,
  Clapperboard,
  Download,
  Loader2,
  Mic2,
  PauseCircle,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Subtitles,
  Volume2,
  XCircle
} from 'lucide-react';

interface DemoNarrationStudioProps {
  videoBlob: Blob | null;
  videoDuration: number;
  videoFileName: string | null;
  videoMimeType: string;
  scenario: DemoScenario | null;
}

interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
}

interface VoiceOption {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  labels: Record<string, string>;
  previewUrl: string | null;
  settings: Partial<VoiceSettings> | null;
  isOwner: boolean;
}

interface ModelOption {
  modelId: string;
  name: string;
  description: string | null;
  maximumTextLength: number | null;
  canUseStyle: boolean | null;
  canUseSpeakerBoost: boolean | null;
  requiresAlphaAccess: boolean | null;
  tokenCostFactor: number | null;
  languages: Array<{ languageId: string | null; name: string | null }>;
}

interface ProviderStatus {
  configured: boolean;
  credentialSource: 'admin_dashboard' | 'render_environment' | null;
  credentialKeyHint: string | null;
  credentialStorageAvailable: boolean;
  credentialEncryptionReady: boolean;
  credentialDecryptable: boolean;
  credentialError: string | null;
  provider: string;
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  maxUploadBytes: number;
  maxScriptCharacters: number;
  maxDurationSeconds: number;
}

interface AccountUsage {
  tier: string | null;
  status: string | null;
  characterCount: number | null;
  characterLimit: number | null;
  nextResetAt: string | null;
  overageEnabled: boolean;
  voiceSlotsUsed: number | null;
  voiceLimit: number | null;
}

interface NarrationJob {
  jobId: string;
  status: 'generating_audio' | 'narration_ready' | 'rendering' | 'completed' | 'failed' | 'cancelled';
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
  expiresAt: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message = typeof data?.error === 'string'
      ? data.error
      : typeof data?.detail === 'string'
        ? data.detail
        : 'The server request failed with HTTP ' + response.status + '.';
    throw new Error(message);
  }
  return data as T;
}

function inferMimeType(blob: Blob, fileName: string): string {
  if (blob.type) return blob.type;
  const extension = fileName.toLowerCase().split('.').pop();
  const types: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    mov: 'video/quicktime',
    webm: 'video/webm',
    ogv: 'video/ogg',
    '3gp': 'video/3gpp',
    '3g2': 'video/3gpp2'
  };
  return types[extension || ''] || 'application/octet-stream';
}

function uploadVideoWithProgress(
  url: string,
  token: string,
  blob: Blob,
  onProgress: (percentage: number | null) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      onProgress(event.lengthComputable && event.total > 0
        ? Math.min(100, Math.round(event.loaded / event.total * 100))
        : null);
    };
    xhr.onerror = () => reject(new Error('The video upload connection failed.'));
    xhr.onabort = () => reject(new Error('The video upload was cancelled.'));
    xhr.onload = () => {
      let data: any = {};
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch { data = {}; }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data?.error || 'The video upload failed with HTTP ' + xhr.status + '.'));
        return;
      }
      onProgress(100);
      resolve();
    };
    xhr.send(blob);
  });
}

function normalizeVoiceSettings(value: unknown): Partial<VoiceSettings> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const normalized: Partial<VoiceSettings> = {};
  if (typeof raw.stability === 'number' && Number.isFinite(raw.stability) && raw.stability >= 0 && raw.stability <= 1) normalized.stability = raw.stability;
  if (typeof raw.similarity_boost === 'number' && Number.isFinite(raw.similarity_boost) && raw.similarity_boost >= 0 && raw.similarity_boost <= 1) normalized.similarity_boost = raw.similarity_boost;
  if (typeof raw.style === 'number' && Number.isFinite(raw.style) && raw.style >= 0 && raw.style <= 1) normalized.style = raw.style;
  if (typeof raw.use_speaker_boost === 'boolean') normalized.use_speaker_boost = raw.use_speaker_boost;
  if (typeof raw.speed === 'number' && Number.isFinite(raw.speed) && raw.speed >= 0.7 && raw.speed <= 1.2) normalized.speed = raw.speed;
  return Object.keys(normalized).length > 0 ? normalized : null;
}

const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white';
const labelClass = 'mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400';

export default function DemoNarrationStudio({
  videoBlob,
  videoDuration,
  videoFileName,
  videoMimeType,
  scenario
}: DemoNarrationStudioProps) {
  const { user } = useAuth();
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [account, setAccount] = useState<AccountUsage | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [nextVoicePage, setNextVoicePage] = useState<string | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(null);
  const [voiceSettingsLoading, setVoiceSettingsLoading] = useState(false);
  const [voiceSettingsError, setVoiceSettingsError] = useState<string | null>(null);
  const [script, setScript] = useState(() => scenario
    ? scenario.steps.map((step) => step.title + '. ' + step.subtitle).join('\n\n')
    : '');
  const [scriptApproved, setScriptApproved] = useState(false);
  const [originalAudioMode, setOriginalAudioMode] = useState<'mix' | 'duck' | 'narration_only'>('duck');
  const [originalAudioVolume, setOriginalAudioVolume] = useState(0.16);
  const [narrationVolume, setNarrationVolume] = useState(1);
  const [subtitles, setSubtitles] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<'source' | '16:9' | '9:16' | '1:1'>('source');
  const [resolution, setResolution] = useState<'source' | '720p' | '1080p'>('source');
  const [loadingProvider, setLoadingProvider] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [job, setJob] = useState<NarrationJob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [outputPreviewUrl, setOutputPreviewUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingSubtitles, setIsDownloadingSubtitles] = useState(false);
  const audioPreviewRef = useRef<string | null>(null);
  const cancelledPollingRef = useRef(false);

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.voiceId === selectedVoiceId) || null,
    [voices, selectedVoiceId]
  );
  const selectedModel = useMemo(
    () => models.find((model) => model.modelId === selectedModelId) || null,
    [models, selectedModelId]
  );
  const scriptLength = script.length;
  const scriptWithinModelLimit = Boolean(
    providerStatus &&
    scriptLength <= providerStatus.maxScriptCharacters &&
    (!selectedModel?.maximumTextLength || scriptLength <= selectedModel.maximumTextLength)
  );
  const maxUploadBytes = providerStatus?.maxUploadBytes ?? 0;
  const videoSizeMb = videoBlob ? videoBlob.size / (1024 * 1024) : null;
  const canStart = Boolean(
    user &&
    videoBlob &&
    videoBlob.size > 0 &&
    providerStatus?.configured &&
    providerStatus?.ffmpegAvailable &&
    providerStatus?.ffprobeAvailable &&
    selectedVoice &&
    !voiceSettingsLoading &&
    selectedModel &&
    script.trim().length >= 5 &&
    scriptApproved &&
    scriptWithinModelLimit &&
    !isWorking &&
    (!maxUploadBytes || videoBlob.size <= maxUploadBytes)
  );

  const authFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    if (!user) throw new Error('An authenticated administrator session is required.');
    const token = await user.getIdToken();
    if (!token) throw new Error('The administrator session did not provide an access token.');
    const headers = new Headers(init.headers);
    headers.set('Authorization', 'Bearer ' + token);
    return fetch(url, { ...init, headers, cache: 'no-store' });
  }, [user]);

  const loadVoices = useCallback(async (search: string, pageToken?: string | null, append = false) => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (pageToken) params.set('next_page_token', pageToken);
    const response = await authFetch('/api/admin/demo-narration/voices?' + params.toString());
    const data = await readJsonResponse<{ voices: VoiceOption[]; hasMore: boolean; nextPageToken: string | null }>(response);
    setVoices((previous) => append ? [...previous, ...data.voices.filter((voice) => !previous.some((old) => old.voiceId === voice.voiceId))] : data.voices);
    setNextVoicePage(data.hasMore ? data.nextPageToken : null);
  }, [authFetch]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoadingProvider(true);
      setProviderError(null);
      try {
        const statusResponse = await authFetch('/api/admin/demo-narration/status');
        const status = await readJsonResponse<ProviderStatus>(statusResponse);
        if (!active) return;
        setProviderStatus(status);
        if (status.credentialError) {
          setProviderError(status.credentialError + ' The secure credential store must be available before voice discovery can be used.');
          setLoadingProvider(false);
          return;
        }
        if (!status.credentialStorageAvailable) {
          setProviderError('Neon credential storage is unavailable. Restore the UniAce system_config database connection before using Admin Dashboard-managed ElevenLabs credentials.');
          setLoadingProvider(false);
          return;
        }
        if (status.configured && !status.credentialDecryptable) {
          setProviderError('An ElevenLabs key is stored but cannot be decrypted. Check that the original ACADEMIC_RESEARCH_ENCRYPTION_KEY is still configured on Render.');
          setLoadingProvider(false);
          return;
        }
        if (!status.configured) {
          setProviderError(status.credentialEncryptionReady
            ? 'ElevenLabs is not configured. Open Admin Dashboard → Settings and save an API key using the secure ElevenLabs credential panel.'
            : 'ElevenLabs is not configured and server-side encryption is unavailable. Configure ACADEMIC_RESEARCH_ENCRYPTION_KEY on the UniAce Render service, then save the ElevenLabs key in Admin Dashboard → Settings.');
          setLoadingProvider(false);
          return;
        }
        const [voiceResult, modelResult, accountResult] = await Promise.all([
          authFetch('/api/admin/demo-narration/voices').then((response) => readJsonResponse<{ voices: VoiceOption[]; hasMore: boolean; nextPageToken: string | null }>(response)),
          authFetch('/api/admin/demo-narration/models').then((response) => readJsonResponse<{ models: ModelOption[] }>(response)),
          authFetch('/api/admin/demo-narration/account').then((response) => readJsonResponse<AccountUsage>(response))
        ]);
        if (!active) return;
        setVoices(voiceResult.voices);
        setNextVoicePage(voiceResult.hasMore ? voiceResult.nextPageToken : null);
        setModels(modelResult.models);
        setAccount(accountResult);
        if (!status.ffmpegAvailable || !status.ffprobeAvailable) {
          setProviderError('The ElevenLabs account is reachable, but server rendering is unavailable because FFmpeg or FFprobe was not detected in this Render runtime.');
        } else if (voiceResult.voices.length === 0) {
          setProviderError('ElevenLabs returned no voices available to this API key. No sample voice has been substituted.');
        } else if (modelResult.models.length === 0) {
          setProviderError('ElevenLabs returned no text-to-speech models available to this API key.');
        }
      } catch (error: any) {
        if (active) setProviderError(error?.message || 'Live ElevenLabs configuration could not be loaded.');
      } finally {
        if (active) setLoadingProvider(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [authFetch]);

  useEffect(() => {
    setScript(scenario
      ? scenario.steps.map((step) => step.title + '. ' + step.subtitle).join('\n\n')
      : '');
    setScriptApproved(false);
  }, [scenario?.id]);

  useEffect(() => {
    if (!selectedVoice) {
      setVoiceSettings(null);
      setVoiceSettingsLoading(false);
      setVoiceSettingsError(null);
      return;
    }
    setVoiceSettingsError(null);
    const settings = normalizeVoiceSettings(selectedVoice.settings);
    if (settings) {
      setVoiceSettings(settings);
      setVoiceSettingsLoading(false);
      return;
    }

    let active = true;
    setVoiceSettings(null);
    setVoiceSettingsLoading(true);
    void authFetch('/api/admin/demo-narration/voices/' + encodeURIComponent(selectedVoice.voiceId) + '/settings')
      .then((response) => readJsonResponse<{ settings: Partial<VoiceSettings> }>(response))
      .then((data) => {
        if (!active) return;
        const live = normalizeVoiceSettings(data.settings);
        if (live) setVoiceSettings(live);
      })
      .catch((error: any) => {
        if (active) setVoiceSettingsError(error?.message || 'The selected voice settings could not be retrieved.');
      })
      .finally(() => {
        if (active) setVoiceSettingsLoading(false);
      });
    return () => { active = false; };
  }, [selectedVoice, authFetch]);

  useEffect(() => {
    if (!job || !['generating_audio', 'rendering'].includes(job.status)) return;
    let active = true;
    let timer: number | undefined;
    cancelledPollingRef.current = false;
    const poll = async () => {
      try {
        const response = await authFetch('/api/admin/demo-narration/jobs/' + encodeURIComponent(job.jobId));
        const next = await readJsonResponse<NarrationJob>(response);
        if (!active || cancelledPollingRef.current) return;
        setJob(next);
        if (next.status === 'generating_audio' || next.status === 'rendering') {
          timer = window.setTimeout(poll, 1600);
        } else if (next.status === 'failed') {
          setOperationError(next.error || next.statusMessage);
          toast.error(next.error || 'The narration job failed.');
        } else if (next.status === 'narration_ready') {
          toast.success('ElevenLabs finished the narration. Listen to it before rendering.');
        } else if (next.status === 'completed') {
          toast.success('The final video passed server-side verification.');
        }
      } catch (error: any) {
        if (!active || cancelledPollingRef.current) return;
        setOperationError(error?.message || 'The narration job status could not be retrieved.');
        active = false;
      }
    };
    timer = window.setTimeout(poll, 1200);
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [authFetch, job?.jobId, job?.status]);

  useEffect(() => {
    let active = true;
    if (!job || !['narration_ready', 'rendering', 'completed'].includes(job.status)) {
      if (audioPreviewRef.current) URL.revokeObjectURL(audioPreviewRef.current);
      audioPreviewRef.current = null;
      setAudioPreviewUrl(null);
      return;
    }
    if (audioPreviewRef.current) return;
    void authFetch('/api/admin/demo-narration/jobs/' + encodeURIComponent(job.jobId) + '/audio')
      .then(async (response) => {
        if (!response.ok) return readJsonResponse<any>(response);
        const blob = await response.blob();
        if (!blob.size) throw new Error('The generated narration preview was empty.');
        const url = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        audioPreviewRef.current = url;
        setAudioPreviewUrl(url);
      })
      .catch((error: any) => {
        if (active) setOperationError(error?.message || 'The generated narration could not be previewed.');
      });
    return () => { active = false; };
  }, [authFetch, job?.jobId, job?.status]);

  useEffect(() => {
    if (!job || job.status !== 'completed') {
      if (outputPreviewUrl) URL.revokeObjectURL(outputPreviewUrl);
      setOutputPreviewUrl(null);
      return;
    }
    let active = true;
    void authFetch('/api/admin/demo-narration/jobs/' + encodeURIComponent(job.jobId) + '/video-preview')
      .then(async (response) => {
        if (!response.ok) return readJsonResponse<any>(response);
        const blob = await response.blob();
        if (!blob.size) throw new Error('The verified MP4 preview returned an empty file.');
        const url = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        setOutputPreviewUrl(url);
      })
      .catch((error: any) => {
        if (active) setOperationError(error?.message || 'The final MP4 preview could not be loaded.');
      });
    return () => { active = false; };
  }, [authFetch, job?.jobId, job?.status]);

  useEffect(() => {
    return () => {
      if (audioPreviewRef.current) URL.revokeObjectURL(audioPreviewRef.current);
      if (outputPreviewUrl) URL.revokeObjectURL(outputPreviewUrl);
    };
  }, [outputPreviewUrl]);

  const handleSearchVoices = async () => {
    setProviderError(null);
    try {
      await loadVoices(voiceSearch, null, false);
    } catch (error: any) {
      setProviderError(error?.message || 'The live voice search failed.');
    }
  };

  const handleLoadMoreVoices = async () => {
    if (!nextVoicePage) return;
    try {
      await loadVoices(voiceSearch, nextVoicePage, true);
    } catch (error: any) {
      setProviderError(error?.message || 'The next live voice page could not be loaded.');
    }
  };

  const handleCreateNarration = async () => {
    if (!canStart || !videoBlob || !selectedVoice || !selectedModel || !voiceSettings) return;
    setIsWorking(true);
    setOperationError(null);
    setUploadProgress(null);
    setJob(null);
    const effectiveVoiceSettings: Partial<VoiceSettings> | undefined = voiceSettings
      ? { ...voiceSettings }
      : undefined;
    if (effectiveVoiceSettings && selectedModel.canUseStyle !== true) {
      delete effectiveVoiceSettings.style;
    }
    if (effectiveVoiceSettings && selectedModel.canUseSpeakerBoost !== true) {
      delete effectiveVoiceSettings.use_speaker_boost;
    }
    const settingsForRequest = effectiveVoiceSettings && Object.keys(effectiveVoiceSettings).length > 0
      ? effectiveVoiceSettings
      : undefined;
    let uploadId: string | null = null;
    try {
      const fileName = videoFileName || (videoMimeType.includes('mp4') ? 'uniace-browser-recording.mp4' : 'uniace-browser-recording.webm');
      const mimeType = inferMimeType(videoBlob, fileName);
      const allocationResponse = await authFetch('/api/admin/demo-narration/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, mimeType, size: videoBlob.size })
      });
      const allocation = await readJsonResponse<{ uploadId: string }>(allocationResponse);
      uploadId = allocation.uploadId;
      setUploadProgress(0);
      const token = await user!.getIdToken();
      await uploadVideoWithProgress(
        '/api/admin/demo-narration/uploads/' + encodeURIComponent(uploadId),
        token,
        videoBlob,
        setUploadProgress
      );

      const jobResponse = await authFetch('/api/admin/demo-narration/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          voiceId: selectedVoice.voiceId,
          modelId: selectedModel.modelId,
          script: script.trim(),
          ...(settingsForRequest ? { voiceSettings: settingsForRequest } : {}),
          originalAudioMode,
          originalAudioVolume,
          narrationVolume,
          subtitles,
          aspectRatio,
          resolution
        })
      });
      const created = await readJsonResponse<NarrationJob>(jobResponse);
      setJob(created);
      setUploadProgress(null);
    } catch (error: any) {
      setOperationError(error?.message || 'The narration request could not be started.');
      toast.error(error?.message || 'The narration request failed.');
      if (uploadId) {
        await authFetch('/api/admin/demo-narration/uploads/' + encodeURIComponent(uploadId), { method: 'DELETE' }).catch(() => undefined);
      }
    } finally {
      setIsWorking(false);
    }
  };

  const handleStartRender = async () => {
    if (!job || job.status !== 'narration_ready') return;
    setOperationError(null);
    try {
      const response = await authFetch('/api/admin/demo-narration/jobs/' + encodeURIComponent(job.jobId) + '/render', { method: 'POST' });
      const updated = await readJsonResponse<NarrationJob>(response);
      setJob(updated);
    } catch (error: any) {
      setOperationError(error?.message || 'Video rendering could not start.');
      toast.error(error?.message || 'Video rendering could not start.');
    }
  };

  const handleCancelJob = async () => {
    cancelledPollingRef.current = true;
    if (job) {
      try {
        await authFetch('/api/admin/demo-narration/jobs/' + encodeURIComponent(job.jobId), { method: 'DELETE' });
      } catch (error: any) {
        setOperationError(error?.message || 'The server could not confirm job cancellation.');
        return;
      }
    }
    if (audioPreviewRef.current) URL.revokeObjectURL(audioPreviewRef.current);
    audioPreviewRef.current = null;
    setAudioPreviewUrl(null);
    if (outputPreviewUrl) URL.revokeObjectURL(outputPreviewUrl);
    setOutputPreviewUrl(null);
    setJob(null);
    toast('Temporary narration job cancelled and server files removed.');
  };

  const handleDownload = async () => {
    if (!job || job.status !== 'completed') return;
    setIsDownloading(true);
    try {
      const response = await authFetch('/api/admin/demo-narration/jobs/' + encodeURIComponent(job.jobId) + '/download-ticket', { method: 'POST' });
      const result = await readJsonResponse<{ url: string; expiresAt: string }>(response);
      const link = document.createElement('a');
      link.href = new URL(result.url, window.location.origin).toString();
      link.download = (videoFileName || 'uniace-demo').replace(/\.[^.]+$/, '') + '-narrated.mp4';
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('The verified MP4 download has been requested. The temporary server files are deleted after the transfer finishes.');
    } catch (error: any) {
      setOperationError(error?.message || 'The temporary download link could not be created.');
      toast.error(error?.message || 'The final video could not be downloaded.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadSubtitles = async () => {
    if (!job || job.status !== 'completed') return;
    setIsDownloadingSubtitles(true);
    try {
      const response = await authFetch('/api/admin/demo-narration/jobs/' + encodeURIComponent(job.jobId) + '/subtitles');
      const blob = await response.blob();
      if (!response.ok || blob.size === 0) throw new Error('A generated subtitle file is not available for this job.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (videoFileName || 'uniace-demo').replace(/\.[^.]+$/, '') + '-narration.srt';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error: any) {
      setOperationError(error?.message || 'The subtitle file could not be downloaded.');
    } finally {
      setIsDownloadingSubtitles(false);
    }
  };

  const handleReset = async () => {
    if (job) await handleCancelJob();
    setOperationError(null);
    setJob(null);
    setScriptApproved(false);
  };

  const usageText = account?.characterCount !== null && account?.characterCount !== undefined &&
    account?.characterLimit !== null && account?.characterLimit !== undefined
    ? account.characterCount.toLocaleString() + ' / ' + account.characterLimit.toLocaleString() + ' characters used'
    : 'Character usage not returned by the account API';
  const fileTooLarge = Boolean(videoBlob && maxUploadBytes > 0 && videoBlob.size > maxUploadBytes);
  const cannotRender = Boolean(providerStatus && (!providerStatus.ffmpegAvailable || !providerStatus.ffprobeAvailable));

  return (
    <section className="mt-7 rounded-3xl border border-indigo-200 bg-indigo-50/60 p-5 dark:border-indigo-900/60 dark:bg-indigo-950/20 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-indigo-600 p-3 text-white">
            <Mic2 size={22} />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white">AI Narration & Video Rendering</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
              Choose a live ElevenLabs voice, approve the script, listen to the generated narration, then render the final video on the server.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300">
          {providerStatus?.configured ? 'ElevenLabs connected' : loadingProvider ? 'Checking provider' : 'Provider unavailable'}
        </span>
      </div>

      {loadingProvider && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <Loader2 size={15} className="animate-spin" /> Checking the live ElevenLabs account, voice catalogue, models and rendering runtime…
        </div>
      )}

      {providerError && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {providerError}
        </div>
      )}
      {operationError && (
        <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs leading-5 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          {operationError}
        </div>
      )}

      {account && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className={labelClass}>ElevenLabs plan</div>
            <div className="text-sm font-black text-slate-900 dark:text-white">{account.tier || account.status || 'Not reported'}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className={labelClass}>Account usage</div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">{usageText}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className={labelClass}>Next reset</div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">{account.nextResetAt ? new Date(account.nextResetAt).toLocaleString() : 'Not reported'}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label className={labelClass} htmlFor="demo-voice-search">Search live ElevenLabs voices</label>
            <div className="flex gap-2">
              <input
                id="demo-voice-search"
                value={voiceSearch}
                onChange={(event) => setVoiceSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void handleSearchVoices(); }}
                placeholder="Search by name, accent, category or label"
                className={inputClass}
              />
              <button type="button" onClick={() => void handleSearchVoices()} className="shrink-0 rounded-xl bg-slate-900 px-4 text-xs font-black text-white dark:bg-white dark:text-slate-900">
                Search
              </button>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="demo-voice-select">Select voice</label>
            <select
              id="demo-voice-select"
              className={inputClass}
              value={selectedVoiceId}
              onChange={(event) => setSelectedVoiceId(event.target.value)}
              disabled={loadingProvider || voices.length === 0 || Boolean(job && ['generating_audio', 'rendering'].includes(job.status))}
            >
              <option value="">Choose from the live voice catalogue…</option>
              {voices.map((voice) => (
                <option key={voice.voiceId} value={voice.voiceId}>
                  {voice.name}{voice.category ? ' · ' + voice.category : ''}
                </option>
              ))}
            </select>
            {nextVoicePage && (
              <button type="button" onClick={() => void handleLoadMoreVoices()} className="mt-2 text-xs font-bold text-indigo-700 underline dark:text-indigo-300">
                Load more voices returned by ElevenLabs
              </button>
            )}
          </div>

          {selectedVoice && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-black text-slate-900 dark:text-white">{selectedVoice.name}</div>
                <span className="text-[10px] font-bold uppercase text-slate-500">{selectedVoice.isOwner ? 'Your voice' : selectedVoice.category || 'Available voice'}</span>
              </div>
              {selectedVoice.description && <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{selectedVoice.description}</p>}
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(selectedVoice.labels || {}).map(([key, value]) => (
                  <span key={key} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {key}: {value}
                  </span>
                ))}
              </div>
              {selectedVoice.previewUrl ? (
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase text-slate-500">Live voice sample</div>
                  <audio controls preload="none" src={selectedVoice.previewUrl} className="h-9 w-full" />
                </div>
              ) : (
                <p className="text-[11px] text-slate-500">ElevenLabs did not provide a preview sample for this voice. The generated narration can still be reviewed before video rendering.</p>
              )}
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="demo-model-select">Text-to-speech model</label>
            <select
              id="demo-model-select"
              className={inputClass}
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
              disabled={loadingProvider || models.length === 0 || Boolean(job && ['generating_audio', 'rendering'].includes(job.status))}
            >
              <option value="">Choose a model supported by this account…</option>
              {models.map((model) => (
                <option key={model.modelId} value={model.modelId}>{model.name}</option>
              ))}
            </select>
            {selectedModel?.description && <p className="mt-1 text-[11px] leading-4 text-slate-500">{selectedModel.description}</p>}
            {selectedModel?.requiresAlphaAccess === true && (
              <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">ElevenLabs marks this model as requiring alpha access. The provider will validate whether your account can use it.</p>
            )}
            {selectedModel?.tokenCostFactor !== null && selectedModel?.tokenCostFactor !== undefined && (
              <p className="mt-1 text-[10px] text-slate-500">Provider-reported model cost factor: {selectedModel.tokenCostFactor}</p>
            )}
            {selectedModel?.maximumTextLength && (
              <p className="mt-1 text-[10px] font-semibold text-slate-500">
                {scriptLength.toLocaleString()} / {selectedModel.maximumTextLength.toLocaleString()} characters
                {!scriptWithinModelLimit && <span className="ml-2 text-rose-600">Model limit exceeded</span>}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className={labelClass} htmlFor="demo-narration-script">Narration script</label>
              {scenario && (
                <button
                  type="button"
                  onClick={() => { setScript(scenario.steps.map((step) => step.title + '. ' + step.subtitle).join('\n\n')); setScriptApproved(false); }}
                  className="mb-1 text-[10px] font-bold text-indigo-700 underline dark:text-indigo-300"
                  disabled={Boolean(job && ['generating_audio', 'rendering'].includes(job.status))}
                >
                  Reload verified scenario text
                </button>
              )}
            </div>
            <textarea
              id="demo-narration-script"
              value={script}
              onChange={(event) => { setScript(event.target.value); setScriptApproved(false); }}
              rows={9}
              maxLength={providerStatus?.maxScriptCharacters}
              placeholder="Write what the narrator should explain about the actual video. This field stays blank for imported recordings until you provide verified narration text."
              className={inputClass + ' resize-y leading-6'}
              disabled={Boolean(job && ['generating_audio', 'rendering'].includes(job.status))}
            />
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>{scenario ? 'Draft sourced from the selected Demo Studio scenario.' : 'No scenario is attached. No narration text has been invented.'}</span>
              <span>{scriptLength.toLocaleString()} characters</span>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
            <input type="checkbox" checked={scriptApproved} onChange={(event) => setScriptApproved(event.target.checked)} className="mt-1" />
            <span>I have reviewed this complete script against the recording and approve the factual claims before sending it to ElevenLabs.</span>
          </label>

          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 flex items-center gap-2 text-xs font-black text-slate-800 dark:text-slate-100">
              <SlidersHorizontal size={14} /> Voice settings returned by the selected voice
            </div>
            {voiceSettings ? (
              <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {typeof voiceSettings.stability === 'number' && (
                  <label className="text-[11px] text-slate-600 dark:text-slate-300">
                    Stability: {voiceSettings.stability.toFixed(2)}
                    <input type="range" min="0" max="1" step="0.05" value={voiceSettings.stability} onChange={(e) => setVoiceSettings({ ...voiceSettings, stability: Number(e.target.value) })} className="mt-1 block w-full" />
                  </label>
                )}
                {typeof voiceSettings.similarity_boost === 'number' && (
                  <label className="text-[11px] text-slate-600 dark:text-slate-300">
                    Similarity: {voiceSettings.similarity_boost.toFixed(2)}
                    <input type="range" min="0" max="1" step="0.05" value={voiceSettings.similarity_boost} onChange={(e) => setVoiceSettings({ ...voiceSettings, similarity_boost: Number(e.target.value) })} className="mt-1 block w-full" />
                  </label>
                )}
                {selectedModel?.canUseStyle === true && typeof voiceSettings.style === 'number' && (
                  <label className="text-[11px] text-slate-600 dark:text-slate-300">
                    Style: {voiceSettings.style.toFixed(2)}
                    <input type="range" min="0" max="1" step="0.05" value={voiceSettings.style} onChange={(e) => setVoiceSettings({ ...voiceSettings, style: Number(e.target.value) })} className="mt-1 block w-full" />
                  </label>
                )}
                {typeof voiceSettings.speed === 'number' && (
                  <label className="text-[11px] text-slate-600 dark:text-slate-300">
                    Speed: {voiceSettings.speed.toFixed(2)}
                    <input type="range" min="0.7" max="1.2" step="0.05" value={voiceSettings.speed} onChange={(e) => setVoiceSettings({ ...voiceSettings, speed: Number(e.target.value) })} className="mt-1 block w-full" />
                  </label>
                )}
                {selectedModel?.canUseSpeakerBoost === true && typeof voiceSettings.use_speaker_boost === 'boolean' && (
                  <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 sm:col-span-2">
                    <input type="checkbox" checked={voiceSettings.use_speaker_boost} onChange={(e) => setVoiceSettings({ ...voiceSettings, use_speaker_boost: e.target.checked })} />
                    Use speaker boost
                  </label>
                )}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">Style and speaker-boost controls are shown only when the selected live model reports support for them. Settings that the model does not support are omitted from the TTS request.</p>
              </>
            ) : voiceSettingsLoading ? (
              <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Loading the selected voice's current settings from ElevenLabs…</p>
            ) : voiceSettingsError ? (
              <p className="text-xs text-rose-600">Voice settings lookup failed: {voiceSettingsError} Custom settings will not be sent; ElevenLabs' configured voice defaults will be used.</p>
            ) : (
              <p className="text-xs text-slate-500">ElevenLabs did not return editable settings for this voice. UniAce will omit them and use the voice's configured provider defaults.</p>
            )}
          </div>
        </div>
      </div>

      <details className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <summary className="flex cursor-pointer items-center gap-2 text-xs font-black text-slate-800 dark:text-slate-100">
          <SlidersHorizontal size={14} /> Audio, subtitles and export settings
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="demo-original-audio">Original video audio</label>
            <select id="demo-original-audio" className={inputClass} value={originalAudioMode} onChange={(e) => setOriginalAudioMode(e.target.value as 'mix' | 'duck' | 'narration_only')}>
              <option value="duck">Automatically lower original audio while narration speaks</option>
              <option value="mix">Mix narration and original audio at a steady level</option>
              <option value="narration_only">Replace original audio with narration</option>
            </select>
            {(originalAudioMode === 'mix' || originalAudioMode === 'duck') && (
              <label className="mt-3 block text-xs text-slate-600 dark:text-slate-300">
                Original audio level: {Math.round(originalAudioVolume * 100)}%
                <input type="range" min="0" max="1" step="0.05" value={originalAudioVolume} onChange={(e) => setOriginalAudioVolume(Number(e.target.value))} className="mt-1 block w-full" />
              </label>
            )}
          </div>
          <div>
            <label className={labelClass}>Narration level: {Math.round(narrationVolume * 100)}%</label>
            <input type="range" min="0.1" max="2" step="0.05" value={narrationVolume} onChange={(e) => setNarrationVolume(Number(e.target.value))} className="mt-1 block w-full" />
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />
              <Subtitles size={14} /> Generate timed subtitles from ElevenLabs alignment and embed them in the MP4
            </label>
          </div>
          <div>
            <label className={labelClass} htmlFor="demo-aspect-ratio">Output aspect ratio</label>
            <select id="demo-aspect-ratio" className={inputClass} value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as typeof aspectRatio)}>
              <option value="source">Preserve source aspect ratio</option>
              <option value="16:9">16:9 landscape</option>
              <option value="9:16">9:16 vertical</option>
              <option value="1:1">1:1 square</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="demo-resolution">Output resolution</label>
            <select id="demo-resolution" className={inputClass} value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}>
              <option value="source">Preserve source resolution</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </div>
        </div>
      </details>

      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-black text-slate-900 dark:text-white">Selected source video</div>
          <div className="text-[10px] font-bold text-slate-500">{videoSizeMb === null ? 'No video file' : videoSizeMb.toFixed(2) + ' MB · ' + videoDuration + 's'}</div>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {videoFileName || 'Browser recording'} · {videoMimeType || videoBlob?.type || 'MIME type not reported'}
        </p>
        {fileTooLarge && <p className="text-xs font-bold text-rose-600">This recording exceeds the live server upload limit of {(maxUploadBytes / (1024 * 1024)).toFixed(0)} MB.</p>}
        {providerStatus && (
          <div className="flex flex-wrap gap-3 text-[10px] font-bold">
            <span className={providerStatus.ffmpegAvailable ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}>FFmpeg {providerStatus.ffmpegAvailable ? 'available' : 'unavailable'}</span>
            <span className={providerStatus.ffprobeAvailable ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}>FFprobe {providerStatus.ffprobeAvailable ? 'available' : 'unavailable'}</span>
            <span className="text-slate-500">Server duration limit: {Math.round(providerStatus.maxDurationSeconds / 60)} minutes</span>
          </div>
        )}
      </div>

      {!job && (
        <button
          type="button"
          onClick={() => void handleCreateNarration()}
          disabled={!canStart}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isWorking ? <Loader2 size={17} className="animate-spin" /> : <AudioLines size={17} />}
          {isWorking ? 'Uploading source video and creating narration…' : 'Generate AI narration for this video'}
        </button>
      )}

      {uploadProgress !== null && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-bold text-slate-600 dark:text-slate-300">
            <span>Actual upload progress</span><span>{uploadProgress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: uploadProgress + '%' }} />
          </div>
        </div>
      )}

      {job && (
        <div className="rounded-2xl border border-indigo-200 bg-white p-4 dark:border-indigo-900/60 dark:bg-slate-900 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-black text-slate-900 dark:text-white">
              <Clapperboard size={16} /> Video production job
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-200">{job.status.replace('_', ' ')}</span>
          </div>
          <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{job.statusMessage}</p>
          {job.progressPercent !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-bold text-slate-500"><span>FFmpeg progress</span><span>{job.progressPercent}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: job.progressPercent + '%' }} />
              </div>
            </div>
          )}
          {job.characterCost && <p className="text-[11px] text-slate-500">ElevenLabs reported character cost: {job.characterCost}</p>}
          {job.requestId && <p className="break-all text-[10px] text-slate-500">Provider request ID: {job.requestId}</p>}

          {audioPreviewUrl && ['narration_ready', 'rendering', 'completed'].includes(job.status) && (
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
              <div className="mb-2 flex items-center gap-2 text-xs font-black text-slate-800 dark:text-slate-100">
                <Volume2 size={14} /> Review the generated narration before rendering
              </div>
              <audio controls preload="metadata" src={audioPreviewUrl} className="h-10 w-full" />
            </div>
          )}

          {job.status === 'completed' && outputPreviewUrl && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
              <div className="text-xs font-black text-slate-800 dark:text-slate-100">Final rendered video preview</div>
              <video controls playsInline preload="metadata" src={outputPreviewUrl} className="max-h-[420px] w-full rounded-lg bg-black" />
            </div>
          )}

          {job.status === 'narration_ready' && (
            <button type="button" onClick={() => void handleStartRender()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white hover:bg-emerald-500">
              <Clapperboard size={15} /> Render final video with this narration
            </button>
          )}

          {job.status === 'completed' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={16} /> Output verified{job.outputWidth && job.outputHeight ? ' · ' + job.outputWidth + ' × ' + job.outputHeight : ''}{job.outputBytes ? ' · ' + (job.outputBytes / (1024 * 1024)).toFixed(2) + ' MB' : ''}
              </div>
              {subtitles && (
                <button type="button" onClick={() => void handleDownloadSubtitles()} disabled={isDownloadingSubtitles} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  {isDownloadingSubtitles ? <Loader2 size={14} className="animate-spin" /> : <Subtitles size={14} />}
                  Download separate SRT subtitles
                </button>
              )}
              <button type="button" onClick={() => void handleDownload()} disabled={isDownloading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50">
                {isDownloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                Download verified MP4 (deletes temporary server files)
              </button>
            </div>
          )}

          {job.status === 'failed' && (
            <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
              <div className="mb-1 flex items-center gap-2 font-black"><XCircle size={15} /> Production failed</div>
              {job.error || 'The server did not provide an error detail.'}
            </div>
          )}

          {['generating_audio', 'rendering'].includes(job.status) && (
            <div className="flex items-center gap-2 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
              <Loader2 size={14} className="animate-spin" /> Processing on the UniAce server
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            {['generating_audio', 'rendering', 'narration_ready'].includes(job.status) ? (
              <button type="button" onClick={() => void handleCancelJob()} className="flex items-center gap-1.5 text-xs font-bold text-rose-600">
                <PauseCircle size={14} /> Cancel and delete temporary media
              </button>
            ) : (
              <button type="button" onClick={() => void handleReset()} className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                <RefreshCw size={14} /> Start another narration
              </button>
            )}
            <span className="text-[10px] text-slate-500">Temporary server files expire at {new Date(job.expiresAt).toLocaleTimeString()} if not downloaded.</span>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] leading-5 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200">
        <ShieldCheck size={15} className="mt-0.5 shrink-0" />
        <span>
          Privacy: the source video and generated audio are uploaded only after you start narration. They are kept in temporary server storage, never saved in the course database, and deleted after a successful download or expiry. The approved narration text is sent to ElevenLabs; the video itself is not sent to ElevenLabs.
        </span>
      </div>
    </section>
  );
}
