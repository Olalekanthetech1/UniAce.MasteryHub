import { FileText, Search, Download, ExternalLink, GraduationCap, ArrowLeft, Brain, Clock, CheckCircle2, XCircle, Lightbulb, RotateCcw, Trophy, ArrowRight, Lock, Loader2, AlertTriangle, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect } from 'react';
import { CourseId, UserProgress } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import PricingModal from './PricingModal';
import { db } from '../firebase';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import CourseContextBar from './CourseContextBar';
import { isCourseEligibleForUser } from '../utils/courseEligibility';

export interface PastPaper {
  id: string;
  courseCode: string;
  year: string;
  semester: string;
  title: string;
  questions: {
    id: string;
    type: 'multiple-choice' | 'true-false' | 'short-answer';
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
    hint?: string;
  }[];
}

interface PastQuestionsProps {
  activeCourseId: CourseId | null;
  onSelectCourse: (courseId: CourseId) => void;
  activeSemester?: string;
  enrolledCourses?: CourseId[];
}

export default function PastQuestions({ 
  activeCourseId,
  onSelectCourse,
  activeSemester = '1st Semester',
  enrolledCourses = []
}: PastQuestionsProps) {
  const { user, profile } = useAuth();
  const { courses } = useCourses();
  const { isPremium } = usePremiumStatus();
  const isAdmin = profile?.role === 'admin' || (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').includes(user?.email || '');
  const isLocked = !isPremium && !isAdmin;

  const [selectedPaper, setSelectedPaper] = useState<PastPaper | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [showHints, setShowHints] = useState<Record<string, boolean>>({});
  const [eliminatedOptions, setEliminatedOptions] = useState<Record<string, string[]>>({});
  const [isUsingFiftyFifty, setIsUsingFiftyFifty] = useState<Record<string, boolean>>({});
  const [submittedQuestions, setSubmittedQuestions] = useState<Record<string, boolean>>({});
  const [showResults, setShowResults] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [allPapers, setAllPapers] = useState<PastPaper[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const activeCourse = activeCourseId ? courses[activeCourseId] : null;

  // Filter program courses using shared eligibility engine
  const availableCourses = Object.values(courses).filter(c => 
    isCourseEligibleForUser(c, profile, activeSemester, enrolledCourses) || enrolledCourses.includes(c.id as CourseId)
  );

  useEffect(() => {
    const fetchPapers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'past_papers'));
        const dbPapers: PastPaper[] = [];
        querySnapshot.forEach((doc) => {
          dbPapers.push({ id: doc.id, ...doc.data() } as PastPaper);
        });
        setAllPapers(dbPapers);
      } catch (error) {
        console.error("Error fetching past papers:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchPapers();
  }, []);

  const filteredPapers = allPapers.filter(paper => {
    const title = paper.title || '';
    const courseCode = paper.courseCode || '';
    const year = paper.year || '';
    const searchLower = searchQuery.toLowerCase();

    const matchesCourse = activeCourseId ? courseCode.replace(/\s+/g, '').toLowerCase() === activeCourseId.replace(/\s+/g, '').toLowerCase() : true;
    const matchesSearch = title.toLowerCase().includes(searchLower) ||
      year.includes(searchQuery) ||
      courseCode.toLowerCase().includes(searchLower);
    return matchesCourse && matchesSearch;
  });

  const handleOptionSelect = (questionId: string, option: string) => {
    if (submittedQuestions[questionId]) return;
    setUserAnswers(prev => ({ ...prev, [questionId]: option }));
  };

  const handleSubmitQuestion = (questionId: string) => {
    setSubmittedQuestions(prev => ({ ...prev, [questionId]: true }));
  };

  const toggleHint = (questionId: string) => {
    setShowHints(prev => ({ ...prev, [questionId]: !prev[questionId] }));
  };

  const handleUseFiftyFifty = async (q: any) => {
    if (isUsingFiftyFifty[q.id]) return;
    if (eliminatedOptions[q.id]) return;

    const rawSparks = profile?.ai_sparks;
    const currentSparks: number | null =
      typeof rawSparks === 'number' && Number.isFinite(rawSparks) ? rawSparks : null;

    if (!isPremium && currentSparks !== null && currentSparks < 1) {
      toast.error("Insufficient sparks! Please upgrade or obtain more sparks.");
      setShowPricingModal(true);
      return;
    }

    setIsUsingFiftyFifty(prev => ({ ...prev, [q.id]: true }));
    try {
      const token = await user?.getIdToken();
      const response = await fetch('/api/user/deduct-sparks-hint', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          courseId: activeCourseId || null,
          moduleId: null,
          questionId: q?.id || null,
          questionText: q?.question || null
        })
      });

      const resData = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(resData.error || "Failed to deduct spark for hint");
      }

      const wrongOptions = q.options?.filter((opt: string) => opt !== q.correctAnswer) || [];
      if (wrongOptions.length <= 1) {
        toast.error("This question doesn't have enough options to eliminate!");
        return;
      }

      const shuffledWrongs = [...wrongOptions].sort(() => Math.random() - 0.5);
      const toEliminate = shuffledWrongs.slice(0, Math.min(2, wrongOptions.length - 1));

      setEliminatedOptions(prev => ({
        ...prev,
        [q.id]: toEliminate
      }));

      if (resData.sparksDeducted === 0 || isPremium) {
        toast.success("50/50 hint activated!");
      } else {
        toast.success(`50/50 hint activated! ${resData.sparksDeducted ?? 1} Spark deducted.`);
      }
    } catch (error: any) {
      console.error("Error using 50/50 hint:", error);
      toast.error(error.message || "Failed to activate 50/50 hint. Please try again.");
    } finally {
      setIsUsingFiftyFifty(prev => ({ ...prev, [q.id]: false }));
    }
  };

  const resetQuiz = () => {
    setUserAnswers({});
    setShowHints({});
    setSubmittedQuestions({});
    setShowResults(false);
    setIsStarted(false);
    setEliminatedOptions({});
  };

  const calculateScore = () => {
    if (!selectedPaper) return 0;
    return selectedPaper.questions.reduce((acc, q) => {
      return acc + (userAnswers[q.id] === q.correctAnswer ? 1 : 0);
    }, 0);
  };

  if (selectedPaper) {
    const score = calculateScore();
    const totalQuestions = selectedPaper.questions.length;
    const percentage = Math.round((score / totalQuestions) * 100);
    const attemptedCount = Object.keys(submittedQuestions).length;
    const progressPercent = (attemptedCount / totalQuestions) * 100;

    if (!isStarted) {
      return (
        <div className="flex-1 bg-slate-50 dark:bg-zinc-950 p-4 sm:p-6 lg:p-12 pb-4 lg:pb-12 transition-colors">
          <div className="max-w-2xl mx-auto space-y-8">
            <div className="lg:pl-4 xl:pl-0">
              <button 
                onClick={() => setSelectedPaper(null)}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-bold transition-colors"
              >
                <ArrowLeft size={20} />
                Back to Repository
              </button>
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-12 rounded-[3rem] text-center space-y-8 shadow-sm">
              <div className="bg-emerald-100 text-emerald-600 p-6 rounded-3xl w-fit mx-auto">
                <Brain size={48} />
              </div>
              <div className="space-y-4">
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{selectedPaper.title}</h2>
                <p className="text-slate-500 dark:text-zinc-400 text-base sm:text-lg">
                  You are about to start a practice session for {selectedPaper.courseCode}. 
                  This session includes {totalQuestions} questions with hints and detailed explanations.
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-left">
                <div className="bg-slate-50 dark:bg-zinc-800/50 p-4 rounded-2xl border border-slate-100 dark:border-zinc-700/60">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Duration</div>
                  <div className="font-bold text-slate-900 dark:text-white">Untimed Practice</div>
                </div>
                <div className="bg-slate-50 dark:bg-zinc-800/50 p-4 rounded-2xl border border-slate-100 dark:border-zinc-700/60">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Questions</div>
                  <div className="font-bold text-slate-900 dark:text-white">{totalQuestions} MCQs</div>
                </div>
              </div>

              <button 
                onClick={() => setIsStarted(true)}
                className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-5 rounded-2xl font-bold text-xl hover:bg-emerald-500 dark:hover:bg-emerald-500 dark:hover:text-white transition-all shadow-xl shadow-slate-200 dark:shadow-none"
              >
                Start Practice Session
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-zinc-950 p-3 sm:p-6 lg:p-8 pb-16 transition-colors">
        <div className="w-full max-w-7xl 2xl:max-w-[1600px] mx-auto space-y-6 sm:space-y-8">
          <div className="sticky top-0 z-10 bg-slate-50/80 dark:bg-zinc-950/80 backdrop-blur-md py-4 -mx-4 px-4 border-b border-slate-200 dark:border-zinc-800 mb-8">
            <div className="flex justify-between items-center mb-4">
              <button 
                onClick={() => {
                  setSelectedPaper(null);
                  resetQuiz();
                }}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-900 dark:hover:text-white font-bold transition-colors"
              >
                <ArrowLeft size={20} />
                Exit Practice
              </button>
              
              <div className="flex items-center gap-4">
                <div className="text-sm font-bold text-slate-500">
                  Progress: <span className="text-slate-900 dark:text-white">{attemptedCount} / {totalQuestions}</span>
                </div>
                {attemptedCount === totalQuestions && !showResults && (
                  <button 
                    onClick={() => setShowResults(true)}
                    className="bg-emerald-500 text-white px-6 py-2 rounded-xl font-bold hover:bg-emerald-600 transition-all shadow-lg"
                  >
                    View Final Results
                  </button>
                )}
              </div>
            </div>
            <div className="h-2 bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                className="h-full bg-emerald-500"
              />
            </div>
          </div>

          <AnimatePresence>
            {showResults && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-900 dark:bg-zinc-900 text-white p-10 rounded-[3rem] text-center space-y-6"
              >
                <Trophy size={64} className="mx-auto text-emerald-400" />
                <div className="space-y-2">
                  <h2 className="text-2xl sm:text-3xl font-bold">Quiz Complete!</h2>
                  <p className="text-slate-400">You scored {score} out of {totalQuestions}</p>
                </div>
                <div className="text-4xl sm:text-5xl font-bold text-emerald-400">{percentage}%</div>
                <div className="flex justify-center gap-4">
                  <button 
                    onClick={resetQuiz}
                    className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-6 py-3 rounded-2xl font-bold transition-all"
                  >
                    <RotateCcw size={20} />
                    Try Again
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-6">
            {(selectedPaper?.questions || []).map((q, idx) => {
              const isSubmitted = submittedQuestions[q.id];
              const selectedOption = userAnswers[q.id];
              const isCorrect = selectedOption === q.correctAnswer;
              const showHint = showHints[q.id];

              return (
                <motion.div 
                  key={q.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`bg-white dark:bg-zinc-900 border p-8 rounded-[2.5rem] shadow-sm space-y-6 transition-all ${
                    isSubmitted 
                      ? isCorrect 
                        ? 'border-emerald-500 ring-4 ring-emerald-50 dark:ring-0' 
                        : 'border-red-500 ring-4 ring-red-50 dark:ring-0'
                      : 'border-slate-200 dark:border-zinc-800'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <span className="bg-slate-100 dark:bg-zinc-800 text-slate-500 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider">
                      Question {idx + 1}
                    </span>
                    {!isSubmitted && (
                      <div className="flex gap-4 items-center flex-wrap">
                        <button 
                          onClick={() => toggleHint(q.id)}
                          className={`flex items-center gap-1 text-xs font-bold uppercase tracking-widest transition-colors ${showHint ? 'text-emerald-500' : 'text-slate-400 hover:text-slate-600 dark:hover:text-white'}`}
                        >
                          <Lightbulb size={14} />
                          {showHint ? 'Hide Hint' : 'Show Hint'}
                        </button>

                        {q.type === 'multiple-choice' && !eliminatedOptions[q.id] && (
                          <button 
                            onClick={() => handleUseFiftyFifty(q)}
                            disabled={isUsingFiftyFifty[q.id]}
                            className="bg-[#fffbeb] dark:bg-amber-950/20 hover:bg-[#fef3c7] dark:hover:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-semibold px-5 py-2.5 rounded-2xl flex items-center gap-2.5 transition-all text-sm border border-amber-100/50 dark:border-amber-900/10 shadow-xs"
                          >
                            {isUsingFiftyFifty[q.id] ? (
                              <Loader2 size={20} className="animate-spin text-amber-700" />
                            ) : (
                              <Lightbulb size={20} className="text-amber-700 shrink-0" />
                            )}
                            <span>
                              Use 50/50 Hint <span className="text-xs font-normal opacity-75">({isPremium ? 'Free' : 'Costs 1 Spark'})</span>
                            </span>
                          </button>
                        )}

                        {q.type === 'multiple-choice' && eliminatedOptions[q.id] && (
                          <div className="text-amber-700 dark:text-amber-400 text-xs font-semibold bg-[#fffbeb] dark:bg-amber-950/15 px-5 py-2.5 rounded-2xl flex items-center gap-2 border border-amber-100/50 dark:border-amber-900/10">
                            <span className="text-sm">🌓</span> 50/50 Hint Activated
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="text-xl font-bold text-slate-900 dark:text-white leading-relaxed markdown-body">
                    <MarkdownRenderer content={q.question} />
                  </div>

                  <AnimatePresence>
                    {showHint && !isSubmitted && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl text-sm text-emerald-800 font-medium italic"
                      >
                        <div className="flex gap-2">
                          <Lightbulb size={16} className="shrink-0 mt-0.5" />
                          <div className="flex-1 text-inherit not-italic">
                            <MarkdownRenderer content={q.hint} className="!text-inherit prose-p:!my-0 prose-sm" />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {q.type === 'multiple-choice' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {q.options?.map((opt, i) => {
                        const isSelected = selectedOption === opt;
                        const isOptionCorrect = opt === q.correctAnswer;
                        const isEliminated = eliminatedOptions[q.id]?.includes(opt);
                        
                        let optionStyles = "bg-slate-50 border-slate-100 text-slate-700 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300";
                        if (isSubmitted) {
                          if (isOptionCorrect) optionStyles = "bg-emerald-50 border-emerald-500 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300";
                          else if (isSelected) optionStyles = "bg-red-50 border-red-500 text-red-900 dark:bg-red-950/20 dark:text-red-300";
                          else optionStyles = "bg-slate-50 border-slate-100 text-slate-400 opacity-50 dark:bg-zinc-800 dark:border-zinc-700";
                        } else if (isEliminated) {
                          optionStyles = "bg-slate-100/30 border-dashed border-slate-200 text-slate-300 line-through cursor-not-allowed dark:border-zinc-800 dark:text-zinc-600";
                        } else if (isSelected) {
                          optionStyles = "bg-slate-900 border-slate-900 text-white dark:bg-white dark:text-slate-900";
                        }

                        return (
                          <button 
                            key={i} 
                            disabled={isSubmitted || isEliminated}
                            onClick={() => handleOptionSelect(q.id, opt)}
                            className={`p-4 rounded-2xl border text-left font-medium flex items-center gap-3 transition-all ${optionStyles} ${!isSubmitted && !isEliminated && 'hover:border-slate-400 dark:hover:border-zinc-500'}`}
                          >
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              isSelected ? 'bg-white text-slate-900' : 'bg-white border border-slate-200 text-slate-400'
                            }`}>
                              {String.fromCharCode(65 + i)}
                            </div>
                            <div className="markdown-body text-inherit flex-1 flex items-center justify-between gap-2">
                              <MarkdownRenderer content={opt} />
                              {isEliminated && (
                                <span className="text-[9px] font-semibold uppercase tracking-wider bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full select-none shrink-0 border border-red-500/15 line-through">
                                  Eliminated
                                </span>
                              )}
                            </div>
                            {isSubmitted && isOptionCorrect && <CheckCircle2 size={16} className="ml-auto text-emerald-500" />}
                            {isSubmitted && isSelected && !isCorrect && <XCircle size={16} className="ml-auto text-red-500" />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-6 border-t border-slate-100 dark:border-zinc-800 flex justify-between items-center">
                    {!isSubmitted ? (
                      <button 
                        disabled={!selectedOption}
                        onClick={() => handleSubmitQuestion(q.id)}
                        className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-6 py-2 rounded-xl font-bold hover:bg-emerald-500 disabled:opacity-50 transition-all"
                      >
                        Submit Answer
                      </button>
                    ) : (
                      <div className="w-full">
                        <div className={`flex items-center gap-2 font-bold text-sm uppercase tracking-widest mb-4 ${isCorrect ? 'text-emerald-600' : 'text-red-600'}`}>
                          {isCorrect ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                          {isCorrect ? 'Correct!' : 'Incorrect'}
                        </div>
                        <div className="p-6 bg-slate-50 dark:bg-zinc-800/40 rounded-2xl border border-slate-200 dark:border-zinc-800 space-y-4">
                          <div>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">Explanation</span>
                            {isLocked ? (
                              <div className="mt-2">
                                <button 
                                  onClick={() => setShowPricingModal(true)}
                                  className="w-full py-4 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl flex items-center justify-center gap-2 text-emerald-700 font-bold transition-colors"
                                >
                                  <Lock size={16} />
                                  Unlock AI Step-by-Step Solution
                                </button>
                              </div>
                            ) : (
                              <div className="text-sm text-slate-700 dark:text-zinc-300 leading-relaxed markdown-body">
                                <MarkdownRenderer content={q.explanation} />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
          <PricingModal 
            isOpen={showPricingModal}
            onClose={() => setShowPricingModal(false)}
            featureName="AI Step-by-Step Solutions"
            onUpgradeClick={() => {
              setShowPricingModal(false);
              window.dispatchEvent(new CustomEvent('navigate', { detail: 'pricing' }));
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-zinc-950 p-3 sm:p-6 lg:p-8 pb-16 transition-colors">
      <div className="w-full max-w-7xl 2xl:max-w-[1600px] mx-auto space-y-8 sm:space-y-12">
        
        {/* Active Course Context Switcher */}
        <CourseContextBar
          courses={courses}
          activeCourseId={activeCourseId}
          onSelectCourse={onSelectCourse}
          profile={profile}
          activeSemester={activeSemester}
          enrolledCourses={enrolledCourses}
          titleLabel="Past Questions Active Course"
        />

        {/* Header */}
        <header className="space-y-4 lg:pl-4 xl:pl-0">
          <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider text-xs">
            <FileText size={16} />
            <span>Repository</span>
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
            {activeCourse ? `${activeCourse.id}: Past Questions` : 'Past Question Bank'}
          </h1>
          <p className="text-slate-500 dark:text-zinc-400 text-sm sm:text-base leading-relaxed max-w-3xl">
            Access previous exam papers, complete targeted assessment sessions, and explore detailed grading logic.
          </p>
        </header>

        {/* STATE 1: No Course Selected */}
        {!activeCourseId && (
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 text-center space-y-6 shadow-sm">
            <div className="w-16 h-16 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto">
              <FileText size={32} />
            </div>
            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Select a Course to View Past Papers
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                Choose a course from your program curriculum to practice with historical examinations.
              </p>
            </div>

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
          </div>
        )}

        {/* STATE 2: Course Selected & Active */}
        {activeCourseId && (
          <>
            {/* Search Bar */}
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-slate-400 group-focus-within:text-slate-900 transition-colors">
                <Search size={20} />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by year, topic or exam code..."
                className="w-full pl-14 pr-6 py-4.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-[2rem] text-base focus:ring-2 focus:ring-slate-900 dark:focus:ring-white focus:border-transparent transition-all shadow-sm text-slate-900 dark:text-white"
              />
            </div>

            {/* Papers List */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-4">Available Papers for {activeCourseId}</h4>
              {filteredPapers.length > 0 ? (
                filteredPapers.map((paper) => (
                  <motion.div 
                    key={paper.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => setSelectedPaper(paper)}
                    className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-8 rounded-[2.5rem] flex flex-col md:flex-row items-start md:items-center justify-between hover:border-slate-900 dark:hover:border-white hover:shadow-xl transition-all cursor-pointer group gap-4 shadow-sm"
                  >
                    <div className="flex items-center gap-6">
                      <div className="bg-slate-100 dark:bg-zinc-800 p-4 rounded-2xl group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 transition-colors">
                        <GraduationCap size={24} />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">{paper.courseCode} - {paper.title}</h3>
                        <p className="text-slate-500 dark:text-zinc-400">{paper.year} • {paper.questions.length} Questions • Solutions Included</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 w-full md:w-auto justify-end">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          toast.success("Download started!");
                        }}
                        className="p-3 bg-slate-100 dark:bg-zinc-800 rounded-xl text-slate-900 dark:text-white hover:bg-slate-200 transition-colors"
                      >
                        <Download size={20} />
                      </button>
                      <div className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 group-hover:bg-emerald-500 dark:group-hover:bg-emerald-500 dark:group-hover:text-white transition-all whitespace-nowrap">
                        Practice Now
                        <ArrowRight size={18} />
                      </div>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-12 rounded-[3rem] text-center space-y-6 shadow-sm">
                  <div className="bg-slate-100 dark:bg-zinc-800 p-6 rounded-3xl w-fit mx-auto text-slate-400">
                    <FileText size={48} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white">No results found</h3>
                    <p className="text-slate-500 dark:text-zinc-400 max-w-md mx-auto">
                      No archived examinations match your criteria. Let us know if you want us to index one!
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Study Tips */}
            <div className="bg-slate-900 dark:bg-zinc-900 text-white p-10 rounded-[3rem] space-y-6 border dark:border-zinc-800 shadow-xl">
              <div className="flex items-center gap-3 text-emerald-400 font-bold uppercase tracking-widest text-xs">
                <GraduationCap size={16} />
                <span>Study Tips</span>
              </div>
              <h3 className="text-2xl font-bold">How to use past questions</h3>
              <ul className="space-y-4 text-slate-400">
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full mt-2 shrink-0" />
                  <span>Simulate exam conditions by setting a timer.</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full mt-2 shrink-0" />
                  <span>Identify recurring topics and question formats.</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full mt-2 shrink-0" />
                  <span>Compare your solutions with the provided marking schemes.</span>
                </li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
