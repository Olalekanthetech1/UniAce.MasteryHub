import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Zap, Clock, X, ArrowRight, Sparkles, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import PricingModal from './PricingModal';

interface PaywallManagerProps {
  onUpgrade: () => void;
}

export default function PaywallManager({ onUpgrade }: PaywallManagerProps) {
  const { profile } = useAuth();
  const { isTrialActive, daysRemaining, hoursRemaining, isPremium } = usePremiumStatus();
  const [showSoftWarning, setShowSoftWarning] = useState(false);
  const [showHardStop, setShowHardStop] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!profile) return;

    const isStaff = ['tutor', 'moderator', 'admin'].includes(profile.role?.toLowerCase() || '');
    if (isStaff) {
      setShowSoftWarning(false);
      setShowHardStop(false);
      return;
    }

    // Active paid subscribers (valid subscription_expiry) do not see paywalls
    if (isPremium && !isTrialActive) {
      setShowSoftWarning(false);
      setShowHardStop(false);
      return;
    }

    // Scenario A: Soft Warning (Trial ending soon or low sparks on free tier)
    const isTrialEndingSoon = isTrialActive && daysRemaining <= 1;
    const isSparksLow = !isPremium && profile.ai_sparks > 0 && profile.ai_sparks < 50;

    if ((isTrialEndingSoon || isSparksLow) && !isDismissed) {
      setShowSoftWarning(true);
    } else {
      setShowSoftWarning(false);
    }

    // Scenario C: Time Hard Stop (Trial Expired, Subscription Expired, or Out of Sparks)
    const isTrialExpired = !isTrialActive && profile.plan_type === 'free';
    const isSubscriptionExpired = profile.plan_type !== 'free' && !isPremium;
    const isOutOfSparks = !isPremium && (profile.ai_sparks ?? 0) <= 0;

    if ((isTrialExpired || isSubscriptionExpired || isOutOfSparks) && !isPremium) {
      setShowHardStop(true);
    } else {
      setShowHardStop(false);
    }
  }, [profile, isTrialActive, daysRemaining, hoursRemaining, isPremium, isDismissed]);

  if (showHardStop) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-md">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white dark:bg-zinc-900 rounded-[2.5rem] p-8 max-w-lg w-full shadow-2xl border border-white/10 text-center space-y-8"
        >
          <div className="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
            <Clock className="text-white" size={40} />
          </div>

          <div className="space-y-3">
            <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              Your Premium Trial has Ended 🎓
            </h2>
            <p className="text-slate-600 dark:text-zinc-400 font-medium">
              Keep acing your courses. Choose your plan to unlock 24/7 AI tutoring, advanced analytics, and unlimited progress tracking.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button 
              onClick={onUpgrade}
              className="bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-emerald-500/20 transition-all flex flex-col items-center justify-center gap-1"
            >
              <span className="text-lg">Scholar</span>
              <span className="text-xs opacity-80">₦1,500 / 30 Days</span>
            </button>
            <button 
              onClick={onUpgrade}
              className="bg-slate-900 dark:bg-white dark:text-zinc-900 text-white py-4 rounded-2xl font-bold shadow-lg transition-all flex flex-col items-center justify-center gap-1"
            >
              <span className="text-lg">Semester</span>
              <span className="text-xs opacity-80">₦4,500 / 120 Days</span>
            </button>
          </div>

          <button 
            onClick={() => setShowHardStop(false)}
            className="text-slate-400 dark:text-zinc-500 text-sm font-bold hover:text-slate-600 dark:hover:text-zinc-300 transition-colors"
          >
            Continue with Free Basic (Limited)
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatePresence>
      {showSoftWarning && (
        <motion.div 
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          className="fixed top-4 left-4 right-4 z-[60] max-w-2xl mx-auto"
        >
          <div className="bg-amber-500 text-white p-4 rounded-2xl shadow-xl flex items-center justify-between gap-4 border border-white/20">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-xl">
                {isTrialActive && daysRemaining <= 1 ? <Clock size={20} /> : <Zap size={20} />}
              </div>
              <div>
                <p className="font-bold text-sm">
                  {isTrialActive && daysRemaining <= 1 
                    ? (hoursRemaining <= 24 ? `Your Premium Trial ends in ${hoursRemaining} hours!` : "Your Premium Trial ends tomorrow!")
                    : `Low Sparks: You have ${profile?.ai_sparks} Sparks left.`}
                </p>
                <p className="text-xs opacity-90 font-medium">
                  {isTrialActive && daysRemaining <= 1
                    ? "Upgrade now to keep your study momentum going."
                    : "Upgrade to get unlimited AI tutoring."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={onUpgrade}
                className="bg-white text-amber-600 px-4 py-2 rounded-xl text-xs font-black shadow-sm hover:bg-amber-50 transition-colors whitespace-nowrap"
              >
                UPGRADE NOW
              </button>
              <button 
                onClick={() => setIsDismissed(true)}
                className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
