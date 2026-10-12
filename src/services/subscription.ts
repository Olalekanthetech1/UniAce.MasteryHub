import { PlanType } from '../types';

export interface PlanLimits {
  sparksPerDay: number | 'unlimited' | null;
  arenaBattlesPerDay: number | 'unlimited';
  pastQuestionsPerDay: number | 'unlimited';
  hasAdvancedAnalytics: boolean;
  hasExamReadiness: boolean;
  hasPrioritySupport: boolean;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  'free': {
    sparksPerDay: null,
    arenaBattlesPerDay: 3,
    pastQuestionsPerDay: 5,
    hasAdvancedAnalytics: false,
    hasExamReadiness: false,
    hasPrioritySupport: false,
  },
  'exam_cram': {
    sparksPerDay: 'unlimited',
    arenaBattlesPerDay: 'unlimited',
    pastQuestionsPerDay: 'unlimited',
    hasAdvancedAnalytics: false,
    hasExamReadiness: true,
    hasPrioritySupport: false,
  },
  'scholar': {
    sparksPerDay: 'unlimited',
    arenaBattlesPerDay: 'unlimited',
    pastQuestionsPerDay: 'unlimited',
    hasAdvancedAnalytics: true,
    hasExamReadiness: true,
    hasPrioritySupport: true,
  },
  'semester': {
    sparksPerDay: 'unlimited',
    arenaBattlesPerDay: 'unlimited',
    pastQuestionsPerDay: 'unlimited',
    hasAdvancedAnalytics: true,
    hasExamReadiness: true,
    hasPrioritySupport: true,
  },
};

export class SubscriptionService {
  static getLimits(plan: PlanType): PlanLimits {
    return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  }

  static canUseFeature(plan: PlanType, feature: keyof PlanLimits): boolean {
    const limits = this.getLimits(plan);
    const value = limits[feature];
    if (typeof value === 'boolean') return value;
    if (value === 'unlimited') return true;
    if (value === null) return false;
    return value > 0; // This is a simplified check, actual usage tracking would be needed for counts
  }
}
