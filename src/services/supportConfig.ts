import { auth } from '../firebase';
import { safeFetchJson } from '../utils/safeFetch';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  order?: number;
}

export interface TutorialItem {
  id: string;
  title: string;
  duration: string;
  thumbnail: string;
  description: string;
  videoUrl?: string;
  category?: string;
}

export interface SupportConfig {
  faqs: FaqItem[];
  tutorials: TutorialItem[];
  contactEmail?: string;
  whatsappSupport?: string;
  lastUpdated?: string;
}

export const SupportService = {
  async getSupportConfig(): Promise<SupportConfig> {
    const res = await safeFetchJson<any>('/api/system/config/support', { cache: 'no-store' });
    const data = res.data?.data;
    if (!res.ok || !data || typeof data !== 'object' ||
        !Array.isArray(data.faqs) || !Array.isArray(data.tutorials)) {
      throw new Error('Authoritative support content is unavailable; no default FAQs, tutorials or contact details will be substituted.');
    }
    return {
      faqs: data.faqs as FaqItem[],
      tutorials: data.tutorials as TutorialItem[],
      contactEmail: typeof data.contactEmail === 'string' ? data.contactEmail : undefined,
      whatsappSupport: typeof data.whatsappSupport === 'string' ? data.whatsappSupport : undefined,
      lastUpdated: typeof data.lastUpdated === 'string' ? data.lastUpdated : undefined
    };
  },

  subscribeSupportConfig(callback: (config: SupportConfig) => void): () => void {
    let isSubscribed = true;

    const poll = async () => {
      if (!isSubscribed) return;
      try {
        const data = await this.getSupportConfig();
        if (isSubscribed) callback(data);
      } catch (error) {
        console.error('[SupportService] Live support content unavailable:', error);
      }
    };

    poll();
    const interval = setInterval(poll, 60000);
    const onFocus = () => { poll(); };
    window.addEventListener('focus', onFocus);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  },

  async saveSupportConfig(config: SupportConfig): Promise<void> {
    const user = auth.currentUser;
    const token = user ? await user.getIdToken() : '';
    await fetch('/api/admin/system-config/support', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        ...config,
        lastUpdated: new Date().toISOString()
      })
    });
  }
};
