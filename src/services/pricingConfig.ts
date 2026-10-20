import { auth } from '../firebase';

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

export const DEFAULT_PRICING_PLANS: PricingPlan[] = [
  {
    id: 'emergency_topup',
    name: 'Emergency Top-Up',
    price: 500,
    sparks: '500',
    duration: 'One-Time',
    features: [
      '500 AI Sparks',
      'Exam Readiness Prediction',
      'Standard Support',
      'Enhanced Precision Logic',
      'Distraction-Free Focus Mode'
    ],
    popular: false,
    enabled: true
  },
  {
    id: 'scholar',
    name: 'Scholar',
    price: 1500,
    sparks: '2,000',
    duration: '30 Days',
    features: [
      '2,000 AI Sparks',
      'Advanced Learning Analytics',
      'Exam Readiness Prediction',
      '30 Days Access',
      'Priority Support',
      'Enhanced Precision Logic',
      'Distraction-Free Focus Mode'
    ],
    popular: true,
    enabled: true
  },
  {
    id: 'semester',
    name: 'Semester Bundle',
    price: 4500,
    sparks: '6,000',
    duration: '120 Days',
    features: [
      '6,000 AI Sparks',
      'Advanced Learning Analytics',
      'Exam Readiness Prediction',
      '120 Days Access',
      'VIP Priority Support',
      'Enhanced Precision Logic',
      'Distraction-Free Focus Mode'
    ],
    popular: false,
    enabled: true
  }
];

export const PricingService = {
  async getPricingConfig(): Promise<PricingConfig> {
    try {
      const res = await fetch('/api/system/config/pricing');
      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data.plans) && json.data.plans.length > 0) {
          return json.data as PricingConfig;
        }
      }
    } catch {
      // Non-fatal, return default
    }
    return { plans: DEFAULT_PRICING_PLANS };
  },

  subscribePricingConfig(callback: (config: PricingConfig) => void): () => void {
    let isMounted = true;
    const load = async () => {
      const config = await PricingService.getPricingConfig();
      if (isMounted) callback(config);
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
