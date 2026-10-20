import React, { useState, useEffect } from 'react';
import { 
  ArrowRight, 
  GraduationCap, 
  ArrowLeft, 
  Wand2, 
  Lock, 
  Book, 
  Activity, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  BookOpen, 
  Clock, 
  RotateCw, 
  Bookmark, 
  HelpCircle,
  FileText,
  Brain,
  MessageSquare
} from 'lucide-react';
import { motion } from 'motion/react';
import { Module, CourseId, CourseObjective, UserProgress } from '../types';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { LogService } from '../services/logService';
import { getModuleIcon } from '../utils/moduleIcons';
import CourseContextBar from './CourseContextBar';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc, getDoc } from 'firebase/firestore';
import { getCourseProgramStatus, isCourseEligibleForUser } from '../utils/courseEligibility';
import { sortCourseSyllabus } from '../shared/courseSchemas';
import toast from 'react-hot-toast';

interface CourseSyllabusProps {
  onModuleSelect: (moduleId: string) => void;
  onBack: () => void;
  onViewSelect?: (view: any) => void;
  activeCourseId: CourseId | null;
  syllabus: Module[];
  objectives?: (string | CourseObjective)[];
  isEnrolled: boolean;
  onEnroll: () => void;
  onUnenroll?: () => void;
  onRegenerate?: () => void;
  regenerationProgress?: number;
  regenerationStatus?: string;
  onSelectCourse?: (courseId: CourseId) => void;
  activeSemester?: string;
  enrolledCourses?: CourseId[];
  progress?: UserProgress;
}

function deriveBloomLevel(text: string): 'Remember' | 'Understand' | 'Apply' | 'Analyze' | 'Evaluate' | 'Create' {
  const lower = text.toLowerCase();
  if (lower.startsWith('create') || lower.startsWith('design') || lower.startsWith('formulate') || lower.startsWith('synthesize') || lower.startsWith('develop')) return 'Create';
  if (lower.startsWith('evaluate') || lower.startsWith('assess') || lower.startsWith('judge') || lower.startsWith('critique')) return 'Evaluate';
  if (lower.startsWith('analyze') || lower.startsWith('compare') || lower.startsWith('contrast') || lower.startsWith('distinguish')) return 'Analyze';
  if (lower.startsWith('apply') || lower.startsWith('solve') || lower.startsWith('calculate') || lower.startsWith('use') || lower.startsWith('implement') || lower.startsWith('compute')) return 'Apply';
  if (lower.startsWith('understand') || lower.startsWith('explain') || lower.startsWith('describe') || lower.startsWith('discuss')) return 'Understand';
  return 'Remember';
}

export default function CourseSyllabus({ 
  onModuleSelect, 
  onBack, 
  onViewSelect,
  activeCourseId, 
  syllabus: rawSyllabus, 
  objectives = [], 
  isEnrolled, 
  onEnroll, 
  onUnenroll,
  onRegenerate,
  regenerationProgress = 0,
  regenerationStatus = '',
  onSelectCourse,
  activeSemester = '1st Semester',
  enrolledCourses = [],
  progress
}: CourseSyllabusProps) {
  const syllabus = React.useMemo(() => sortCourseSyllabus(rawSyllabus), [rawSyllabus]);
  const { user, profile } = useAuth();
  const { courses, refreshCourses } = useCourses();
  const { isPremium } = usePremiumStatus();
  const isAdmin = Boolean(user && profile?.role === 'admin');
  const isLocked = !isPremium && !isAdmin;
  const [showUnenrollConfirm, setShowUnenrollConfirm] = useState(false);
  const [isRequestingGeneration, setIsRequestingGeneration] = useState(false);
  const [generationRequested, setGenerationRequested] = useState(false);

  const activeCourse = activeCourseId ? courses[activeCourseId] : null;

  // Filter program courses using shared eligibility engine
  const availableCourses = Object.values(courses).filter(c => 
    isCourseEligibleForUser(c, profile, activeSemester, enrolledCourses) || enrolledCourses.includes(c.id as CourseId)
  );

  const isEligible = activeCourse ? (
    getCourseProgramStatus(activeCourse, profile, activeSemester) === 'current_program' ||
    getCourseProgramStatus(activeCourse, profile, activeSemester) === 'global_core'
  ) : false;

  // Syllabus Status and Subscription from Live Database
  const [liveSyllabusStatus, setLiveSyllabusStatus] = useState<'pending' | 'generating' | 'ready' | 'failed'>('ready');
  
  useEffect(() => {
    if (activeCourse) {
      if (activeCourse.syllabusStatus) {
        setLiveSyllabusStatus(activeCourse.syllabusStatus);
      } else {
        setLiveSyllabusStatus(syllabus.length > 0 ? 'ready' : 'pending');
      }
    }
  }, [activeCourse, syllabus]);

  // Request Syllabus generation
  const handleRequestSyllabus = async () => {
    if (!activeCourseId || !activeCourse) return;
    setIsRequestingGeneration(true);
    try {
      await addDoc(collection(db, 'system_alerts'), {
        type: 'SYLLABUS_REQUEST',
        courseId: activeCourseId,
        courseTitle: activeCourse.title,
        requestedBy: user?.uid || 'anonymous',
        userEmail: user?.email || '',
        department: profile?.department || '',
        level: profile?.academic_level || '',
        semester: activeSemester,
        timestamp: serverTimestamp(),
        status: 'pending'
      });
      setGenerationRequested(true);
      toast.success("Syllabus request submitted to academic team!");
    } catch (e) {
      console.error("Failed requesting syllabus:", e);
      toast.error("Could not submit request. Please try again.");
    } finally {
      setIsRequestingGeneration(false);
    }
  };

  // Wrapped Admin Regeneration that sets live syllabusStatus on course document
  const triggerRegenerate = async () => {
    if (!isAdmin || !activeCourseId || !onRegenerate) return;
    toast.error("Admin syllabus regeneration writes to Firestore are paused during Postgres catalog migration.");
    return;
  };

  // Normalize objectives with Bloom taxonomy levels and match with quiz performance
  const normalizedObjectives: CourseObjective[] = (objectives || []).map(item => {
    if (typeof item === 'string') {
      return {
        outcome: item,
        bloomLevel: deriveBloomLevel(item)
      };
    }
    return {
      outcome: item.outcome || (item as any).title || (item as any).text || '',
      bloomLevel: item.bloomLevel || deriveBloomLevel(item.outcome || '')
    };
  });

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-zinc-950 p-3 sm:p-6 lg:p-8 pb-16 transition-colors">
      <div className="w-full space-y-6 sm:space-y-8">
        
        {/* Course Context Switcher Bar */}
        {onSelectCourse && (
          <CourseContextBar
            courses={courses}
            activeCourseId={activeCourseId}
            onSelectCourse={onSelectCourse}
            profile={profile}
            activeSemester={activeSemester}
            enrolledCourses={enrolledCourses}
            titleLabel="Syllabus Active Course"
          />
        )}

        {/* Header */}
        <header className="space-y-4 sm:space-y-6 lg:pl-4 xl:pl-0">
          <div className="flex items-center justify-between">
            <button 
              onClick={onBack}
              className="flex items-center gap-2 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white font-bold text-sm transition-colors group"
            >
              <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
              <span>Back to Dashboard</span>
            </button>
            {isAdmin && onRegenerate && activeCourseId && (
              <div className="flex flex-col items-end gap-2">
                <button 
                  onClick={triggerRegenerate}
                  disabled={regenerationProgress > 0 && regenerationProgress < 100 || liveSyllabusStatus === 'generating'}
                  className={`flex items-center gap-2 px-4 py-2 font-bold rounded-xl transition-colors text-sm ${
                    regenerationProgress > 0 && regenerationProgress < 100 || liveSyllabusStatus === 'generating'
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-200'
                  }`}
                >
                  <Wand2 size={16} className={regenerationProgress > 0 && regenerationProgress < 100 || liveSyllabusStatus === 'generating' ? 'animate-spin' : ''} />
                  {regenerationProgress > 0 && regenerationProgress < 100 || liveSyllabusStatus === 'generating' ? 'Generating Syllabus...' : 'Regenerate Syllabus'}
                </button>
                {regenerationProgress > 0 && (
                  <div className="w-48 sm:w-64 space-y-1">
                    <div className="flex justify-between text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                      <span>{regenerationStatus}</span>
                      <span>{Math.round(regenerationProgress)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${regenerationProgress}%` }}
                        className="h-full bg-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider text-[10px] sm:text-xs">
                <GraduationCap size={16} />
                <span>Full Course Syllabus</span>
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 dark:text-white tracking-tight leading-snug">
                {activeCourse ? `${activeCourse.id}: ${activeCourse.title}` : 'Academic Course Syllabus'}
              </h1>
              <p className="text-slate-500 dark:text-zinc-400 text-sm sm:text-base max-w-2xl leading-relaxed">
                A comprehensive breakdown of course modules and academic competencies. Select a module to explore its topics and start studying.
              </p>
            </div>
            
            {activeCourseId && liveSyllabusStatus === 'ready' && (
              <div className="shrink-0">
                {isEnrolled ? (
                  <button
                    onClick={() => {
                      if (onViewSelect) {
                        onViewSelect('dashboard');
                      }
                    }}
                    className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold shadow-lg shadow-emerald-500/30 transition-all hover:scale-105 active:scale-95 text-sm sm:text-base"
                  >
                    <Activity size={20} />
                    <span>Continue Studying</span>
                  </button>
                ) : (
                  <button
                    onClick={onEnroll}
                    className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 transition-all hover:scale-105 active:scale-95 text-sm sm:text-base"
                  >
                    <Book size={20} />
                    <span>Enroll Now</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {/* STATE 1: No Active Course Selected */}
        {!activeCourseId && (
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 text-center space-y-6 shadow-sm">
            <div className="w-16 h-16 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto">
              <BookOpen size={32} />
            </div>
            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Select a Course to View Syllabus
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                Choose a course from your program curriculum to view its module outline and lesson topics.
              </p>
            </div>

            {onSelectCourse && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-left max-w-3xl mx-auto pt-4">
                {availableCourses.map(c => (
                  <button
                    key={c.id}
                    onClick={() => onSelectCourse(c.id as CourseId)}
                    className="p-5 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-700/60 rounded-2xl transition-all group flex flex-col justify-between"
                  >
                    <div>
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block mb-1">
                        {c.id}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 mb-2">
                        {c.title}
                      </h4>
                    </div>
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-zinc-300 pt-3 border-t border-slate-200/60 dark:border-zinc-700/60">
                      <span>{c.level ? `L${c.level}` : 'L100'} • {c.semester || activeSemester}</span>
                      <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform text-emerald-500" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STATE 2: Course Selected, but Syllabus Empty, Pending, or Failed */}
        {activeCourseId && activeCourse && (liveSyllabusStatus === 'pending' || liveSyllabusStatus === 'generating' || liveSyllabusStatus === 'failed' || !syllabus || syllabus.length === 0) && (
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 sm:p-12 text-center space-y-6 shadow-sm">
            
            {liveSyllabusStatus === 'generating' ? (
              <div className="space-y-6">
                <div className="w-16 h-16 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto animate-pulse">
                  <Wand2 size={32} className="animate-spin" />
                </div>
                <div className="max-w-lg mx-auto space-y-2">
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                    Formulating Academic Syllabus...
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                    UniAce AI is currently building the core learning map and populating rigorous academic topics for <strong className="text-slate-900 dark:text-white">{activeCourse.id}: {activeCourse.title}</strong>. This takes about 10–20 seconds.
                  </p>
                </div>
                <div className="flex justify-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-bounce"></span>
                </div>
              </div>
            ) : liveSyllabusStatus === 'failed' ? (
              <div className="space-y-6">
                <div className="w-16 h-16 bg-red-500/10 text-red-600 dark:text-red-400 rounded-2xl flex items-center justify-center mx-auto">
                  <AlertTriangle size={32} />
                </div>
                <div className="max-w-lg mx-auto space-y-2">
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                    Syllabus Formulation Failed
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                    An error occurred while UniAce AI compiled the learning syllabus for <strong className="text-slate-900 dark:text-white">{activeCourse.title}</strong>. 
                  </p>
                </div>
                {isAdmin ? (
                  <button
                    onClick={triggerRegenerate}
                    className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold text-sm flex items-center gap-2 mx-auto"
                  >
                    <RotateCw size={16} />
                    Retry Syllabus Generation
                  </button>
                ) : (
                  <p className="text-xs text-slate-500">The academic support team has been notified and will resolve this shortly.</p>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="w-16 h-16 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto">
                  <HelpCircle size={32} />
                </div>
                <div className="max-w-lg mx-auto space-y-2">
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                    Syllabus Outline Not Available Yet
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                    The module curriculum breakdown for <strong className="text-slate-900 dark:text-white">{activeCourse.id}: {activeCourse.title}</strong> has not yet been initialized.
                  </p>
                </div>
                
                {isAdmin ? (
                  <button
                    onClick={triggerRegenerate}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm flex items-center gap-2 mx-auto"
                  >
                    <Wand2 size={16} />
                    Initialize Syllabus with UniAce AI
                  </button>
                ) : (
                  <div className="pt-2">
                    {generationRequested ? (
                      <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-emerald-800 dark:text-emerald-400 text-sm font-semibold max-w-sm mx-auto">
                        ✓ Request Received! Academic team has been notified.
                      </div>
                    ) : (
                      <button
                        onClick={handleRequestSyllabus}
                        disabled={isRequestingGeneration}
                        className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2 mx-auto"
                      >
                        {isRequestingGeneration ? 'Submitting Request...' : '✉ Request Syllabus Generation'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STATE 3: Course Selected with Modules */}
        {activeCourseId && liveSyllabusStatus === 'ready' && syllabus && syllabus.length > 0 && (
          <section className="space-y-8">
            {/* Syllabus Learning Map Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <BookOpen size={20} className="text-emerald-500" />
                <span>Core Study Map</span>
              </h2>
              <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
                {syllabus.length} modules • Est. 45 study hours
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {syllabus.map((module, i) => {
                const Icon = getModuleIcon(module.id, module.title, i);
                
                const confidenceColors: Record<string, string> = {
                  'verified': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200/50',
                  'needs_review': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200/50',
                  'failed': 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200/50'
                };

                return (
                  <motion.button
                    key={module.id || i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => {
                      if (isEnrolled) {
                        onModuleSelect(module.id);
                      } else {
                        onEnroll();
                      }
                    }}
                    className={`group relative flex flex-col h-full bg-white dark:bg-zinc-900 border p-6 sm:p-8 rounded-[2rem] sm:rounded-[2.5rem] text-left transition-all duration-300 overflow-hidden ${
                      isEnrolled 
                        ? 'border-slate-200 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-500 hover:shadow-xl cursor-pointer' 
                        : 'border-slate-100 dark:border-zinc-800/50 opacity-80 hover:opacity-100 cursor-pointer'
                    }`}
                  >
                    <div className="relative z-10 flex flex-col h-full w-full">
                      <div className="flex justify-between items-start mb-4 sm:mb-6">
                        <div className={`text-white p-3 sm:p-4 rounded-xl sm:rounded-2xl w-fit transition-colors duration-300 ${
                          isEnrolled ? 'bg-slate-900 dark:bg-zinc-800 group-hover:bg-emerald-500' : 'bg-slate-400 dark:bg-slate-700'
                        }`}>
                          <Icon size={20} className="sm:w-6 sm:h-6" />
                        </div>
                        
                        {module.confidenceState && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${confidenceColors[module.confidenceState] || confidenceColors.needs_review}`}>
                            {module.confidenceState.replace('_', ' ')}
                          </span>
                        )}
                      </div>

                      <div className="flex-1 flex flex-col">
                        <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white mb-1.5 break-words leading-snug pr-4">{module.title}</h3>
                        <p className="text-slate-500 dark:text-zinc-400 text-xs sm:text-sm leading-relaxed mb-4 flex-1">
                          Explore {(module?.subTopics || []).length} key topics including {(module?.subTopics?.[0]?.title || 'core concepts').toLowerCase()}.
                        </p>
                        
                        {module.groundingReferences && module.groundingReferences.length > 0 && (
                          <div className="mb-6 space-y-1.5">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Grounding Sources</p>
                            <div className="flex flex-wrap gap-2">
                              {module.groundingReferences.slice(0, 2).map((ref, idx) => (
                                <span key={idx} className="text-[10px] font-medium text-slate-500 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-zinc-700">
                                  {ref}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-2 font-semibold text-xs sm:text-sm mt-auto text-emerald-600 dark:text-emerald-400">
                          <span>{isEnrolled ? 'Explore Module' : 'Enroll to Access'}</span>
                          <ArrowRight size={14} className="sm:w-4 sm:h-4 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </section>
        )}

        {/* Syllabus Summary / Learning Outcomes with Live Quiz Performance Tracking */}
        {activeCourseId && liveSyllabusStatus === 'ready' && normalizedObjectives.length > 0 && (
          <section className="bg-slate-900 dark:bg-zinc-900 text-white p-6 sm:p-10 rounded-[2rem] sm:rounded-[3rem] space-y-6 sm:space-y-8 border dark:border-zinc-800 shadow-xl">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs uppercase tracking-wider">
                <Sparkles size={16} />
                <span>Academic Competencies</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold">Course Learning Objectives</h3>
              <p className="text-slate-400 text-sm sm:text-base">Targeted university-level skills linked with your live study and quiz performance data:</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              {normalizedObjectives.map((obj, index) => {
                // Find matching mastery from progress
                // If student has taken a quiz matching keywords in this outcome, they've demonstrated competency
                const relatedTopics = Object.keys(progress?.mastery || {}).filter(t => 
                  obj.outcome.toLowerCase().includes(t.toLowerCase())
                );
                const maxMastery = relatedTopics.length > 0 
                  ? Math.max(...relatedTopics.map(t => progress?.mastery[t] || 0)) 
                  : 0;

                const isMastered = maxMastery >= 80;
                const isStarted = maxMastery > 0;

                return (
                  <div key={index} className="flex items-start gap-4 p-5 bg-slate-800/60 dark:bg-zinc-800/60 rounded-2xl border border-slate-700/50 hover:border-slate-600 transition-colors">
                    {isMastered ? (
                      <div className="p-1 bg-emerald-500/20 text-emerald-400 rounded-full shrink-0">
                        <CheckCircle2 size={20} />
                      </div>
                    ) : isStarted ? (
                      <div className="p-1 bg-amber-500/20 text-amber-400 rounded-full shrink-0 animate-pulse">
                        <Activity size={20} />
                      </div>
                    ) : (
                      <div className="p-1 bg-slate-700/50 text-slate-400 rounded-full shrink-0">
                        <GraduationCap size={20} />
                      </div>
                    )}
                    <div className="space-y-2 w-full">
                      <p className="text-sm font-semibold text-slate-100 leading-relaxed">{obj.outcome}</p>
                      
                      <div className="flex flex-wrap items-center gap-2">
                        {obj.bloomLevel && (
                          <span className="inline-block px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 rounded-md">
                            Bloom: {obj.bloomLevel}
                          </span>
                        )}
                        {maxMastery > 0 && (
                          <span className={`inline-block px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-md ${
                            isMastered ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            Mastery: {maxMastery}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Curriculum Provenance Metadata */}
            {activeCourse?.provenance && (
              <div className="pt-4 border-t border-slate-800 text-[11px] text-slate-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <span>
                  Syllabus verified under standard: <strong>{activeCourse.academicStandard || 'Accredited Higher Education Criterion'}</strong>
                </span>
                <span>
                  Last Revised: <strong>{new Date(activeCourse.provenance.generatedAt).toLocaleDateString()}</strong> • Sources: <strong>{activeCourse.provenance.sources?.join(', ') || 'Global Curriculum Blueprint'}</strong>
                </span>
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  );
}
