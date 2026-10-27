import { useAuth } from '../context/AuthContext';
import { PlanType } from '../types';

function parseDynamicTimestamp(raw: any): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'object') {
    if (typeof raw.toDate === 'function') {
      const d = raw.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    }
    if (typeof raw._seconds === 'number') {
      return new Date(raw._seconds * 1000);
    }
    if (typeof raw.seconds === 'number') {
      return new Date(raw.seconds * 1000);
    }
    if (typeof raw.iso === 'string') {
      const d = new Date(raw.iso);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

export const usePremiumStatus = () => {
  const { profile } = useAuth();

  if (!profile) {
    return {
      isPremium: false,
      isTrialActive: false,
      daysRemaining: 0,
      hoursRemaining: 0,
      planType: 'free' as PlanType
    };
  }

  // Staff roles always have scholar access
  const isStaff = ['tutor', 'moderator', 'admin'].includes(profile.role?.toLowerCase() || '');
  if (isStaff) {
    return {
      isPremium: true,
      isTrialActive: false,
      daysRemaining: 0,
      hoursRemaining: 0,
      planType: 'scholar' as PlanType
    };
  }

  const now = new Date();

  // Dynamic expiration validation for paid/granted subscriptions
  const expiryDate = parseDynamicTimestamp(profile.subscription_expiry);
  const isSubscriptionExpired = Boolean(
    profile.subscription_status === 'expired' ||
    (expiryDate && now.getTime() > expiryDate.getTime())
  );

  // Dynamic trial evaluation based strictly on verified user creation timestamp (never fabricate 'now')
  const userCreatedAt =
    parseDynamicTimestamp(profile.created_at) ||
    parseDynamicTimestamp((profile as any).createdAt);
  const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
  const diffInMs = userCreatedAt ? Math.max(0, now.getTime() - userCreatedAt.getTime()) : Infinity;

  // Trial is only active if user is on free plan, not marked expired, and within the verified 7-day window
  const isTrialActive =
    profile.plan_type === 'free' &&
    !isSubscriptionExpired &&
    userCreatedAt !== null &&
    diffInMs < sevenDaysInMs;
  const daysRemaining = isTrialActive ? Math.max(0, Math.ceil((sevenDaysInMs - diffInMs) / (24 * 60 * 60 * 1000))) : 0;
  const hoursRemaining = isTrialActive ? Math.max(0, Math.ceil((sevenDaysInMs - diffInMs) / (60 * 60 * 1000))) : 0;

  // Active paid plan (non-free plan whose expiration timestamp has not passed)
  const isPaidActive = profile.plan_type !== 'free' && !isSubscriptionExpired;
  const isPremium = isPaidActive || isTrialActive;

  // Effective plan dynamically resolves to 'free' once trial/subscription expires
  const effectivePlan: PlanType = isPremium
    ? (profile.plan_type === 'free' ? 'scholar' : profile.plan_type)
    : 'free';

  return {
    isPremium,
    isTrialActive,
    daysRemaining,
    hoursRemaining,
    planType: effectivePlan
  };
};
