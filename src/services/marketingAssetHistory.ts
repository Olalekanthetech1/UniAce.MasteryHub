import { auth } from '../firebase';
import { DynamicFlyerConfig, MarketingTargetScope } from './demoReelService';

export interface MarketingAssetSnapshot {
  targetScope: MarketingTargetScope;
  selectedFaculty?: string;
  selectedDepartment?: string;
  selectedCourseId?: string;
  copyReviewRequired: boolean;
  config: DynamicFlyerConfig;
}

export interface MarketingAssetVersion {
  id: string;
  assetKey: string;
  assetName: string;
  targetScope: MarketingTargetScope;
  version: number;
  createdAt: string | null;
}

export interface MarketingAssetVersionDetail extends MarketingAssetVersion {
  snapshot: MarketingAssetSnapshot;
}

async function getAdminToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('An authenticated administrator session is required to use marketing asset history.');
  return user.getIdToken(true);
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Marketing asset history request failed (HTTP ${response.status}).`);
  }
  return data as T;
}

export async function listMarketingAssetVersions(assetKey: string): Promise<MarketingAssetVersion[]> {
  const token = await getAdminToken();
  const response = await fetch(`/api/admin/marketing/assets?assetKey=${encodeURIComponent(assetKey)}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readApiResponse<{ versions: MarketingAssetVersion[] }>(response);
  if (!Array.isArray(data.versions)) throw new Error('The server returned an invalid marketing version list.');
  return data.versions;
}

export async function saveMarketingAssetVersion(input: {
  assetKey: string;
  assetName: string;
  snapshot: MarketingAssetSnapshot;
}): Promise<MarketingAssetVersion> {
  const token = await getAdminToken();
  const response = await fetch('/api/admin/marketing/assets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(input)
  });
  const data = await readApiResponse<{ version: MarketingAssetVersion }>(response);
  if (!data.version || typeof data.version.id !== 'string' || !Number.isInteger(data.version.version)) {
    throw new Error('The server did not confirm a persisted marketing asset version.');
  }
  return data.version;
}

export async function getMarketingAssetVersion(id: string): Promise<MarketingAssetVersionDetail> {
  const token = await getAdminToken();
  const response = await fetch(`/api/admin/marketing/assets/${encodeURIComponent(id)}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readApiResponse<{ version: MarketingAssetVersionDetail }>(response);
  if (!data.version?.snapshot?.config || !Number.isInteger(data.version.version)) {
    throw new Error('The selected marketing asset version failed validation.');
  }
  return data.version;
}
