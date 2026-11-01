import { UserProgress, Achievement, LeaderboardEntry } from '../types';
import { safeFetchJson } from '../utils/safeFetch';

export type GamificationCondition =
  | { type: 'mastery_count'; threshold: number }
  | { type: 'streak'; threshold: number }
  | { type: 'mastery_percent'; threshold: number }
  | { type: 'quizzes_completed'; threshold: number };

export interface GamificationLevel {
  level: number;
  xp: number;
  title: string;
}

export interface GamificationBadge {
  id: string;
  title: string;
  description: string;
  icon: string;
  condition: GamificationCondition;
}

export interface GamificationPolicy {
  levels: GamificationLevel[];
  badges: GamificationBadge[];
  version: string;
}

function validatePolicy(data: any): GamificationPolicy {
  if (!data || typeof data !== 'object' ||
      typeof data.version !== 'string' || !data.version.trim() ||
      !Array.isArray(data.levels) || data.levels.length === 0 ||
      !Array.isArray(data.badges)) {
    throw new Error('The persisted gamification policy is missing required live configuration.');
  }

  const levels = data.levels.map((level: any) => {
    if (!Number.isInteger(level?.level) || level.level < 1 ||
        !Number.isInteger(level?.xp) || level.xp < 0 ||
        typeof level?.title !== 'string' || !level.title.trim()) {
      throw new Error('A persisted gamification level is missing a valid level, XP threshold or title.');
    }
    return { level: level.level, xp: level.xp, title: level.title };
  }).sort((a: GamificationLevel, b: GamificationLevel) => a.xp - b.xp);

  if (new Set(levels.map((level: GamificationLevel) => level.level)).size !== levels.length ||
      new Set(levels.map((level: GamificationLevel) => level.xp)).size !== levels.length) {
    throw new Error('The persisted gamification level table contains duplicate values.');
  }

  const badges = data.badges.map((badge: any) => {
    const condition = badge?.condition;
    const allowedConditions = ['mastery_count', 'streak', 'mastery_percent', 'quizzes_completed'];
    if (typeof badge?.id !== 'string' || !badge.id.trim() ||
        typeof badge?.title !== 'string' || !badge.title.trim() ||
        typeof badge?.description !== 'string' || !badge.description.trim() ||
        typeof badge?.icon !== 'string' || !badge.icon.trim() ||
        !condition || !allowedConditions.includes(condition.type) ||
        !Number.isFinite(condition.threshold) || condition.threshold < 0) {
      throw new Error('A persisted gamification badge is missing a valid identity or condition.');
    }
    return {
      id: badge.id,
      title: badge.title,
      description: badge.description,
      icon: badge.icon,
      condition: { type: condition.type, threshold: condition.threshold } as GamificationCondition
    };
  });

  if (new Set(badges.map((badge: GamificationBadge) => badge.id)).size !== badges.length) {
    throw new Error('The persisted gamification policy contains duplicate badge identifiers.');
  }

  return { levels, badges, version: data.version };
}

export class GamificationService {
  static async getPolicy(): Promise<GamificationPolicy> {
    const res = await safeFetchJson<any>('/api/system/config/gamification', { cache: 'no-store' });
    const payload = res.data?.data || res.data;
    if (!res.ok) {
      throw new Error(res.error || 'Live gamification policy is unavailable.');
    }
    return validatePolicy(payload);
  }

  static calculateLevel(xp: number, policy: GamificationPolicy): GamificationLevel {
    if (!Number.isFinite(xp) || xp < 0) throw new Error('A verified non-negative XP balance is required.');
    if (!policy || !Array.isArray(policy.levels) || policy.levels.length === 0) {
      throw new Error('A verified live gamification level table is required.');
    }
    const eligible = policy.levels.filter(level => xp >= level.xp);
    if (eligible.length === 0) throw new Error('The persisted gamification policy has no level applicable to the supplied XP.');
    return eligible[eligible.length - 1];
  }

  static getNextLevel(xp: number, policy: GamificationPolicy): GamificationLevel | null {
    if (!Number.isFinite(xp) || xp < 0 || !policy || !Array.isArray(policy.levels)) {
      throw new Error('A verified XP value and live gamification policy are required.');
    }
    return policy.levels.find(level => xp < level.xp) || null;
  }

  static checkNewBadges(progress: UserProgress, policy: GamificationPolicy): Achievement[] {
    if (!policy || !Array.isArray(policy.badges)) {
      throw new Error('A verified live badge policy is required.');
    }
    const existingBadgeIds = new Set((progress.achievements || []).map(a => a.id));
    return policy.badges.filter(badge => {
      if (existingBadgeIds.has(badge.id)) return false;
      const threshold = badge.condition.threshold;
      switch (badge.condition.type) {
        case 'mastery_count':
          return Object.keys(progress.mastery || {}).length >= threshold;
        case 'streak':
          return Number(progress.streak) >= threshold;
        case 'mastery_percent':
          return Object.values(progress.mastery || {}).some(value => Number(value) >= threshold);
        case 'quizzes_completed':
          return Number(progress.quizzesCompleted || 0) >= threshold;
        default:
          return false;
      }
    }).map(badge => ({
      id: badge.id,
      title: badge.title,
      description: badge.description,
      icon: badge.icon,
      unlockedAt: new Date().toISOString()
    }));
  }

  static async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const res = await safeFetchJson<any>('/api/gamification/leaderboard', { cache: 'no-store' });
    if (!res.ok || !res.data || !Array.isArray(res.data.leaderboard)) {
      throw new Error(res.error || 'Live leaderboard records are unavailable.');
    }
    return res.data.leaderboard.map((entry: any, index: number) => {
      if (typeof entry.id !== 'string' || !entry.id.trim() ||
          typeof entry.name !== 'string' || !entry.name.trim() ||
          !Number.isInteger(entry.xp) || !Number.isInteger(entry.level) ||
          !Number.isInteger(entry.rank) || entry.rank < 1) {
        throw new Error(`Leaderboard entry ${index + 1} is missing verified data.`);
      }
      return {
        userId: entry.id,
        displayName: entry.name,
        photoURL: typeof entry.avatar === 'string' ? entry.avatar : '',
        xp: entry.xp,
        rank: entry.rank,
        streak: Number.isInteger(entry.streak) ? entry.streak : 0,
      };
    });
  }
}
