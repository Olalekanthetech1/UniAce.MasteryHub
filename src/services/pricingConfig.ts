import { auth } from '../firebase';
import { safeFetchJson } from '../utils/safeFetch';

export interface PricingPlan {
  id: string;
  name: string;
  price: number; // In Naira (NGN)
  sparks: string;
  duration: string;
  features: string[];
  popular?: boolean;
  badge?: string;
  paystackPlanCode?: string;
  enabled?: boolean;
}

export interface PricingConfig {
  plans: PricingPlan[];
  promoBanner?: {
    enabled: boolean;
    text: string;
    discountPercent?: number;
  };
  lastUpdated?: string;
}

export const PricingService = {
  async getPricingConfig(): Promise<PricingConfig> {
    const res = await safeFetchJson<any>('/api/system/config/pricing', { cache: 'no-store' });
    if (!res.ok || !res.data || !res.data.data || !Array.isArray(res.data.data.plans)) {
      throw new Error('Authoritative pricing configuration is unavailable; no fallback prices will be displayed.');
    }
    return res.data.data as PricingConfig;
  },

  subscribePricingConfig(callback: (config: PricingConfig) => void): () => void {
    let isMounted = true;
    const load = async () => {
      try {
        const config = await PricingService.getPricingConfig();
        if (isMounted) callback(config);
      } catch (error) {
        console.error('[PricingService] Live pricing unavailable:', error);
      }
    };

    load();
    const interval = setInterval(load, 60000);
    const onFocus = () => { load(); };
    window.addEventListener('focus', onFocus);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  },

  async savePricingConfig(config: PricingConfig, token?: string): Promise<void> {
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        key: 'pricing',
        data: {
          ...config,
          lastUpdated: new Date().toISOString()
        }
      })
    });
    if (!res.ok) {
      throw new Error(`Failed to save pricing config: ${res.statusText}`);
    }
  }
};
