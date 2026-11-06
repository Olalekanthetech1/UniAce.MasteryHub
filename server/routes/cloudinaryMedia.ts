import express from 'express';
import { z } from 'zod';
import {
  clearCloudinaryMediaConfig,
  getCloudinaryCredentialStatus,
  normalizeCloudinaryConfig,
  saveCloudinaryMediaConfig,
  type CloudinaryMediaConfig
} from '../services/cloudinaryCredentials.js';

const CloudinaryUpdateSchema = z.object({
  cloudName: z.string().trim().min(2).max(64),
  apiKey: z.string().trim().min(1).max(4096),
  apiSecret: z.string().trim().min(1).max(4096),
  folderPrefix: z.string().trim().min(1).max(180)
}).strict();

async function verifyCloudinaryAccount(config: CloudinaryMediaConfig): Promise<void> {
  const endpoint = 'https://api.cloudinary.com/v1_1/' +
    encodeURIComponent(config.cloudName) +
    '/resources/image?max_results=1';

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(config.apiKey + ':' + config.apiSecret).toString('base64'),
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(15000)
    });
  } catch (error: any) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('Cloudinary did not respond within 15 seconds. The credentials were not saved.');
    }
    throw new Error('Cloudinary could not be reached. Check the network and try again. The credentials were not saved.');
  }

  if (response.status === 401) {
    throw new Error('Cloudinary rejected the Cloud name, API key or API secret. Check the values and try again.');
  }
  if (response.status === 403) {
    throw new Error('Cloudinary denied access to the Admin API. Check the API key permissions for this product environment.');
  }
  if (response.status === 404) {
    throw new Error('Cloudinary could not find that product environment. Check the Cloud name.');
  }
  if (response.status === 429) {
    throw new Error('Cloudinary rate-limited the verification request. Wait before trying again.');
  }
  if (!response.ok) {
    throw new Error('Cloudinary credential verification failed with HTTP ' + response.status + '. The credentials were not saved.');
  }

  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object' || !Array.isArray((body as any).resources)) {
    throw new Error('Cloudinary returned an unexpected Admin API response. The credentials were not saved.');
  }
}

export function setupCloudinaryMediaRoutes(app: express.Express): void {
  app.get('/api/admin/demo-studio/cloudinary/credentials', async (_req, res) => {
    try {
      const credential = await getCloudinaryCredentialStatus();
      res.set('Cache-Control', 'private, no-store');
      return res.json(credential);
    } catch (error: any) {
      return res.status(503).json({
        error: 'Cloudinary credential status could not be read from the secure Neon store.',
        detail: typeof error?.message === 'string' ? error.message.slice(0, 300) : 'Secure credential storage is unavailable.'
      });
    }
  });

  app.put('/api/admin/demo-studio/cloudinary/credentials', async (req, res) => {
    const parsed = CloudinaryUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Cloud name, API key, API secret and a valid default folder are required.' });
    }

    let config: CloudinaryMediaConfig;
    try {
      config = normalizeCloudinaryConfig(parsed.data);
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Cloudinary configuration is invalid.' });
    }

    try {
      await verifyCloudinaryAccount(config);
      const credential = await saveCloudinaryMediaConfig(config);
      res.set('Cache-Control', 'private, no-store');
      return res.json({ success: true, credential });
    } catch (error: any) {
      const message = typeof error?.message === 'string'
        ? error.message
        : 'Cloudinary credentials could not be verified and saved.';
      const isStorageError = /Neon|system_config|encrypt|ACADEMIC_RESEARCH_ENCRYPTION_KEY|database/i.test(message);
      return res.status(isStorageError ? 503 : 400).json({
        error: message.slice(0, 320)
      });
    }
  });

  app.delete('/api/admin/demo-studio/cloudinary/credentials', async (_req, res) => {
    try {
      const credential = await clearCloudinaryMediaConfig();
      res.set('Cache-Control', 'private, no-store');
      return res.json({ success: true, credential });
    } catch (error: any) {
      return res.status(503).json({
        error: 'The Admin Dashboard Cloudinary configuration could not be removed from Neon.',
        detail: typeof error?.message === 'string' ? error.message.slice(0, 300) : 'Secure credential storage is unavailable.'
      });
    }
  });
}
