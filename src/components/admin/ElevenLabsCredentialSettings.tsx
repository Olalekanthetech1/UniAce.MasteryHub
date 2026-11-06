import React, { useCallback, useEffect, useState } from 'react';
import { auth } from '../../firebase';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2
} from 'lucide-react';

interface CredentialStatus {
  configured: boolean;
  source: 'admin_dashboard' | 'render_environment' | 'none';
  keyHint: string | null;
  encryptionReady: boolean;
  storageAvailable: boolean;
  decryptable: boolean;
}

async function readResponse<T>(response: Response): Promise<T> {
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
    const detail = typeof data?.detail === 'string' ? ' ' + data.detail : '';
    throw new Error(message + detail);
  }
  return data as T;
}

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800';
const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

export default function ElevenLabsCredentialSettings() {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const authorizedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Your administrator session has expired. Sign in again before changing provider credentials.');
    const headers = new Headers(init.headers);
    headers.set('Authorization', 'Bearer ' + token);
    return fetch(url, { ...init, headers, cache: 'no-store' });
  }, []);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authorizedFetch('/api/admin/demo-narration/credentials');
      const next = await readResponse<CredentialStatus>(response);
      setStatus(next);
    } catch (loadError: any) {
      setError(loadError?.message || 'The ElevenLabs credential status could not be loaded.');
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [authorizedFetch]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = apiKey.trim();
    if (!normalized) {
      setError('Paste your ElevenLabs API key before saving.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await authorizedFetch('/api/admin/demo-narration/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: normalized })
      });
      const result = await readResponse<{ success: boolean; credential: CredentialStatus }>(response);
      setStatus(result.credential);
      setApiKey('');
      setShowKey(false);
      setConfirmClear(false);
      setSuccess('ElevenLabs verified the key and UniAce stored it encrypted. The full key was not returned.');
    } catch (saveError: any) {
      setError(saveError?.message || 'The ElevenLabs key could not be verified and saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsClearing(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await authorizedFetch('/api/admin/demo-narration/credentials', { method: 'DELETE' });
      const result = await readResponse<{ success: boolean; credential: CredentialStatus }>(response);
      setStatus(result.credential);
      setApiKey('');
      setConfirmClear(false);
      setSuccess(result.credential.source === 'render_environment'
        ? 'The Admin Dashboard key was removed. A Render environment key is still configured and remains active.'
        : 'The Admin Dashboard-stored ElevenLabs key was removed.');
    } catch (clearError: any) {
      setError(clearError?.message || 'The stored ElevenLabs key could not be removed.');
    } finally {
      setIsClearing(false);
    }
  };

  const sourceLabel = status?.source === 'admin_dashboard'
    ? 'Admin Dashboard · encrypted Neon storage'
    : status?.source === 'render_environment'
      ? 'Render environment variable'
      : 'No key configured';

  const canSave = Boolean(
    status?.storageAvailable &&
    status?.encryptionReady &&
    apiKey.trim().length > 0 &&
    !isSaving
  );

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            <KeyRound size={22} />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white">ElevenLabs · AI Narration</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">
              Configure the provider key used by Demo Studio voice discovery, narration generation and account usage checks.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={isLoading || isSaving || isClearing}
          className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh status
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Connection status</div>
          <div className="mt-2 flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
            {isLoading ? (
              <><Loader2 size={15} className="animate-spin text-slate-400" /> Checking secure storage…</>
            ) : status?.configured && status.decryptable ? (
              <><CheckCircle2 size={15} className="text-emerald-600" /> Key configured</>
            ) : status?.configured && !status.decryptable ? (
              <><AlertCircle size={15} className="text-rose-600" /> Key cannot be decrypted</>
            ) : (
              <><AlertCircle size={15} className="text-amber-600" /> Not configured</>
            )}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{sourceLabel}</div>
          {status?.keyHint && (
            <div className="mt-2 font-mono text-xs text-slate-600 dark:text-slate-300">{status.keyHint}</div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Secure storage readiness</div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-bold">
            <span className={status?.storageAvailable ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}>
              Neon {status?.storageAvailable ? 'available' : isLoading ? 'checking' : 'unavailable'}
            </span>
            <span className={status?.encryptionReady ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}>
              AES-256-GCM {status?.encryptionReady ? 'ready' : isLoading ? 'checking' : 'not configured'}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            The encryption key remains on the server. It is not the ElevenLabs API key and is never sent to the browser.
          </p>
        </div>
      </div>

      {status?.configured && !status.decryptable && (
        <div role="alert" className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs leading-5 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          The stored key exists, but the server could not decrypt it. Confirm that the original ACADEMIC_RESEARCH_ENCRYPTION_KEY is still configured on Render. Do not replace that encryption key unless the existing encrypted provider credentials have been migrated.
        </div>
      )}

      {(!status?.storageAvailable || (status && !status.encryptionReady)) && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {status?.storageAvailable === false
            ? 'Neon system_config is unavailable. The API key cannot be stored persistently until the database connection is restored.'
            : 'Server-side credential encryption is not configured. Configure ACADEMIC_RESEARCH_ENCRYPTION_KEY in the Render service environment before saving an Admin Dashboard key.'}
        </div>
      )}

      <form onSubmit={handleSave} className="mt-5 space-y-3">
        <div>
          <label htmlFor="elevenlabs-admin-api-key" className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">
            ElevenLabs API key
          </label>
          <div className="flex gap-2">
            <input
              id="elevenlabs-admin-api-key"
              name="elevenlabs-api-key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={status?.configured ? 'Paste a replacement key to rotate the current key' : 'Paste your ElevenLabs API key'}
              className={fieldClass}
              disabled={isLoading || isSaving || isClearing || !status?.storageAvailable || !status?.encryptionReady}
            />
            <button
              type="button"
              onClick={() => setShowKey((visible) => !visible)}
              disabled={!apiKey}
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              className="shrink-0 rounded-xl border border-slate-300 px-3 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            Saving verifies the key with ElevenLabs before encrypting it in Neon. The full key is write-only: UniAce never returns it to the browser or displays it again.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!canSave}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-xs font-black text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            {isSaving ? 'Verifying and encrypting…' : status?.configured ? 'Verify and replace key' : 'Verify and save key'}
          </button>

          {status?.source === 'admin_dashboard' && !confirmClear && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={isClearing || isSaving}
              className="flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-3 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              <Trash2 size={14} /> Remove stored key
            </button>
          )}

          {confirmClear && (
            <>
              <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">Remove the Admin Dashboard key?</span>
              <button type="button" onClick={() => void handleClear()} disabled={isClearing} className="rounded-xl bg-rose-600 px-4 py-3 text-xs font-black text-white disabled:opacity-40">
                {isClearing ? 'Removing…' : 'Confirm removal'}
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} disabled={isClearing} className="rounded-xl border border-slate-300 px-4 py-3 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                Cancel
              </button>
            </>
          )}
        </div>
      </form>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> {success}
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-4 text-[11px] leading-5 text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        <span>
          Admin Dashboard keys take precedence over ELEVENLABS_API_KEY in Render. Removing the dashboard key falls back to the Render environment value, if one exists. Never paste the encryption key into this field.
        </span>
      </div>
    </section>
  );
}
