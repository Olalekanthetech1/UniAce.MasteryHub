import React, { useCallback, useEffect, useState } from 'react';
import { auth } from '../../firebase';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2
} from 'lucide-react';

interface CloudinaryCredentialStatus {
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

export default function CloudinaryCredentialSettings() {
  const [status, setStatus] = useState<CloudinaryCredentialStatus | null>(null);
  const [cloudName, setCloudName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [folderPrefix, setFolderPrefix] = useState('marketing-demo-studio');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const authorizedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Your administrator session has expired. Sign in again before changing Cloudinary settings.');
    const headers = new Headers(init.headers);
    headers.set('Authorization', 'Bearer ' + token);
    return fetch(url, { ...init, headers, cache: 'no-store' });
  }, []);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authorizedFetch('/api/admin/demo-studio/cloudinary/credentials');
      const next = await readResponse<CloudinaryCredentialStatus>(response);
      setStatus(next);
      setCloudName(next.cloudName || '');
      setFolderPrefix(next.folderPrefix || 'marketing-demo-studio');
    } catch (loadError: any) {
      setError(loadError?.message || 'Cloudinary credential status could not be loaded.');
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
    if (!cloudName.trim() || !apiKey.trim() || !apiSecret.trim() || !folderPrefix.trim()) {
      setError('Enter the Cloud name, API key, API secret and default folder before saving.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await authorizedFetch('/api/admin/demo-studio/cloudinary/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloudName: cloudName.trim(),
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          folderPrefix: folderPrefix.trim()
        })
      });
      const result = await readResponse<{ success: boolean; credential: CloudinaryCredentialStatus }>(response);
      setStatus(result.credential);
      setApiKey('');
      setApiSecret('');
      setShowApiKey(false);
      setShowApiSecret(false);
      setConfirmClear(false);
      setCloudName(result.credential.cloudName || cloudName.trim());
      setFolderPrefix(result.credential.folderPrefix);
      setSuccess('Cloudinary account verified. Its credentials were encrypted and stored in Neon; neither secret was returned.');
    } catch (saveError: any) {
      setError(saveError?.message || 'Cloudinary could not verify and save these credentials.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsClearing(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await authorizedFetch('/api/admin/demo-studio/cloudinary/credentials', { method: 'DELETE' });
      const result = await readResponse<{ success: boolean; credential: CloudinaryCredentialStatus }>(response);
      setStatus(result.credential);
      setApiKey('');
      setApiSecret('');
      setConfirmClear(false);
      setSuccess(result.credential.source === 'render_environment'
        ? 'The Admin Dashboard configuration was removed. A complete Render environment configuration remains active.'
        : 'The Admin Dashboard Cloudinary configuration was removed.');
    } catch (clearError: any) {
      setError(clearError?.message || 'The Cloudinary configuration could not be removed.');
    } finally {
      setIsClearing(false);
    }
  };

  const sourceLabel = status?.source === 'admin_dashboard'
    ? 'Admin Dashboard · encrypted Neon storage'
    : status?.source === 'render_environment'
      ? 'Render environment variables'
      : 'No complete Cloudinary configuration';

  const canSave = Boolean(
    status?.storageAvailable &&
    status?.encryptionReady &&
    cloudName.trim() &&
    apiKey.trim() &&
    apiSecret.trim() &&
    folderPrefix.trim() &&
    !isSaving &&
    !isLoading
  );

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-sky-100 p-3 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <HardDrive size={22} />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white">Cloudinary · Demo Studio Media Storage</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">
              Configure the Cloudinary product environment used for Marketing & Demo Studio media. UniAce verifies the credentials with Cloudinary before saving them.
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
              <><CheckCircle2 size={15} className="text-emerald-600" /> Configuration stored</>
            ) : status?.configured && !status.decryptable ? (
              <><AlertCircle size={15} className="text-rose-600" /> Credentials cannot be decrypted</>
            ) : (
              <><AlertCircle size={15} className="text-amber-600" /> Not configured</>
            )}
          </div>
          <div className="mt-1 break-all text-[11px] text-slate-500 dark:text-slate-400">{sourceLabel}</div>
          {status?.cloudName && <div className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200">Cloud name: {status.cloudName}</div>}
          {status?.apiKeyHint && <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">API key: {status.apiKeyHint}</div>}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Secure configuration storage</div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-bold">
            <span className={status?.storageAvailable ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}>
              Neon {status?.storageAvailable ? 'available' : isLoading ? 'checking' : 'unavailable'}
            </span>
            <span className={status?.encryptionReady ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}>
              AES-256-GCM {status?.encryptionReady ? 'ready' : isLoading ? 'checking' : 'not configured'}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <FolderOpen size={14} className="shrink-0" /> Default folder: {status?.folderPrefix || folderPrefix || 'marketing-demo-studio'}
          </div>
          <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            The API secret is encrypted on the server and is never returned to the browser. The encryption root is separate from the Cloudinary API secret.
          </p>
        </div>
      </div>

      {status?.configured && !status.decryptable && (
        <div role="alert" className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs leading-5 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          The saved Cloudinary configuration exists but cannot be decrypted. Confirm that the original ACADEMIC_RESEARCH_ENCRYPTION_KEY is still configured on Render. Do not rotate that encryption root unless the encrypted credentials have first been migrated.
        </div>
      )}

      {status?.environmentIncomplete && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          A partial Cloudinary environment configuration was detected. Configure all three values—CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET—or save the complete configuration here.
        </div>
      )}

      {status && (!status.storageAvailable || !status.encryptionReady) && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {status.storageAvailable === false
            ? 'Neon system_config is unavailable. Cloudinary credentials cannot be stored persistently until the database connection is restored.'
            : 'Server-side credential encryption is not configured. Configure ACADEMIC_RESEARCH_ENCRYPTION_KEY in the Render service environment before saving Cloudinary credentials.'}
        </div>
      )}

      <form onSubmit={handleSave} className="mt-5 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cloudinary-cloud-name" className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Cloud name</label>
            <input
              id="cloudinary-cloud-name"
              name="cloudinary-cloud-name"
              type="text"
              value={cloudName}
              onChange={(event) => setCloudName(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Your Cloudinary cloud name"
              className={fieldClass}
              disabled={isLoading || isSaving || isClearing}
            />
          </div>
          <div>
            <label htmlFor="cloudinary-folder-prefix" className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">Default Demo Studio folder</label>
            <input
              id="cloudinary-folder-prefix"
              name="cloudinary-folder-prefix"
              type="text"
              value={folderPrefix}
              onChange={(event) => setFolderPrefix(event.target.value)}
              autoComplete="off"
              placeholder="marketing-demo-studio"
              className={fieldClass}
              disabled={isLoading || isSaving || isClearing}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cloudinary-api-key" className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">API key</label>
            <div className="flex gap-2">
              <input
                id="cloudinary-api-key"
                name="cloudinary-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Enter the Cloudinary API key"
                className={fieldClass}
                disabled={isLoading || isSaving || isClearing}
              />
              <button type="button" onClick={() => setShowApiKey((visible) => !visible)} disabled={!apiKey} aria-label={showApiKey ? 'Hide Cloudinary API key' : 'Show Cloudinary API key'} className="shrink-0 rounded-xl border border-slate-300 px-3 text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">
                {showApiKey ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="cloudinary-api-secret" className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">API secret</label>
            <div className="flex gap-2">
              <input
                id="cloudinary-api-secret"
                name="cloudinary-api-secret"
                type={showApiSecret ? 'text' : 'password'}
                value={apiSecret}
                onChange={(event) => setApiSecret(event.target.value)}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={status?.configured ? 'Enter a replacement API secret' : 'Enter the Cloudinary API secret'}
                className={fieldClass}
                disabled={isLoading || isSaving || isClearing}
              />
              <button type="button" onClick={() => setShowApiSecret((visible) => !visible)} disabled={!apiSecret} aria-label={showApiSecret ? 'Hide Cloudinary API secret' : 'Show Cloudinary API secret'} className="shrink-0 rounded-xl border border-slate-300 px-3 text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">
                {showApiSecret ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
        </div>

        <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
          Both credentials are write-only in this screen. Saving sends them to the authenticated UniAce server, verifies them with Cloudinary’s Admin API, then encrypts the complete configuration in Neon. The API secret is never sent back to the browser.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={!canSave} className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-3 text-xs font-black text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40">
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            {isSaving ? 'Verifying and encrypting…' : status?.source === 'admin_dashboard' ? 'Verify and replace credentials' : 'Verify and save credentials'}
          </button>

          {status?.source === 'admin_dashboard' && !confirmClear && (
            <button type="button" onClick={() => setConfirmClear(true)} disabled={isClearing || isSaving} className="flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-3 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30">
              <Trash2 size={14} /> Remove stored configuration
            </button>
          )}

          {confirmClear && (
            <>
              <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">Remove the Admin Dashboard Cloudinary configuration?</span>
              <button type="button" onClick={() => void handleClear()} disabled={isClearing} className="rounded-xl bg-rose-600 px-4 py-3 text-xs font-black text-white disabled:opacity-40">
                {isClearing ? 'Removing…' : 'Confirm removal'}
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} disabled={isClearing} className="rounded-xl border border-slate-300 px-4 py-3 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">Cancel</button>
            </>
          )}
        </div>
      </form>

      {error && <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"><AlertCircle size={15} className="mr-2 inline" />{error}</div>}
      {success && <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><CheckCircle2 size={15} className="mr-2 inline" />{success}</div>}

      <div className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-4 text-[11px] leading-5 text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        <span>
          Admin Dashboard credentials take precedence over CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET on Render. Removing the dashboard configuration falls back to environment variables only when all three are present. Keep ACADEMIC_RESEARCH_ENCRYPTION_KEY stable while encrypted provider credentials are stored.
        </span>
      </div>
    </section>
  );
}
