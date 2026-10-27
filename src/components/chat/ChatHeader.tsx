import React from 'react';
import { Bot, Zap, Calculator, Settings, X, BookOpen, RotateCcw, ChevronDown, Sparkles, CheckCircle2, ArrowLeft, LayoutGrid } from 'lucide-react';
import { CourseId, AIPersonality, UserProgress } from '../../types';
import { UniAceLogo } from '../UniAceLogo';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';

interface ChatHeaderProps {
  activeCourseId: CourseId | null;
  activeModuleTitle?: string;
  activeSubTopicTitle?: string;
  progress?: UserProgress;
  profile?: any;
  sparksRemaining: number | null;
  isWsConnected: boolean;
  currentPersonality: AIPersonality;
  onUpdatePersonality?: (personality: AIPersonality) => void;
  onToggleCalculator?: () => void;
  onToggleSettings?: () => void;
  onOpenSyllabusJumper: () => void;
  onNewChatSession: () => void;
  onClose?: () => void;
  isFullPage?: boolean;
  onToggleFullPage?: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  activeCourseId,
  activeModuleTitle,
  activeSubTopicTitle,
  progress,
  profile,
  sparksRemaining,
  isWsConnected,
  currentPersonality,
  onUpdatePersonality,
  onToggleCalculator,
  onToggleSettings,
  onOpenSyllabusJumper,
  onNewChatSession,
  onClose,
  isFullPage = false,
  onToggleFullPage
}) => {
  const { isPremium } = usePremiumStatus();
  const isAdmin = profile?.role === 'admin' || (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').includes(profile?.email || '');
  const hasUnlimitedSparks = isPremium || ['tutor', 'moderator'].includes(profile?.role) || isAdmin;

  // Calculate mastery for active topic or enrolled courses
  let topicMastery = 0;
  if (progress && progress.mastery) {
    if (activeSubTopicTitle) {
      const matchKey = Object.keys(progress.mastery).find(k => k.toLowerCase().includes(activeSubTopicTitle.toLowerCase()));
      if (matchKey) {
        topicMastery = progress.mastery[matchKey] || 0;
      }
    }
    if (!topicMastery && Object.values(progress.mastery).length > 0) {
      const values = Object.values(progress.mastery);
      topicMastery = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    }
  }

  const personalityBadges: Record<AIPersonality, { label: string; icon: string; desc: string }> = {
    encouraging: { label: 'Coach', icon: '🏆', desc: 'Step-by-step supportive' },
    strict: { label: 'Professor', icon: '👨‍🏫', desc: 'Elite academic rigor' },
    socratic: { label: 'Socratic', icon: '🤔', desc: 'Guided inquiry' },
    humorous: { label: 'Buddy', icon: '🤪', desc: 'Witty study partner' },
    master: { label: 'Grandmaster', icon: '🧠', desc: 'Omniscient & direct' },
    debate: { label: 'Feynman Mode', icon: '🔄', desc: 'Teach the AI & test logic' }
  };

  return (
    <header className="bg-slate-900 dark:bg-black text-white px-3 sm:px-6 py-3 sm:py-4 pt-safe flex flex-col gap-2.5 sm:gap-3 shrink-0 border-b border-slate-800">
      <div className="w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto flex flex-col gap-2.5 sm:gap-3">
        <div className="flex justify-between items-center">
          {/* Tutor Identity & Breadcrumb */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Prominent Return to App / Main Hub Navigation Button */}
            {onToggleFullPage && (
              <button
                onClick={onToggleFullPage}
                className="p-1.5 sm:p-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 hover:text-emerald-100 rounded-xl transition-all flex items-center gap-1.5 text-xs font-semibold border border-emerald-500/40 shrink-0 shadow-sm"
                title="Return to Main Dashboard / Course Hub"
              >
                <ArrowLeft size={16} />
                <span className="hidden xs:inline">Hub Navigation</span>
              </button>
            )}

            <UniAceLogo size="sm" badgeClassName="w-8 h-8 sm:w-10 sm:h-10" />

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm sm:text-base text-white truncate">UniAce Academic Tutor</span>
                <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{isWsConnected ? 'Live Stream' : 'Connected'}</span>
                </div>
              </div>

              {/* Curriculum Breadcrumb with Unit Jumper */}
              <button
                onClick={onOpenSyllabusJumper}
                className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-emerald-400 transition-colors group truncate text-left mt-0.5"
                title="Click to jump syllabus topic"
              >
                <BookOpen size={12} className="text-emerald-400 shrink-0" />
                <span className="font-semibold text-emerald-400 group-hover:underline truncate">
                  {activeCourseId || 'General Academy'}
                </span>
                {activeSubTopicTitle && (
                  <>
                    <span className="text-slate-500">/</span>
                    <span className="text-slate-300 truncate max-w-[130px] sm:max-w-[220px]">
                      {activeSubTopicTitle}
                    </span>
                  </>
                )}
                <ChevronDown size={12} className="text-slate-400 group-hover:translate-y-0.5 transition-transform shrink-0" />
              </button>
            </div>
          </div>

          {/* Action Controls & Sparks */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Spark Counter */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 text-[11px] font-bold">
              {hasUnlimitedSparks ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <Zap size={12} fill="currentColor" /> Unlimited
                </span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1">
                  <Zap size={12} fill="currentColor" /> {sparksRemaining ?? '...'}
                </span>
              )}
            </div>

            {/* New Chat / Reset Session Button */}
            <button
              onClick={onNewChatSession}
              className="p-1.5 sm:p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors flex items-center gap-1 text-xs font-semibold"
              title="Start new study session"
            >
              <RotateCcw size={16} />
              <span className="hidden md:inline">New Chat</span>
            </button>

            {/* Calculator Trigger */}
            {onToggleCalculator && (
              <button 
                onClick={onToggleCalculator}
                className="p-1.5 sm:p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
                title="Open Scientific Calculator"
              >
                <Calculator size={17} />
              </button>
            )}

            {/* Settings Trigger */}
            {onToggleSettings && (
              <button 
                onClick={onToggleSettings}
                className="p-1.5 sm:p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
                title="Tutor Personality & Memory Calibration"
              >
                <Settings size={17} />
              </button>
            )}

            {/* Close Trigger for floating/modal */}
            {onClose && (
              <button 
                onClick={onClose}
                className="p-1.5 sm:p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
                title="Close chat"
              >
                <X size={17} />
              </button>
            )}
          </div>
        </div>

        {/* Secondary Context & Mode Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
          {/* Pedagogical Mode Selector */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:pb-0 scrollbar-hide">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider hidden sm:inline">
              Mode:
            </span>
            {(['encouraging', 'socratic', 'strict', 'debate'] as AIPersonality[]).map(mode => {
              const isSelected = currentPersonality === mode;
              const badge = personalityBadges[mode];
              return (
                <button
                  key={mode}
                  onClick={() => onUpdatePersonality?.(mode)}
                  className={`px-2 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-[11px] font-bold transition-all flex items-center gap-1 whitespace-nowrap ${
                    isSelected
                      ? 'bg-emerald-500 text-white shadow-xs'
                      : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                  title={badge.desc}
                >
                  <span>{badge.icon}</span>
                  <span>{badge.label}</span>
                </button>
              );
            })}
          </div>

          {/* Topic Mastery Tracker */}
          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-300">
            <span className="text-slate-400 text-[10px] uppercase font-bold">Mastery:</span>
            <div className="w-14 sm:w-20 bg-slate-800 rounded-full h-1.5 sm:h-2 overflow-hidden border border-slate-700">
              <div 
                className="bg-emerald-400 h-full rounded-full transition-all duration-500" 
                style={{ width: `${topicMastery}%` }} 
              />
            </div>
            <span className="font-mono text-emerald-400 font-bold">{topicMastery}%</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default ChatHeader;
