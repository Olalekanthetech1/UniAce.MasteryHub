import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Bot, User, Volume2, VolumeX, Copy, Check, BookmarkPlus, 
  Share2, ChevronDown, ChevronUp, Sparkles, Lightbulb, 
  BarChart2, FileText, ArrowRight, HelpCircle, Clock,
  Smile, ThumbsUp, Heart, Target, Flag
} from 'lucide-react';
import { ChatMessage, Bookmark } from '../../types';
import MarkdownRenderer from '../MarkdownRenderer';
import { sanitizeLatex } from '../../services/aiCourseGenerator';
import { 
  toggleMessageReaction, 
  subscribeToMessageReactions,
  ReactionState 
} from '../../services/chatReactionService';

const stripThinkTags = (text: string) => {
  if (!text) return '';
  let clean = text;
  if (clean.includes('</think>')) {
    clean = clean.replace(/^[\s\S]*?<\/think>\s*/i, '');
  } else if (clean.includes('<think>')) {
    clean = clean.replace(/<think>[\s\S]*$/i, '');
  }
  clean = clean.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
  clean = clean.replace(/<\/?think>/gi, '');
  clean = clean.replace(/\[SYSTEM DIRECTIVE:[\s\S]*?\]/gi, '');
  clean = clean.replace(/\[SYSTEM REMINDER:[\s\S]*?\]/gi, '');
  return clean.trim();
};

const formatMessageTime = (timestamp?: string | number | Date): string => {
  if (!timestamp) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  try {
    const d = typeof timestamp === 'string' || typeof timestamp === 'number' 
      ? new Date(timestamp) 
      : timestamp;
    if (isNaN(d.getTime())) {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const AVAILABLE_REACTIONS = [
  { emoji: '👍', label: 'Helpful & Clear' },
  { emoji: '❤️', label: 'Loved the Solution' },
  { emoji: '💡', label: 'Insightful Concept' },
  { emoji: '🎯', label: 'Accurate Proof' },
  { emoji: '❓', label: 'Need More Explanation' }
];

interface ChatMessageCardProps {
  message: ChatMessage;
  index: number;
  isLast: boolean;
  activeSpeechIdx: number | null;
  onSpeakText: (text: string, idx: number) => void;
  onStopSpeech: () => void;
  onSendPrompt: (promptText: string) => void;
  onSaveBookmark?: (bookmark: Bookmark) => void;
  currentUserId?: string;
  courseId?: string;
  onReportWrongAnswer?: (message: ChatMessage, index: number) => void;
}

export const ChatMessageCard: React.FC<ChatMessageCardProps> = ({
  message,
  index,
  isLast,
  activeSpeechIdx,
  onSpeakText,
  onStopSpeech,
  onSendPrompt,
  onSaveBookmark,
  currentUserId,
  courseId,
  onReportWrongAnswer,
}) => {
  const isModel = message.role === 'model';
  const [copied, setCopied] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [isDerivationOpen, setIsDerivationOpen] = useState(true);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const isSpeakingThis = activeSpeechIdx === index;

  // Reactions state
  const [tallies, setTallies] = useState<{ [emoji: string]: number }>(message.reactions || {});
  const [userReactions, setUserReactions] = useState<string[]>(message.userReactions || []);

  const rawText = message.text || '';
  const cleanText = stripThinkTags(rawText);
  const formattedTime = formatMessageTime(message.timestamp);

  // Subscribe to real-time reactions from Firestore for this message
  useEffect(() => {
    if (!message.id || !isModel) return;

    const unsubscribe = subscribeToMessageReactions(
      message.id, 
      currentUserId, 
      (state: ReactionState) => {
        if (state.tallies) setTallies(state.tallies);
        if (state.userReactions) setUserReactions(state.userReactions);
      }
    );

    return () => unsubscribe();
  }, [message.id, currentUserId, isModel]);

  // Close reaction picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowReactionPicker(false);
      }
    };
    if (showReactionPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showReactionPicker]);

  // Handle reaction toggle
  const handleReactionToggle = async (emoji: string) => {
    setShowReactionPicker(false);
    const msgId = message.id || `msg-${index}-${Date.now()}`;

    // Optimistic UI update
    const wasActive = userReactions.includes(emoji);
    const updatedUserReactions = wasActive
      ? userReactions.filter(e => e !== emoji)
      : [...userReactions, emoji];

    const currentCount = tallies[emoji] || 0;
    const newCount = wasActive ? Math.max(0, currentCount - 1) : currentCount + 1;
    
    const updatedTallies = { ...tallies };
    if (newCount > 0) {
      updatedTallies[emoji] = newCount;
    } else {
      delete updatedTallies[emoji];
    }

    setUserReactions(updatedUserReactions);
    setTallies(updatedTallies);

    // Save to Firestore
    if (currentUserId) {
      try {
        await toggleMessageReaction(msgId, emoji, currentUserId, courseId);
      } catch (err) {
        console.warn('Reaction persist fallback:', err);
      }
    }
  };

  // Detect if text contains multi-step derivations
  const hasMultiStep = isModel && (
    cleanText.includes('Step 1') || 
    cleanText.includes('Step 2') || 
    cleanText.includes('### Proof') || 
    cleanText.includes('### Derivation')
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBookmark = () => {
    if (onSaveBookmark) {
      const newBookmark: Bookmark = {
        id: crypto.randomUUID(),
        type: 'formula',
        content: {
          title: `Study Card from Chat (${new Date().toLocaleDateString()})`,
          text: cleanText.substring(0, 1500),
          role: message.role
        },
        timestamp: new Date().toISOString(),
        note: 'Saved from UniAce AI Chat'
      };
      onSaveBookmark(newBookmark);
      setBookmarked(true);
      setTimeout(() => setBookmarked(false), 3000);
    }
  };

  const handleSharePeerCard = () => {
    const shareText = `🎓 UniAce Academic Solution:\n\n${cleanText}\n\n— Solved with UniAce Academic Tutor`;
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Generate dynamic follow-up chips based on message content
  const dynamicChips = React.useMemo(() => {
    if (!isModel || !cleanText) return [];
    const chips = [];

    if (cleanText.toLowerCase().includes('formula') || cleanText.toLowerCase().includes('equation') || cleanText.includes('$')) {
      chips.push({ label: 'Break Down Step-by-Step', prompt: 'Please break down the step-by-step mathematical proof for this equation in detail.', icon: Lightbulb });
      chips.push({ label: 'Show Visual/Plot', prompt: 'Can you describe and provide a Mermaid graph or chart visualization for this concept?', icon: BarChart2 });
    }
    if (cleanText.length > 250) {
      chips.push({ label: 'Give 1 Practice Problem', prompt: 'Give me a challenging university-level practice problem based on this to test my understanding.', icon: HelpCircle });
      chips.push({ label: 'Real-World Analogy', prompt: 'Can you explain this using an intuitive real-world engineering or scientific analogy?', icon: Sparkles });
    }
    return chips.slice(0, 3);
  }, [isModel, cleanText]);

  const activeTallyEntries = Object.entries(tallies).filter(([_, count]) => count > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`w-full flex flex-col py-1 ${isModel ? 'items-start' : 'items-end'}`}
    >
      {/* Message Specific Container */}
      <div className={`w-full flex ${isModel ? 'justify-start' : 'justify-end'}`}>
        <div className={`flex gap-2 sm:gap-3 ${
          isModel 
            ? 'w-full max-w-full sm:max-w-[96%] md:max-w-[92%] flex-row items-start' 
            : 'max-w-[92%] sm:max-w-[85%] md:max-w-[78%] flex-row-reverse items-end'
        }`}>
          {/* Avatar Container */}
          <div className={`shrink-0 flex items-center justify-center shadow-xs select-none ${
            isModel 
              ? 'w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-emerald-500 text-white mt-0.5 sm:mt-1' 
              : 'w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-slate-800 dark:bg-zinc-700 text-white mb-0.5'
          }`}>
            {isModel ? <Bot size={16} className="sm:w-[18px] sm:h-[18px]" /> : <User size={14} className="sm:w-[15px] sm:h-[15px]" />}
          </div>

          {/* Message Content Stack */}
          <div className={`flex flex-col gap-1 min-w-0 ${isModel ? 'w-full items-start' : 'items-end'}`}>
            {/* Header Metadata with Timestamp */}
            <div className={`flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-slate-400 dark:text-zinc-400 font-medium ${
              isModel ? 'justify-start' : 'justify-end'
            }`}>
              {isModel ? (
                <>
                  <span className="font-semibold text-slate-700 dark:text-zinc-200">UniAce Tutor</span>
                  {formattedTime && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-zinc-500 font-mono tabular-nums">
                        <Clock size={10} className="opacity-70" />
                        {formattedTime}
                      </span>
                    </>
                  )}
                  {(message.meta?.providerLabel || message.meta?.providerUsed) && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[10px] text-slate-500 dark:text-zinc-400 font-mono">
                        Answered by {message.meta.providerLabel || message.meta.providerUsed}
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    Academic Rigor
                  </span>
                </>
              ) : (
                <>
                  {formattedTime && (
                    <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-zinc-500 font-mono tabular-nums">
                      <Clock size={10} className="opacity-70" />
                      {formattedTime}
                    </span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-slate-600 dark:text-zinc-300">You</span>
                </>
              )}
            </div>

            {/* Message Body Card */}
            <div className={`p-3 sm:p-5 shadow-xs text-sm transition-all select-text relative ${
              isModel
                ? 'w-full bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 rounded-2xl rounded-tl-xs border border-slate-200/85 dark:border-zinc-800'
                : 'bg-slate-900 dark:bg-zinc-800 text-white rounded-2xl rounded-tr-xs border border-transparent'
            }`}>
              {/* Transparent PDF / RAG Scrubbing Notice */}
              {isModel && typeof message.meta?.scrubbedPassagesCount === 'number' && message.meta.scrubbedPassagesCount > 0 && (
                <div className="mb-3 pb-2 border-b border-amber-200/70 dark:border-amber-900/50 flex items-center justify-between text-xs text-amber-700 dark:text-amber-400 font-medium">
                  <span>
                    Document Hygiene: <strong className="font-mono tabular-nums">{message.meta.scrubbedPassagesCount}</strong> non-academic instruction {message.meta.scrubbedPassagesCount === 1 ? 'passage was' : 'passages were'} removed from your attached document.
                  </span>
                </div>
              )}

              {/* Uploaded Images */}
              {message.image && (
                <div className="mb-3 rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-700 max-w-sm">
                  <img src={message.image} alt="Uploaded problem diagram" className="w-full object-contain max-h-60" />
                </div>
              )}

              {/* Uploaded PDF Context Banner */}
              {message.pdfContent && (
                <div className="mb-3 p-2.5 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-900/60 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                  <FileText size={15} />
                  <span className="font-semibold truncate">Uploaded Document Context Attached</span>
                </div>
              )}

              {/* Collapsible Proof Header if multi-step */}
              {isModel && hasMultiStep && cleanText.trim() && (
                <div className="mb-3 pb-2 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <Sparkles size={13} />
                    Structured Academic Proof & Steps
                  </span>
                  <button
                    onClick={() => setIsDerivationOpen(!isDerivationOpen)}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 rounded-lg flex items-center gap-1 text-[11px] font-medium transition-colors"
                  >
                    <span>{isDerivationOpen ? 'Collapse' : 'Expand'}</span>
                    {isDerivationOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                </div>
              )}

              {/* Rendered Text with KaTeX for Model OR high-contrast text for Student */}
              {isModel ? (
                !cleanText.trim() ? (
                  <div className="flex items-center gap-2.5 py-1 text-slate-500 dark:text-zinc-400">
                    <div className="flex gap-1.5 items-center">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" />
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce [animation-delay:0.2s]" />
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce [animation-delay:0.4s]" />
                    </div>
                    <span className="text-xs font-medium">UniAce Tutor is writing solution...</span>
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {(!hasMultiStep || isDerivationOpen) && (
                      <div className="markdown-body leading-relaxed text-slate-800 dark:text-zinc-100">
                        <MarkdownRenderer content={sanitizeLatex(cleanText)} />
                      </div>
                    )}
                  </AnimatePresence>
                )
              ) : (
                <div className="text-white dark:text-white font-medium whitespace-pre-wrap break-words leading-relaxed text-sm">
                  {cleanText || message.text}
                </div>
              )}

              {/* Source Citations */}
              {isModel && message.sources && message.sources.length > 0 && cleanText.trim() && (
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-zinc-800/80">
                  <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase mb-1.5">
                    Academic References:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {message.sources.map((src, sIdx) => (
                      <a
                        key={sIdx}
                        href={src.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-1 bg-slate-50 dark:bg-zinc-800 text-[11px] text-emerald-600 dark:text-emerald-400 rounded-lg border border-slate-200 dark:border-zinc-700 hover:underline flex items-center gap-1"
                      >
                        <span>{src.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Reaction Badges (Rendered inside card footer) */}
              {isModel && activeTallyEntries.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-zinc-800/80 flex flex-wrap items-center gap-1.5">
                  {activeTallyEntries.map(([emoji, count]) => {
                    const isSelectedByMe = userReactions.includes(emoji);
                    return (
                      <motion.button
                        key={emoji}
                        whileTap={{ scale: 0.92 }}
                        onClick={() => handleReactionToggle(emoji)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all select-none ${
                          isSelectedByMe
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 shadow-2xs font-semibold'
                            : 'bg-slate-100/90 dark:bg-zinc-800/80 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700 hover:bg-slate-200 dark:hover:bg-zinc-700'
                        }`}
                        title={isSelectedByMe ? 'Click to remove reaction' : 'Click to react'}
                      >
                        <span className="text-sm leading-none">{emoji}</span>
                        <span className="text-[11px] font-semibold">{count}</span>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action Toolbar & Reactions (Only shown for non-empty AI responses) */}
            {isModel && cleanText.trim().length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-1 pt-0.5 text-slate-400 relative">
                {/* Reaction Trigger Button & Popover */}
                <div className="relative" ref={pickerRef}>
                  <button
                    onClick={() => setShowReactionPicker(!showReactionPicker)}
                    className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 text-xs ${
                      showReactionPicker || userReactions.length > 0
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200'
                    }`}
                    title="React to this AI answer"
                  >
                    <Smile size={14} />
                    <span className="text-[11px]">
                      {userReactions.length > 0 ? 'Reacted' : 'React'}
                    </span>
                  </button>

                  {/* Reaction Choice Popover */}
                  <AnimatePresence>
                    {showReactionPicker && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 5 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 5 }}
                        transition={{ duration: 0.12 }}
                        className="absolute left-0 bottom-full mb-1.5 z-30 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-slate-200 dark:border-zinc-700 p-1.5 flex items-center gap-1"
                      >
                        {AVAILABLE_REACTIONS.map((item) => {
                          const isSelected = userReactions.includes(item.emoji);
                          return (
                            <button
                              key={item.emoji}
                              onClick={() => handleReactionToggle(item.emoji)}
                              className={`p-1.5 rounded-lg text-base hover:scale-125 transition-all flex items-center justify-center ${
                                isSelected 
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 ring-1 ring-emerald-400' 
                                  : 'hover:bg-slate-100 dark:hover:bg-zinc-800'
                              }`}
                              title={item.label}
                            >
                              <span>{item.emoji}</span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Quick 1-Click Thumbs Up */}
                <button
                  onClick={() => handleReactionToggle('👍')}
                  className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 text-xs ${
                    userReactions.includes('👍')
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-semibold'
                      : 'hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200'
                  }`}
                  title="Mark as Helpful"
                >
                  <ThumbsUp size={13} />
                  <span className="text-[11px]">Helpful</span>
                </button>

                {/* Quick 1-Click Love */}
                <button
                  onClick={() => handleReactionToggle('❤️')}
                  className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 text-xs ${
                    userReactions.includes('❤️')
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-semibold'
                      : 'hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200'
                  }`}
                  title="Love this explanation"
                >
                  <Heart size={13} className={userReactions.includes('❤️') ? 'fill-rose-500 text-rose-500' : ''} />
                  <span className="text-[11px]">Love</span>
                </button>

                {/* Divider */}
                <span className="w-px h-3 bg-slate-200 dark:bg-zinc-800 mx-0.5" />

                {/* Copy Button */}
                <button
                  onClick={handleCopy}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 transition-colors flex items-center gap-1 text-xs"
                  title="Copy solution text"
                >
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  <span className="text-[11px]">{copied ? 'Copied' : 'Copy'}</span>
                </button>

                {/* Bookmark to Notebook */}
                <button
                  onClick={handleBookmark}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 transition-colors flex items-center gap-1 text-xs"
                  title="Save study note to Notebook"
                >
                  {bookmarked ? <Check size={14} className="text-emerald-500" /> : <BookmarkPlus size={14} />}
                  <span className="text-[11px]">{bookmarked ? 'Saved' : 'Save Note'}</span>
                </button>

                {/* Text to Speech */}
                <button
                  onClick={() => isSpeakingThis ? onStopSpeech() : onSpeakText(cleanText, index)}
                  className={`p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1 text-xs ${
                    isSpeakingThis ? 'text-emerald-500 font-semibold' : 'text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200'
                  }`}
                  title="Read solution aloud"
                >
                  {isSpeakingThis ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  <span className="text-[11px]">{isSpeakingThis ? 'Stop' : 'Read'}</span>
                </button>

                {/* Share Peer Card */}
                <button
                  onClick={handleSharePeerCard}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 transition-colors flex items-center gap-1 text-xs"
                  title="Copy peer review study card"
                >
                  <Share2 size={14} />
                  <span className="text-[11px]">Share Card</span>
                </button>

                {/* Report Wrong Answer (Student Trust & Golden Set Feedback Loop) */}
                {onReportWrongAnswer && (
                  <>
                    <span className="w-px h-3 bg-slate-200 dark:bg-zinc-800 mx-0.5" />
                    {message.reportStatus ? (
                      <span
                        className="p-1.5 text-amber-600 dark:text-amber-400 flex items-center gap-1 text-[11px] font-mono"
                        title="Queued for Academic SME & SymPy Verification"
                      >
                        <Flag size={13} />
                        <span>
                          {message.reportStatus === 'verified_promoted'
                            ? 'Verified · Bounty Credited'
                            : 'Reported · Pending SME Review'}
                        </span>
                      </span>
                    ) : (
                      <button
                        onClick={() => onReportWrongAnswer(message, index)}
                        className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/30 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors flex items-center gap-1 text-xs"
                        title="Report mathematical or factual inaccuracy for SME review & Spark restitution"
                      >
                        <Flag size={13} />
                        <span className="text-[11px]">Report Wrong Answer</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Dynamic Follow-up Chips for last message */}
            {isModel && isLast && cleanText.trim().length > 0 && dynamicChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 px-1">
                {dynamicChips.map((chip, cIdx) => {
                  const IconComponent = chip.icon;
                  return (
                    <button
                      key={cIdx}
                      onClick={() => onSendPrompt(chip.prompt)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-all flex items-center gap-1.5 shadow-2xs group"
                    >
                      <IconComponent size={13} className="text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                      <span>{chip.label}</span>
                      <ArrowRight size={11} className="opacity-60 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default ChatMessageCard;

