import { useState, useEffect } from 'react';
import { Module, SubTopic, QuizQuestion, QuestionType } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Brain, Loader2, CheckCircle2, XCircle, ArrowRight, RefreshCw, Settings2, Bookmark, Timer, Flag, LayoutGrid, ChevronLeft, ChevronRight, Lock, Calculator as CalcIcon, Lightbulb } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { AIService } from '../services/ai';
import { useAuth } from '../context/AuthContext';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import PricingModal from './PricingModal';
import { SRSService } from '../services/srsService';
import { triggerMilestoneCelebration } from '../utils/celebration';
import toast from 'react-hot-toast';

interface QuizGeneratorProps {
  courseId?: string;
  module: Module;
  subTopic?: SubTopic;
  onClose: () => void;
  onComplete?: (score: number) => void;
  onNextTopic?: () => void;
  isNextTopicLocked?: boolean;
  onBookmark?: (question: QuizQuestion) => void;
  isProactive?: boolean;
  onToggleCalculator?: () => void;
}

export default function QuizGenerator({ 
  courseId, 
  module, 
  subTopic, 
  onClose, 
  onComplete, 
  onNextTopic, 
  isNextTopicLocked, 
  onBookmark, 
  isProactive,
  onToggleCalculator
}: QuizGeneratorProps) {
  const [step, setStep] = useState<'config' | 'loading' | 'quiz' | 'results'>('config');
  const [isClaimingReward, setIsClaimingReward] = useState(false);
  const [rewardMessage, setRewardMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<'practice' | 'exam' | 'adaptive'>('practice');
  const [numQuestions, setNumQuestions] = useState(3);
  const [questionType, setQuestionType] = useState<QuestionType>('multiple-choice');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [adaptiveQuestions, setAdaptiveQuestions] = useState<QuizQuestion[]>([]);
  const [currentDifficulty, setCurrentDifficulty] = useState(3);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [showExplanation, setShowExplanation] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [hintsUsed, setHintsUsed] = useState<Record<string, boolean>>({});
  const [eliminatedOptions, setEliminatedOptions] = useState<Record<string, string[]>>({});
  const [isUsingFiftyFifty, setIsUsingFiftyFifty] = useState(false);
  const [progressiveHint, setProgressiveHint] = useState<string | null>(null);
  const [isFetchingHint, setIsFetchingHint] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  
  // Written evaluation states
  const [writtenEvaluations, setWrittenEvaluations] = useState<Record<string, { score: number; isCorrect: boolean; feedback: string }>>({});
  const [isEvaluatingWritten, setIsEvaluatingWritten] = useState(false);
  const [isExamSubmitting, setIsExamSubmitting] = useState(false);
  
  const { user, profile } = useAuth();
  const { isPremium } = usePremiumStatus();
  const isAdmin = profile?.role === 'admin' || (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').includes(user?.email || '');
  const isLocked = !isPremium && !isAdmin;
  
  // Exam Mode State
  const [timeLeft, setTimeLeft] = useState(0); // in seconds
  const [flaggedQuestions, setFlaggedQuestions] = useState<Record<string, boolean>>({});
  const [showPalette, setShowPalette] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (step === 'quiz' && mode === 'exam' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            submitExam();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step, mode, timeLeft]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const generateQuiz = async () => {
    setStep('loading');
    try {
      const isAdaptive = mode === 'adaptive';
      
      // Fetch user skill level for adaptive quizzes
      let userSkillLevel = 3; // Default to medium
      if (isAdaptive && user && courseId && subTopic) {
        try {
          const srsRecord = await SRSService.getSRSRecord(user.uid, courseId, subTopic.id);
          if (srsRecord) {
            // Map repetitions to a skill level (1-5)
            // 0 reps = level 1, 1-2 reps = level 2, 3-4 reps = level 3, 5-6 reps = level 4, 7+ reps = level 5
            userSkillLevel = Math.min(5, Math.max(1, Math.floor(srsRecord.repetitions / 2) + 1));
          }
        } catch (error) {
          console.error("Failed to fetch user skill level:", error);
        }
      }

      // Lazy Load Content for Quiz Generation if missing
      let moduleForQuiz = { ...module };
      let subTopicForQuiz = subTopic ? { ...subTopic } : undefined;

      if (courseId) {
        try {
          const { CourseService } = await import('../services/courseService');
          const lessons = await CourseService.getLessons(courseId, module.id);
          
          if (subTopicForQuiz && !subTopicForQuiz.content) {
            const target = lessons.find(l => l.id === subTopicForQuiz.id || (subTopicForQuiz.id.includes('-') && l.id === subTopicForQuiz.id.split('-')[1]));
            if (target && target.content) {
              subTopicForQuiz.content = target.content;
            }
          } else if (!subTopicForQuiz) {
            const lessonsContentMap: Record<string, string> = {};
            lessons.forEach(l => {
              if (l.content) lessonsContentMap[l.id] = l.content;
            });
            moduleForQuiz.subTopics = moduleForQuiz.subTopics.map(st => ({
              ...st,
              content: st.content || lessonsContentMap[st.id] || lessonsContentMap[st.id.split('-')[1] || ''] || ''
            }));
          }
        } catch (lErr) {
          console.warn('[QuizGenerator] Failed to load lesson content via API:', lErr);
        }
      }
          


      // Check if there is actual content to generate questions from
      const hasContent = subTopicForQuiz ? !!subTopicForQuiz.content : moduleForQuiz.subTopics.some(st => st.content);
      if (!hasContent) {
        throw new Error("No lesson content found. Please read or generate the lessons first before taking a quiz.");
      }

      const rollingMastery = typeof userSkillLevel === 'number' ? Math.round((userSkillLevel / 5) * 100) : 50;
      const data = await AIService.generateQuiz(
        moduleForQuiz, 
        subTopicForQuiz, 
        numQuestions, 
        questionType, 
        isAdaptive, 
        userSkillLevel,
        profile?.academic_level,
        profile?.department,
        profile?.displayName,
        rollingMastery
      );
      
      if (!data || data.length === 0) {
        throw new Error("No questions generated. Please try again.");
      }

      if (isAdaptive) {
        setAdaptiveQuestions(data);
        const firstQ = data.find((q: any) => q.difficulty === userSkillLevel) || data[0];
        setQuestions([firstQ]);
        setCurrentDifficulty(firstQ.difficulty || userSkillLevel);
      } else {
        setQuestions(data);
        if (mode === 'exam') {
          setTimeLeft(numQuestions * 90); // 1.5 minutes per question
        }
      }
      setStep('quiz');
    } catch (error: any) {
      console.error("Quiz generation error:", error);
      alert(error.message || "Failed to generate quiz. Please try again.");
      setStep('config');
    }
  };

  const handleAnswer = (answer: string) => {
    if ((mode === 'practice' || mode === 'adaptive') && showExplanation) return;
    
    setUserAnswers(prev => ({ ...prev, [questions[currentQuestionIndex].id]: answer }));
    
    if (mode === 'practice' || mode === 'adaptive') {
      setShowExplanation(true);
    }
  };

  const handleWrittenAnswerSubmit = async () => {
    const q = questions[currentQuestionIndex];
    const answer = userAnswers[q.id] || '';
    if (!answer.trim() || isEvaluatingWritten) return;

    setIsEvaluatingWritten(true);
    try {
      const evalResult = await AIService.evaluateWrittenAnswer(q.question, q.correctAnswer, answer);
      setWrittenEvaluations(prev => ({ ...prev, [q.id]: evalResult }));
    } catch (err) {
      console.error("Error evaluating written answer:", err);
    } finally {
      setIsEvaluatingWritten(false);
      setShowExplanation(true);
    }
  };

  const nextQuestion = () => {
    if (mode === 'adaptive') {
      if (questions.length < numQuestions) {
        const currentQ = questions[currentQuestionIndex];
        const isCorrect = currentQ.type === 'multiple-choice'
          ? userAnswers[currentQ.id]?.toLowerCase().trim() === currentQ.correctAnswer.toLowerCase().trim()
          : !!writtenEvaluations[currentQ.id]?.isCorrect;
        
        let nextDiff = currentDifficulty;
        if (isCorrect) nextDiff = Math.min(5, currentDifficulty + 1);
        else nextDiff = Math.max(1, currentDifficulty - 1);
        
        const usedIds = new Set(questions.map(q => q.id));
        let nextQ = adaptiveQuestions.find(q => q.difficulty === nextDiff && !usedIds.has(q.id));
        
        if (!nextQ) {
          nextQ = adaptiveQuestions.find(q => !usedIds.has(q.id));
        }
        
        if (nextQ) {
          setQuestions(prev => [...prev, nextQ!]);
          setCurrentQuestionIndex(prev => prev + 1);
          setCurrentDifficulty(nextQ!.difficulty || nextDiff);
          setShowExplanation(false);
          setShowHint(false);
          setProgressiveHint(null);
        } else {
          finishQuiz();
        }
      } else {
        finishQuiz();
      }
    } else {
      if (currentQuestionIndex < questions.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
        setShowExplanation(false);
        setShowHint(false);
        setProgressiveHint(null);
      } else if (mode === 'practice') {
        finishQuiz();
      }
    }
  };

  const prevQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
      setShowExplanation(false);
      setShowHint(false);
      setProgressiveHint(null);
    }
  };

  const toggleFlag = () => {
    const qId = questions[currentQuestionIndex].id;
    setFlaggedQuestions(prev => ({ ...prev, [qId]: !prev[qId] }));
  };

  const submitExam = async () => {
    // Collect all written questions that need to be graded
    const writtenQuestions = questions.filter(q => q.type === 'fill-in-the-blank');
    const answersToGrade = writtenQuestions.filter(q => userAnswers[q.id]?.trim() && !writtenEvaluations[q.id]);
    
    let finalEvals = { ...writtenEvaluations };
    
    if (answersToGrade.length > 0) {
      setIsExamSubmitting(true);
      try {
        const gradingPromises = answersToGrade.map(async q => {
          const evalResult = await AIService.evaluateWrittenAnswer(q.question, q.correctAnswer, userAnswers[q.id]);
          return { id: q.id, evalResult };
        });
        
        const gradedResults = await Promise.all(gradingPromises);
        gradedResults.forEach(({ id, evalResult }) => {
          finalEvals[id] = evalResult;
        });
        setWrittenEvaluations(finalEvals);
      } catch (err) {
        console.error("Error during exam written grading:", err);
      } finally {
        setIsExamSubmitting(false);
      }
    }
    
    await finishQuiz(finalEvals);
  };

  const finishQuiz = async (evals = writtenEvaluations) => {
    // If we have some written questions that haven't been evaluated
    const writtenQuestions = questions.filter(q => q.type === 'fill-in-the-blank');
    const answersToGrade = writtenQuestions.filter(q => userAnswers[q.id]?.trim() && !evals[q.id]);
    
    let finalEvals = { ...evals };
    
    if (answersToGrade.length > 0) {
      setIsExamSubmitting(true);
      try {
        const gradingPromises = answersToGrade.map(async q => {
          const evalResult = await AIService.evaluateWrittenAnswer(q.question, q.correctAnswer, userAnswers[q.id]);
          return { id: q.id, evalResult };
        });
        
        const gradedResults = await Promise.all(gradingPromises);
        gradedResults.forEach(({ id, evalResult }) => {
          finalEvals[id] = evalResult;
        });
        setWrittenEvaluations(finalEvals);
      } catch (err) {
        console.error("Error during final written grading:", err);
      } finally {
        setIsExamSubmitting(false);
      }
    }

    const score = calculateScore(finalEvals);
    const percentage = Math.round((score / questions.length) * 100);
    if (onComplete) onComplete(percentage);
    setStep('results');

    if (percentage >= 70) {
      triggerMilestoneCelebration();
    }

    // Persist Quiz Attempt to Neon API
    if (user && courseId) {
      user.getIdToken().then(token => {
        fetch('/api/quiz/record-attempt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            courseId,
            moduleId: module.id,
            quizId: subTopic?.id || 'default',
            scorePct: percentage,
            passed: percentage >= 70
          })
        }).catch(err => console.warn("Could not record quiz attempt:", err));
      }).catch(err => console.warn("Could not get idToken for quiz attempt:", err));
    }

    // Update Spaced Repetition System
    if (courseId && subTopic) {
      try {
        await SRSService.updateSRS(courseId, subTopic.id, subTopic.title, percentage);
      } catch (error) {
        console.error('Failed to update SRS:', error);
      }
    }

    // Claim reward if proactive and score is decent (e.g., > 60%)
    if (isProactive && subTopic && percentage >= 60) {
      setIsClaimingReward(true);
      try {
        const result = await AIService.claimReward(subTopic.id, 'proactive_quiz');
        if (result.success) {
          setRewardMessage(`🎉 You earned ${result.amount} Sparks for completing the proactive quiz!`);
        }
      } catch (error) {
        console.error('Failed to claim reward:', error);
      } finally {
        setIsClaimingReward(false);
      }
    }

    // PHASE 3: Automated Weakness Targeting
    if (percentage < 70 && user) {
      const failedQuestions = questions.filter(q => {
        if (q.type === 'multiple-choice') {
          return userAnswers[q.id]?.toLowerCase().trim() !== q.correctAnswer.toLowerCase().trim();
        } else {
          return !finalEvals[q.id]?.isCorrect;
        }
      });

      if (failedQuestions.length > 0) {
        AIService.generateRemedialFlashcards(
          failedQuestions.map(q => ({ question: q.question, correctAnswer: q.correctAnswer })),
          module.title,
          module.id,
          subTopic?.id
        ).then(async (cards) => {
          if (cards && cards.length > 0 && user?.uid) {
            const token = await user.getIdToken();
            cards.forEach(c => {
              fetch('/api/user/srs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                  cardId: c.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'c_' + Date.now()),
                  courseId: courseId || module.id,
                  rating: 1,
                  front: c.front,
                  back: c.back,
                  topicTitle: subTopic?.title || module.title,
                  source: 'quiz_remedial'
                })
              }).catch(err => console.warn('Failed to save remedial flashcard:', err));
            });
            console.log("Remedial flashcards injected silently via SRS API!");
          }
        }).catch(err => console.error("Silently failed generating remedial flashcards", err));
      }
    }
  };

  const calculateScore = (evals = writtenEvaluations) => {
    let score = 0;
    questions.forEach(q => {
      if (q.type === 'multiple-choice') {
        if (userAnswers[q.id]?.toLowerCase().trim() === q.correctAnswer.toLowerCase().trim()) {
          score++;
        }
      } else {
        const evaluation = evals[q.id];
        if (evaluation && evaluation.isCorrect) {
          score++;
        }
      }
    });
    return score;
  };

  const fetchProgressiveHint = async () => {
    if (isFetchingHint) return;
    setIsFetchingHint(true);
    try {
      const currentQuestion = questions[currentQuestionIndex];
      const hint = await AIService.generateHint(currentQuestion.question, currentQuestion.correctAnswer);
      setProgressiveHint(hint);
    } catch (error) {
      console.error("Hint fetch error:", error);
    } finally {
      setIsFetchingHint(false);
    }
  };

  const handleUseFiftyFifty = async () => {
    if (isUsingFiftyFifty) return;
    const currentQuestion = questions[currentQuestionIndex];
    if (eliminatedOptions[currentQuestion.id]) return;

    const rawSparks = profile?.ai_sparks;
    const currentSparks: number | null =
      typeof rawSparks === 'number' && Number.isFinite(rawSparks) ? rawSparks : null;

    if (!isPremium && currentSparks !== null && currentSparks < 1) {
      toast.error("Insufficient sparks! Please upgrade or obtain more sparks.");
      setShowPricingModal(true);
      return;
    }

    setIsUsingFiftyFifty(true);
    try {
      const token = await user?.getIdToken();
      const response = await fetch('/api/user/deduct-sparks-hint', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          courseId: courseId || null,
          moduleId: module?.id || null,
          questionId: currentQuestion?.id || null,
          questionText: currentQuestion?.question || null
        })
      });

      const resData = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(resData.error || "Failed to deduct spark for hint");
      }

      const wrongOptions = currentQuestion.options?.filter(opt => opt !== currentQuestion.correctAnswer) || [];
      if (wrongOptions.length <= 1) {
        toast.error("This question doesn't have enough options to eliminate!");
        return;
      }

      const shuffledWrongs = [...wrongOptions].sort(() => Math.random() - 0.5);
      const toEliminate = shuffledWrongs.slice(0, Math.min(2, wrongOptions.length - 1));

      setEliminatedOptions(prev => ({
        ...prev,
        [currentQuestion.id]: toEliminate
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
      setIsUsingFiftyFifty(false);
    }
  };

  const resetQuiz = () => {
    setStep('config');
    setQuestions([]);
    setCurrentQuestionIndex(0);
    setUserAnswers({});
    setShowExplanation(false);
    setFlaggedQuestions({});
    setTimeLeft(0);
    setWrittenEvaluations({});
    setIsEvaluatingWritten(false);
    setIsExamSubmitting(false);
    setEliminatedOptions({});
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm">
      {isExamSubmitting && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex flex-col items-center justify-center text-center p-6 space-y-4 rounded-3xl">
          <div className="w-16 h-16 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin mb-4" />
          <h3 className="text-xl font-bold text-white">Grading Exam Submissions...</h3>
          <p className="text-sm text-slate-300 max-w-md">
            Please wait while our AI professor evaluates and grades your written theory answers based on core department standards.
          </p>
        </div>
      )}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 dark:border-zinc-800 flex justify-between items-center bg-slate-50 dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl text-white ${mode === 'exam' ? 'bg-amber-500' : mode === 'adaptive' ? 'bg-purple-500' : 'bg-emerald-500'}`}>
              <Brain size={20} />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white leading-none">{mode === 'exam' ? 'Exam Mode' : mode === 'adaptive' ? 'Adaptive Quiz' : 'Practice Quiz'}</h2>
              <p className="text-slate-500 dark:text-zinc-400 text-[10px] uppercase tracking-wider mt-1 font-bold">{module.title}</p>
            </div>
          </div>

          {step === 'quiz' && mode === 'exam' && (
            <div className="flex items-center gap-2 sm:gap-4">
              <div className={`flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl font-mono font-bold text-sm sm:text-lg ${timeLeft < 60 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 animate-pulse' : 'bg-slate-900 dark:bg-white text-white dark:text-zinc-900'}`}>
                <Timer size={16} className="sm:w-5 sm:h-5" />
                {formatTime(timeLeft)}
              </div>
              <button 
                onClick={() => setShowPalette(!showPalette)}
                className={`p-2 rounded-xl transition-colors ${showPalette ? 'bg-slate-200 dark:bg-zinc-800 text-slate-900 dark:text-white' : 'bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'}`}
              >
                <LayoutGrid size={20} />
              </button>
            </div>
          )}

          {step === 'quiz' && (
            <button 
              onClick={onToggleCalculator}
              className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-2 rounded-full hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors"
              title="Open Calculator"
            >
              <CalcIcon size={20} />
            </button>
          )}

          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-2 rounded-full hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors">
            <XCircle size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Question Palette (Exam Mode Only) */}
          <AnimatePresence>
            {showPalette && mode === 'exam' && step === 'quiz' && (
              <motion.div 
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "100%", opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="absolute inset-0 z-20 bg-slate-50 dark:bg-zinc-950 sm:static sm:w-64 sm:border-r border-slate-100 dark:border-zinc-800 overflow-y-auto"
              >
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">Question Palette</h3>
                    <button 
                      onClick={() => setShowPalette(false)}
                      className="sm:hidden p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    >
                      <XCircle size={20} />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-5 sm:grid-cols-4 gap-2">
                    {questions.map((q, i) => {
                      const isAnswered = !!userAnswers[q.id];
                      const isFlagged = !!flaggedQuestions[q.id];
                      const isCurrent = currentQuestionIndex === i;
                      
                      let bgClass = "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400";
                      if (isCurrent) bgClass = "bg-slate-900 dark:bg-white text-white dark:text-zinc-900 border-slate-900 dark:border-white";
                      else if (isFlagged) bgClass = "bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400";
                      else if (isAnswered) bgClass = "bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400";

                      return (
                        <button
                          key={i}
                          onClick={() => {
                            setCurrentQuestionIndex(i);
                            if (window.innerWidth < 640) setShowPalette(false);
                          }}
                          className={`aspect-square rounded-lg border flex items-center justify-center text-sm font-bold transition-all ${bgClass}`}
                        >
                          {isFlagged ? <Flag size={12} /> : i + 1}
                        </button>
                      );
                    })}
                  </div>
                  <div className="space-y-2 pt-4 border-t border-slate-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400">
                      <div className="w-3 h-3 bg-slate-900 dark:bg-white rounded" /> Current
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400">
                      <div className="w-3 h-3 bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 rounded" /> Answered
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400">
                      <div className="w-3 h-3 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded" /> Flagged
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400">
                      <div className="w-3 h-3 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded" /> Unvisited
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex-1 overflow-y-auto p-6 sm:p-10">
            <AnimatePresence mode="wait">
              {step === 'config' && (
                <motion.div 
                  key="config"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8 max-w-xl mx-auto"
                >
                  <div className="text-center space-y-2">
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Configure Your Quiz</h3>
                    <p className="text-slate-500 dark:text-zinc-400">Test your knowledge of {module.title.split('. ')[1]}</p>
                  </div>

                  <div className="grid gap-6">
                    <div className="space-y-3">
                      <label className="text-sm font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-2">
                        <Brain size={16} className="text-emerald-500" />
                        Quiz Mode
                      </label>
                      <div className="flex flex-col sm:flex-row gap-4">
                        <button
                          onClick={() => setMode('practice')}
                          className={`flex-1 p-4 rounded-2xl text-left border-2 transition-all ${
                            mode === 'practice' 
                              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' 
                              : 'border-slate-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-slate-200 dark:hover:border-zinc-700'
                          }`}
                        >
                          <div className="font-bold text-slate-900 dark:text-white mb-1">Practice Mode</div>
                          <div className="text-xs text-slate-500 dark:text-zinc-400">Immediate feedback, hints, and explanations.</div>
                        </button>
                        <button
                          onClick={() => setMode('adaptive')}
                          className={`flex-1 p-4 rounded-2xl text-left border-2 transition-all ${
                            mode === 'adaptive' 
                              ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' 
                              : 'border-slate-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-slate-200 dark:hover:border-zinc-700'
                          }`}
                        >
                          <div className="font-bold text-slate-900 dark:text-white mb-1">Adaptive Mode</div>
                          <div className="text-xs text-slate-500 dark:text-zinc-400">Difficulty adjusts based on your performance.</div>
                        </button>
                        <button
                          onClick={() => setMode('exam')}
                          className={`flex-1 p-4 rounded-2xl text-left border-2 transition-all ${
                            mode === 'exam' 
                              ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' 
                              : 'border-slate-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-slate-200 dark:hover:border-zinc-700'
                          }`}
                        >
                          <div className="font-bold text-slate-900 dark:text-white mb-1">Exam Mode</div>
                          <div className="text-xs text-slate-500 dark:text-zinc-400">Timed, no hints, submit at the end.</div>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-2">
                        <Settings2 size={16} className="text-emerald-500" />
                        Number of Questions
                      </label>
                      <div className="flex gap-2">
                        {[3, 5, 10, 15].map(n => {
                          const isLockedOption = isLocked && n > 3;
                          return (
                          <button
                            key={n}
                            onClick={() => {
                              if (isLockedOption) {
                                setShowPricingModal(true);
                                return;
                              }
                              setNumQuestions(n);
                            }}
                            className={`flex-1 py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-1 ${
                              numQuestions === n 
                                ? 'bg-slate-900 dark:bg-white text-white dark:text-zinc-900 shadow-lg scale-105' 
                                : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700'
                            } ${isLockedOption ? 'opacity-60' : ''}`}
                          >
                            {n}
                            {isLockedOption && <Lock size={12} />}
                          </button>
                        )})}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-2">
                        <Settings2 size={16} className="text-emerald-500" />
                        Question Type
                      </label>
                      <div className="flex gap-4">
                        {(['multiple-choice', 'fill-in-the-blank'] as QuestionType[]).map(t => (
                          <button
                            key={t}
                            onClick={() => setQuestionType(t)}
                            className={`flex-1 py-4 px-4 rounded-2xl font-bold text-sm transition-all border-2 ${
                              questionType === t 
                                ? 'border-slate-900 dark:border-white bg-slate-900 dark:bg-white text-white dark:text-zinc-900 shadow-lg' 
                                : 'border-slate-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 hover:border-slate-200 dark:hover:border-zinc-700'
                            }`}
                          >
                            {t === 'multiple-choice' ? 'Multiple Choice' : 'Written'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={generateQuiz}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-5 rounded-2xl font-bold text-lg shadow-xl shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    Start {mode === 'exam' ? 'Exam' : 'Quiz'}
                    <ArrowRight size={20} />
                  </button>
                </motion.div>
              )}

              {step === 'loading' && (
                <motion.div 
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-20 space-y-6"
                >
                  <div className="relative">
                    <Loader2 size={64} className="text-emerald-500 animate-spin" />
                    <Brain size={32} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-slate-900 dark:text-white" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">Generating Quiz...</h3>
                    <p className="text-slate-500 dark:text-zinc-400 animate-pulse">Gemini is crafting questions based on your study material.</p>
                  </div>
                </motion.div>
              )}

              {step === 'quiz' && questions.length > 0 && (
                <motion.div 
                  key="quiz"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-8 w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">
                      Question {currentQuestionIndex + 1} of {mode === 'adaptive' ? numQuestions : questions.length}
                    </span>
                    {(mode === 'practice' || mode === 'adaptive') && (
                      <div className="h-1.5 w-32 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-500 ${mode === 'adaptive' ? 'bg-purple-500' : 'bg-emerald-500'}`}
                          style={{ width: `${((currentQuestionIndex + 1) / (mode === 'adaptive' ? numQuestions : questions.length)) * 100}%` }}
                        />
                      </div>
                    )}
                    {mode === 'exam' && (
                      <button 
                        onClick={toggleFlag}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                          flaggedQuestions[questions[currentQuestionIndex].id] 
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' 
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700'
                        }`}
                      >
                        <Flag size={14} />
                        {flaggedQuestions[questions[currentQuestionIndex].id] ? 'Flagged' : 'Flag'}
                      </button>
                    )}
                  </div>

                  <div className="space-y-6">
                    <div className="flex justify-between items-start gap-4">
                      <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white leading-relaxed flex-1">
                        <MarkdownRenderer content={questions[currentQuestionIndex].question} />
                      </div>
                      {onBookmark && (
                        <button
                          onClick={() => onBookmark(questions[currentQuestionIndex])}
                          className="text-slate-400 hover:text-emerald-500 transition-colors p-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-xl flex-shrink-0"
                          title="Save to Notebook"
                        >
                          <Bookmark size={20} />
                        </button>
                      )}
                    </div>

                    {(mode === 'practice' || mode === 'adaptive') && !showExplanation && (
                      <div className="flex flex-wrap gap-4 items-center">
                        {!showHint && (
                          <button 
                            onClick={() => {
                              setShowHint(true);
                              setHintsUsed(prev => ({ ...prev, [questions[currentQuestionIndex].id]: true }));
                            }}
                            className={`${mode === 'adaptive' ? 'text-purple-500 hover:text-purple-600' : 'text-emerald-500 hover:text-emerald-600'} text-xs font-bold uppercase tracking-widest flex items-center gap-1 transition-colors`}
                          >
                            <Brain size={14} />
                            Need a hint?
                          </button>
                        )}

                        {questions[currentQuestionIndex].type === 'multiple-choice' && !eliminatedOptions[questions[currentQuestionIndex].id] && (
                          <button 
                            onClick={handleUseFiftyFifty}
                            disabled={isUsingFiftyFifty}
                            className="bg-[#fffbeb] dark:bg-amber-950/20 hover:bg-[#fef3c7] dark:hover:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-semibold px-5 py-2.5 rounded-2xl flex items-center gap-2.5 transition-all text-sm md:text-base border border-amber-100/50 dark:border-amber-900/10 shadow-xs"
                          >
                            {isUsingFiftyFifty ? (
                              <Loader2 size={20} className="animate-spin text-amber-700 dark:text-amber-400" />
                            ) : (
                              <Lightbulb size={20} className="text-amber-700 dark:text-amber-400 shrink-0" />
                            )}
                            <span>
                              Use 50/50 Hint <span className="text-xs font-normal opacity-75">({isPremium ? 'Free' : 'Costs 1 Spark'})</span>
                            </span>
                          </button>
                        )}

                        {questions[currentQuestionIndex].type === 'multiple-choice' && eliminatedOptions[questions[currentQuestionIndex].id] && (
                          <div className="text-amber-700 dark:text-amber-400 text-xs font-semibold bg-[#fffbeb] dark:bg-amber-950/15 px-5 py-2.5 rounded-2xl flex items-center gap-2 border border-amber-100/50 dark:border-amber-900/10">
                            <span className="text-sm">🌓</span> 50/50 Hint Activated (2 wrong options eliminated)
                          </div>
                        )}
                      </div>
                    )}

                    {(mode === 'practice' || mode === 'adaptive') && showHint && !showExplanation && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-3"
                      >
                        <div className={`${mode === 'adaptive' ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-100 dark:border-purple-900/30 text-purple-800 dark:text-purple-300' : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-900/30 text-emerald-800 dark:text-emerald-300'} border p-4 rounded-2xl text-sm italic`}>
                          <div className="flex gap-2">
                            <span className="font-bold not-italic shrink-0">Hint:</span>
                            <div className="flex-1 text-inherit not-italic">
                              <MarkdownRenderer content={questions[currentQuestionIndex].hint} className="!text-inherit prose-p:!my-0 prose-sm" />
                            </div>
                          </div>
                        </div>
                        
                        {!progressiveHint ? (
                          <button 
                            onClick={fetchProgressiveHint}
                            disabled={isFetchingHint}
                            className="text-emerald-600 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 hover:underline disabled:opacity-50"
                          >
                            {isFetchingHint ? <Loader2 size={10} className="animate-spin" /> : <Brain size={10} />}
                            Still stuck? Get a deeper hint
                          </button>
                        ) : (
                          <motion.div 
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 p-4 rounded-2xl text-sm text-amber-800 dark:text-amber-300 italic"
                          >
                            <div className="flex gap-2">
                              <span className="font-bold not-italic shrink-0">Tutor Insight:</span>
                              <div className="flex-1 text-inherit not-italic">
                                <MarkdownRenderer content={progressiveHint} className="!text-inherit prose-p:!my-0 prose-sm" />
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </motion.div>
                    )}

                    {questions[currentQuestionIndex].type === 'multiple-choice' ? (
                      <div className="grid gap-3">
                        {questions[currentQuestionIndex].options?.map((opt, i) => {
                          const isSelected = userAnswers[questions[currentQuestionIndex].id] === opt;
                          const isCorrect = opt === questions[currentQuestionIndex].correctAnswer;
                          const isEliminated = eliminatedOptions[questions[currentQuestionIndex].id]?.includes(opt);
                          
                          let btnClass = "bg-slate-50 dark:bg-zinc-800 border-2 border-slate-100 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:border-slate-200 dark:hover:border-zinc-600";
                          
                          if ((mode === 'practice' || mode === 'adaptive') && showExplanation) {
                            if (isCorrect) btnClass = "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500 dark:border-emerald-500/50 text-emerald-700 dark:text-emerald-400";
                            else if (isSelected) btnClass = "bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-500/50 text-red-700 dark:text-red-400";
                            else btnClass = "bg-slate-50 dark:bg-zinc-800 border-slate-100 dark:border-zinc-800 text-slate-400 dark:text-zinc-500 opacity-50";
                          } else if (isEliminated) {
                            btnClass = "bg-slate-100/30 dark:bg-zinc-900/20 border-dashed border-slate-200 dark:border-zinc-800 text-slate-300 dark:text-zinc-600 line-through cursor-not-allowed";
                          } else if (isSelected) {
                            btnClass = "bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-zinc-900";
                          }

                          return (
                            <button
                              key={i}
                              disabled={isEliminated || ((mode === 'practice' || mode === 'adaptive') && showExplanation)}
                              onClick={() => handleAnswer(opt)}
                              className={`w-full p-4 sm:p-5 rounded-xl sm:rounded-2xl text-left font-medium transition-all flex items-center justify-between ${btnClass}`}
                            >
                              <div className="flex-1 flex items-center justify-between gap-3">
                                <MarkdownRenderer content={opt} />
                                {isEliminated && (
                                  <span className="text-[9px] font-semibold uppercase tracking-wider bg-red-500/10 text-red-500 px-2.5 py-1 rounded-full select-none shrink-0 border border-red-500/20">
                                    Eliminated
                                  </span>
                                )}
                              </div>
                              {(mode === 'practice' || mode === 'adaptive') && showExplanation && isCorrect && <CheckCircle2 size={20} className="text-emerald-500 shrink-0 ml-3" />}
                              {(mode === 'practice' || mode === 'adaptive') && showExplanation && isSelected && !isCorrect && <XCircle size={20} className="text-red-500 shrink-0 ml-3" />}
                              {mode === 'exam' && isSelected && <div className="w-4 h-4 bg-white rounded-full ml-3 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <textarea
                          rows={6}
                          disabled={(mode === 'practice' || mode === 'adaptive') && showExplanation}
                          placeholder="Type your essay / detailed academic explanation here..."
                          value={userAnswers[questions[currentQuestionIndex].id] || ''}
                          className="w-full p-4 sm:p-5 rounded-xl sm:rounded-2xl bg-slate-50 dark:bg-zinc-800 border-2 border-slate-100 dark:border-zinc-700 focus:border-slate-900 dark:focus:border-white focus:ring-0 transition-all font-medium text-slate-900 dark:text-white leading-relaxed resize-none"
                          onChange={(e) => {
                            setUserAnswers(prev => ({ ...prev, [questions[currentQuestionIndex].id]: e.target.value }));
                          }}
                        />
                        
                        {isEvaluatingWritten && (
                          <div className="flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-zinc-800 rounded-2xl border border-slate-100 dark:border-zinc-700 gap-3 animate-pulse">
                            <RefreshCw className="text-emerald-500 animate-spin" size={24} />
                            <p className="text-sm font-bold text-slate-700 dark:text-zinc-300">Evaluating your answer...</p>
                            <p className="text-xs text-slate-400 dark:text-zinc-500">Our AI professor is reading and grading your response based on the curriculum standard.</p>
                          </div>
                        )}

                        {(mode === 'practice' || mode === 'adaptive') && !showExplanation && !isEvaluatingWritten && (
                          <button
                            onClick={handleWrittenAnswerSubmit}
                            disabled={!(userAnswers[questions[currentQuestionIndex].id] || '').trim()}
                            className="w-full bg-slate-900 dark:bg-white text-white dark:text-zinc-900 py-4 rounded-xl sm:rounded-2xl font-bold transition-all hover:bg-slate-800 dark:hover:bg-zinc-100 disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            Check Written Answer
                          </button>
                        )}

                        {(mode === 'practice' || mode === 'adaptive') && showExplanation && !isEvaluatingWritten && (
                          <div className="space-y-4">
                            {writtenEvaluations[questions[currentQuestionIndex].id] ? (
                              <div className="bg-slate-50 dark:bg-zinc-800 p-5 rounded-2xl border border-slate-100 dark:border-zinc-700 space-y-3">
                                <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-700 pb-3">
                                  <div className="flex items-center gap-2">
                                    {writtenEvaluations[questions[currentQuestionIndex].id].isCorrect ? (
                                      <CheckCircle2 size={22} className="text-emerald-500" />
                                    ) : (
                                      <XCircle size={22} className="text-red-500" />
                                    )}
                                    <span className="font-bold text-slate-900 dark:text-white">Grading Result</span>
                                  </div>
                                  <span className={`text-base sm:text-lg font-bold px-3 py-1 rounded-xl ${
                                    writtenEvaluations[questions[currentQuestionIndex].id].isCorrect
                                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                      : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                  }`}>
                                    Score: {writtenEvaluations[questions[currentQuestionIndex].id].score}/100
                                  </span>
                                </div>
                                <div className="text-sm text-slate-600 dark:text-zinc-300 italic">
                                  "{writtenEvaluations[questions[currentQuestionIndex].id].feedback}"
                                </div>
                              </div>
                            ) : null}

                            <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 p-5 rounded-2xl space-y-2 text-emerald-800 dark:text-emerald-300">
                              <div className="flex items-center gap-2 font-bold text-sm">
                                <CheckCircle2 size={18} className="text-emerald-500" />
                                Model Answer / Rubric:
                              </div>
                              <div className="text-sm leading-relaxed"><MarkdownRenderer content={questions[currentQuestionIndex].correctAnswer} /></div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {(mode === 'practice' || mode === 'adaptive') && showExplanation && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-6"
                    >
                      <div className="bg-slate-50 dark:bg-zinc-800 p-6 rounded-2xl border border-slate-100 dark:border-zinc-700">
                        <h4 className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-2">Explanation</h4>
                        <div className="text-sm text-slate-600 dark:text-zinc-300 leading-relaxed">
                          <MarkdownRenderer content={questions[currentQuestionIndex].explanation} />
                        </div>
                      </div>

                      <button
                        onClick={nextQuestion}
                        className="w-full bg-slate-900 dark:bg-white text-white dark:text-zinc-900 py-5 rounded-2xl font-bold transition-all hover:bg-slate-800 dark:hover:bg-zinc-100 flex items-center justify-center gap-2"
                      >
                        {mode === 'adaptive' 
                          ? (questions.length === numQuestions ? 'Finish Quiz' : 'Next Question')
                          : (currentQuestionIndex === questions.length - 1 ? 'Finish Quiz' : 'Next Question')}
                        <ArrowRight size={20} />
                      </button>
                    </motion.div>
                  )}

                  {mode === 'exam' && (
                    <div className="flex gap-4 pt-4">
                      <button
                        onClick={prevQuestion}
                        disabled={currentQuestionIndex === 0}
                        className="flex-1 bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-white py-4 rounded-2xl font-bold transition-all hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <ChevronLeft size={20} />
                        Previous
                      </button>
                      
                      {currentQuestionIndex === questions.length - 1 ? (
                        <button
                          onClick={submitExam}
                          className="flex-1 bg-emerald-500 text-white py-4 rounded-2xl font-bold transition-all hover:bg-emerald-600 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                        >
                          Submit Exam
                          <CheckCircle2 size={20} />
                        </button>
                      ) : (
                        <button
                          onClick={nextQuestion}
                          className="flex-1 bg-slate-900 dark:bg-white text-white dark:text-zinc-900 py-4 rounded-2xl font-bold transition-all hover:bg-slate-800 dark:hover:bg-zinc-100 flex items-center justify-center gap-2"
                        >
                          Next
                          <ChevronRight size={20} />
                        </button>
                      )}
                    </div>
                  )}
                </motion.div>
              )}

              {step === 'results' && (
                <motion.div 
                  key="results"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center space-y-8 max-w-2xl mx-auto"
                >
                  <div className="relative inline-block">
                    <div className="w-44 h-44 sm:w-48 sm:h-48 rounded-full border-8 border-slate-100 dark:border-zinc-800 flex flex-col items-center justify-center">
                      <span className="text-4xl sm:text-5xl font-bold text-slate-900 dark:text-white">{calculateScore()}</span>
                      <span className="text-slate-400 dark:text-zinc-500 font-semibold uppercase tracking-wider text-xs">of {questions.length}</span>
                    </div>
                    <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-3 rounded-2xl shadow-lg">
                      <CheckCircle2 size={32} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-3xl font-bold text-slate-900 dark:text-white">
                      {calculateScore() === questions.length ? 'Perfect Score!' : calculateScore() > questions.length / 2 ? 'Great Job!' : 'Keep Studying!'}
                    </h3>
                    <p className="text-slate-500 dark:text-zinc-400">You've completed the {mode} for {module.title.split('. ')[1]}</p>
                  </div>

                  {/* Review Section for Exam Mode */}
                  {(mode === 'exam' || mode === 'adaptive') && (
                    <div className="text-left space-y-4 max-h-80 overflow-y-auto p-5 bg-slate-50 dark:bg-zinc-800 rounded-2xl border border-slate-100 dark:border-zinc-700">
                      <h4 className="font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-zinc-700 pb-2">Exam Question Review</h4>
                      {questions.map((q, i) => {
                        const isCorrect = q.type === 'multiple-choice'
                          ? userAnswers[q.id]?.toLowerCase().trim() === q.correctAnswer.toLowerCase().trim()
                          : !!writtenEvaluations[q.id]?.isCorrect;
                        const score = q.type === 'fill-in-the-blank' ? writtenEvaluations[q.id]?.score : null;
                        const feedback = q.type === 'fill-in-the-blank' ? writtenEvaluations[q.id]?.feedback : null;
                        
                        return (
                          <div key={i} className="flex flex-col gap-1 text-sm border-b border-slate-200 dark:border-zinc-700 py-3 last:border-0 last:pb-0 first:pt-0">
                            <div className="flex items-start gap-3">
                              <div className={`mt-0.5 shrink-0 ${isCorrect ? 'text-emerald-500' : 'text-red-500'}`}>
                                {isCorrect ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                              </div>
                              <div className="flex-1">
                                <p className="font-semibold text-slate-900 dark:text-white">Q{i+1}: {q.question}</p>
                                <div className="mt-2 text-xs space-y-1">
                                  <p className="text-slate-600 dark:text-zinc-400">
                                    <span className="font-bold">Your Answer:</span> {userAnswers[q.id] || <span className="italic text-slate-400">Unanswered</span>}
                                  </p>
                                  {q.type === 'multiple-choice' ? (
                                    <p className="text-emerald-600 dark:text-emerald-400">
                                      <span className="font-bold">Model Answer:</span> {q.correctAnswer}
                                    </p>
                                  ) : (
                                    <div className="space-y-1 mt-1 bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-100 dark:border-zinc-800">
                                      {score !== null && (
                                        <p className="font-bold text-emerald-600 dark:text-emerald-400">
                                          Score: {score}/100 {isCorrect ? '(Passed)' : '(Failed)'}
                                        </p>
                                      )}
                                      {feedback && (
                                        <p className="text-slate-500 dark:text-zinc-400 italic">
                                          "Professor Feedback: {feedback}"
                                        </p>
                                      )}
                                      <div className="text-slate-500 dark:text-zinc-400">
                                        <span className="font-bold text-emerald-600 dark:text-emerald-400">Model Key Rubric:</span> <MarkdownRenderer content={q.correctAnswer} />
                                      </div>
                                    </div>
                                  )}
                                  {mode === 'adaptive' && <p className="text-purple-500 text-[10px] uppercase font-bold tracking-wider">Difficulty: {q.difficulty}/5</p>}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {rewardMessage && (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl text-emerald-700 dark:text-emerald-400 font-medium flex items-center justify-center gap-2"
                    >
                      {rewardMessage}
                    </motion.div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-4">
                    <button
                      onClick={resetQuiz}
                      className="flex-1 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-900 dark:text-white py-5 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <RefreshCw size={20} />
                      Take Another
                    </button>
                    
                    {onNextTopic && (
                      <button
                        onClick={onNextTopic}
                        className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-5 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                      >
                        {isNextTopicLocked && <Lock size={20} className="text-amber-300" />}
                        Next Topic
                        <ArrowRight size={20} />
                      </button>
                    )}

                    <button
                      onClick={onClose}
                      className="flex-1 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-zinc-100 text-white dark:text-zinc-900 py-5 rounded-2xl font-bold transition-all"
                    >
                      Back to Study
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      <PricingModal 
        isOpen={showPricingModal}
        onClose={() => setShowPricingModal(false)}
        featureName="Full Length Quizzes"
        onUpgradeClick={() => {
          onClose();
          window.dispatchEvent(new CustomEvent('navigate', { detail: 'pricing' }));
        }}
      />
    </div>
  );
}
