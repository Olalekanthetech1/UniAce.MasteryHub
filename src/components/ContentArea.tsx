import { Module, SubTopic, UserProgress } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, ChevronRight, Brain, Menu, Volume2, Loader2, ArrowLeft, Sparkles, Wand2, Lock, Calculator as CalcIcon, List } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import QuizGenerator from './QuizGenerator';
import QuickCheck from './QuickCheck';
import MarkdownRenderer from './MarkdownRenderer';
import PricingModal from './PricingModal';
import MiniTeacherModal from './MiniTeacherModal';
import QuickSummaryModal from './QuickSummaryModal';
import { AIService } from '../services/ai';
import { generateLessonContent, sanitizeLatex } from '../services/aiCourseGenerator';
import { sanitizeForFirestore } from '../services/courseService';
import { LogService } from '../services/logService';
import { useCourses } from '../context/CourseContext';
import { useAuth } from '../context/AuthContext';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { PipelineMetadata } from '../types';

const stripThinkTags = (text: string) => {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
};

interface ContentAreaProps {
  courseId: string | null;
  courseTitle: string;
  module: Module;
  activeSubTopicId: string;
  onSubTopicSelect: (id: string) => void;
  onBackToSyllabus: () => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  onQuizComplete: (topicId: string, score: number) => void;
  onQuickCheckComplete?: (topicId: string) => void;
  autoStartQuiz?: boolean;
  onBookmark?: (item: any) => void;
  onViewSelect?: (view: any) => void;
  progress?: UserProgress;
  onToggleCalculator?: () => void;
  onLessonContentChange?: (content: string) => void;
}

export default function ContentArea({ 
  courseId,
  courseTitle,
  module, 
  activeSubTopicId, 
  onSubTopicSelect, 
  onBackToSyllabus,
  isSidebarOpen, 
  toggleSidebar,
  onQuizComplete,
  onQuickCheckComplete,
  autoStartQuiz = false,
  onBookmark,
  onViewSelect,
  progress,
  onToggleCalculator,
  onLessonContentChange
}: ContentAreaProps) {
  const [showQuiz, setShowQuiz] = useState(autoStartQuiz);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState(0);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [isMiniTeacherOpen, setIsMiniTeacherOpen] = useState(false);
  const [isQuickSummaryOpen, setIsQuickSummaryOpen] = useState(false);
  const [miniTeacherMode, setMiniTeacherMode] = useState<'default' | 'simpler' | 'quiz' | 'proactive'>('default');
  const [isProactiveQuiz, setIsProactiveQuiz] = useState(false);
  const hasCheckedInRef = useRef<Set<string>>(new Set());
  const [lockedFeatureName, setLockedFeatureName] = useState('');
  const [fetchedLesson, setFetchedLesson] = useState<{ id: string; content: string; metadata: PipelineMetadata } | null>(null);
  const [isFetchingContent, setIsFetchingContent] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const { courses, refreshCourses } = useCourses();
  const { user, profile } = useAuth();
  const { isPremium } = usePremiumStatus();
  const isAdmin = Boolean(user && profile?.role === 'admin');
  const isLocked = !isPremium && !isAdmin;

  const subTopics = module?.subTopics || [];
  const activeSubTopicIndex = subTopics.findIndex(st => st.id === activeSubTopicId);
  const activeSubTopic = subTopics[activeSubTopicIndex] || subTopics[0];

  // Derive active lesson content synchronously on render to guarantee content availability precedes render
  const activeLessonData = (activeSubTopic?.content && activeSubTopic.content.trim().length > 0)
    ? { id: activeSubTopic.id, content: sanitizeLatex(stripThinkTags(activeSubTopic.content)), metadata: {} as PipelineMetadata }
    : (fetchedLesson?.id === activeSubTopic?.id && fetchedLesson.content && fetchedLesson.content.trim().length > 0 ? fetchedLesson : null);

  const isCurrentLessonLoading = isFetchingContent || (!activeLessonData && !isGenerating);

  const generationSteps = [
    "AI is brainstorming the lesson structure...",
    "Consulting academic sources...",
    "Writing university-level content...",
    "Formatting LaTeX formulas...",
    "Adding real-world examples...",
    "Finalizing your personalized lesson..."
  ];

  const [selectedRelevanceDept, setSelectedRelevanceDept] = useState<string>('');

  const relevanceList = (activeLessonData?.metadata as PipelineMetadata)?.relevance || [];

  useEffect(() => {
    if (Array.isArray(relevanceList) && relevanceList.length > 0) {
      const studentDept = profile?.department?.toLowerCase().trim();
      const matched = relevanceList.find((r: any) => r.department?.toLowerCase().trim() === studentDept);
      setSelectedRelevanceDept(matched ? matched.department : relevanceList[0].department);
    }
  }, [relevanceList, profile?.department]);

  const activeRelevance = Array.isArray(relevanceList)
    ? (relevanceList.find((r: any) => r.department === selectedRelevanceDept) || relevanceList[0])
    : null;

  // Proactive Mini Teacher Check-in (Smart Timer)
  const isMiniTeacherOpenRef = useRef(isMiniTeacherOpen);
  useEffect(() => { isMiniTeacherOpenRef.current = isMiniTeacherOpen; }, [isMiniTeacherOpen]);
  
  const showQuizRef = useRef(showQuiz);
  useEffect(() => { showQuizRef.current = showQuiz; }, [showQuiz]);

  // Load content dynamically (Lazy Loading)
  useEffect(() => {
    const loadContent = async () => {
      if (!courseId) return;
      
      // If it already has content (legacy or preloaded courses), use it
      if (activeSubTopic?.content) {
        const sanitized = sanitizeLatex(stripThinkTags(activeSubTopic.content));
        setFetchedLesson({ id: activeSubTopic.id, content: sanitized, metadata: {} });
        onLessonContentChange?.(sanitized);
        setIsFetchingContent(false);
        return;
      }

      setIsFetchingContent(true);
      try {
        console.log(`[ContentArea] Fetching lessons via Neon API for ${courseId}/${module.id}/${activeSubTopic?.id}`);
        const { CourseService } = await import('../services/courseService');
        const lessons = await CourseService.getLessons(courseId, module.id);
        const targetLesson = lessons.find(l => l.id === activeSubTopic?.id || (activeSubTopic?.id.includes('-') && l.id === activeSubTopic.id.split('-')[1]));

        if (targetLesson && targetLesson.content) {
          console.log(`[ContentArea] Lesson found via Neon API! Content length: ${targetLesson.content.length}`);
          const sanitizedContent = sanitizeLatex(stripThinkTags(targetLesson.content));
          setFetchedLesson({ id: activeSubTopic.id, content: sanitizedContent, metadata: {} });
          onLessonContentChange?.(sanitizedContent);
        } else {
          console.log(`[ContentArea] Lesson content not found for ${activeSubTopic?.id}`);
          setFetchedLesson(null);
          if (!profile) {
            return;
          }
          if (isAdmin) {
            console.log(`[ContentArea] User is admin, triggering generation...`);
            handleGenerateLesson();
          } else {
            console.log(`[ContentArea] User is NOT admin, cannot trigger generation.`);
            setFetchedLesson({
              id: activeSubTopic.id,
              content: "### Content Not Available\n\nThis lesson content hasn't been generated yet. Please contact your instructor or administrator to generate the course content.",
              metadata: {}
            });
          }
        }
      } catch (error) {
        console.error("Error fetching lesson content:", error);
      } finally {
        setIsFetchingContent(false);
      }
    };

    loadContent();
  }, [activeSubTopic.id, courseId, module.id, isAdmin, profile?.role]);

  // On-Demand Auto-Upgrade for placeholder images
  useEffect(() => {
    if (!isAdmin || !fetchedLesson || isGenerating || isFetchingContent) return;
    
    let isMounted = true;
    
    const upgradePlaceholders = async () => {
      const content = fetchedLesson.content;
      // Match ![alt](...placeholder...) OR ![alt](...unsplash...) OR [Complex Image: alt...]
      const placeholderRegex = /!\[([^\]]*)\]\(([^)]*(?:placeholder|unsplash|fakeimg)[^)]*)\)|\[Complex Image:?([^\]]+)\]/gi;
      let match;
      let hasUpdates = false;
      let newContent = content;
      
      const matches: { original: string, alt: string, index: number }[] = [];
      while ((match = placeholderRegex.exec(content)) !== null) {
        // match[1] is markdown alt, match[3] is complex image alt
        matches.push({ original: match[0], alt: match[1] || match[3] || 'Educational diagram', index: match.index });
      }
      
      if (matches.length > 0) {
        console.log(`[Auto-Upgrade] Found ${matches.length} placeholder images. Upgrading with FLUX...`);
        
        for (const m of matches) {
           try {
             const token = await user?.getIdToken();
             const response = await fetch('/api/ai/generate-image', {
               method: 'POST',
               headers: {
                 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${token}`
               },
               body: JSON.stringify({ 
                 prompt: m.alt.trim(),
                 complexity: 'high'
               })
             });
             
             if (response.ok) {
                const data = await response.json();
                if (data.image) {
                   newContent = newContent.replace(m.original, `![${m.alt.trim()}](${data.image})`);
                   hasUpdates = true;
                }
             } else {
               console.warn(`[Auto-Upgrade] Failed to generate image for "${m.alt}"`, await response.text());
             }
           } catch (e) {
             console.error("[Auto-Upgrade] Error during image generation:", e);
           }
        }
        
        if (hasUpdates && isMounted) {
           setFetchedLesson({ ...fetchedLesson, content: newContent });
           onLessonContentChange?.(newContent);
           
           // Update via Neon API
           try {
              const idToken = await user?.getIdToken();
              await fetch(`/api/courses/${encodeURIComponent(courseId!)}/modules/${encodeURIComponent(module.id)}/lessons/${encodeURIComponent(activeSubTopic.id)}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                  title: activeSubTopic.title,
                  content: newContent
                })
              });
              console.log("[Auto-Upgrade] Successfully updated lesson content via API!");
           } catch (e) {
             console.error("[Auto-Upgrade] Failed to save upgraded content:", e);
           }
        }
      }
    };
    
    upgradePlaceholders();
    
    return () => {
      isMounted = false;
    };
  }, [activeSubTopic.id, activeLessonData?.content, isGenerating, isCurrentLessonLoading, courseId, module.id, user]);

  useEffect(() => {
    if (!activeLessonData || isGenerating || isCurrentLessonLoading) return;
    if (hasCheckedInRef.current.has(activeSubTopic.id)) return;

    // Calculate Dynamic Delay (Smart Timer)
    // Avg reading speed: 200 wpm. We nudge at ~70% of estimated reading time.
    const wordCount = activeLessonData.content.split(/\s+/).length;
    const estimatedReadingTimeMs = (wordCount / 200) * 60 * 1000;
    const dynamicDelay = Math.max(45000, Math.min(180000, estimatedReadingTimeMs * 0.7));

    const timer = setTimeout(() => {
      if (!isMiniTeacherOpenRef.current && !showQuizRef.current) {
        console.log(`[Proactive Check-In] Triggering for topic: ${activeSubTopic.title}`);
        handleOpenMiniTeacher('proactive');
      }
      hasCheckedInRef.current.add(activeSubTopic.id);
    }, dynamicDelay);

    return () => clearTimeout(timer);
  }, [activeSubTopic.id, activeLessonData, isGenerating, isCurrentLessonLoading]);

  useEffect(() => {
    if (autoStartQuiz) {
      setShowQuiz(true);
    }
    // Reset audio when subtopic changes
    setAudioUrl(null);
    setIsSpeaking(false);

    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [autoStartQuiz, activeSubTopicId]);

  const handleOpenMiniTeacher = (mode: 'default' | 'simpler' | 'quiz' | 'proactive' = 'default') => {
    setMiniTeacherMode(mode);
    setIsMiniTeacherOpen(true);
  };

  const handleMiniTeacherAction = (action: 'simpler' | 'quiz') => {
    if (action === 'quiz') {
      setIsMiniTeacherOpen(false);
      setIsProactiveQuiz(true);
      setShowQuiz(true);
    } else {
      setMiniTeacherMode('simpler');
    }
  };

  const handleQuizClose = () => {
    setShowQuiz(false);
    setIsProactiveQuiz(false);
  };

  const handleGenerateLesson = async () => {
    if (!isAdmin || !courseId) return;
    
    setIsGenerating(true);
    setGenerationStep(0);

    // Track regeneration telemetry
    try {
      const idToken = await user?.getIdToken();
      fetch('/api/telemetry/module-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ courseId, moduleId: module.id, action: 'regenerate' })
      }).catch(err => console.warn('Failed to track regeneration telemetry:', err));
    } catch (e) {}

    // Progress animation
    const interval = setInterval(() => {
      setGenerationStep(prev => (prev + 1) % generationSteps.length);
    }, 3000);

    try {
      const currentCourse = courseId ? courses[courseId] : null;
      const courseInput = currentCourse || { id: courseId, title: courseTitle };

      const lesson = await generateLessonContent(
        courseInput,
        module.title,
        activeSubTopic.title,
        undefined
      );

      // Save via Neon API
      try {
        const idToken = await user?.getIdToken();
        await fetch(`/api/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(module.id)}/lessons/${encodeURIComponent(activeSubTopic.id)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            title: activeSubTopic.title,
            content: lesson.content || ''
          })
        });
      } catch (saveErr) {
        console.warn('Failed to save lesson content via API:', saveErr);
      }

      LogService.log('success', 'ai', `Generated lesson content for ${activeSubTopic.title}`, { courseId, moduleId: module.id, lessonId: activeSubTopic.id, audience: (lesson.metadata as any)?.audience });

      // Update local state
      setFetchedLesson({ id: activeSubTopic.id, content: lesson.content, metadata: (lesson.metadata as PipelineMetadata) || {} });
      onLessonContentChange?.(lesson.content);

      // Update global state to reflect new content
      await refreshCourses();
    } catch (error: any) {
      console.error('Lesson Generation Error:', error);
    } finally {
      clearInterval(interval);
      setIsGenerating(false);
    }
  };

  const handleListen = async () => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      setIsSpeaking(true);
      audio.onended = () => setIsSpeaking(false);
      audio.play();
      return;
    }

    if (!activeLessonData?.content) return;

    try {
      setIsSpeaking(true);
      const url = await AIService.generateTTS(activeLessonData.content);
      if (url) {
        setAudioUrl(url);
        const audio = new Audio(url);
        audio.onended = () => setIsSpeaking(false);
        audio.play();
      } else {
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error('TTS Error:', error);
      setIsSpeaking(false);
    }
  };

  const prevSubTopic = activeSubTopicIndex > 0 ? module.subTopics[activeSubTopicIndex - 1] : null;
  const nextSubTopic = activeSubTopicIndex < module.subTopics.length - 1 ? module.subTopics[activeSubTopicIndex + 1] : null;

  const handleNextTopicClick = () => {
    if (nextSubTopic) {
      if (isLocked && activeSubTopicIndex + 1 > 0) {
        setLockedFeatureName('Full Module Access');
        setShowPricingModal(true);
        return;
      }
      onSubTopicSelect(nextSubTopic.id);
    }
  };

  const handleBackToSyllabusAction = async () => {
    // Track dropoff telemetry if they are leaving before finishing
    try {
      const idToken = await user?.getIdToken();
      fetch('/api/telemetry/module-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ courseId, moduleId: module.id, action: 'dropoff' })
      }).catch(err => console.warn('Failed to track dropoff telemetry:', err));
    } catch (e) {}
    onBackToSyllabus();
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-zinc-50 dark:bg-zinc-950">
      {/* Subtopic Navigation Bar */}
      <div className="sticky top-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-6 py-3 flex items-center justify-between overflow-x-auto no-scrollbar whitespace-nowrap">
        <div className="flex items-center gap-4">
          {!isSidebarOpen && (
            <button 
              onClick={toggleSidebar}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 dark:text-zinc-400 transition-colors"
            >
              <Menu size={18} />
            </button>
          )}
          <button 
            onClick={handleBackToSyllabusAction}
            className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 font-medium text-sm transition-colors"
          >
            <ArrowLeft size={16} />
            <span>Syllabus</span>
          </button>
          {isAdmin && (
            <button 
              onClick={handleGenerateLesson}
              disabled={isGenerating}
              className="flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium transition-all active:scale-95 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50"
              title="Regenerate Full University Note"
            >
              <Wand2 size={14} />
              <span className="hidden sm:inline">Regenerate</span>
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleListen}
            disabled={isSpeaking && !audioUrl}
            className={`flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium transition-all active:scale-95 ${
              isSpeaking 
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' 
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
            }`}
          >
            {isSpeaking && !audioUrl ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Volume2 size={14} />
            )}
            <span>{isSpeaking ? 'Speaking...' : 'Listen'}</span>
          </button>

          <button
            onClick={() => setIsQuickSummaryOpen(true)}
            className="flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium transition-all active:scale-95 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50"
          >
            <List size={14} />
            <span className="hidden sm:inline">Summary</span>
          </button>

          <div className="relative">
            <button
              onClick={() => handleOpenMiniTeacher('default')}
              className="flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium transition-all active:scale-95 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50"
            >
              <Sparkles size={14} />
              <span>Mini Teacher</span>
            </button>
          </div>

          <button
            onClick={onToggleCalculator}
            className="flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium transition-all active:scale-95 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-zinc-300"
          >
            <CalcIcon size={14} />
            <span>Calc</span>
          </button>

          <button
            onClick={() => setShowQuiz(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-md text-sm font-medium transition-all active:scale-95"
          >
            <Brain size={14} />
            <span>Quiz</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div ref={contentScrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10 pb-4 lg:pb-10">
        <div className="w-full space-y-8">
          <motion.div
            key={activeSubTopic.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-8 lg:p-10 text-zinc-800 dark:text-zinc-200"
          >
            <div className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500 text-[10px] font-semibold uppercase tracking-wider mb-3 sm:mb-4">
              <BookOpen size={12} />
              <span>{module.title}</span>
              <ChevronRight size={12} />
              <span className="text-zinc-900 dark:text-zinc-100">{activeSubTopic.title}</span>
            </div>

            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-zinc-950 dark:text-white mb-5 sm:mb-7 tracking-tight leading-snug">{activeSubTopic.title}</h1>

            {isGenerating ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-6 text-center">
                <div className="relative">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                    className="w-24 h-24 border-4 border-emerald-100 border-t-emerald-600 rounded-full"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Wand2 size={32} className="text-emerald-600 animate-pulse" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg sm:text-xl font-semibold text-zinc-900 dark:text-white flex items-center justify-center gap-2">
                    <Sparkles size={20} className="text-amber-500" />
                    Infinite Lesson Engine
                  </h3>
                  <p className="text-zinc-500 dark:text-zinc-400 font-medium animate-pulse">
                    {generationSteps[generationStep]}
                  </p>
                </div>
                <div className="max-w-xs text-xs text-zinc-400 italic">
                  "The magic of AI is turning blank pages into worlds of knowledge."
                </div>
              </div>
            ) : isCurrentLessonLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                <Loader2 className="animate-spin text-indigo-500" size={48} />
                <p className="text-zinc-500 dark:text-zinc-400 font-medium animate-pulse">
                  Loading lesson content...
                </p>
              </div>
            ) : activeLessonData ? (
              <div className="max-w-none space-y-8">
                {/* Dynamic Program Applications & Disciplinary Relevance Overlay */}
                {Array.isArray(relevanceList) && relevanceList.length > 0 && activeRelevance && (
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-50/80 to-purple-50/50 dark:from-indigo-950/30 dark:to-purple-950/20 border border-indigo-100 dark:border-indigo-900/40">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-300">
                          Disciplinary Applications & Program Relevance
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {relevanceList.map((rel: any) => {
                          const isSelected = rel.department === activeRelevance.department;
                          const isUserDept = profile?.department && rel.department?.toLowerCase() === profile.department.toLowerCase();
                          return (
                            <button
                              key={rel.department}
                              onClick={() => setSelectedRelevanceDept(rel.department)}
                              className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all ${
                                isSelected
                                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                                  : 'bg-white/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-700 border border-zinc-200/60 dark:border-zinc-700/50'
                              }`}
                            >
                              {rel.department}
                              {isUserDept && (
                                <span className="ml-1.5 text-[9px] px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-200">
                                  Your Program
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-indigo-100/80 dark:border-zinc-800 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/40 border border-indigo-200/50 dark:border-indigo-800/50">
                          Applied Concept: {activeRelevance.concept}
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                        {activeRelevance.application}
                      </p>
                    </div>
                  </div>
                )}

                <MarkdownRenderer content={activeLessonData.content} />
                
                {/* Source Citations & Grounding Section */}
                {module.groundingReferences && module.groundingReferences.length > 0 && (
                  <div className="pt-8 border-t border-zinc-100 dark:border-zinc-800/50">
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <BookOpen size={14} className="text-indigo-500" />
                      Academic Grounding & Verification Sources
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {module.groundingReferences.map((ref, idx) => (
                        <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-700/30">
                          <div className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                          <span className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{ref}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-[10px] text-zinc-400 italic">
                      This content was dynamically generated and verified against the scholarly references listed above. 
                      Confidence State: <span className="font-bold text-indigo-500">{module.confidenceState || 'Verified'}</span>
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                <div className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-full">
                  <BookOpen size={32} className="text-zinc-400 dark:text-zinc-500" />
                </div>
                <p className="text-zinc-500 dark:text-zinc-400">This lesson is currently empty.</p>
                {isAdmin ? (
                  <button 
                    onClick={handleGenerateLesson}
                    className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-2 rounded-xl font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all text-sm"
                  >
                    Generate Content Now
                  </button>
                ) : (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-md">
                    This lesson content hasn't been generated yet. Please contact your instructor or administrator to generate the course content.
                  </p>
                )}
              </div>
            )}
          </motion.div>

          {!isGenerating && !isCurrentLessonLoading && activeLessonData && (
            <>
              {/* Quick Knowledge Check */}
              <QuickCheck 
                key={`qc-${activeSubTopic.id}`}
                subTopic={{ ...activeSubTopic, content: activeLessonData.content }} 
                onCorrect={() => onQuickCheckComplete?.(activeSubTopic.id)} 
              />
            </>
          )}

          {/* Navigation & Quiz Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {prevSubTopic ? (
              <button
                onClick={() => onSubTopicSelect(prevSubTopic.id)}
                className="group flex flex-col items-start gap-1 p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-zinc-900 dark:hover:border-zinc-100 transition-all text-left"
              >
                <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Previous Topic</span>
                <span className="text-zinc-900 dark:text-zinc-100 font-semibold group-hover:text-emerald-600 transition-colors text-sm sm:text-base">{prevSubTopic.title}</span>
              </button>
            ) : <div />}

            <button
              onClick={() => setShowQuiz(true)}
              className="flex flex-col items-center justify-center gap-2 p-5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all active:scale-95"
            >
              <Brain size={20} />
              <span className="font-semibold text-sm">Take Topic Quiz</span>
            </button>

            {nextSubTopic ? (
              <button
                onClick={handleNextTopicClick}
                className="group flex flex-col items-end gap-1 p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-zinc-900 dark:hover:border-zinc-100 transition-all text-right"
              >
                <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                  {isLocked && activeSubTopicIndex + 1 > 0 && <Lock size={10} className="text-amber-500" />}
                  Next Topic
                </span>
                <span className="text-zinc-900 dark:text-zinc-100 font-semibold group-hover:text-emerald-600 transition-colors text-sm sm:text-base">{nextSubTopic.title}</span>
              </button>
            ) : <div />}
          </div>
        </div>
      </div>

      {/* Quiz Generator Overlay */}
      <AnimatePresence>
        {showQuiz && (
          <QuizGenerator 
            courseId={courseId || undefined}
            module={module} 
            subTopic={{ ...activeSubTopic, content: fetchedLesson?.content || '' }}
            isProactive={isProactiveQuiz}
            onClose={handleQuizClose} 
            onComplete={(score) => onQuizComplete(activeSubTopic.id, score)}
            onNextTopic={nextSubTopic ? handleNextTopicClick : undefined}
            isNextTopicLocked={isLocked && activeSubTopicIndex + 1 > 0}
            onBookmark={onBookmark}
            onToggleCalculator={onToggleCalculator}
          />
        )}
      </AnimatePresence>

      {showPricingModal && (
        <PricingModal 
          isOpen={showPricingModal}
          onClose={() => setShowPricingModal(false)} 
          featureName={lockedFeatureName}
          onUpgradeClick={() => {
            setShowPricingModal(false);
            setShowQuiz(false);
            onViewSelect?.('pricing');
          }}
        />
      )}

      <MiniTeacherModal
        isOpen={isMiniTeacherOpen}
        onClose={() => setIsMiniTeacherOpen(false)}
        onAction={handleMiniTeacherAction}
        module={module}
        subTopic={{ ...activeSubTopic, content: fetchedLesson?.content || '' }}
        mode={miniTeacherMode}
        progress={progress}
      />

      <QuickSummaryModal
        isOpen={isQuickSummaryOpen}
        onClose={() => setIsQuickSummaryOpen(false)}
        topicTitle={activeSubTopic.title}
        content={fetchedLesson?.content || ''}
      />
    </div>
  );
}
