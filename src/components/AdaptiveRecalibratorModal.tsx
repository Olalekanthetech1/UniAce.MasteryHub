import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Award, CheckCircle2, Loader2, ArrowRight, Zap, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AIService } from '../services/ai';
import { Module, UserProgress } from '../types';

interface AdaptiveRecalibratorModalProps {
  topicId: string;
  score: number;
  isOpen: boolean;
  onClose: () => void;
  progress: UserProgress;
  syllabus: Module[];
  onViewStudyPlan?: () => void;
}

/**
 * AdaptiveRecalibratorModal — Non-Blocking Study Toast / Banner (Option 1)
 * Enforces Zero Distraction during active study.
 * Operates as a floating corner banner with pointer-events-none on backdrop,
 * leaving the lesson text, notes, and navigation 100% interactive and unobstructed.
 */
export const AdaptiveRecalibratorModal: React.FC<AdaptiveRecalibratorModalProps> = ({
  topicId,
  score,
  isOpen,
  onClose,
  progress,
  syllabus,
  onViewStudyPlan
}) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'idle' | 'generating' | 'success_booster' | 'fast_track_offer' | 'fast_track_success' | 'no_plan'>('idle');
  const [boosterData, setBoosterData] = useState<{ focus: string; tasks: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoCloseTimerRef = useRef<NodeJS.Timeout | null>(null);

  const topic = syllabus.flatMap(m => m.subTopics).find(st => st.id === topicId);
  const topicTitle = topic?.title || topicId;

  // Auto-dismiss after 8 seconds on success states so reading flow is never interrupted
  useEffect(() => {
    if (step === 'success_booster' || step === 'fast_track_success') {
      autoCloseTimerRef.current = setTimeout(() => {
        onClose();
      }, 8000);
    }
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, [step, onClose]);

  useEffect(() => {
    if (isOpen) {
      evaluatePerformance();
    } else {
      setStep('idle');
      setBoosterData(null);
      setError(null);
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
      }
    }
  }, [isOpen]);

  const evaluatePerformance = async () => {
    if (!user) {
      onClose();
      return;
    }
    
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/user/study-plan', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        onClose();
        return;
      }
      const json = await res.json();
      if (!json.plan) {
        onClose();
        return;
      }

      if (score < 60) {
        triggerBoosterInjection();
      } else if (score === 100) {
        setStep('fast_track_offer');
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Error evaluating study plan performance:', err);
      onClose();
    }
  };

  const triggerBoosterInjection = async () => {
    if (!user) return;
    setLoading(true);
    setStep('generating');
    setError(null);

    try {
      const booster = await AIService.generateBoosterLesson(topicTitle, score);
      setBoosterData(booster);

      const token = await user.getIdToken();
      const res = await fetch('/api/user/study-plan', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        const activePlan = json.plan || {};
        const updatedSchedule = [
          {
            day: "AI Booster Session",
            focus: booster.focus,
            tasks: booster.tasks
          },
          ...(activePlan.dailySchedule || [])
        ];

        await fetch('/api/user/study-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            plan: {
              ...activePlan,
              dailySchedule: updatedSchedule,
              tips: [
                `Booster Tip: Reinforce "${topicTitle}" foundations before proceeding to next modules.`,
                ...(activePlan.tips || [])
              ]
            }
          })
        });
        setStep('success_booster');
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Booster Injection failed:', err);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const acceptFastTrack = async () => {
    if (!user || !progress || !syllabus) return;
    setLoading(true);
    setError(null);

    try {
      const advancedPlan = await AIService.generateFastTrackPlan(progress, syllabus, topicTitle);
      
      const token = await user.getIdToken();
      await fetch('/api/user/study-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ plan: advancedPlan })
      });
      
      setStep('fast_track_success');
    } catch (err) {
      console.error('Fast-track generation failed:', err);
      setError('Could not update study plan. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || step === 'idle' || step === 'no_plan') return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 max-w-sm sm:max-w-md w-[calc(100vw-2.5rem)] pointer-events-none">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 25, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 15, scale: 0.95 }}
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
          className="pointer-events-auto bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/90 dark:border-zinc-800 p-4 sm:p-5 overflow-hidden ring-1 ring-black/5"
        >
          {/* Close button in corner */}
          <button
            onClick={onClose}
            aria-label="Dismiss notification"
            className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>

          {/* Background generating indicator */}
          {step === 'generating' && (
            <div className="flex items-center gap-3 pr-6">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-500 flex items-center justify-center shrink-0">
                <Loader2 size={18} className="animate-spin" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">Optimizing Study Plan...</p>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">Synthesizing booster review for "{topicTitle}"</p>
              </div>
            </div>
          )}

          {/* Booster Success Toast */}
          {step === 'success_booster' && boosterData && (
            <div className="space-y-3 pr-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/50 text-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 size={18} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">Study Plan Recalibrated</h4>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 line-clamp-2">
                    Booster session inserted for <span className="font-semibold text-slate-700 dark:text-zinc-200">"{topicTitle}"</span> to reinforce foundations.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100 dark:border-zinc-800/80">
                <button
                  onClick={onClose}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-white"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => {
                    onClose();
                    onViewStudyPlan?.();
                  }}
                  className="px-3 py-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-[11px] font-bold hover:opacity-90 transition-opacity flex items-center gap-1"
                >
                  View Plan <ArrowRight size={12} />
                </button>
              </div>
            </div>
          )}

          {/* Fast-Track Offer Toast (Non-blocking) */}
          {step === 'fast_track_offer' && (
            <div className="space-y-3 pr-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                  <Award size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">Perfect Mastery! 🏆</h4>
                    <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded">100%</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 line-clamp-2">
                    Fast-track your study plan past introductory modules for <span className="font-semibold text-slate-700 dark:text-zinc-200">"{topicTitle}"</span>?
                  </p>
                </div>
              </div>

              {error && (
                <p className="text-[11px] text-red-500 font-medium">{error}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100 dark:border-zinc-800/80">
                <button
                  onClick={onClose}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-white"
                >
                  Keep Plan
                </button>
                <button
                  onClick={acceptFastTrack}
                  disabled={loading}
                  className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1.5 shadow-sm shadow-amber-200 dark:shadow-none disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      <span>Optimizing...</span>
                    </>
                  ) : (
                    <>
                      <Zap size={12} fill="currentColor" />
                      <span>Fast-Track</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Fast-Track Success Toast */}
          {step === 'fast_track_success' && (
            <div className="space-y-3 pr-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles size={18} fill="currentColor" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">Academic Path Advanced!</h4>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 line-clamp-2">
                    Introductory modules for <span className="font-semibold text-slate-700 dark:text-zinc-200">"{topicTitle}"</span> fast-tracked to advanced tracks.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100 dark:border-zinc-800/80">
                <button
                  onClick={onClose}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-white"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => {
                    onClose();
                    onViewStudyPlan?.();
                  }}
                  className="px-3 py-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-[11px] font-bold hover:opacity-90 transition-opacity flex items-center gap-1"
                >
                  View Study Plan <ArrowRight size={12} />
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
