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
  category: 'battle' | 'quiz' | 'streak' | 'study';
  active: boolean;
}

export const DEFAULT_CHALLENGES: ArenaChallenge[] = [
  {
    id: 'win_1',
    title: 'First Blood',
    description: 'Win 1 Arena Battle',
    reward: 50,
    rewardType: 'sparks',
    iconType: 'swords',
    targetCount: 1,
    category: 'battle',
    active: true
  },
  {
    id: 'win_3',
    title: 'Gladiator',
    description: 'Win 3 Arena Battles',
    reward: 200,
    rewardType: 'sparks',
    iconType: 'trophy',
    targetCount: 3,
    category: 'battle',
    active: true
  },
  {
    id: 'streak_2',
    title: 'On Fire',
    description: 'Achieve a 2-win streak in Arena',
    reward: 150,
    rewardType: 'sparks',
    iconType: 'flame',
    targetCount: 2,
    category: 'streak',
    active: true
  },
  {
    id: 'quiz_master',
    title: 'Quiz Ace',
    description: 'Complete 3 Practice Quizzes with >80% score',
    reward: 100,
    rewardType: 'sparks',
    iconType: 'star',
    targetCount: 3,
    category: 'quiz',
    active: true
  }
];

export const ChallengesService = {
  async getChallenges(): Promise<ArenaChallenge[]> {
    try {
      const res = await safeFetchJson<any>('/api/system/config/challenges');
      if (res.ok && res.data) {
        const json = res.data;
        if (json.data && Array.isArray(json.data.challenges) && json.data.challenges.length > 0) {
          return json.data.challenges as ArenaChallenge[];
        }
      }
    } catch (e) {
      console.warn('Using default challenges due to fetch error:', e);
    }
    return DEFAULT_CHALLENGES;
  },

  subscribeChallenges(callback: (challenges: ArenaChallenge[]) => void): () => void {
    let isSubscribed = true;

    const poll = async () => {
      if (!isSubscribed) return;
      const data = await this.getChallenges();
      if (isSubscribed) callback(data);
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
