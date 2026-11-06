import crypto from 'crypto';
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { v2 as cloudinary } from 'cloudinary';
import {
  getCloudinaryMediaConfig,
  type CloudinaryMediaConfig
} from './cloudinaryCredentials.js';

export interface CloudinaryUploadSignature {
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
  publicId: string;
  resourceType: 'video';
  deliveryType: 'authenticated';
  uploadUrl: string;
}

export interface CloudinaryAsset {
  assetId: string;
  publicId: string;
  resourceType: 'video' | 'raw';
  deliveryType: 'authenticated';
  format: string;
  bytes: number;
  version: number;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
}

function requireAssetString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Cloudinary did not return a verifiable ' + field + '.');
  }
  return value.trim();
}

function signUploadParams(params: Record<string, string | number | boolean>, apiSecret: string): string {
  const canonical = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + '=' + String(value))
    .join('&');
  return crypto.createHash('sha1').update(canonical + apiSecret).digest('hex');
}

export async function createCloudinaryVideoUploadSignature(input: {
  publicId: string;
  folder: string;
}): Promise<CloudinaryUploadSignature> {
  const config = await getCloudinaryMediaConfig();
  if (!config) throw new Error('Cloudinary is not configured. Open Admin Dashboard → Settings → Cloudinary and verify the credentials.');

  const timestamp = Math.floor(Date.now() / 1000);
  const signedParams = {
    folder: input.folder,
    overwrite: false,
    public_id: input.publicId,
    timestamp,
    type: 'authenticated'
  };
  return {
    timestamp,
    signature: signUploadParams(signedParams, config.apiSecret),
    apiKey: config.apiKey,
    cloudName: config.cloudName,
    folder: input.folder,
    publicId: input.publicId,
    resourceType: 'video',
    deliveryType: 'authenticated',
    uploadUrl: 'https://api.cloudinary.com/v1_1/' + encodeURIComponent(config.cloudName) + '/video/upload'
  };
}

async function configureCloudinary(): Promise<CloudinaryMediaConfig> {
  const config = await getCloudinaryMediaConfig();
  if (!config) throw new Error('Cloudinary is not configured. Verify Cloudinary credentials in Admin Dashboard → Settings.');
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
    hide_sensitive: true
  });
  return config;
}

function normalizeAsset(raw: any, expected: {
  assetId: string;
  publicId: string;
  resourceType: 'video' | 'raw';
  deliveryType: 'authenticated';
  expectedBytes?: number;
}): CloudinaryAsset {
  const assetId = requireAssetString(raw?.asset_id, 'asset ID');
  const publicId = requireAssetString(raw?.public_id, 'public ID');
  const resourceType = raw?.resource_type;
  const deliveryType = raw?.type;
  const format = requireAssetString(raw?.format, 'file format');
  const bytes = Number(raw?.bytes);
  const version = Number(raw?.version);

  if (assetId !== expected.assetId || publicId !== expected.publicId) {
    throw new Error('Cloudinary asset identity did not match the signed upload session.');
  }
  if (resourceType !== expected.resourceType || deliveryType !== expected.deliveryType) {
    throw new Error('Cloudinary asset was not stored with the required resource and authenticated delivery types.');
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0 ||
      (typeof expected.expectedBytes === 'number' && bytes !== expected.expectedBytes)) {
    throw new Error('Cloudinary asset size did not match the selected source file.');
  }
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error('Cloudinary did not return a valid asset version.');
  }

  const result: CloudinaryAsset = {
    assetId,
    publicId,
    resourceType,
    deliveryType,
    format,
    bytes,
    version
  };
  if (typeof raw.duration === 'number' && Number.isFinite(raw.duration) && raw.duration > 0) result.duration = raw.duration;
  if (typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width > 0) result.width = raw.width;
  if (typeof raw.height === 'number' && Number.isFinite(raw.height) && raw.height > 0) result.height = raw.height;
  return result;
}

export async function verifyCloudinaryVideoUpload(input: {
  assetId: string;
  publicId: string;
  expectedBytes: number;
}): Promise<CloudinaryAsset> {
  const config = await getCloudinaryMediaConfig();
  if (!config) throw new Error('Cloudinary is not configured.');

  const url = 'https://api.cloudinary.com/v1_1/' + encodeURIComponent(config.cloudName) +
    '/resources/video/upload/' + input.publicId.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(url, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(config.apiKey + ':' + config.apiSecret).toString('base64'),
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(20000)
  });
  if (response.status === 404) throw new Error('Cloudinary could not find the uploaded video. The upload was not accepted.');
  if (!response.ok) throw new Error('Cloudinary could not verify the uploaded video (HTTP ' + response.status + ').');
  const raw = await response.json();
  return normalizeAsset(raw, {
    assetId: input.assetId,
    publicId: input.publicId,
    resourceType: 'video',
    deliveryType: 'authenticated',
    expectedBytes: input.expectedBytes
  });
}

export async function uploadCloudinaryLocalAsset(input: {
  filePath: string;
  folder: string;
  publicId: string;
  resourceType: 'video' | 'raw';
}): Promise<CloudinaryAsset> {
  const config = await configureCloudinary();
  const stat = await fs.promises.stat(input.filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error('The local media file is missing or empty; Cloudinary upload was not attempted.');

  const uploaded: any = await cloudinary.uploader.upload_large(input.filePath, {
    resource_type: input.resourceType,
    type: 'authenticated',
    folder: input.folder,
    public_id: input.publicId,
    overwrite: false,
    unique_filename: false,
    chunk_size: 20 * 1024 * 1024,
    timeout: 15 * 60 * 1000
  });

  const normalized = normalizeAsset(uploaded, {
    assetId: requireAssetString(uploaded?.asset_id, 'asset ID'),
    publicId: input.publicId,
    resourceType: input.resourceType,
    deliveryType: 'authenticated',
    expectedBytes: stat.size
  });
  if (uploaded?.secure_url && !String(uploaded.secure_url).startsWith('https://res.cloudinary.com/' + config.cloudName + '/')) {
    throw new Error('Cloudinary returned an unexpected delivery host. The asset was not accepted.');
  }
  return normalized;
}

export async function getCloudinaryAuthenticatedDeliveryUrl(asset: CloudinaryAsset): Promise<string> {
  const config = await getCloudinaryMediaConfig();
  if (!config) throw new Error('Cloudinary is not configured.');
  const encodedPublicId = asset.publicId.split('/').map(encodeURIComponent).join('/');
  const versionedPath = 'v' + asset.version + '/' + encodedPublicId + '.' + encodeURIComponent(asset.format);
  const signature = crypto.createHash('sha1')
    .update(versionedPath + config.apiSecret)
    .digest('base64url')
    .slice(0, 8);
  return 'https://res.cloudinary.com/' + encodeURIComponent(config.cloudName) + '/' +
    asset.resourceType + '/authenticated/s--' + signature + '--/' + versionedPath;
}

export async function fetchCloudinaryAuthenticatedAsset(asset: CloudinaryAsset): Promise<Response> {
  const url = await getCloudinaryAuthenticatedDeliveryUrl(asset);
  const response = await fetch(url, {
    headers: { Accept: '*/*' },
    signal: AbortSignal.timeout(15 * 60 * 1000)
  });
  if (!response.ok || !response.body) {
    throw new Error('Cloudinary could not deliver the protected media asset (HTTP ' + response.status + ').');
  }
  return response;
}

export async function downloadCloudinaryAuthenticatedAsset(asset: CloudinaryAsset, destination: string): Promise<void> {
  const response = await fetchCloudinaryAuthenticatedAsset(asset);
  await pipeline(
    Readable.fromWeb(response.body as import('stream/web').ReadableStream),
    fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })
  );
  const downloaded = await fs.promises.stat(destination);
  if (downloaded.size !== asset.bytes) {
    await fs.promises.rm(destination, { force: true }).catch(() => undefined);
    throw new Error('The downloaded Cloudinary asset size did not match its verified metadata.');
  }
}

export async function deleteCloudinaryAsset(asset: CloudinaryAsset): Promise<void> {
  await configureCloudinary();
  const result: any = await cloudinary.uploader.destroy(asset.publicId, {
    resource_type: asset.resourceType,
    type: asset.deliveryType,
    invalidate: true
  });
  if (result?.result !== 'ok' && result?.result !== 'not found') {
    throw new Error('Cloudinary did not confirm deletion of asset ' + asset.publicId + '.');
  }
}

export function cloudinaryFolderForAsset(config: CloudinaryMediaConfig): string {
  return config.folderPrefix;
}
