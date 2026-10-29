import { auth } from '../firebase';
import { safeFetchJson } from '../utils/safeFetch';

export interface ArenaChallenge {
  id: string;
  title: string;
  description: string;
  reward: number; // Sparks or XP
  rewardType: 'sparks' | 'xp';
  iconType: 'swords' | 'trophy' | 'flame' | 'target' | 'star' | 'zap';
  targetCount: number;
  currentCount?: number;
  completed?: boolean;
  claimed?: boolean;
  courseId?: string;
  scope?: 'daily' | 'global';
  updatedAt?: string;
  category: 'battle' | 'quiz' | 'streak' | 'study';
  active: boolean;
}

export const ChallengesService = {
  async getChallenges(): Promise<ArenaChallenge[]> {
    try {
      const user = auth.currentUser;
      if (user) {
        const token = await user.getIdToken();
        const liveRes = await safeFetchJson<any>('/api/arena/challenges/live', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (liveRes.ok && liveRes.data && Array.isArray(liveRes.data.challenges)) {
          return liveRes.data.challenges as ArenaChallenge[];
        }
      }

      const res = await safeFetchJson<any>('/api/system/config/challenges');
      if (res.ok && res.data) {
        const json = res.data;
        if (json.data && Array.isArray(json.data.challenges)) {
          return json.data.challenges as ArenaChallenge[];
        }
      }
    } catch (e) {
      console.warn('Failed to fetch live arena challenges:', e);
    }
    return [];
  },

  async claimChallengeReward(challengeId: string): Promise<{
    success: boolean;
    reward?: number;
    rewardType?: 'sparks' | 'xp';
    ai_sparks?: number;
    xp?: number;
    error?: string;
  }> {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }
    const token = await user.getIdToken();
    const res = await safeFetchJson<any>('/api/arena/challenges/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ challengeId })
    });
    if (res.ok && res.data?.success) {
      return res.data;
    }
    return {
      success: false,
      error: res.data?.error || 'Failed to claim challenge reward'
    };
  },

  subscribeChallenges(callback: (challenges: ArenaChallenge[]) => void): () => void {
    let isSubscribed = true;

    const poll = async () => {
      if (!isSubscribed) return;
      const data = await this.getChallenges();
      if (isSubscribed) callback(data);
    };

    void poll();
    const interval = setInterval(poll, 30000);
    const onFocus = () => { void poll(); };
    window.addEventListener('focus', onFocus);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  },

  async saveChallenges(challenges: ArenaChallenge[]): Promise<void> {
    const user = auth.currentUser;
    const token = user ? await user.getIdToken() : '';
    await fetch('/api/admin/system-config/challenges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        challenges,
        lastUpdated: new Date().toISOString()
      })
    });
  }
};
