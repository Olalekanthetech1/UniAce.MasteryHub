import { auth } from '../firebase';

interface CampaignAttribution {
  campaignId: string;
  sessionId: string;
  capturedAt: string;
  medium: string;
}

const ATTRIBUTION_KEY = 'uniace_campaign_attribution';
const SESSION_KEY = 'uniace_marketing_session';
const VALID_CAMPAIGN = /^[a-z0-9:_-]{3,180}$/i;

function getSessionId(): string | null {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[a-z0-9_-]{16,80}$/i.test(existing)) return existing;
    const generated = `s${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    sessionStorage.setItem(SESSION_KEY, generated);
    return generated;
  } catch {
    return null;
  }
}

function getAttribution(): CampaignAttribution | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object' ||
        typeof parsed.campaignId !== 'string' || !VALID_CAMPAIGN.test(parsed.campaignId) ||
        typeof parsed.sessionId !== 'string' || typeof parsed.capturedAt !== 'string') return null;
    if (Date.now() - Date.parse(parsed.capturedAt) > 30 * 60 * 1000) return null;
    return parsed as CampaignAttribution;
  } catch {
    return null;
  }
}

export function getStoredCampaignIdForCheckout(): string | null {
  const attribution = getAttribution();
  return attribution?.campaignId || null;
}

async function sendLandingEvent(campaignId: string, sessionId: string, eventType: 'qr_landing' | 'landing_visit') {
  const response = await fetch('/api/marketing/campaign-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ campaignId, visitorId: sessionId, eventType })
  });
  if (!response.ok) throw new Error(`Campaign event was not accepted (HTTP ${response.status}).`);
}

export async function captureAndTrackCampaignLanding(): Promise<void> {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const campaignId = params.get('utm_campaign')?.trim() || '';
  if (!VALID_CAMPAIGN.test(campaignId)) return;
  const sessionId = getSessionId();
  if (!sessionId) return;
  const medium = (params.get('utm_medium') || '').slice(0, 80);
  const attribution = { campaignId, sessionId, capturedAt: new Date().toISOString(), medium };
  try {
    sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution));
  } catch {
    // Current page tracking may continue without attribution persistence.
  }
  const events: Array<'qr_landing' | 'landing_visit'> = medium.toLowerCase() === 'qr'
    ? ['qr_landing', 'landing_visit']
    : ['landing_visit'];
  const results = await Promise.allSettled(events.map((event) => sendLandingEvent(campaignId, sessionId, event)));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') console.warn('[MarketingCampaignTracking] Event was not confirmed:', failure.reason);
}

/** Called only after Firebase confirms a new account. */
export async function trackCampaignRegistration(): Promise<void> {
  const attribution = getAttribution();
  const user = auth.currentUser;
  if (!attribution || !user) return;
  const token = await user.getIdToken(true);
  const response = await fetch('/api/marketing/campaign-events/registration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ campaignId: attribution.campaignId, visitorId: attribution.sessionId })
  });
  if (!response.ok) throw new Error(`Campaign registration event was not accepted (HTTP ${response.status}).`);
}

export interface MarketingCampaignAnalytics {
  campaignId: string;
  metrics: {
    qrLandings: number;
    landingVisits: number;
    registrations: number;
    paidConversions: number;
    uniqueVisitors: number;
    lastEventAt: string | null;
  };
  source: 'recorded_marketing_campaign_events';
}

export async function getMarketingCampaignAnalytics(campaignId: string): Promise<MarketingCampaignAnalytics> {
  const user = auth.currentUser;
  if (!user) throw new Error('An authenticated administrator session is required to load campaign analytics.');
  const token = await user.getIdToken(true);
  const response = await fetch(`/api/admin/marketing/analytics?campaignId=${encodeURIComponent(campaignId)}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Campaign analytics request failed (HTTP ${response.status}).`);
  if (data?.source !== 'recorded_marketing_campaign_events' || !data?.metrics ||
      !['qrLandings', 'landingVisits', 'registrations', 'paidConversions', 'uniqueVisitors'].every((key) =>
        Number.isSafeInteger(data.metrics[key]) && data.metrics[key] >= 0
      )) {
    throw new Error('The server returned an invalid campaign analytics payload.');
  }
  return data as MarketingCampaignAnalytics;
}
