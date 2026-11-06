import crypto from 'crypto';
import { getPostgresPool } from '../postgresPool';
import { ensureMarketingStudioSchema } from './marketingStudioSchema';

const CAMPAIGN_ID_PATTERN = /^[a-z0-9:_-]{3,180}$/i;

/**
 * Record a paid conversion only from the server-side verified Paystack success
 * path. The transaction reference is used only as a one-way deduplication hash.
 */
export async function recordVerifiedMarketingPaidConversion(
  campaignId: unknown,
  transactionReference: unknown
): Promise<boolean> {
  if (typeof campaignId !== 'string' || !CAMPAIGN_ID_PATTERN.test(campaignId.trim())) {
    return false;
  }
  if (typeof transactionReference !== 'string' || !transactionReference.trim() || transactionReference.length > 180) {
    return false;
  }

  await ensureMarketingStudioSchema();
  const pool = getPostgresPool();
  if (!pool) throw new Error('Campaign conversion storage is unavailable: Neon PostgreSQL is not connected.');

  const normalizedCampaign = campaignId.trim();
  const normalizedReference = transactionReference.trim();
  const eventId = crypto.randomUUID();
  const dedupeKey = crypto
    .createHash('sha256')
    .update(`paid_conversion|${normalizedCampaign}|${normalizedReference}`)
    .digest('hex');

  const result = await pool.query(
    `INSERT INTO marketing_campaign_events
      (event_id, campaign_id, event_type, visitor_id, dedupe_key, occurred_at)
     VALUES ($1, $2, 'paid_conversion', NULL, $3, NOW())
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING event_id`,
    [eventId, normalizedCampaign, dedupeKey]
  );
  return result.rowCount === 1;
}
