import admin from 'firebase-admin';
import { dbTelemetry } from './dbTelemetry';

interface ProviderMetrics {
  requests: number;
  tokens: number;
  latencySum: number;
  errors: number;
}

interface HourlyMetrics {
  time: string;
  groq: number;
  mistral: number;
  gemini: number;
}

class TelemetryService {
  private metrics: Record<string, ProviderMetrics> = {};
  private hourlyHistory: HourlyMetrics[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private isInitialized: boolean = false;
  private isDirty: boolean = false;

  constructor() {
    this.resetMetrics();
  }

  private resetMetrics() {
    const providers = [
      'gemini_direct', 
      'groq', 
      'mistral_direct', 
      'openrouter_free', 
      'cohere', 
      'huggingface',
      'nvidia'
    ];
    providers.forEach(p => {
      this.metrics[p] = { requests: 0, tokens: 0, latencySum: 0, errors: 0 };
    });
  }

  async initialize() {
    if (this.isInitialized) return;
    try {
      try {
        admin.app();
      } catch (e) {
        console.warn('[Telemetry] Firebase Admin not initialized. Skipping Firestore initialization.');
        this.startFlushing();
        return;
      }

      const doc = await admin.firestore().collection('system_stats').doc('ai_telemetry').get();
      if (doc.exists) {
        const data = doc.data();
        if (data && data.metrics) {
          this.metrics = { ...this.metrics, ...data.metrics };
          console.log('[Telemetry] Initialized from Firestore');
        }
      }
      this.isInitialized = true;
      this.startFlushing();
    } catch (e) {
      console.error('[Telemetry] Initialization failed:', e);
      this.startFlushing();
    }
  }

  record(provider: string, tokens: number, latencyMs: number, isError: boolean = false) {
    if (!this.metrics[provider]) {
      this.metrics[provider] = { requests: 0, tokens: 0, latencySum: 0, errors: 0 };
    }
    this.metrics[provider].requests++;
    this.metrics[provider].tokens += tokens;
    this.metrics[provider].latencySum += latencyMs;
    if (isError) this.metrics[provider].errors++;
    this.isDirty = true;

    const now = new Date();
    const hour = now.getHours().toString().padStart(2, '0') + ':00';
    let currentHour = this.hourlyHistory.find(h => h.time === hour);
    if (!currentHour) {
      currentHour = { time: hour, groq: 0, mistral: 0, gemini: 0 };
      this.hourlyHistory.push(currentHour);
      if (this.hourlyHistory.length > 24) this.hourlyHistory.shift();
    }

    if (provider.includes('groq')) currentHour.groq++;
    else if (provider.includes('mistral')) currentHour.mistral++;
    else if (provider.includes('gemini')) currentHour.gemini++;
  }

  getChartData() {
    return this.hourlyHistory;
  }

  getMetrics() {
    const result: any = {};
    for (const [provider, data] of Object.entries(this.metrics)) {
      const avgLatency = data.requests > 0 ? (data.latencySum / data.requests / 1000).toFixed(1) + 's' : '0s';
      const uptime = data.requests > 0 ? ((1 - data.errors / data.requests) * 100).toFixed(1) + '%' : '100%';
      result[provider] = {
        requests: data.requests,
        tokens: this.formatTokens(data.tokens),
        latency: avgLatency,
        uptime: uptime
      };
    }
    return result;
  }

  private formatTokens(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  }

  private startFlushing() {
    if (this.flushInterval) clearInterval(this.flushInterval);
    this.flushInterval = setInterval(async () => {
      await this.flushToFirestore();
    }, 5 * 60 * 1000);
  }

  public async flushToFirestore() {
    if (!this.isDirty) {
      dbTelemetry.recordSuppressedWrite('system_stats', 'unchanged_ai_telemetry_periodic_flush', 1);
      return;
    }
    try {
      try {
        admin.app();
      } catch (e) {
        return;
      }

      this.isDirty = false;
      await admin.firestore().collection('system_stats').doc('ai_telemetry').set({
        metrics: this.metrics,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log('[Telemetry] Flushed dirty metrics to Firestore');
    } catch (e) {
      this.isDirty = true;
      console.error('[Telemetry] Failed to flush metrics:', e);
    }
  }
}

export const telemetry = new TelemetryService();
