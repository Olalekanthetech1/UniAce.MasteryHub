import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { CourseId, Semester, QuizQuestion } from '../types';
import {
  FileText,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RefreshCw,
  Award,
  ChevronRight,
  ChevronLeft,
  BookOpen,
  Sparkles,
  Download,
  Zap,
  Clock,
  Flag,
  ShieldAlert,
  LayoutGrid,
  Play,
  Send,
  Brain,
  CheckCheck,
  AlertTriangle,
  Timer,
  SlidersHorizontal,
  Trophy,
  Lightbulb,
  Eye,
  Check,
  X,
  Mic,
  MicOff,
  Layers,
  GraduationCap,
  Volume2,
  VolumeX
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import toast from 'react-hot-toast';
import PricingModal from './PricingModal';
import { safeFetchJson } from '../utils/safeFetch';

export interface CBTExamQuestion {
  id: string;
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  hint: string;
  type: 'multiple-choice' | 'short-answer';
  topic?: string;
}

export interface CBTExamAssessment {
  id: string;
  courseCode: CourseId;
  title: string;
  year: string;
  semester: Semester;
  department?: string;
  questions: CBTExamQuestion[];
}

export type PastPaperQuestion = CBTExamQuestion;
export type PastPaper = CBTExamAssessment;

export interface SkillExerciseOption {
  text: string;
  isCorrect: boolean;
  feedback: string;
}

export interface SkillMatchPair {
  id: string;
  left: string;
  right: string;
  explanation?: string;
}

export interface SkillExercise {
  id: string;
  type:
    | 'concept_carousel'
    | 'concept_flashcard'
    | 'match_pairs'
    | 'smart_mcq'
    | 'fill_blanks'
    | 'explain_concept'
    | 'highlight_mistake';
  prompt: string;
  instruction?: string;
  passage?: string;
  mistakeTarget?: string;
  correctionText?: string;
  frontTitle?: string;
  frontFormulaOrVisual?: string;
  backAnswer?: string;
  cards?: string[];
  pairs?: SkillMatchPair[];
  question?: string;
  options?: SkillExerciseOption[];
  sentenceWithBlanks?: string;
  correctBlanks?: string[];
  wordBank?: string[];
  explanation?: string;
  hint?: string;
  keyConcepts?: string[];
  sampleAnswer?: string;
  learnMore?: string;
  learnConcept?: string;
  difficultyTier?: number;
  isFinalChallenge?: boolean;
}

interface HighlightWordUnit {
  index: number;
  text: string;
  cleanWord: string;
}

interface AnalyzedHighlightPassage {
  words: HighlightWordUnit[];
  targetStartIdx: number;
  targetEndIdx: number;
  targetWordCount: number;
  dynamicInstruction: string;
}

function normalizeWordForCompare(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/^[.,!?;:"'()[\]{}]+|[.,!?;:"'()[\]{}]+$/g, '')
    .trim();
}

/**
 * Splits a passage into individual selectable word units (keeping inline $...$ math expressions intact)
 * WITHOUT pre-grouping multi-word mistakes into a single button, so students genuinely select
 * 1-word or N-word phrases via drag or tap just like the reference video.
 */
function analyzeHighlightPassage(
  passage: string,
  mistakeTarget?: string,
  explicitInstruction?: string
): AnalyzedHighlightPassage {
  if (!passage) {
    return {
      words: [],
      targetStartIdx: -1,
      targetEndIdx: -1,
      targetWordCount: 1,
      dynamicInstruction: "You're looking for one word that is a mistake."
    };
  }

  const rawTokens: string[] = passage.match(/(\$[^\$]+\$|\S+)/g) || [];
  const words: HighlightWordUnit[] = rawTokens.map((t: string, idx: number) => ({
    index: idx,
    text: t,
    cleanWord: normalizeWordForCompare(t)
  }));

  const targetTokens: string[] = (mistakeTarget || '')
    .trim()
    .match(/(\$[^\$]+\$|\S+)/g) || [];
  const cleanTargetWords = targetTokens.map((t: string) => normalizeWordForCompare(t)).filter(Boolean);

  let targetStartIdx = -1;
  let targetEndIdx = -1;

  if (cleanTargetWords.length > 0 && words.length >= cleanTargetWords.length) {
    for (let i = 0; i <= words.length - cleanTargetWords.length; i++) {
      let allMatch = true;
      for (let j = 0; j < cleanTargetWords.length; j++) {
        if (words[i + j].cleanWord !== cleanTargetWords[j]) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        targetStartIdx = i;
        targetEndIdx = i + cleanTargetWords.length - 1;
        break;
      }
    }
  }

  // Fallback substring match if punctuation/math attached
  if (targetStartIdx === -1 && cleanTargetWords.length > 0) {
    const firstTarget = cleanTargetWords[0];
    const foundIdx = words.findIndex(
      (w) => w.cleanWord === firstTarget || w.cleanWord.includes(firstTarget)
    );
    if (foundIdx !== -1) {
      targetStartIdx = foundIdx;
      targetEndIdx = Math.min(words.length - 1, foundIdx + cleanTargetWords.length - 1);
    }
  }

  const targetWordCount =
    targetStartIdx !== -1 && targetEndIdx >= targetStartIdx
      ? targetEndIdx - targetStartIdx + 1
      : Math.max(1, cleanTargetWords.length || 1);

  const dynamicInstruction =
    targetWordCount === 1
      ? "You're looking for one word that is a mistake."
      : `You're looking for a ${targetWordCount}-word phrase that is a mistake.`;

  return {
    words,
    targetStartIdx,
    targetEndIdx,
    targetWordCount,
    dynamicInstruction: explicitInstruction && explicitInstruction.includes(String(targetWordCount))
      ? explicitInstruction
      : dynamicInstruction
  };
}

export interface SkillSessionPayload {
  courseId: string;
  moduleId: string;
  skillId: string;
  skillTitle: string;
  learnSummary: string;
  recommendedMasteryTarget?: number;
  exercises: SkillExercise[];
}

interface SkillPracticeHubProps {
  activeCourseId: CourseId | null;
  activeSemester: Semester;
  onSelectCourse?: (courseId: CourseId) => void;
  onCourseSelect?: (courseId: CourseId) => void;
  enrolledCourses?: CourseId[];
  onComplete?: (xp: number) => void;
}

type HubTab = 'skills' | 'cbt' | 'cheatsheet';
type ExamSessionMode = 'practice' | 'cbt';

const MarkdownInline: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => (
  <div className={`prose prose-slate dark:prose-invert max-w-none leading-relaxed ${className}`}>
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {content || ''}
    </ReactMarkdown>
  </div>
);

const MarkdownWordSpan: React.FC<{ content: string }> = ({ content }) => (
  <ReactMarkdown
    components={{ p: ({ children }) => <>{children}</> }}
    remarkPlugins={[remarkMath]}
    rehypePlugins={[rehypeKatex]}
  >
    {content || ''}
  </ReactMarkdown>
);

const formatMathToken = (token: string): string => {
  if (!token) return '';
  const trimmed = token.trim();
  if (trimmed.startsWith('$') && trimmed.endsWith('$')) {
    return trimmed;
  }
  if (/^\\[a-zA-Z]+/.test(trimmed) || /\\[a-zA-Z]+/.test(trimmed)) {
    return `$${trimmed}$`;
  }
  return token;
};

export default function SkillPracticeHub({
  activeCourseId: propCourseId,
  activeSemester,
  onSelectCourse,
  onCourseSelect,
  enrolledCourses,
  onComplete
}: SkillPracticeHubProps) {
  const { user, profile } = useAuth();
  const { courses: coursesMap } = useCourses();
  const courses = useMemo(() => Object.values(coursesMap || {}), [coursesMap]);

  const [internalCourseId, setInternalCourseId] = useState<CourseId>(propCourseId || '');

  useEffect(() => {
    if (propCourseId) {
      setInternalCourseId(propCourseId);
    }
  }, [propCourseId]);

  const activeCourseId: CourseId = useMemo(() => {
    if (internalCourseId) return internalCourseId;
    if (propCourseId) return propCourseId;
    if (enrolledCourses && enrolledCourses.length > 0 && enrolledCourses[0]) {
      return enrolledCourses[0];
    }
    if (courses.length > 0 && courses[0]?.id) {
      return courses[0].id;
    }
    return '';
  }, [internalCourseId, propCourseId, enrolledCourses, courses]);

  const activeCourseData = activeCourseId ? coursesMap?.[activeCourseId] : undefined;
  const syllabus = useMemo(() => activeCourseData?.syllabus || [], [activeCourseData]);
  const formulas = useMemo(() => activeCourseData?.formulas || [], [activeCourseData]);

  const handleCourseChange = useCallback(
    (courseId: CourseId) => {
      setInternalCourseId(courseId);
      if (onSelectCourse) onSelectCourse(courseId);
      else if (onCourseSelect) onCourseSelect(courseId);
    },
    [onSelectCourse, onCourseSelect]
  );

  useEffect(() => {
    if (!propCourseId && activeCourseId) {
      handleCourseChange(activeCourseId);
    }
  }, [propCourseId, activeCourseId, handleCourseChange]);

  const awardXP = useCallback(
    (xp: number) => {
      if (onComplete) onComplete(xp);
    },
    [onComplete]
  );

  // Top-level Hub Tab: 'skills' (CampusLearn Skill Mastery Tree) | 'cbt' (Timed CBT Simulator) | 'cheatsheet'
  const [activeTab, setActiveTab] = useState<HubTab>('skills');

  // --- Skill Mastery Tree & Interactive Session State ---
  const [skillLevels, setSkillLevels] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(`uniace_skill_levels_${activeCourseId}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [activeSkillSession, setActiveSkillSession] = useState<SkillSessionPayload | null>(null);
  const [isGeneratingSkill, setIsGeneratingSkill] = useState<string | null>(null);
  const [currentExIndex, setCurrentExIndex] = useState(0);

  // Continuous Vertical Page-Snap Feed & Per-Exercise State Maps
  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const hasAwardedSkillXPRef = useRef<boolean>(false);

  // Concept Carousel (Format A) & Flip Flashcard (Format A2) state per exercise
  const [carouselIndexMap, setCarouselIndexMap] = useState<Record<number, number>>({});
  const [flippedFlashcardMap, setFlippedFlashcardMap] = useState<Record<number, boolean>>({});

  // Match the Pairs (Format B) state per exercise
  const [selectedLeftPairMap, setSelectedLeftPairMap] = useState<Record<number, string | null>>({});
  const [matchedPairsMap, setMatchedPairsMap] = useState<Record<number, string[]>>({});
  const [wrongPairFlashMap, setWrongPairFlashMap] = useState<Record<number, string | null>>({});
  const [shuffledRightPairsMap, setShuffledRightPairsMap] = useState<Record<number, SkillMatchPair[]>>({});

  // Smart-Retry MCQ (Format C) state per exercise
  const [selectedMcqMap, setSelectedMcqMap] = useState<Record<number, number | null>>({});
  const [triedWrongMcqMap, setTriedWrongMcqMap] = useState<Record<number, number[]>>({});

  // Fill in the Blanks (Format D) state per exercise
  const [filledBlanksMap, setFilledBlanksMap] = useState<Record<number, (string | null)[]>>({});
  const [revealedBlanksMap, setRevealedBlanksMap] = useState<Record<number, boolean>>({});
  const [blanksCheckedMap, setBlanksCheckedMap] = useState<Record<number, boolean>>({});

  // Explain the Concept (Format E) state per exercise
  const [explanationInputMap, setExplanationInputMap] = useState<Record<number, string>>({});
  const [isListeningMic, setIsListeningMic] = useState(false);
  const [isEvaluatingMap, setIsEvaluatingMap] = useState<Record<number, boolean>>({});
  const recognitionRef = useRef<any>(null);

  // Highlight the Mistake (Format F) — Contiguous Word Range Selection & Drag State
  const [highlightRangeMap, setHighlightRangeMap] = useState<
    Record<number, { start: number; end: number } | null>
  >({});
  const [highlightStatusMap, setHighlightStatusMap] = useState<
    Record<number, 'selecting' | 'correct' | 'wrong'>
  >({});
  const [highlightRevealedMap, setHighlightRevealedMap] = useState<Record<number, boolean>>({});
  const dragSelectionRef = useRef<{
    exIdx: number;
    anchorIdx: number;
    currentIdx: number;
    isDragging: boolean;
  } | null>(null);

  // Bottom Sheets & Modals inside Skill Session
  const [feedbackSheet, setFeedbackSheet] = useState<{
    type: 'correct' | 'try_again';
    title: string;
    message: string;
    canAdvance: boolean;
    targetExIndex?: number;
  } | null>(null);
  const [showHintSheet, setShowHintSheet] = useState(false);
  const [showLearnModal, setShowLearnModal] = useState(false);
  const [sessionMistakes, setSessionMistakes] = useState<
    Array<{ topic: string; question: string; correctAnswer: string; explanation: string }>
  >([]);
  const [skillSessionCompleted, setSkillSessionCompleted] = useState(false);
  const [sessionAttempts, setSessionAttempts] = useState<Record<string, number>>({});
  const [completedExerciseMap, setCompletedExerciseMap] = useState<Record<number, boolean>>({});
  const [skippedExerciseMap, setSkippedExerciseMap] = useState<Record<number, boolean>>({});
  const [isFetchingNextExercise, setIsFetchingNextExercise] = useState<boolean>(false);
  const [speakingText, setSpeakingText] = useState<string | null>(null);

  // Dynamic Mastery Target (Never hardcoded to 4; adapts to subtopic complexity & live student mistakes)
  const [dynamicMasteryTarget, setDynamicMasteryTarget] = useState<number>(6);

  // Helper to evaluate a selected word range [start, end] in "Highlight the mistake"
  const evaluateHighlightRange = useCallback(
    (
      exIdx: number,
      startIdx: number,
      endIdx: number,
      analyzed: AnalyzedHighlightPassage,
      exercise: SkillExercise
    ) => {
      const normStart = Math.min(startIdx, endIdx);
      const normEnd = Math.max(startIdx, endIdx);
      const selectedSpanLength = normEnd - normStart + 1;

      setHighlightRangeMap((prev) => ({ ...prev, [exIdx]: { start: normStart, end: normEnd } }));

      // Check if the selected word range matches the mistake target
      const selectedCleanPhrase = analyzed.words
        .slice(normStart, normEnd + 1)
        .map((w) => w.cleanWord)
        .join(' ');
      const targetCleanPhrase = (exercise.mistakeTarget || '')
        .trim()
        .split(/\s+/)
        .map((w) => normalizeWordForCompare(w))
        .filter(Boolean)
        .join(' ');

      const isExactIndexMatch =
        analyzed.targetStartIdx !== -1 &&
        normStart === analyzed.targetStartIdx &&
        normEnd === analyzed.targetEndIdx;
      const isCleanPhraseMatch =
        Boolean(targetCleanPhrase) && selectedCleanPhrase === targetCleanPhrase;

      if (isExactIndexMatch || isCleanPhraseMatch) {
        setHighlightStatusMap((prev) => ({ ...prev, [exIdx]: 'correct' }));
        setCompletedExerciseMap((prev) => ({ ...prev, [exIdx]: true }));
        setFeedbackSheet({
          type: 'correct',
          title: 'Correct!',
          message:
            exercise.explanation ||
            (exercise.correctionText
              ? `The correct term here is "${exercise.correctionText}".`
              : ''),
          canAdvance: true,
          targetExIndex: exIdx + 1
        });
      } else if (selectedSpanLength >= analyzed.targetWordCount) {
        // Student completed selecting the required number of words (1 word or N-word phrase), but it's not the mistake
        setHighlightStatusMap((prev) => ({ ...prev, [exIdx]: 'wrong' }));
        // Dynamically increase mastery target by 1 on mistake (up to +3 above initial target) so weak areas are reinforced
        setDynamicMasteryTarget((prev) =>
          Math.min((activeSkillSession?.recommendedMasteryTarget || 6) + 3, prev + 1)
        );
        setFeedbackSheet({
          type: 'try_again',
          title: 'Not quite',
          message: '',
          canAdvance: false,
          targetExIndex: exIdx
        });
      } else {
        // Still selecting (e.g., tapped 1st word of a 2-word phrase) — keep light blue highlight without popping sheet yet
        setHighlightStatusMap((prev) => ({ ...prev, [exIdx]: 'selecting' }));
      }
    },
    [activeSkillSession?.recommendedMasteryTarget]
  );

  const handleWordPointerDown = (
    exIdx: number,
    wordIdx: number,
    analyzed: AnalyzedHighlightPassage
  ) => {
    if (highlightStatusMap[exIdx] === 'correct' || highlightRevealedMap[exIdx]) return;

    const existingRange = highlightRangeMap[exIdx];
    const existingStatus = highlightStatusMap[exIdx];

    // If looking for a multi-word phrase and the user already tapped 1 word in 'selecting' state,
    // tapping an adjacent word expands the selection to [start, end]
    if (
      analyzed.targetWordCount > 1 &&
      existingStatus === 'selecting' &&
      existingRange &&
      existingRange.start === existingRange.end &&
      Math.abs(wordIdx - existingRange.start) > 0 &&
      Math.abs(wordIdx - existingRange.start) < analyzed.targetWordCount
    ) {
      const newStart = Math.min(existingRange.start, wordIdx);
      const newEnd = Math.max(existingRange.start, wordIdx);
      dragSelectionRef.current = {
        exIdx,
        anchorIdx: newStart,
        currentIdx: newEnd,
        isDragging: true
      };
      setHighlightRangeMap((prev) => ({ ...prev, [exIdx]: { start: newStart, end: newEnd } }));
      setHighlightStatusMap((prev) => ({ ...prev, [exIdx]: 'selecting' }));
      return;
    }

    dragSelectionRef.current = {
      exIdx,
      anchorIdx: wordIdx,
      currentIdx: wordIdx,
      isDragging: true
    };
    setHighlightRangeMap((prev) => ({ ...prev, [exIdx]: { start: wordIdx, end: wordIdx } }));
    setHighlightStatusMap((prev) => ({ ...prev, [exIdx]: 'selecting' }));
  };

  const handleWordPointerEnter = (exIdx: number, wordIdx: number) => {
    const drag = dragSelectionRef.current;
    if (!drag || !drag.isDragging || drag.exIdx !== exIdx) return;
    drag.currentIdx = wordIdx;
    const normStart = Math.min(drag.anchorIdx, wordIdx);
    const normEnd = Math.max(drag.anchorIdx, wordIdx);
    setHighlightRangeMap((prev) => ({ ...prev, [exIdx]: { start: normStart, end: normEnd } }));
    setHighlightStatusMap((prev) => ({ ...prev, [exIdx]: 'selecting' }));
  };

  const handlePassageTouchMove = (exIdx: number, e: React.TouchEvent<HTMLDivElement>) => {
    const drag = dragSelectionRef.current;
    if (!drag || !drag.isDragging || drag.exIdx !== exIdx) return;
    const touch = e.touches[0];
    if (!touch) return;
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const wordSpan = el?.closest('[data-highlight-word-idx]') as HTMLElement | null;
    if (wordSpan) {
      const idxAttr = Number(wordSpan.getAttribute('data-highlight-word-idx'));
      if (Number.isFinite(idxAttr) && idxAttr !== drag.currentIdx) {
        drag.currentIdx = idxAttr;
        const normStart = Math.min(drag.anchorIdx, idxAttr);
        const normEnd = Math.max(drag.anchorIdx, idxAttr);
        setHighlightRangeMap((prev) => ({ ...prev, [exIdx]: { start: normStart, end: normEnd } }));
        setHighlightStatusMap((prev) => ({ ...prev, [exIdx]: 'selecting' }));
      }
    }
  };

  const handlePassagePointerUp = (
    exIdx: number,
    analyzed: AnalyzedHighlightPassage,
    exercise: SkillExercise
  ) => {
    const drag = dragSelectionRef.current;
    if (!drag || !drag.isDragging || drag.exIdx !== exIdx) return;
    drag.isDragging = false;
    evaluateHighlightRange(exIdx, drag.anchorIdx, drag.currentIdx, analyzed, exercise);
  };

  const handleRevealHighlightMistake = (exIdx: number, exercise: SkillExercise) => {
    const analyzed = analyzeHighlightPassage(
      exercise.passage || '',
      exercise.mistakeTarget,
      exercise.instruction
    );
    if (analyzed.targetStartIdx !== -1) {
      setHighlightRangeMap((prev) => ({
        ...prev,
        [exIdx]: { start: analyzed.targetStartIdx, end: analyzed.targetEndIdx }
      }));
    }
    setHighlightStatusMap((prev) => ({ ...prev, [exIdx]: 'correct' }));
    setHighlightRevealedMap((prev) => ({ ...prev, [exIdx]: true }));
    setCompletedExerciseMap((prev) => ({ ...prev, [exIdx]: true }));
    // Using Reveal adds +1 to dynamicMasteryTarget so the student completes an extra unassisted exercise
    setDynamicMasteryTarget((prev) =>
      Math.min((activeSkillSession?.recommendedMasteryTarget || 6) + 3, prev + 1)
    );
    setFeedbackSheet({
      type: 'correct',
      title: 'Correct!',
      message:
        exercise.explanation ||
        `The mistake is "${exercise.mistakeTarget || 'the highlighted phrase'}". ${
          exercise.correctionText ? `It should be "${exercise.correctionText}".` : ''
        }`,
      canAdvance: true,
      targetExIndex: exIdx + 1
    });
  };

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const toggleSpeechSynthesis = (cardText: string) => {
    if (!('speechSynthesis' in window)) {
      toast.error('Text-to-speech is not supported in this browser.');
      return;
    }
    const cleanText = cardText
      .replace(/[*_#$`~]/g, '')
      .replace(/\\(?:[a-zA-Z]+)/g, '')
      .trim();

    if (speakingText === cardText) {
      window.speechSynthesis.cancel();
      setSpeakingText(null);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 0.95;
      utterance.onend = () => setSpeakingText(null);
      utterance.onerror = () => setSpeakingText(null);
      setSpeakingText(cardText);
      window.speechSynthesis.speak(utterance);
    }
  };

  // --- CBT Mock Simulator State ---
  const [allPapers, setAllPapers] = useState<CBTExamAssessment[]>([]);
  const [isLoadingPapers, setIsLoadingPapers] = useState(true);
  const [selectedPaper, setSelectedPaper] = useState<CBTExamAssessment | null>(null);
  const [activeQuestions, setActiveQuestions] = useState<CBTExamQuestion[]>([]);
  const [sessionMode, setSessionMode] = useState<ExamSessionMode>('cbt');
  const [secondsPerQuestion, setSecondsPerQuestion] = useState<number>(60);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(0);
  const [totalAllocatedSeconds, setTotalAllocatedSeconds] = useState<number>(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [flaggedQuestions, setFlaggedQuestions] = useState<Record<string, boolean>>({});
  const [showPalette, setShowPalette] = useState<boolean>(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState<boolean>(false);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [showHints, setShowHints] = useState<Record<string, boolean>>({});
  const [submittedQuestions, setSubmittedQuestions] = useState<Record<string, boolean>>({});
  const [showResults, setShowResults] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [eliminatedOptions, setEliminatedOptions] = useState<Record<string, string[]>>({});
  const [isUsingFiftyFifty, setIsUsingFiftyFifty] = useState<Record<string, boolean>>({});
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [srsScheduleStatus, setSrsScheduleStatus] = useState<'idle' | 'scheduling' | 'scheduled' | 'error'>('idle');
  const [scheduledSrsCount, setScheduledSrsCount] = useState<number>(0);
  const [isCompilingPaper, setIsCompilingPaper] = useState<boolean>(false);
  const [compileQuestionCount, setCompileQuestionCount] = useState<'dynamic' | number>('dynamic');
  const [compileDifficulty, setCompileDifficulty] = useState<'standard' | 'high'>('standard');

  const hasFinalizedRef = useRef<boolean>(false);
  const sessionStartRef = useRef<number>(Date.now());

  const isPremium =
    profile?.role === 'admin' ||
    (profile?.plan_type &&
      profile.plan_type !== 'free' &&
      profile?.subscription_status === 'active');

  const activeCourseObj = useMemo(
    () => courses.find((c) => c.id === activeCourseId),
    [courses, activeCourseId]
  );

  // Sync skill levels per course from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`uniace_skill_levels_${activeCourseId}`);
      if (saved) {
        setSkillLevels(JSON.parse(saved));
      } else {
        setSkillLevels({});
      }
    } catch {
      setSkillLevels({});
    }
  }, [activeCourseId]);

  const getSkillLevel = useCallback(
    (skillId: string, _skillTitle: string): number => {
      if (skillLevels[skillId]) return skillLevels[skillId];
      return 1;
    },
    [skillLevels]
  );

  // Compute Trophy Progress from all course skills
  const { totalSkillsCount, leveledUpSkillsCount, trophyProgressPercent } = useMemo(() => {
    let total = 0;
    let leveled = 0;
    syllabus.forEach((mod) => {
      (mod.subTopics || []).forEach((sub) => {
        total += 1;
        if (getSkillLevel(sub.id, sub.title) >= 2) {
          leveled += 1;
        }
      });
    });
    const pct = total > 0 ? Math.min(100, Math.round((leveled / total) * 100)) : 0;
    return {
      totalSkillsCount: total,
      leveledUpSkillsCount: leveled,
      trophyProgressPercent: pct
    };
  }, [syllabus, getSkillLevel]);

  // Fetch CBT Mock Assessments from Neon PostgreSQL
  const fetchPapers = useCallback(async () => {
    setIsLoadingPapers(true);
    try {
      const result = await safeFetchJson<{ exams?: CBTExamAssessment[]; papers?: CBTExamAssessment[] }>('/api/cbt/exams');
      if (result.ok && result.data) {
        const list = result.data.exams || result.data.papers;
        setAllPapers(Array.isArray(list) ? list : []);
      }
    } catch (error) {
      console.warn('Could not fetch CBT mock assessments:', error);
    } finally {
      setIsLoadingPapers(false);
    }
  }, []);

  useEffect(() => {
    fetchPapers();
  }, [fetchPapers]);

  // Persistent Seen-Exercise Tracker (prevents repeating questions across "Practice Again" sessions)
  const getSeenExercisePrompts = useCallback(
    (skillId: string): string[] => {
      try {
        const raw = localStorage.getItem(`uniace_seen_exercises_${activeCourseId}_${skillId}`);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    [activeCourseId]
  );

  const recordSeenExercises = useCallback(
    (skillId: string, exercises: SkillExercise[]) => {
      try {
        const existing = getSeenExercisePrompts(skillId);
        const nextSet = new Set<string>(existing);
        exercises.forEach((ex) => {
          const sig = [
            ex.question || '',
            ex.passage || '',
            ex.sentenceWithBlanks || '',
            ex.frontTitle || '',
            ...(ex.cards || []).slice(0, 2),
            ...(ex.pairs || []).map((p) => `${p.left}:${p.right}`)
          ]
            .filter(Boolean)
            .join(' | ')
            .trim();
          if (sig.length > 5) nextSet.add(sig.slice(0, 220));
          if (ex.question && ex.question.trim().length > 5) nextSet.add(ex.question.trim());
          if (ex.passage && ex.passage.trim().length > 5) nextSet.add(ex.passage.trim());
          if (ex.sentenceWithBlanks && ex.sentenceWithBlanks.trim().length > 5) {
            nextSet.add(ex.sentenceWithBlanks.trim());
          }
        });
        const merged = Array.from(nextSet).slice(-80);
        localStorage.setItem(
          `uniace_seen_exercises_${activeCourseId}_${skillId}`,
          JSON.stringify(merged)
        );
      } catch {
        // Ignore storage quota errors
      }
    },
    [activeCourseId, getSeenExercisePrompts]
  );

  const availableCourses = useMemo(
    () =>
      courses.filter(
        (c) =>
          c.semester === activeSemester ||
          allPapers.some((p) => p.courseCode === c.id && p.semester === activeSemester)
      ),
    [courses, activeSemester, allPapers]
  );

  const coursePapers = useMemo(
    () =>
      allPapers.filter(
        (p) =>
          p.courseCode?.toLowerCase().replace(/\s+/g, '') ===
          activeCourseId?.toLowerCase().replace(/\s+/g, '')
      ),
    [allPapers, activeCourseId]
  );

  useEffect(() => {
    setSelectedPaper(null);
    setActiveQuestions([]);
    setIsStarted(false);
    setShowResults(false);
  }, [activeCourseId]);

  // Active exercise reference based on current scroll snap index
  const activeExercise: SkillExercise | undefined = activeSkillSession?.exercises?.[currentExIndex];

  useEffect(() => {
    setFeedbackSheet(null);
    setShowHintSheet(false);
  }, [currentExIndex]);

  // Launch an interactive multi-format Skill Session with dynamic variation rotation & mastery adaptation
  const handleStartSkillSession = async (
    moduleId: string,
    moduleTitle: string,
    skillId: string,
    skillTitle: string,
    skillContent?: string,
    forceNextAttempt: boolean = true
  ) => {
    if (!user) {
      toast.error('Please sign in to start an interactive skill session.');
      return;
    }

    const currentLvl = getSkillLevel(skillId, skillTitle);
    const rollingMastery = currentLvl >= 3 ? 90 : currentLvl === 2 ? 75 : 45;
    const currentAttempt = (sessionAttempts[skillId] || 0) + (forceNextAttempt ? 1 : 0);
    if (forceNextAttempt) {
      setSessionAttempts((prev) => ({ ...prev, [skillId]: currentAttempt }));
    }

    const previouslySeenPrompts = getSeenExercisePrompts(skillId);

    setIsGeneratingSkill(skillId);
    const toastId = toast.loading(
      currentAttempt > 1
        ? `Generating fresh unseen exercises for ${skillTitle}...`
        : `Loading interactive skill session: ${skillTitle}...`
    );

    try {
      const token = await user.getIdToken();
      const result = await safeFetchJson<{ session?: SkillSessionPayload; error?: string; details?: string }>(
        '/api/skill-session/generate',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            courseId: activeCourseId,
            courseTitle: activeCourseObj?.title || activeCourseId,
            moduleId,
            moduleTitle,
            skillId,
            skillTitle,
            skillContent,
            rollingMastery,
            sessionAttempt: currentAttempt,
            avoidPrompts: previouslySeenPrompts,
            forceFresh: currentAttempt > 1 || previouslySeenPrompts.length > 0
          })
        }
      );

      if (!result.ok || !result.data?.session) {
        throw new Error(result.error || result.data?.error || result.data?.details || 'Failed to build skill session');
      }

      const session = result.data.session;
      recordSeenExercises(skillId, session.exercises || []);

      const computedTarget =
        typeof session.recommendedMasteryTarget === 'number' && session.recommendedMasteryTarget >= 4
          ? session.recommendedMasteryTarget
          : Math.max(5, (session.exercises || []).length);
      setDynamicMasteryTarget(computedTarget);

      const initShuffledRight: Record<number, SkillMatchPair[]> = {};
      const initFilledBlanks: Record<number, (string | null)[]> = {};
      session.exercises.forEach((ex, idx) => {
        if (ex.type === 'match_pairs' && Array.isArray(ex.pairs)) {
          initShuffledRight[idx] = [...ex.pairs].sort(() => Math.random() - 0.5);
        }
        if (ex.type === 'fill_blanks') {
          const blankCount = (ex.sentenceWithBlanks?.match(/___BLANK___/g) || []).length || 1;
          initFilledBlanks[idx] = Array(blankCount).fill(null);
        }
      });
      setShuffledRightPairsMap(initShuffledRight);
      setFilledBlanksMap(initFilledBlanks);
      setSelectedMcqMap({});
      setTriedWrongMcqMap({});
      setMatchedPairsMap({});
      setSelectedLeftPairMap({});
      setCompletedExerciseMap({});
      setSkippedExerciseMap({});
      setIsFetchingNextExercise(false);
      setRevealedBlanksMap({});
      setBlanksCheckedMap({});
      setExplanationInputMap({});
      setIsEvaluatingMap({});
      setHighlightRangeMap({});
      setHighlightStatusMap({});
      setHighlightRevealedMap({});
      setFlippedFlashcardMap({});
      hasAwardedSkillXPRef.current = false;
      setSkillSessionCompleted(false);

      toast.dismiss(toastId);
      setActiveSkillSession(session);
      setCurrentExIndex(0);
      setSessionMistakes([]);
      setTimeout(() => {
        feedContainerRef.current?.scrollTo({ top: 0, behavior: 'instant' as any });
      }, 40);
    } catch (err: any) {
      console.error('Error starting skill session:', err);
      toast.error(err.message || 'Could not generate skill session. Please try again.', { id: toastId });
    } finally {
      setIsGeneratingSkill(null);
    }
  };

  // Programmatic smooth scroll to a specific exercise card
  const scrollToExercise = useCallback((idx: number) => {
    if (!feedContainerRef.current) return;
    const h = feedContainerRef.current.clientHeight;
    feedContainerRef.current.scrollTo({ top: idx * h, behavior: 'smooth' });
  }, []);

  const scrollCarouselCard = useCallback((exIdx: number, targetCardIdx: number) => {
    const el = document.getElementById(`carousel-container-${exIdx}`);
    if (el) {
      const cardWidth = el.clientWidth * 0.82;
      el.scrollTo({ left: targetCardIdx * cardWidth, behavior: 'smooth' });
      setCarouselIndexMap((prev) => ({ ...prev, [exIdx]: targetCardIdx }));
    }
  }, []);

  // Dynamically generate and append a fresh exercise from the subtopic's lesson content on the fly
  const fetchAndAppendNextExercise = useCallback(async () => {
    if (!activeSkillSession || isFetchingNextExercise) return;
    setIsFetchingNextExercise(true);

    try {
      const token = await user?.getIdToken();
      const currentLvl = getSkillLevel(activeSkillSession.skillId, activeSkillSession.skillTitle);
      const rollingMastery = currentLvl >= 3 ? 90 : currentLvl === 2 ? 75 : 50;

      const currentSessionPrompts = (activeSkillSession.exercises || [])
        .flatMap((e) => [
          e.question || '',
          e.passage || '',
          e.sentenceWithBlanks || '',
          e.frontTitle || '',
          e.prompt || ''
        ])
        .filter(Boolean);
      const historicalSeen = getSeenExercisePrompts(activeSkillSession.skillId);
      const avoidList = Array.from(new Set([...historicalSeen, ...currentSessionPrompts])).slice(-60);

      const verifiedCount = Object.values(completedExerciseMap).filter(Boolean).length;
      const isFinalChallenge = verifiedCount >= dynamicMasteryTarget - 1;

      const res = await safeFetchJson<{ success: boolean; exercise?: SkillExercise; error?: string }>(
        '/api/skill-session/next-exercise',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            courseId: activeCourseId,
            courseTitle: activeCourseObj?.title || activeCourseId,
            moduleId: activeSkillSession.moduleId,
            skillId: activeSkillSession.skillId,
            skillTitle: activeSkillSession.skillTitle,
            skillContent: activeSkillSession.learnSummary,
            rollingMastery,
            avoidPrompts: avoidList,
            isFinalChallenge
          })
        }
      );

      if (res.ok && res.data?.exercise) {
        const newEx = res.data.exercise;
        recordSeenExercises(activeSkillSession.skillId, [newEx]);

        setActiveSkillSession((prev) => {
          if (!prev) return null;
          const nextIndex = prev.exercises.length;

          // Initialize state for new exercise
          if (newEx.type === 'match_pairs' && Array.isArray(newEx.pairs)) {
            setShuffledRightPairsMap((m) => ({
              ...m,
              [nextIndex]: [...newEx.pairs!].sort(() => Math.random() - 0.5)
            }));
          }
          if (newEx.type === 'fill_blanks') {
            const blankCount = (newEx.sentenceWithBlanks?.match(/___BLANK___/g) || []).length || 1;
            setFilledBlanksMap((m) => ({
              ...m,
              [nextIndex]: Array(blankCount).fill(null)
            }));
          }

          return {
            ...prev,
            exercises: [...prev.exercises, newEx]
          };
        });
      }
    } catch (err) {
      console.warn('Error dynamically loading next practice question:', err);
    } finally {
      setIsFetchingNextExercise(false);
    }
  }, [
    activeSkillSession,
    isFetchingNextExercise,
    user,
    getSkillLevel,
    activeCourseId,
    activeCourseObj,
    getSeenExercisePrompts,
    recordSeenExercises,
    completedExerciseMap,
    dynamicMasteryTarget
  ]);

  // Mark an exercise as completed with verified correctness
  const markExerciseCompleted = useCallback((exIdx: number) => {
    setCompletedExerciseMap((prev) => ({ ...prev, [exIdx]: true }));
  }, []);

  const handleAdvanceSkillExercise = useCallback(() => {
    if (!activeSkillSession) return;
    const target =
      feedbackSheet?.targetExIndex !== undefined
        ? feedbackSheet.targetExIndex
        : currentExIndex + 1;
    setFeedbackSheet(null);

    const verifiedCount = Object.values(completedExerciseMap).filter(Boolean).length;
    if (target >= activeSkillSession.exercises.length && verifiedCount < dynamicMasteryTarget) {
      fetchAndAppendNextExercise();
    }
    scrollToExercise(target);
  }, [
    activeSkillSession,
    feedbackSheet,
    currentExIndex,
    completedExerciseMap,
    dynamicMasteryTarget,
    fetchAndAppendNextExercise,
    scrollToExercise
  ]);

  // Update active exercise indicator as the user continuous-swipes
  const handleFeedScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!el || el.clientHeight === 0 || !activeSkillSession) return;
    const index = Math.round(el.scrollTop / el.clientHeight);
    if (index !== currentExIndex && index >= 0) {
      // If student scrolled forward past an uncompleted card, mark as skipped (does NOT count towards mastery)
      if (index > currentExIndex && !completedExerciseMap[currentExIndex]) {
        setSkippedExerciseMap((prev) => ({ ...prev, [currentExIndex]: true }));
      }

      setCurrentExIndex(index);
      setFeedbackSheet(null);
      setShowHintSheet(false);

      // Pre-fetch next dynamic exercise from lesson content when approaching the end
      const total = activeSkillSession.exercises.length;
      const verifiedCount = Object.values(completedExerciseMap).filter(Boolean).length;
      if (index >= total - 1 && verifiedCount < dynamicMasteryTarget && !isFetchingNextExercise) {
        fetchAndAppendNextExercise();
      }
    }
  }, [
    currentExIndex,
    activeSkillSession,
    completedExerciseMap,
    dynamicMasteryTarget,
    isFetchingNextExercise,
    fetchAndAppendNextExercise
  ]);

  // Session completion handler (awards XP and syncs Spaced Repetition deck)
  const handleCompleteSession = useCallback(async () => {
    if (hasAwardedSkillXPRef.current || !activeSkillSession) return;
    hasAwardedSkillXPRef.current = true;
    setSkillSessionCompleted(true);
    const currentLvl = getSkillLevel(activeSkillSession.skillId, activeSkillSession.skillTitle);
    const nextLvl = Math.min(3, currentLvl + 1);

    const updatedLevels = {
      ...skillLevels,
      [activeSkillSession.skillId]: nextLvl
    };
    setSkillLevels(updatedLevels);
    try {
      localStorage.setItem(`uniace_skill_levels_${activeCourseId}`, JSON.stringify(updatedLevels));
    } catch {
      // Ignore storage quota errors
    }

    awardXP(60);

    // Schedule any mistakes into Neon PostgreSQL Spaced Repetition
    if (user && sessionMistakes.length > 0) {
      try {
        const token = await user.getIdToken();
        await fetch('/api/user/srs/batch-schedule', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            courseId: activeCourseId,
            items: sessionMistakes
          })
        });
      } catch (e) {
        console.warn('Failed to schedule skill mistakes to SRS:', e);
      }
    }
  }, [
    activeSkillSession,
    getSkillLevel,
    skillLevels,
    activeCourseId,
    awardXP,
    user,
    sessionMistakes
  ]);

  // Trigger completion ONLY when user has genuinely earned mastery and arrives at the celebration card
  useEffect(() => {
    const verifiedCount = Object.values(completedExerciseMap).filter(Boolean).length;
    if (
      activeSkillSession &&
      verifiedCount >= dynamicMasteryTarget &&
      currentExIndex >= activeSkillSession.exercises.length
    ) {
      handleCompleteSession();
    }
  }, [activeSkillSession, currentExIndex, completedExerciseMap, dynamicMasteryTarget, handleCompleteSession]);

  // Next subtopic in course sequence
  const nextSubTopic = useMemo(() => {
    if (!activeSkillSession) return null;
    let foundCurrent = false;
    for (const mod of syllabus) {
      for (const sub of mod.subTopics || []) {
        if (foundCurrent) return { module: mod, subTopic: sub };
        if (sub.id === activeSkillSession.skillId || sub.title === activeSkillSession.skillTitle) {
          foundCurrent = true;
        }
      }
    }
    return null;
  }, [activeSkillSession, syllabus]);

  // Sync body attribute so BottomNav knows when to hide
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.skillSessionActive = activeSkillSession ? 'true' : 'false';
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.dataset.skillSessionActive = 'false';
      }
    };
  }, [activeSkillSession]);

  // Format A: Concept Carousel decision
  const handleCarouselDecision = (needsPractice: boolean, exIdx: number, exercise: SkillExercise) => {
    if (needsPractice && activeSkillSession) {
      const cardsSummary = (exercise.cards || []).join(' ');
      setSessionMistakes((prev) => [
        ...prev,
        {
          topic: activeSkillSession.skillTitle,
          question: `Concept Review: ${activeSkillSession.skillTitle}`,
          correctAnswer: exercise.cards?.[exercise.cards.length - 1] || activeSkillSession.skillTitle,
          explanation: cardsSummary
        }
      ]);
      // Dynamically extend required mastery count when student requests extra practice
      setDynamicMasteryTarget((prev) =>
        Math.min((activeSkillSession.recommendedMasteryTarget || 6) + 3, prev + 1)
      );
      toast('Added concept to your Spaced Repetition review deck & queued extra practice!', { icon: '🧠' });
    } else {
      markExerciseCompleted(exIdx);
    }
    if (exIdx >= (activeSkillSession?.exercises.length || 1) - 1) {
      fetchAndAppendNextExercise();
    }
    scrollToExercise(exIdx + 1);
  };

  // Format 1B: "Check your knowledge" Tap-to-Flip Flashcard decision (Video 00:12)
  const handleFlashcardDecision = (needsPractice: boolean, exIdx: number, exercise: SkillExercise) => {
    if (needsPractice && activeSkillSession) {
      setSessionMistakes((prev) => [
        ...prev,
        {
          topic: activeSkillSession.skillTitle,
          question: exercise.question || exercise.frontTitle || activeSkillSession.skillTitle,
          correctAnswer: exercise.backAnswer || '',
          explanation: exercise.learnMore || exercise.backAnswer || ''
        }
      ]);
      setDynamicMasteryTarget((prev) =>
        Math.min((activeSkillSession.recommendedMasteryTarget || 6) + 3, prev + 1)
      );
      toast('Scheduled for reinforcement practice!', { icon: '🧠' });
    } else {
      markExerciseCompleted(exIdx);
    }
    if (exIdx >= (activeSkillSession?.exercises.length || 1) - 1) {
      fetchAndAppendNextExercise();
    }
    scrollToExercise(exIdx + 1);
  };

  // Distinct vibrant color palette for matched pairs (Matches Screenshot: Indigo, Rose Pink, Sky Blue, Leaf Green + dynamic extras)
  const MATCH_PAIR_COLOR_CLASSES = [
    'bg-[#4E46F5] dark:bg-[#4E46F5] border-[#4E46F5] text-white shadow-xs',
    'bg-[#FF80AB] dark:bg-[#FF80AB] border-[#FF80AB] text-white shadow-xs',
    'bg-[#63B4FF] dark:bg-[#63B4FF] border-[#63B4FF] text-white shadow-xs',
    'bg-[#68A828] dark:bg-[#68A828] border-[#68A828] text-white shadow-xs',
    'bg-[#F59E0B] dark:bg-[#F59E0B] border-[#F59E0B] text-white shadow-xs',
    'bg-[#8B5CF6] dark:bg-[#8B5CF6] border-[#8B5CF6] text-white shadow-xs'
  ];

  // Format B: Match the Pairs handlers
  const handleSelectLeftPair = (exIdx: number, pairId: string) => {
    setSelectedLeftPairMap((prev) => ({
      ...prev,
      [exIdx]: prev[exIdx] === pairId ? null : pairId
    }));
  };

  const handleSelectRightPair = (exIdx: number, rightPair: SkillMatchPair, exercise: SkillExercise) => {
    const selectedLeft = selectedLeftPairMap[exIdx];
    if (!selectedLeft || !exercise.pairs) return;
    const currentMatched = matchedPairsMap[exIdx] || [];
    if (currentMatched.includes(rightPair.id)) return;

    if (selectedLeft === rightPair.id) {
      const nextMatched = [...currentMatched, rightPair.id];
      setMatchedPairsMap((prev) => ({ ...prev, [exIdx]: nextMatched }));
      setSelectedLeftPairMap((prev) => ({ ...prev, [exIdx]: null }));

      if (nextMatched.length === exercise.pairs.length) {
        markExerciseCompleted(exIdx);

        // Build complete explanation covering all matched pairs dynamically
        const combinedPairExplanations = exercise.pairs
          .map((p) => {
            if (p.explanation && p.explanation.trim().length > 0) {
              const trimmed = p.explanation.trim();
              return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
            }
            return `${p.left} corresponds to ${p.right}.`;
          })
          .join(' ');

        const fullSummaryMessage =
          exercise.explanation && exercise.explanation.trim().length > 15
            ? exercise.explanation.trim()
            : combinedPairExplanations;

        setFeedbackSheet({
          type: 'correct',
          title: 'Correct!',
          message: fullSummaryMessage,
          canAdvance: true,
          targetExIndex: exIdx + 1
        });
        if (exIdx >= (activeSkillSession?.exercises.length || 1) - 1) {
          fetchAndAppendNextExercise();
        }
      }
    } else {
      setWrongPairFlashMap((prev) => ({ ...prev, [exIdx]: rightPair.id }));
      setTimeout(() => setWrongPairFlashMap((prev) => ({ ...prev, [exIdx]: null })), 650);
      setDynamicMasteryTarget((prev) =>
        Math.min((activeSkillSession?.recommendedMasteryTarget || 6) + 3, prev + 1)
      );
      setFeedbackSheet({
        type: 'try_again',
        title: 'Not quite',
        message: '',
        canAdvance: false
      });
    }
  };

  // Format C: Smart-Retry Multiple Choice handler
  const handleSelectSmartMcqOption = (
    exIdx: number,
    opt: SkillExerciseOption,
    optIdx: number,
    exercise: SkillExercise
  ) => {
    setSelectedMcqMap((prev) => ({ ...prev, [exIdx]: optIdx }));
    if (opt.isCorrect) {
      markExerciseCompleted(exIdx);
      setFeedbackSheet({
        type: 'correct',
        title: 'Correct!',
        message: opt.feedback || 'Great job! That is the exact mathematical interpretation.',
        canAdvance: true,
        targetExIndex: exIdx + 1
      });
      if (exIdx >= (activeSkillSession?.exercises.length || 1) - 1) {
        fetchAndAppendNextExercise();
      }
    } else {
      setTriedWrongMcqMap((prev) => {
        const current = prev[exIdx] || [];
        return current.includes(optIdx) ? prev : { ...prev, [exIdx]: [...current, optIdx] };
      });
      setDynamicMasteryTarget((prev) =>
        Math.min((activeSkillSession?.recommendedMasteryTarget || 6) + 3, prev + 1)
      );
      if (activeSkillSession) {
        const rightOpt = exercise.options?.find((o) => o.isCorrect);
        setSessionMistakes((prev) => [
          ...prev,
          {
            topic: activeSkillSession.skillTitle,
            question: exercise.question || activeSkillSession.skillTitle,
            correctAnswer: rightOpt?.text || '',
            explanation: rightOpt?.feedback || ''
          }
        ]);
      }
      setFeedbackSheet({
        type: 'try_again',
        title: 'Not quite',
        message: opt.feedback || 'Not quite. Re-check the core condition and try another option.',
        canAdvance: false
      });
    }
  };

  // Format D: Fill in the Blanks handlers
  const handleTapWordChip = (exIdx: number, word: string) => {
    if (revealedBlanksMap[exIdx]) return;
    setBlanksCheckedMap((prev) => ({ ...prev, [exIdx]: false }));
    const blanks = filledBlanksMap[exIdx] || [];
    const emptyIdx = blanks.findIndex((b) => b === null);
    if (emptyIdx === -1) return;
    const next = [...blanks];
    next[emptyIdx] = word;
    setFilledBlanksMap((prev) => ({ ...prev, [exIdx]: next }));
  };

  const handleClearBlankSlot = (exIdx: number, slotIdx: number) => {
    if (revealedBlanksMap[exIdx]) return;
    setBlanksCheckedMap((prev) => ({ ...prev, [exIdx]: false }));
    const blanks = filledBlanksMap[exIdx] || [];
    const next = [...blanks];
    next[slotIdx] = null;
    setFilledBlanksMap((prev) => ({ ...prev, [exIdx]: next }));
  };

  const handleRevealBlanks = (exIdx: number) => {
    const exercise = activeSkillSession?.exercises[exIdx];
    if (!exercise?.correctBlanks) return;
    setFilledBlanksMap((prev) => ({ ...prev, [exIdx]: [...exercise.correctBlanks!] }));
    setRevealedBlanksMap((prev) => ({ ...prev, [exIdx]: true }));
    setBlanksCheckedMap((prev) => ({ ...prev, [exIdx]: true }));
    setDynamicMasteryTarget((prev) =>
      Math.min((activeSkillSession?.recommendedMasteryTarget || 6) + 3, prev + 1)
    );
    setFeedbackSheet({
      type: 'correct',
      title: 'Solution Revealed',
      message: exercise.explanation || 'Review how each term completes the formal statement.',
      canAdvance: true,
      targetExIndex: exIdx + 1
    });
  };

  const handleSubmitBlanks = (exIdx: number) => {
    const exercise = activeSkillSession?.exercises[exIdx];
    if (!exercise?.correctBlanks) return;
    const blanks = filledBlanksMap[exIdx] || [];
    if (blanks.some((b) => b === null)) {
      toast.error('Tap the word chips to fill all blanks first.');
      return;
    }

    setBlanksCheckedMap((prev) => ({ ...prev, [exIdx]: true }));

    const allCorrect = exercise.correctBlanks.every(
      (ans, idx) => (blanks[idx] || '').trim().toLowerCase() === ans.trim().toLowerCase()
    );

    if (allCorrect) {
      markExerciseCompleted(exIdx);
      setFeedbackSheet({
        type: 'correct',
        title: 'Correct!',
        message: exercise.explanation || 'Spot on! Every blank is accurately completed.',
        canAdvance: true,
        targetExIndex: exIdx + 1
      });
      if (exIdx >= (activeSkillSession?.exercises.length || 1) - 1) {
        fetchAndAppendNextExercise();
      }
    } else {
      setDynamicMasteryTarget((prev) =>
        Math.min((activeSkillSession?.recommendedMasteryTarget || 6) + 3, prev + 1)
      );
      if (activeSkillSession) {
        setSessionMistakes((prev) => [
          ...prev,
          {
            topic: activeSkillSession.skillTitle,
            question: exercise.prompt || activeSkillSession.skillTitle,
            correctAnswer: (exercise.correctBlanks || []).join(' → '),
            explanation: exercise.explanation || 'Fill in the blanks practice item'
          }
        ]);
      }
      setFeedbackSheet({
        type: 'try_again',
        title: 'Not quite',
        message:
          exercise.hint ||
          'Check the highlighted slots: green slots are correct, and red slots are inaccurate. Tap the red slots to remove and replace them.',
        canAdvance: false
      });
    }
  };

  // Format E: Voice / Text "Explain the Concept" handlers
  const toggleVoiceDictation = (exIdx: number) => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Voice dictation is not supported in this browser. Please type your answer.');
      return;
    }

    if (isListeningMic && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListeningMic(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setIsListeningMic(true);
      recognition.onend = () => setIsListeningMic(false);
      recognition.onerror = () => setIsListeningMic(false);
      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        if (transcript) {
          setExplanationInputMap((prev) => ({
            ...prev,
            [exIdx]: prev[exIdx] ? `${prev[exIdx]} ${transcript}` : transcript
          }));
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListeningMic(false);
    }
  };

  const handleSubmitExplanation = async (exIdx: number, exercise: SkillExercise) => {
    const inputVal = (explanationInputMap[exIdx] || '').trim();
    if (!inputVal || isEvaluatingMap[exIdx]) return;
    setIsEvaluatingMap((prev) => ({ ...prev, [exIdx]: true }));

    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/skill-session/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          skillTitle: activeSkillSession?.skillTitle,
          question: exercise.question,
          userResponse: inputVal,
          keyConcepts: exercise.keyConcepts || [],
          sampleAnswer: exercise.sampleAnswer || ''
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        if (data.isCorrect) {
          markExerciseCompleted(exIdx);
          setFeedbackSheet({
            type: 'correct',
            title: 'Correct!',
            message: data.feedback || `Model Answer: ${exercise.sampleAnswer || ''}`,
            canAdvance: true,
            targetExIndex: exIdx + 1
          });
          if (exIdx >= (activeSkillSession?.exercises.length || 1) - 1) {
            fetchAndAppendNextExercise();
          }
        } else {
          setDynamicMasteryTarget((prev) =>
            Math.min((activeSkillSession?.recommendedMasteryTarget || 6) + 3, prev + 1)
          );
          setFeedbackSheet({
            type: 'try_again',
            title: 'Refine your explanation',
            message:
              data.feedback ||
              exercise.hint ||
              'Check the key relationship and try adding more detail.',
            canAdvance: false
          });
        }
      } else {
        setFeedbackSheet({
          type: 'correct',
          title: 'Compare with Reference',
          message: `Reference Explanation: ${exercise.sampleAnswer || exercise.learnMore || ''}`,
          canAdvance: true,
          targetExIndex: exIdx + 1
        });
      }
    } catch {
      setFeedbackSheet({
        type: 'correct',
        title: 'Compare with Reference',
        message: `Reference Explanation: ${exercise.sampleAnswer || exercise.learnMore || ''}`,
        canAdvance: true,
        targetExIndex: exIdx + 1
      });
    } finally {
      setIsEvaluatingMap((prev) => ({ ...prev, [exIdx]: false }));
    }
  };

  // --- CBT Exam Simulator Finalization & Spaced Repetition Auto-Scheduling ---
  const isAnswerMatch = useCallback((userAns: string | undefined, correctAns: string): boolean => {
    if (!userAns) return false;
    return userAns.trim().toLowerCase() === correctAns.trim().toLowerCase();
  }, []);

  const calculateScore = useCallback(() => {
    let correct = 0;
    activeQuestions.forEach((q) => {
      if (isAnswerMatch(userAnswers[q.id], q.correctAnswer)) {
        correct++;
      }
    });
    return correct;
  }, [activeQuestions, userAnswers, isAnswerMatch]);

  const finalizeExamSession = useCallback(
    async (autoSubmittedByTimer: boolean = false) => {
      if (hasFinalizedRef.current) return;
      hasFinalizedRef.current = true;

      setShowSubmitConfirm(false);
      setShowPalette(false);

      const allSubmitted: Record<string, boolean> = {};
      activeQuestions.forEach((q) => {
        allSubmitted[q.id] = true;
      });
      setSubmittedQuestions(allSubmitted);
      setShowResults(true);

      const score = calculateScore();
      const total = activeQuestions.length;
      const pct = total > 0 ? Math.round((score / total) * 100) : 0;
      const xpEarned = score * 25 + (sessionMode === 'cbt' ? 50 : 25);
      awardXP(xpEarned);

      if (autoSubmittedByTimer) {
        toast('Time expired! CBT Mock automatically submitted.', { icon: '⏱️' });
      } else {
        toast.success(`CBT Mock completed! Score: ${score}/${total} (${pct}%)`);
      }

      if (!user) return;

      const missedItems = activeQuestions
        .filter((q) => !isAnswerMatch(userAnswers[q.id], q.correctAnswer))
        .map((q) => ({
          questionId: q.id,
          topic: q.topic || selectedPaper?.title || activeCourseId,
          question: q.question,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          userAnswer: userAnswers[q.id] || 'Unanswered'
        }));

      try {
        const token = await user.getIdToken();
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000));

        await fetch('/api/quiz/record-attempt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            courseId: activeCourseId,
            moduleId: selectedPaper?.id || 'cbt_mock_exam',
            quizType: sessionMode === 'cbt' ? 'cbt_exam_simulator' : 'cbt_study_mode',
            scorePct: pct,
            correctCount: score,
            totalQuestions: total,
            timeTakenSeconds:
              sessionMode === 'cbt' && totalAllocatedSeconds > 0
                ? Math.max(1, totalAllocatedSeconds - timeLeftSeconds)
                : elapsedSeconds,
            answersBreakdown: activeQuestions.map((q) => ({
              questionId: q.id,
              topic: q.topic || activeCourseId,
              selectedAnswer: userAnswers[q.id] || null,
              correctAnswer: q.correctAnswer,
              isCorrect: isAnswerMatch(userAnswers[q.id], q.correctAnswer)
            }))
          })
        });

        if (missedItems.length > 0) {
          setSrsScheduleStatus('scheduling');
          const srsRes = await fetch('/api/user/srs/batch-schedule', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              courseId: activeCourseId,
              items: missedItems
            })
          });

          if (srsRes.ok) {
            const srsData = await srsRes.json();
            setScheduledSrsCount(srsData.scheduledCount ?? missedItems.length);
            setSrsScheduleStatus('scheduled');
          } else {
            setSrsScheduleStatus('error');
          }
        }
      } catch (err) {
        console.error('Error recording CBT attempt or scheduling SRS:', err);
        setSrsScheduleStatus('error');
      }
    },
    [
      activeQuestions,
      calculateScore,
      sessionMode,
      awardXP,
      user,
      isAnswerMatch,
      userAnswers,
      selectedPaper,
      activeCourseId,
      totalAllocatedSeconds,
      timeLeftSeconds
    ]
  );

  // Countdown timer for Strict CBT Mode
  useEffect(() => {
    if (!isStarted || showResults || sessionMode !== 'cbt') return;
    if (timeLeftSeconds <= 0) {
      finalizeExamSession(true);
      return;
    }

    const timer = setInterval(() => {
      setTimeLeftSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isStarted, showResults, sessionMode, timeLeftSeconds, finalizeExamSession]);

  const startPaperSession = (paper: CBTExamAssessment) => {
    const qs = paper.questions || [];
    if (qs.length === 0) {
      toast.error('This CBT mock assessment has no questions.');
      return;
    }

    setSelectedPaper(paper);
    setActiveQuestions(qs);
    setUserAnswers({});
    setShowHints({});
    setSubmittedQuestions({});
    setEliminatedOptions({});
    setFlaggedQuestions({});
    setCurrentQuestionIndex(0);
    setShowResults(false);
    setShowSubmitConfirm(false);
    setShowPalette(false);
    setSrsScheduleStatus('idle');
    setScheduledSrsCount(0);
    hasFinalizedRef.current = false;
    sessionStartRef.current = Date.now();

    if (sessionMode === 'cbt') {
      const totalSecs = qs.length * secondsPerQuestion;
      setTotalAllocatedSeconds(totalSecs);
      setTimeLeftSeconds(totalSecs);
    } else {
      setTotalAllocatedSeconds(0);
      setTimeLeftSeconds(0);
    }

    setIsStarted(true);
  };

  const resetCbtSession = () => {
    setUserAnswers({});
    setShowHints({});
    setSubmittedQuestions({});
    setShowResults(false);
    setIsStarted(false);
    setEliminatedOptions({});
    setFlaggedQuestions({});
    setCurrentQuestionIndex(0);
    setShowSubmitConfirm(false);
    setShowPalette(false);
    setSrsScheduleStatus('idle');
    setScheduledSrsCount(0);
    hasFinalizedRef.current = false;
  };

  const handleCompileNewPaper = async () => {
    if (!activeCourseId || isCompilingPaper) return;
    if (!user) {
      toast.error('Please sign in to compile a Syllabus CBT Mock assessment.');
      return;
    }

    setIsCompilingPaper(true);
    const labelCount =
      compileQuestionCount === 'dynamic' ? 'dynamic syllabus-scaled' : `${compileQuestionCount}-question`;
    const toastId = toast.loading(
      `Compiling ${labelCount} CBT Assessment for ${activeCourseId}...`
    );
    try {
      const token = await user.getIdToken();
      const syllabusSummary = syllabus
        .map(
          (m, idx) =>
            `Unit ${idx + 1}: ${m.title} — ${(m.subTopics || []).map((s) => s.title).join(', ')}`
        )
        .join('\n');

      // Gather already-compiled questions for this course so the new CBT exam has 0 repeats
      const avoidQuestions = coursePapers
        .flatMap((p) => (p.questions || []).map((q) => q.question))
        .filter(Boolean)
        .slice(-50);

      // Gather weak topics from recent mistakes and user profile
      const weakTopics = Array.from(
        new Set([
          ...sessionMistakes.map((m) => m.topic),
          ...(profile?.learningProfile?.weaknesses || []),
          ...syllabus.flatMap((m) =>
            (m.subTopics || [])
              .filter((s) => getSkillLevel(s.id, s.title) <= 1)
              .map((s) => s.title)
          )
        ])
      ).slice(0, 8);

      const result = await safeFetchJson<{
        exam?: CBTExamAssessment;
        paper?: CBTExamAssessment;
        error?: string;
        details?: string;
      }>('/api/cbt/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          courseId: activeCourseId,
          courseTitle: activeCourseObj?.title || activeCourseId,
          syllabusSummary,
          questionCount: compileQuestionCount,
          semester: activeSemester,
          difficulty: compileDifficulty,
          weakTopics,
          avoidQuestions
        })
      });

      const compiledExam = result.data?.exam || result.data?.paper;
      if (!result.ok || !compiledExam) {
        throw new Error(
          result.error || result.data?.error || result.data?.details || 'Failed to compile CBT mock assessment'
        );
      }

      setAllPapers((prev) => [compiledExam, ...prev.filter((p) => p.id !== compiledExam.id)]);
      toast.success(`Compiled "${compiledExam.title}" (${compiledExam.questions.length} unseen questions)!`, {
        id: toastId
      });
      setSelectedPaper(compiledExam);
      setActiveQuestions(compiledExam.questions || []);
      setIsStarted(false);
    } catch (err: any) {
      console.error('Error compiling CBT assessment:', err);
      toast.error(err.message || 'Failed to compile CBT mock assessment from course syllabus.', {
        id: toastId
      });
    } finally {
      setIsCompilingPaper(false);
    }
  };

  const handleUseFiftyFifty = async (q: CBTExamQuestion) => {
    if (sessionMode === 'cbt' && !showResults) return;
    if (isUsingFiftyFifty[q.id] || eliminatedOptions[q.id]) return;

    const rawSparks = profile?.ai_sparks;
    const currentSparks = typeof rawSparks === 'number' && Number.isFinite(rawSparks) ? rawSparks : null;

    if (!isPremium && currentSparks !== null && currentSparks < 1) {
      toast.error('Insufficient sparks! Please upgrade or obtain more sparks.');
      setShowPricingModal(true);
      return;
    }

    setIsUsingFiftyFifty((prev) => ({ ...prev, [q.id]: true }));
    try {
      const token = await user?.getIdToken();
      const response = await fetch('/api/user/deduct-sparks-hint', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          courseId: activeCourseId || selectedPaper?.courseCode || null,
          moduleId: null,
          questionId: q?.id || null,
          questionText: q?.question || null
        })
      });

      const resData = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(resData.error || 'Failed to deduct spark for 50/50 lifeline');
      }

      const wrongOptions = q.options?.filter((opt) => opt !== q.correctAnswer) || [];
      if (wrongOptions.length <= 1) return;

      const shuffledWrongs = [...wrongOptions].sort(() => Math.random() - 0.5);
      const toEliminate = shuffledWrongs.slice(0, Math.min(2, wrongOptions.length - 1));
      setEliminatedOptions((prev) => ({ ...prev, [q.id]: toEliminate }));
      toast.success('50/50 lifeline activated!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to activate 50/50 lifeline.');
    } finally {
      setIsUsingFiftyFifty((prev) => ({ ...prev, [q.id]: false }));
    }
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const cleanUnitTitle = (raw: string) =>
    raw.replace(/^(Module|Unit)\s*\d+\s*[:.-]?\s*/i, '').trim() || raw;

  // ============================================================================
  // 1. FULL-SCREEN INTERACTIVE SKILL SESSION OVERLAY (CampusLearn Video Flow)
  // ============================================================================
  if (activeSkillSession) {
    const verifiedCorrectCount = Object.keys(completedExerciseMap).filter(
      (k) => completedExerciseMap[Number(k)]
    ).length;
    const isMasteryEarned = verifiedCorrectCount >= dynamicMasteryTarget;
    const progressPct = Math.min(100, Math.round((verifiedCorrectCount / Math.max(1, dynamicMasteryTarget)) * 100));
    const newLevel = getSkillLevel(activeSkillSession.skillId, activeSkillSession.skillTitle);
    const isCompletedScreen = isMasteryEarned && currentExIndex >= activeSkillSession.exercises.length;

    return (
      <div className="fixed inset-0 z-[70] bg-white dark:bg-zinc-950 flex flex-col overflow-hidden select-none">
        {/* Top Header Bar + Purple Progress Bar (No Prev/Next buttons, No 1/6) */}
        <div className="shrink-0 bg-white dark:bg-zinc-950 border-b border-slate-100 dark:border-zinc-800/80">
          <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
            <button
              onClick={() => setActiveSkillSession(null)}
              className="p-2 -ml-2 rounded-xl text-indigo-600 dark:text-indigo-400 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors"
              title="Exit Skill Session"
            >
              <X size={22} />
            </button>
            <h2 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base truncate flex-1">
              {activeSkillSession.skillTitle}
            </h2>

            {/* Dynamic Live Mastery Indicator (No 1/6 fraction) */}
            <div className="flex items-center gap-2 shrink-0">
              {isMasteryEarned ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                  <Trophy size={13} /> Mastery Reached!
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  <Sparkles size={12} className="text-indigo-600 dark:text-indigo-400" />
                  <span>Level {newLevel} Mastery</span>
                </span>
              )}
            </div>
          </div>
          <div className="w-full h-1.5 bg-slate-100 dark:bg-zinc-900">
            <div
              className="h-full bg-indigo-600 transition-all duration-500 rounded-r-full"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Continuous 1:1 Touch-Tracked Vertical Scroll-Snap Feed */}
        <div
          ref={feedContainerRef}
          onScroll={handleFeedScroll}
          className="flex-1 overflow-y-auto snap-y snap-mandatory h-full w-full no-scrollbar overscroll-y-contain"
        >
          {activeSkillSession.exercises.map((exercise, exIdx) => (
            <div
              key={exercise.id || exIdx}
              className="h-full w-full shrink-0 snap-start snap-always flex flex-col justify-start px-4 sm:px-6 pt-5 pb-28 overflow-y-auto max-w-2xl mx-auto"
            >
              {/* Exercise Header + Flag Icon + Subtle Horizontal Divider (Matches Video & Screenshot) */}
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/80 pb-3.5 mb-5">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  {exercise.type === 'match_pairs'
                    ? 'Match the pairs'
                    : exercise.type === 'highlight_mistake'
                    ? 'Highlight the mistake'
                    : exercise.type === 'concept_carousel'
                    ? 'Review the concept'
                    : exercise.type === 'concept_flashcard'
                    ? 'Check your knowledge'
                    : exercise.type === 'fill_blanks'
                    ? exercise.prompt || 'Fill in the blanks'
                    : exercise.type === 'explain_concept'
                    ? exercise.prompt || 'Explain the concept'
                    : exercise.prompt || 'Choose the correct answer'}
                </h3>
                <button
                  type="button"
                  onClick={() => toast('Question flagged for academic review.', { icon: '🚩' })}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
                  title="Report or flag this exercise"
                >
                  <Flag size={18} />
                </button>
              </div>

              {/* FORMAT 1: DYNAMIC SWIPEABLE CONCEPT CAROUSEL (6 to 10+ Cards, Video 00:11) */}
              {exercise.type === 'concept_carousel' && Array.isArray(exercise.cards) && (
                <div className="space-y-6">
                  <div
                    id={`carousel-container-${exIdx}`}
                    onScroll={(e) => {
                      const el = e.currentTarget;
                      if (el.clientWidth > 0) {
                        const idx = Math.round(el.scrollLeft / (el.clientWidth * 0.82));
                        setCarouselIndexMap((prev) => ({
                          ...prev,
                          [exIdx]: Math.max(0, Math.min(exercise.cards!.length - 1, idx))
                        }));
                      }
                    }}
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                    data-carousel="true"
                    className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 no-scrollbar touch-pan-x"
                  >
                    {exercise.cards.map((cardText, cIdx) => {
                      const isSpeaking = speakingText === cardText;
                      return (
                        <div
                          key={cIdx}
                          className="snap-start shrink-0 w-[85%] sm:w-[78%] min-h-[290px] sm:min-h-[320px] rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-900/90 p-6 sm:p-8 flex flex-col justify-between shadow-xs relative transition-all duration-200"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
                              {cIdx + 1} / {exercise.cards!.length}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleSpeechSynthesis(cardText)}
                              title={isSpeaking ? 'Stop listening' : 'Listen to card'}
                              className={`p-2 rounded-xl border transition-all ${
                                isSpeaking
                                  ? 'bg-indigo-600 text-white border-indigo-600 animate-pulse shadow-md'
                                  : 'border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-zinc-800'
                              }`}
                            >
                              {isSpeaking ? <VolumeX size={18} /> : <Volume2 size={18} />}
                            </button>
                          </div>
                          <div className="my-auto text-lg sm:text-xl font-medium text-slate-900 dark:text-white leading-relaxed">
                            <MarkdownInline content={cardText} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Carousel Dots + Arrows */}
                  <div className="flex items-center justify-between px-1">
                    <button
                      onClick={() => scrollCarouselCard(exIdx, (carouselIndexMap[exIdx] || 0) - 1)}
                      disabled={(carouselIndexMap[exIdx] || 0) === 0}
                      className="p-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 disabled:opacity-30"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <div className="flex items-center gap-1.5">
                      {exercise.cards.map((_, cIdx) => (
                        <button
                          key={cIdx}
                          onClick={() => scrollCarouselCard(exIdx, cIdx)}
                          className={`h-2 rounded-full transition-all ${
                            cIdx === (carouselIndexMap[exIdx] || 0)
                              ? 'w-6 bg-indigo-600'
                              : 'w-2 bg-slate-200 dark:bg-zinc-800'
                          }`}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => scrollCarouselCard(exIdx, (carouselIndexMap[exIdx] || 0) + 1)}
                      disabled={(carouselIndexMap[exIdx] || 0) >= exercise.cards.length - 1}
                      className="p-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 disabled:opacity-30"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>

                  {/* Needs practice / I know it buttons */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <button
                      onClick={() => handleCarouselDecision(true, exIdx, exercise)}
                      className="py-3.5 px-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 font-semibold text-sm hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                    >
                      Needs practice
                    </button>
                    <button
                      onClick={() => handleCarouselDecision(false, exIdx, exercise)}
                      className="py-3.5 px-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 font-semibold text-sm hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                    >
                      I know it
                    </button>
                  </div>
                </div>
              )}

              {/* FORMAT 1B: "CHECK YOUR KNOWLEDGE" TAP-TO-FLIP FLASHCARD (Matches Video 00:12) */}
              {exercise.type === 'concept_flashcard' && (
                <div className="space-y-6">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setFlippedFlashcardMap((prev) => ({
                        ...prev,
                        [exIdx]: !prev[exIdx]
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setFlippedFlashcardMap((prev) => ({
                          ...prev,
                          [exIdx]: !prev[exIdx]
                        }));
                      }
                    }}
                    className="w-full min-h-[340px] sm:min-h-[370px] rounded-2xl border border-slate-200/90 dark:border-zinc-800 bg-stone-50/80 dark:bg-zinc-900/90 p-5 sm:p-7 flex flex-col justify-between cursor-pointer shadow-xs hover:border-slate-300 dark:hover:border-zinc-700 transition-all"
                  >
                    {/* Visual / Formula Dark Banner Box (Matches Video 00:12 Top Graphic) */}
                    <div className="w-full rounded-xl bg-zinc-900 dark:bg-black text-white p-5 sm:p-6 text-center space-y-2 shadow-inner">
                      {exercise.frontTitle && (
                        <div className="text-sm sm:text-base font-extrabold tracking-wide text-amber-300">
                          <MarkdownInline content={exercise.frontTitle} />
                        </div>
                      )}
                      {exercise.frontFormulaOrVisual && (
                        <div className="text-xs sm:text-sm text-zinc-200 font-medium leading-relaxed">
                          <MarkdownInline content={exercise.frontFormulaOrVisual} />
                        </div>
                      )}
                    </div>

                    {/* Question or Flipped Back Answer */}
                    <div className="my-auto py-6 text-center px-2">
                      {!flippedFlashcardMap[exIdx] ? (
                        <div className="text-lg sm:text-xl font-medium text-slate-900 dark:text-white leading-relaxed">
                          <MarkdownInline
                            content={
                              exercise.question ||
                              `What is the core academic principle behind ${activeSkillSession.skillTitle}?`
                            }
                          />
                        </div>
                      ) : (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-2 text-left bg-white dark:bg-zinc-950/90 p-4 sm:p-5 rounded-xl border border-emerald-200 dark:border-emerald-900/60"
                        >
                          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                            Verified Answer
                          </div>
                          <div className="text-base sm:text-lg font-medium text-slate-900 dark:text-white leading-relaxed">
                            <MarkdownInline content={exercise.backAnswer || exercise.learnMore || ''} />
                          </div>
                        </motion.div>
                      )}
                    </div>

                    <div className="text-center text-xs sm:text-sm font-medium text-slate-400 dark:text-zinc-500">
                      {flippedFlashcardMap[exIdx] ? 'Tap to flip back to question' : 'Tap to flip'}
                    </div>
                  </div>

                  {/* Needs practice / I know it buttons (Matches Video 00:12) */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                      onClick={() => handleFlashcardDecision(true, exIdx, exercise)}
                      className="py-3.5 px-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 font-semibold text-sm hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                    >
                      Needs practice
                    </button>
                    <button
                      onClick={() => handleFlashcardDecision(false, exIdx, exercise)}
                      className="py-3.5 px-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 font-semibold text-sm hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                    >
                      I know it
                    </button>
                  </div>
                </div>
              )}

              {/* FORMAT 2: INTERACTIVE COLOR-CODED MATCH THE PAIRS (Matches Screenshot) */}
              {exercise.type === 'match_pairs' && Array.isArray(exercise.pairs) && (
                <div className="space-y-6">
                  {/* Dynamic Sub-Instruction with Bold Category Terms */}
                  <div className="text-sm sm:text-base text-slate-800 dark:text-zinc-200 leading-relaxed">
                    <MarkdownInline
                      content={
                        exercise.instruction ||
                        exercise.question ||
                        (exercise.prompt &&
                        exercise.prompt.trim().toLowerCase() !== 'match the pairs'
                          ? exercise.prompt
                          : `Match the following **${activeSkillSession.skillTitle}** terms with their corresponding **definitions or units**`)
                      }
                    />
                  </div>

                  {/* Two Columns Separated by Subtle Center Vertical Divider */}
                  <div className="grid grid-cols-[1fr_1px_1fr] gap-3 sm:gap-5 items-stretch">
                    {/* Left Column */}
                    <div className="space-y-3.5">
                      {exercise.pairs.map((pair, leftIdx) => {
                        const isMatched = (matchedPairsMap[exIdx] || []).includes(pair.id);
                        const isSelected = selectedLeftPairMap[exIdx] === pair.id;
                        const matchedColorClass =
                          MATCH_PAIR_COLOR_CLASSES[leftIdx % MATCH_PAIR_COLOR_CLASSES.length];

                        return (
                          <button
                            key={pair.id}
                            disabled={isMatched}
                            onClick={() => handleSelectLeftPair(exIdx, pair.id)}
                            className={`w-full min-h-[64px] sm:min-h-[68px] px-4 py-3.5 rounded-2xl border text-center flex items-center justify-center transition-all text-sm sm:text-base font-medium ${
                              isMatched
                                ? matchedColorClass
                                : isSelected
                                ? 'bg-white dark:bg-zinc-900 border-2 border-slate-900 dark:border-white text-slate-900 dark:text-white shadow-sm'
                                : 'bg-[#F3F2EE] dark:bg-zinc-900 border-transparent dark:border-zinc-800 text-slate-800 dark:text-zinc-200 hover:border-slate-300 dark:hover:border-zinc-700'
                            }`}
                          >
                            <MarkdownInline content={pair.left} />
                          </button>
                        );
                      })}
                    </div>

                    {/* Center Vertical Divider Line */}
                    <div className="w-px bg-slate-200/90 dark:bg-zinc-800 my-2 shrink-0" />

                    {/* Right Column */}
                    <div className="space-y-3.5">
                      {(shuffledRightPairsMap[exIdx] || exercise.pairs || []).map((pair) => {
                        const isMatched = (matchedPairsMap[exIdx] || []).includes(pair.id);
                        const isWrong = wrongPairFlashMap[exIdx] === pair.id;
                        const originalLeftIdx = Math.max(
                          0,
                          exercise.pairs!.findIndex((p) => p.id === pair.id)
                        );
                        const matchedColorClass =
                          MATCH_PAIR_COLOR_CLASSES[originalLeftIdx % MATCH_PAIR_COLOR_CLASSES.length];

                        return (
                          <button
                            key={pair.id}
                            disabled={isMatched}
                            onClick={() => handleSelectRightPair(exIdx, pair, exercise)}
                            className={`w-full min-h-[64px] sm:min-h-[68px] px-4 py-3.5 rounded-2xl border text-center flex items-center justify-center transition-all text-sm sm:text-base font-medium ${
                              isMatched
                                ? matchedColorClass
                                : isWrong
                                ? 'bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-500 text-rose-700 dark:text-rose-300'
                                : 'bg-[#F3F2EE] dark:bg-zinc-900 border-transparent dark:border-zinc-800 text-slate-800 dark:text-zinc-200 hover:border-slate-300 dark:hover:border-zinc-700'
                            }`}
                          >
                            <MarkdownInline content={pair.right} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* FORMAT 3: SMART-RETRY MULTIPLE CHOICE */}
              {exercise.type === 'smart_mcq' && Array.isArray(exercise.options) && (
                <div className="space-y-6">
                  <div className="text-base sm:text-lg text-slate-800 dark:text-zinc-100 leading-relaxed">
                    <MarkdownInline content={exercise.question || ''} />
                  </div>

                  <div className="space-y-3">
                    {exercise.options.map((opt, optIdx) => {
                      const isSelected = selectedMcqMap[exIdx] === optIdx;
                      const wasWrong = (triedWrongMcqMap[exIdx] || []).includes(optIdx);
                      const showGreen = isSelected && opt.isCorrect;
                      const showRed = (isSelected && !opt.isCorrect) || wasWrong;

                      return (
                        <button
                          key={optIdx}
                          onClick={() => handleSelectSmartMcqOption(exIdx, opt, optIdx, exercise)}
                          className={`w-full p-4 rounded-2xl border text-left flex items-start gap-3.5 transition-all ${
                            showGreen
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-500 text-emerald-950 dark:text-emerald-200 font-medium'
                              : showRed
                              ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-400 dark:border-rose-900 text-slate-600 dark:text-zinc-400'
                              : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 hover:border-slate-400 dark:hover:border-zinc-700 text-slate-800 dark:text-zinc-200'
                          }`}
                        >
                          <div
                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                              showGreen
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : showRed
                                ? 'bg-rose-500 border-rose-500 text-white'
                                : 'border-slate-300 dark:border-zinc-700'
                            }`}
                          >
                            {showGreen && <Check size={14} />}
                            {showRed && <X size={14} />}
                          </div>
                          <div className="flex-1 text-sm sm:text-base">
                            <MarkdownInline content={opt.text} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* FORMAT 4: WORD-BANK FILL IN THE BLANKS */}
              {exercise.type === 'fill_blanks' && (
                <div className="space-y-6">
                  <div className="p-5 rounded-2xl bg-slate-50 dark:bg-zinc-900/70 border border-slate-200 dark:border-zinc-800 text-base sm:text-lg text-slate-800 dark:text-zinc-100 leading-loose">
                    {(() => {
                      const raw = exercise.sentenceWithBlanks || '';
                      const parts = raw.split('___BLANK___');
                      const blanks = filledBlanksMap[exIdx] || [];
                      const checked = blanksCheckedMap[exIdx];

                      return parts.map((segment, bIdx) => (
                        <React.Fragment key={bIdx}>
                          <span className="inline">
                            <ReactMarkdown
                              components={{ p: ({ children }) => <span>{children}</span> }}
                              remarkPlugins={[remarkMath]}
                              rehypePlugins={[rehypeKatex]}
                            >
                              {segment}
                            </ReactMarkdown>
                          </span>
                          {bIdx < parts.length - 1 && (() => {
                            const filledValue = blanks[bIdx];
                            const correctAnswer = exercise.correctBlanks?.[bIdx];
                            const isFilled = Boolean(filledValue);
                            const isCorrect =
                              isFilled &&
                              Boolean(correctAnswer) &&
                              (filledValue || '').trim().toLowerCase() === correctAnswer!.trim().toLowerCase();

                            let slotStyle =
                              'bg-white dark:bg-zinc-900 border-dashed border-2 border-slate-300 dark:border-zinc-700 text-slate-400';
                            if (checked && isFilled) {
                              if (isCorrect) {
                                slotStyle =
                                  'bg-emerald-50 dark:bg-emerald-950/60 border-solid border-2 border-emerald-500 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/20';
                              } else {
                                slotStyle =
                                  'bg-rose-50 dark:bg-rose-950/60 border-solid border-2 border-rose-500 text-rose-700 dark:text-rose-300 ring-2 ring-rose-500/20';
                              }
                            } else if (isFilled) {
                              slotStyle =
                                'bg-indigo-50 dark:bg-indigo-950/50 border-solid border-2 border-indigo-600 text-indigo-700 dark:text-indigo-300';
                            }

                            return (
                              <button
                                type="button"
                                onClick={() => handleClearBlankSlot(exIdx, bIdx)}
                                title={isFilled ? 'Tap to clear' : undefined}
                                className={`inline-flex items-center justify-center min-w-[110px] mx-1.5 px-3 py-1 rounded-xl font-bold text-sm transition-all shadow-xs ${slotStyle}`}
                              >
                                {isFilled ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <ReactMarkdown
                                      components={{ p: ({ children }) => <span>{children}</span> }}
                                      remarkPlugins={[remarkMath]}
                                      rehypePlugins={[rehypeKatex]}
                                    >
                                      {formatMathToken(filledValue!)}
                                    </ReactMarkdown>
                                    {checked && (
                                      isCorrect ? (
                                        <Check size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                      ) : (
                                        <X size={14} className="text-rose-600 dark:text-rose-400 shrink-0" />
                                      )
                                    )}
                                  </span>
                                ) : (
                                  '_______'
                                )}
                              </button>
                            );
                          })()}
                        </React.Fragment>
                      ));
                    })()}
                  </div>

                  {/* Tappable Word Bank Chips */}
                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                    {(exercise.wordBank || []).map((word, wIdx) => {
                      const currentFilled = filledBlanksMap[exIdx] || [];
                      const isUsed = currentFilled.includes(word);
                      return (
                        <button
                          key={`${word}_${wIdx}`}
                          disabled={isUsed || revealedBlanksMap[exIdx]}
                          onClick={() => handleTapWordChip(exIdx, word)}
                          className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                            isUsed
                              ? 'border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 text-transparent select-none pointer-events-none'
                              : 'border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-200 hover:border-indigo-500 shadow-xs active:scale-95'
                          }`}
                        >
                          <ReactMarkdown
                            components={{ p: ({ children }) => <span>{children}</span> }}
                            remarkPlugins={[remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                          >
                            {formatMathToken(word)}
                          </ReactMarkdown>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* FORMAT 5: VOICE / TEXT EXPLAIN THE CONCEPT */}
              {exercise.type === 'explain_concept' && (
                <div className="space-y-5">
                  <div className="text-base sm:text-lg text-slate-800 dark:text-zinc-100 leading-relaxed">
                    <MarkdownInline content={exercise.question || ''} />
                  </div>

                  <div className="relative rounded-2xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 focus-within:border-indigo-600 transition-colors">
                    <textarea
                      rows={4}
                      value={explanationInputMap[exIdx] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setExplanationInputMap((prev) => ({ ...prev, [exIdx]: val }));
                      }}
                      placeholder="Type or tap the mic to answer"
                      className="w-full pr-14 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 text-sm sm:text-base focus:outline-none resize-none"
                    />
                    <button
                      type="button"
                      onClick={() => toggleVoiceDictation(exIdx)}
                      title={isListeningMic ? 'Stop listening' : 'Tap to speak your explanation'}
                      className={`w-11 h-11 rounded-full flex items-center justify-center absolute right-3 bottom-3 transition-all shadow-md ${
                        isListeningMic
                          ? 'bg-rose-600 text-white animate-pulse'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      }`}
                    >
                      {isListeningMic ? <MicOff size={20} /> : <Mic size={20} />}
                    </button>
                  </div>

                  <button
                    onClick={() => handleSubmitExplanation(exIdx, exercise)}
                    disabled={!(explanationInputMap[exIdx] || '').trim() || isEvaluatingMap[exIdx]}
                    className="w-full py-3.5 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-zinc-800 disabled:text-slate-400 text-white font-bold text-sm transition-colors"
                  >
                    {isEvaluatingMap[exIdx] ? 'Evaluating your explanation...' : 'Submit response'}
                  </button>
                </div>
              )}

              {/* FORMAT 6: HIGHLIGHT THE MISTAKE (NATURAL PARAGRAPH + CONTIGUOUS WORD SCRUB, Video 00:00-00:09 & 00:13-00:25) */}
              {exercise.type === 'highlight_mistake' &&
                (() => {
                  const analyzed = analyzeHighlightPassage(
                    exercise.passage || '',
                    exercise.mistakeTarget,
                    exercise.instruction
                  );
                  const currentRange = highlightRangeMap[exIdx] || null;
                  const status = highlightStatusMap[exIdx] || 'idle';

                  return (
                    <div
                      className="space-y-8 pt-1"
                      onPointerUp={() => handlePassagePointerUp(exIdx, analyzed, exercise)}
                      onPointerCancel={() => handlePassagePointerUp(exIdx, analyzed, exercise)}
                      onTouchMove={(e) => handlePassageTouchMove(exIdx, e)}
                      onTouchEnd={() => handlePassagePointerUp(exIdx, analyzed, exercise)}
                    >
                      {/* Natural flowing paragraph with zero button borders around words (Matches Video 00:00) */}
                      <p className="text-base sm:text-[19px] leading-[1.85] text-slate-900 dark:text-zinc-100 select-none touch-none tracking-[-0.005em]">
                        {analyzed.words.map((w, idx) => {
                          const isSelected =
                            currentRange !== null &&
                            idx >= currentRange.start &&
                            idx <= currentRange.end;
                          const isPrevSelected =
                            currentRange !== null &&
                            idx - 1 >= currentRange.start &&
                            idx - 1 <= currentRange.end;
                          const isNextSelected =
                            currentRange !== null &&
                            idx + 1 >= currentRange.start &&
                            idx + 1 <= currentRange.end;

                          const isCorrectHighlight = isSelected && status === 'correct';
                          const isSkyBlueHighlight =
                            isSelected && (status === 'selecting' || status === 'wrong');

                          let wordHighlightClass =
                            'cursor-pointer transition-colors duration-100 py-0.5 ';
                          if (isCorrectHighlight) {
                            wordHighlightClass +=
                              'bg-emerald-300/85 dark:bg-emerald-500/45 text-slate-950 dark:text-white ';
                          } else if (isSkyBlueHighlight) {
                            wordHighlightClass +=
                              'bg-sky-200/95 dark:bg-sky-500/40 text-slate-950 dark:text-white ';
                          } else {
                            wordHighlightClass +=
                              'hover:bg-sky-100/60 dark:hover:bg-sky-900/30 ';
                          }

                          if (isSelected) {
                            if (!isPrevSelected && !isNextSelected) {
                              wordHighlightClass += 'rounded-md px-1 -mx-0.5';
                            } else if (!isPrevSelected && isNextSelected) {
                              wordHighlightClass += 'rounded-l-md pl-1';
                            } else if (isPrevSelected && !isNextSelected) {
                              wordHighlightClass += 'rounded-r-md pr-1';
                            }
                          } else {
                            wordHighlightClass += 'rounded-xs';
                          }

                          const spaceHighlightClass =
                            isSelected && isNextSelected
                              ? isCorrectHighlight
                                ? 'bg-emerald-300/85 dark:bg-emerald-500/45 py-0.5'
                                : 'bg-sky-200/95 dark:bg-sky-500/40 py-0.5'
                              : '';

                          return (
                            <React.Fragment key={w.index}>
                              <span
                                data-highlight-word-idx={w.index}
                                onPointerDown={(e) => {
                                  if (e.button !== undefined && e.button !== 0) return;
                                  handleWordPointerDown(exIdx, w.index, analyzed);
                                }}
                                onPointerEnter={() => handleWordPointerEnter(exIdx, w.index)}
                                className={wordHighlightClass}
                              >
                                <MarkdownWordSpan content={w.text} />
                              </span>
                              {idx < analyzed.words.length - 1 && (
                                <span className={spaceHighlightClass}> </span>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </p>

                      {/* Dynamic Muted-Gray Instruction BELOW the Paragraph (Matches Video 00:00 & 00:13) */}
                      <p className="text-sm sm:text-base text-slate-500 dark:text-zinc-400 text-center font-normal pt-2">
                        {analyzed.dynamicInstruction}
                      </p>
                    </div>
                  );
                })()}
            </div>
          ))}

          {/* FINAL SNAP CARD: TROPHY LEVEL-UP CELEBRATION (Rendered only when student genuinely earns mastery) */}
          {isMasteryEarned && (
            <div
              key="celebration-screen"
              className="h-full w-full shrink-0 snap-start snap-always flex flex-col items-center justify-center p-6 overflow-y-auto select-none max-w-lg mx-auto"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 text-center shadow-xl space-y-6"
              >
                <div className="w-20 h-20 rounded-3xl bg-amber-100 dark:bg-amber-900/30 text-amber-500 flex items-center justify-center mx-auto shadow-inner">
                  <Trophy size={42} />
                </div>
                <div className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                    <Sparkles size={14} /> Skill Level {newLevel} Reached!
                  </span>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                    {activeSkillSession.skillTitle}
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-zinc-400">
                    You demonstrated mastery across {dynamicMasteryTarget} adaptive exercises and earned +60 XP toward your next course trophy.
                  </p>
                </div>

                {sessionMistakes.length > 0 && (
                  <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 text-left flex items-start gap-3">
                    <Brain className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" size={18} />
                    <div className="text-xs text-indigo-900 dark:text-indigo-200 leading-relaxed">
                      <strong>{sessionMistakes.length} concept(s)</strong> from this session were automatically scheduled into your Spaced Repetition deck for review.
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 pt-2">
                  {nextSubTopic && (
                    <button
                      onClick={() =>
                        handleStartSkillSession(
                          nextSubTopic.module.id,
                          cleanUnitTitle(nextSubTopic.module.title),
                          nextSubTopic.subTopic.id,
                          nextSubTopic.subTopic.title,
                          nextSubTopic.subTopic.content
                        )
                      }
                      className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition-colors shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
                    >
                      <span>Next Subtopic: {nextSubTopic.subTopic.title}</span>
                      <ChevronRight size={16} />
                    </button>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() =>
                        handleStartSkillSession(
                          activeSkillSession.moduleId,
                          '',
                          activeSkillSession.skillId,
                          activeSkillSession.skillTitle,
                          '',
                          true
                        )
                      }
                      className="flex-1 py-3 px-4 rounded-2xl border border-slate-200 dark:border-zinc-700 font-bold text-sm text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      Practice Again (Fresh Unseen Set)
                    </button>
                    <button
                      onClick={() => setActiveSkillSession(null)}
                      className="flex-1 py-3 px-4 rounded-2xl border border-slate-200 dark:border-zinc-700 font-bold text-sm text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      Skill Tree
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {/* DYNAMIC LOADING SHIMMER CARD (While generating next practice question from lesson content) */}
          {isFetchingNextExercise && !isMasteryEarned && (
            <div
              key="dynamic-loading-card"
              className="h-full w-full shrink-0 snap-start snap-always flex flex-col items-center justify-center p-6 text-center space-y-4 max-w-lg mx-auto"
            >
              <div className="w-14 h-14 rounded-3xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center animate-pulse shadow-sm">
                <Sparkles size={26} />
              </div>
              <div className="space-y-1.5">
                <h4 className="font-bold text-slate-800 dark:text-zinc-200 text-base">Generating next lesson practice...</h4>
                <p className="text-xs text-slate-400 dark:text-zinc-500 max-w-xs mx-auto">
                  UniAce AI is synthesizing a new adaptive exercise from the authoritative lesson content.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* FLOATING BOTTOM ACTION DOCK (Learn | Hint | Reveal | Submit - NO Prev/Next) */}
        {!isCompletedScreen && activeExercise && (
          <div className="fixed bottom-5 left-0 right-0 z-30 flex flex-col items-center gap-2 px-4 pointer-events-none pb-safe">
            <div className="pointer-events-auto inline-flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-xl">
              <button
                onClick={() => setShowLearnModal(true)}
                className="flex flex-col items-center justify-center min-w-[58px] py-1.5 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <BookOpen size={18} className="text-purple-700 dark:text-purple-400 mb-0.5" />
                <span className="text-[11px] font-bold text-purple-800 dark:text-purple-300">Learn</span>
              </button>

              {activeExercise.type !== 'concept_carousel' &&
                activeExercise.type !== 'concept_flashcard' &&
                activeExercise.type !== 'fill_blanks' && (
                  <button
                    onClick={() => setShowHintSheet(true)}
                    className="flex flex-col items-center justify-center min-w-[58px] py-1.5 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors border-l border-slate-100 dark:border-zinc-800"
                  >
                    <Lightbulb size={18} className="text-emerald-600 dark:text-emerald-400 mb-0.5" />
                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Hint</span>
                  </button>
                )}

              {activeExercise.type === 'highlight_mistake' && (
                <button
                  onClick={() => handleRevealHighlightMistake(currentExIndex, activeExercise)}
                  className="flex flex-col items-center justify-center min-w-[58px] py-1.5 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors border-l border-slate-100 dark:border-zinc-800"
                >
                  <Eye size={18} className="text-sky-600 dark:text-sky-400 mb-0.5" />
                  <span className="text-[11px] font-bold text-sky-700 dark:text-sky-300">Reveal</span>
                </button>
              )}

              {activeExercise.type === 'fill_blanks' && (
                <>
                  <button
                    onClick={() => handleRevealBlanks(currentExIndex)}
                    className="flex flex-col items-center justify-center min-w-[58px] py-1.5 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors border-l border-slate-100 dark:border-zinc-800"
                  >
                    <Eye size={18} className="text-sky-600 dark:text-sky-400 mb-0.5" />
                    <span className="text-[11px] font-bold text-sky-700 dark:text-sky-300">Reveal</span>
                  </button>
                  <button
                    onClick={() => handleSubmitBlanks(currentExIndex)}
                    className="flex flex-col items-center justify-center min-w-[58px] py-1.5 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors border-l border-slate-100 dark:border-zinc-800"
                  >
                    <Check size={18} className="text-emerald-600 dark:text-emerald-400 mb-0.5" />
                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                      Submit
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* SLIDE-UP SOCRATIC HINT BOTTOM SHEET (matches Video 0:08 & 0:37-0:41) */}
        <AnimatePresence>
          {showHintSheet && activeExercise && (
            <motion.div
              initial={{ opacity: 0, y: 80 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 80 }}
              className="fixed inset-x-0 bottom-0 z-40 p-4 sm:p-6 flex justify-center bg-black/20 backdrop-blur-xs"
            >
              <div className="max-w-lg w-full rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-6 shadow-2xl space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-lg">
                    <Lightbulb size={20} />
                    <span>Here's a hint!</span>
                  </div>
                  <button
                    onClick={() => setShowHintSheet(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="text-sm sm:text-base text-slate-700 dark:text-zinc-200 leading-relaxed">
                  <MarkdownInline
                    content={
                      activeExercise.hint ||
                      activeExercise.learnMore ||
                      'Break the statement down into its core variables and check how the input affects the output.'
                    }
                  />
                </div>
                <button
                  onClick={() => setShowHintSheet(false)}
                  className="w-full py-3.5 rounded-full border border-slate-300 dark:border-zinc-700 font-bold text-sm text-slate-800 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* SLIDE-UP "CORRECT!" / "NOT QUITE" FEEDBACK BOTTOM SHEET (Matches Screenshot & Video) */}
        <AnimatePresence>
          {feedbackSheet && (
            <motion.div
              initial={{ opacity: 0, y: 80 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 80 }}
              className="fixed inset-x-0 bottom-0 z-[80] p-4 sm:p-6 pb-safe flex justify-center bg-black/15 backdrop-blur-[1px]"
            >
              <div
                className={`max-w-lg w-full rounded-3xl border p-6 sm:p-7 shadow-2xl space-y-5 ${
                  feedbackSheet.type === 'correct'
                    ? 'bg-[#F4FAF7] dark:bg-zinc-900 border-[#D0E8DD] dark:border-emerald-700'
                    : 'bg-[#FDF6F6] dark:bg-zinc-900 border-[#F3D2D2] dark:border-rose-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h4
                    className={`text-lg sm:text-xl font-extrabold ${
                      feedbackSheet.type === 'correct'
                        ? 'text-[#009959] dark:text-emerald-400'
                        : 'text-[#E5484D] dark:text-rose-400'
                    }`}
                  >
                    {feedbackSheet.title}
                  </h4>
                  <button
                    onClick={() => setFeedbackSheet(null)}
                    className={`p-1 rounded-lg transition-colors ${
                      feedbackSheet.type === 'correct'
                        ? 'text-[#009959] hover:bg-emerald-100/60 dark:text-emerald-400'
                        : 'text-[#E5484D] hover:bg-rose-100/60 dark:text-rose-400'
                    }`}
                  >
                    <X size={22} />
                  </button>
                </div>

                {feedbackSheet.message && feedbackSheet.message.trim().length > 0 && (
                  <div
                    className={`text-sm sm:text-base font-medium leading-relaxed max-h-[35vh] overflow-y-auto ${
                      feedbackSheet.type === 'correct'
                        ? 'text-[#008A50] dark:text-emerald-200'
                        : 'text-[#C6373C] dark:text-rose-200'
                    }`}
                  >
                    <MarkdownInline content={feedbackSheet.message} />
                  </div>
                )}

                {/* Stacked Full-Width Pill Buttons: "Learn more" (outlined) on top, "Continue" (solid) below (Matches Screenshot & Video) */}
                <div className="space-y-3 pt-2">
                  <button
                    onClick={() => setShowLearnModal(true)}
                    className={`w-full py-3.5 rounded-full border font-bold text-sm sm:text-base transition-colors ${
                      feedbackSheet.type === 'correct'
                        ? 'border-[#009959]/60 text-[#008A50] dark:text-emerald-300 hover:bg-emerald-100/50 dark:hover:bg-emerald-950/40'
                        : 'border-[#E5484D]/60 text-[#C6373C] dark:text-rose-300 hover:bg-rose-100/50 dark:hover:bg-rose-950/40'
                    }`}
                  >
                    Learn more
                  </button>

                  {feedbackSheet.canAdvance ? (
                    <button
                      onClick={handleAdvanceSkillExercise}
                      className="w-full py-3.5 rounded-full bg-[#00A35C] hover:bg-[#008F50] text-white font-bold text-sm sm:text-base transition-colors shadow-xs"
                    >
                      Continue
                    </button>
                  ) : (
                    <button
                      onClick={() => setFeedbackSheet(null)}
                      className="w-full py-3.5 rounded-full bg-[#EB5757] hover:bg-[#D94646] text-white font-bold text-sm sm:text-base transition-colors shadow-xs"
                    >
                      Continue
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* LEARN SUMMARY MODAL */}
        <AnimatePresence>
          {showLearnModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
            >
              <div className="max-w-xl w-full max-h-[82vh] overflow-y-auto rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-6 sm:p-8 shadow-2xl space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                      <BookOpen size={20} />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                        Concept Deep-Dive
                      </span>
                      <h3 className="font-bold text-slate-900 dark:text-white text-base sm:text-lg">
                        {activeSkillSession.skillTitle}
                      </h3>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowLearnModal(false)}
                    className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="text-sm sm:text-base text-slate-700 dark:text-zinc-200 leading-relaxed space-y-4">
                  <MarkdownInline content={activeSkillSession.learnSummary} />
                  {activeExercise?.learnMore && (
                    <div className="p-4 rounded-2xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200/60 dark:border-purple-800/40">
                      <MarkdownInline content={activeExercise.learnMore} />
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setShowLearnModal(false)}
                  className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition-colors"
                >
                  Back to Exercise
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ============================================================================
  // 2. MAIN SKILL MASTERY + CBT PRACTICE HUB VIEW
  // ============================================================================
  return (
    <div className="w-full min-w-0 max-w-4xl mx-auto space-y-6 pb-28 px-3 sm:px-6 overflow-x-hidden">
      {/* Course Header + Trophy Progress Card (matches Video 1 0:00-0:03) */}
      <div className="w-full min-w-0 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-4 sm:p-7 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              <GraduationCap size={15} />
              <span>Skill Mastery & CBT Practice Hub</span>
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight truncate">
              {activeCourseObj?.title || activeCourseId}
            </h1>
          </div>

          {/* Course Switcher */}
          {availableCourses.length > 0 && (
            <div className="w-full sm:w-auto min-w-0 shrink-0">
              <select
                value={activeCourseId || ''}
                onChange={(e) => handleCourseChange(e.target.value as CourseId)}
                className="w-full sm:w-auto max-w-full sm:max-w-xs truncate px-3 sm:px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-xs sm:text-sm font-bold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {availableCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} — {(c.title || c.id).replace(/^[^:]+:\s*/, '')}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Trophy Level-Up Progress Bar (matches Video 1 top bar) */}
        <div className="p-3.5 sm:p-5 rounded-2xl bg-slate-50 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800 space-y-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-500 flex items-center justify-center shrink-0">
              <Trophy size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="h-2.5 sm:h-3 w-full bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-500 rounded-full"
                  style={{ width: `${Math.max(8, trophyProgressPercent)}%` }}
                />
              </div>
            </div>
            <span className="text-[11px] sm:text-xs font-extrabold text-slate-700 dark:text-zinc-300 shrink-0">
              {leveledUpSkillsCount}/{totalSkillsCount || 1} Skills
            </span>
          </div>
          <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-zinc-400 pl-0 sm:pl-11">
            Level up skills to next trophy · Practice bite-sized concepts or take a timed syllabus CBT mock
          </p>
        </div>

        {/* 3-Tab Switcher: Skills | CBT Mock | Cheat Sheet */}
        <div className="flex items-center gap-4 sm:gap-6 border-b border-slate-200 dark:border-zinc-800 pt-1 overflow-x-auto scrollbar-none">
          {[
            { id: 'skills' as HubTab, label: 'Skills', icon: Layers },
            { id: 'cbt' as HubTab, label: 'CBT Mock', icon: Timer },
            { id: 'cheatsheet' as HubTab, label: 'Cheat Sheet', icon: BookOpen }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-3 px-1 flex items-center gap-2 text-xs sm:text-sm font-bold border-b-2 transition-all whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================
          TAB 1: SKILLS TREE (CampusLearn Unit & Skill Mastery List)
         ======================================================================== */}
      {activeTab === 'skills' && (
        <div className="space-y-6">
          {syllabus.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 sm:p-10 text-center space-y-3">
              <Layers className="mx-auto text-slate-400" size={36} />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                No syllabus units found for {activeCourseId}
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400 max-w-md mx-auto">
                Switch to the CBT Mock tab to compile a syllabus examination assessment or select another course above.
              </p>
            </div>
          ) : (
            syllabus.map((module, unitIdx) => {
              const unitTitle = cleanUnitTitle(module.title);
              const subTopics = module.subTopics || [];

              return (
                <div
                  key={module.id}
                  className="w-full min-w-0 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-4 sm:p-7 shadow-xs space-y-4"
                >
                  <div className="space-y-1 border-b border-slate-100 dark:border-zinc-800 pb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                      Unit {unitIdx + 1}
                    </span>
                    <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 dark:text-white break-words">
                      {unitTitle}
                    </h2>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-zinc-800/70">
                    {subTopics.map((sub) => {
                      const lvl = getSkillLevel(sub.id, sub.title);
                      const isBuilding = isGeneratingSkill === sub.id;

                      return (
                        <div
                          key={sub.id}
                          className="py-3.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3 min-w-0"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* Skill Level Badge (1, 2, 3 — matches Video 1) */}
                            <div
                              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center font-extrabold text-xs shrink-0 border ${
                                lvl >= 3
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                                  : lvl === 2
                                  ? 'bg-amber-100 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                                  : 'bg-orange-100/80 dark:bg-orange-950/40 border-orange-200 dark:border-orange-900/50 text-orange-800 dark:text-orange-300'
                              }`}
                              title={`Skill Mastery Level ${lvl}`}
                            >
                              {lvl}
                            </div>

                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm md:text-base truncate">
                                {sub.title}
                              </h3>
                              <p className="text-[11px] sm:text-xs text-slate-400 dark:text-zinc-500 truncate">
                                Concept carousel · Flashcard flip · Highlight mistake · Match pairs · Smart MCQ · Fill blanks
                              </p>
                            </div>
                          </div>

                          <button
                            onClick={() =>
                              handleStartSkillSession(
                                module.id,
                                unitTitle,
                                sub.id,
                                sub.title,
                                sub.content
                              )
                            }
                            disabled={Boolean(isGeneratingSkill)}
                            className="shrink-0 px-3 sm:px-4 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs sm:text-sm transition-all flex items-center gap-1 disabled:opacity-50"
                          >
                            {isBuilding ? (
                              <>
                                <RefreshCw size={13} className="animate-spin" />
                                <span>Loading...</span>
                              </>
                            ) : (
                              <>
                                <span>Practice</span>
                                <ChevronRight size={14} />
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ========================================================================
          TAB 2: TIMED CBT MOCK EXAM SIMULATOR
         ======================================================================== */}
      {activeTab === 'cbt' && (
        <div className="space-y-6">
          {!isStarted ? (
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-zinc-800 pb-6">
                <div className="space-y-1">
                  <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                    Syllabus CBT Mock Simulator
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400">
                    Simulate strict university CBT examination conditions or practice question-by-question with instant solutions.
                  </p>
                </div>

                {/* Mode Switcher: Strict CBT vs Practice */}
                <div className="inline-flex p-1 rounded-2xl bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 self-start">
                  <button
                    onClick={() => setSessionMode('cbt')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                      sessionMode === 'cbt'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-zinc-400'
                    }`}
                  >
                    <Timer size={14} />
                    <span>Timed CBT Mode</span>
                  </button>
                  <button
                    onClick={() => setSessionMode('practice')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                      sessionMode === 'practice'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-zinc-400'
                    }`}
                  >
                    <BookOpen size={14} />
                    <span>Study Mode</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Syllabus CBT Compiler Bar */}
              <div className="p-5 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/25 border border-indigo-200/70 dark:border-indigo-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold text-sm">
                    <Sparkles size={16} />
                    <span>Compile Dynamic Syllabus CBT Assessment</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-zinc-400">
                    Dynamically scales question count to your syllabus depth & weak topics with zero repeated questions.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <select
                    value={compileQuestionCount}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCompileQuestionCount(val === 'dynamic' ? 'dynamic' : Number(val));
                    }}
                    className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200"
                  >
                    <option value="dynamic">Dynamic (Syllabus & Mastery Scaled)</option>
                    <option value={8}>8 Questions</option>
                    <option value={12}>12 Questions</option>
                    <option value={15}>15 Questions</option>
                    <option value={20}>20 Questions</option>
                  </select>

                  <select
                    value={compileDifficulty}
                    onChange={(e) => setCompileDifficulty(e.target.value as 'standard' | 'high')}
                    className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200"
                  >
                    <option value="standard">Standard Rigor</option>
                    <option value="high">High Exam Rigor</option>
                  </select>

                  <button
                    onClick={handleCompileNewPaper}
                    disabled={isCompilingPaper}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 shadow-sm transition-colors"
                  >
                    {isCompilingPaper ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Compiling...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        <span>Compile CBT Assessment</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Available CBT Papers List */}
              {isLoadingPapers ? (
                <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Loading CBT mock papers...</span>
                </div>
              ) : coursePapers.length === 0 ? (
                <div className="py-10 text-center space-y-3 border border-dashed border-slate-200 dark:border-zinc-800 rounded-2xl">
                  <FileText className="mx-auto text-slate-400" size={32} />
                  <p className="text-sm font-semibold text-slate-700 dark:text-zinc-300">
                    No CBT mock papers compiled yet for {activeCourseId}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    Click "Compile CBT Mock" above to generate a live syllabus examination paper.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {coursePapers.map((paper) => (
                    <div
                      key={paper.id}
                      className="p-5 rounded-2xl border border-slate-200 dark:border-zinc-800 hover:border-indigo-500 dark:hover:border-indigo-500 transition-all flex flex-col justify-between gap-4 bg-slate-50/40 dark:bg-zinc-900/50"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="px-2.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold text-[11px]">
                            {paper.courseCode}
                          </span>
                          <span className="text-xs text-slate-400 font-medium">
                            {paper.questions?.length || 0} Questions ·{' '}
                            {Math.round(((paper.questions?.length || 10) * secondsPerQuestion) / 60)} mins
                          </span>
                        </div>
                        <h3 className="font-bold text-slate-900 dark:text-white text-base">
                          {paper.title}
                        </h3>
                      </div>

                      <button
                        onClick={() => startPaperSession(paper)}
                        className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-bold text-xs flex items-center justify-center gap-2 transition-colors"
                      >
                        <Play size={14} />
                        <span>
                          Start {sessionMode === 'cbt' ? 'Timed CBT Exam' : 'Study Session'}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ACTIVE CBT / STUDY SESSION */
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
              {/* Top Exam Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-zinc-800 pb-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    {sessionMode === 'cbt' ? 'Strict Timed CBT Mode' : 'Interactive Study Mode'}
                  </span>
                  <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                    {selectedPaper?.title}
                  </h2>
                </div>

                <div className="flex items-center gap-3">
                  {sessionMode === 'cbt' && !showResults && (
                    <div
                      className={`px-3.5 py-2 rounded-xl font-mono font-bold text-sm flex items-center gap-2 ${
                        timeLeftSeconds <= 60
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 animate-pulse'
                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200'
                      }`}
                    >
                      <Clock size={16} />
                      <span>{formatTimer(timeLeftSeconds)}</span>
                    </div>
                  )}

                  <button
                    onClick={resetCbtSession}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800"
                  >
                    Exit Paper
                  </button>
                </div>
              </div>

              {/* Question Navigation Palette */}
              <div className="flex flex-wrap gap-1.5">
                {activeQuestions.map((q, idx) => {
                  const isCurrent = idx === currentQuestionIndex;
                  const isAnswered = Boolean(userAnswers[q.id]);
                  const isFlagged = Boolean(flaggedQuestions[q.id]);

                  return (
                    <button
                      key={q.id}
                      onClick={() => setCurrentQuestionIndex(idx)}
                      className={`w-9 h-9 rounded-xl font-bold text-xs transition-all relative ${
                        isCurrent
                          ? 'bg-indigo-600 text-white ring-2 ring-indigo-300'
                          : isAnswered
                          ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400'
                      }`}
                    >
                      {idx + 1}
                      {isFlagged && (
                        <span className="w-2 h-2 rounded-full bg-amber-500 absolute -top-0.5 -right-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Current CBT Question */}
              {activeQuestions[currentQuestionIndex] &&
                (() => {
                  const q = activeQuestions[currentQuestionIndex];
                  const selectedAns = userAnswers[q.id];
                  const isSubmitted = submittedQuestions[q.id] || showResults;
                  const hiddenOpts = eliminatedOptions[q.id] || [];

                  return (
                    <div className="space-y-6 pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                          Question {currentQuestionIndex + 1} of {activeQuestions.length}
                          {q.topic ? ` · ${q.topic}` : ''}
                        </span>

                        <div className="flex items-center gap-2">
                          {sessionMode === 'practice' && !isSubmitted && (
                            <button
                              onClick={() => handleUseFiftyFifty(q)}
                              disabled={Boolean(eliminatedOptions[q.id])}
                              className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold text-xs flex items-center gap-1.5 disabled:opacity-40"
                            >
                              <Zap size={13} />
                              <span>50/50 (1 Spark)</span>
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setFlaggedQuestions((prev) => ({ ...prev, [q.id]: !prev[q.id] }))
                            }
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border ${
                              flaggedQuestions[q.id]
                                ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300'
                                : 'border-slate-200 dark:border-zinc-800 text-slate-500'
                            }`}
                          >
                            <Flag size={13} />
                            <span>{flaggedQuestions[q.id] ? 'Flagged' : 'Flag'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="text-base sm:text-lg font-medium text-slate-900 dark:text-white">
                        <MarkdownInline content={q.question} />
                      </div>

                      <div className="space-y-3">
                        {(q.options || []).map((opt, oIdx) => {
                          if (hiddenOpts.includes(opt)) return null;
                          const isChosen = selectedAns === opt;
                          const isRight = isAnswerMatch(opt, q.correctAnswer);

                          let styleClass =
                            'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-zinc-200 hover:border-indigo-400';
                          if (isSubmitted) {
                            if (isRight) {
                              styleClass =
                                'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-900 dark:text-emerald-200';
                            } else if (isChosen && !isRight) {
                              styleClass =
                                'bg-rose-50 dark:bg-rose-950/40 border-rose-500 text-rose-900 dark:text-rose-200';
                            }
                          } else if (isChosen) {
                            styleClass =
                              'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-600 text-indigo-950 dark:text-indigo-200';
                          }

                          return (
                            <button
                              key={oIdx}
                              disabled={isSubmitted}
                              onClick={() =>
                                setUserAnswers((prev) => ({ ...prev, [q.id]: opt }))
                              }
                              className={`w-full p-4 rounded-2xl border text-left flex items-start gap-3 transition-all ${styleClass}`}
                            >
                              <span className="w-6 h-6 rounded-full border border-current flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                                {String.fromCharCode(65 + oIdx)}
                              </span>
                              <div className="flex-1 text-sm sm:text-base">
                                <MarkdownInline content={opt} />
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Instant Check in Practice Mode */}
                      {sessionMode === 'practice' && !isSubmitted && selectedAns && (
                        <button
                          onClick={() =>
                            setSubmittedQuestions((prev) => ({ ...prev, [q.id]: true }))
                          }
                          className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
                        >
                          Check Answer
                        </button>
                      )}

                      {/* Explanation Box */}
                      {isSubmitted && (
                        <div className="p-5 rounded-2xl bg-slate-50 dark:bg-zinc-950/70 border border-slate-200 dark:border-zinc-800 space-y-2">
                          <div className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                            Marking Scheme Explanation
                          </div>
                          <div className="text-sm text-slate-700 dark:text-zinc-300">
                            <MarkdownInline content={q.explanation} />
                          </div>
                        </div>
                      )}

                      {/* Navigation Footer */}
                      <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-zinc-800">
                        <button
                          onClick={() =>
                            setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))
                          }
                          disabled={currentQuestionIndex === 0}
                          className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 text-xs font-bold disabled:opacity-40 flex items-center gap-1.5"
                        >
                          <ChevronLeft size={15} />
                          <span>Previous</span>
                        </button>

                        {currentQuestionIndex < activeQuestions.length - 1 ? (
                          <button
                            onClick={() =>
                              setCurrentQuestionIndex((prev) =>
                                Math.min(activeQuestions.length - 1, prev + 1)
                              )
                            }
                            className="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-bold flex items-center gap-1.5"
                          >
                            <span>Next</span>
                            <ChevronRight size={15} />
                          </button>
                        ) : !showResults ? (
                          <button
                            onClick={() => finalizeExamSession(false)}
                            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm"
                          >
                            <Send size={14} />
                            <span>Submit CBT Paper</span>
                          </button>
                        ) : null}
                      </div>

                      {/* Results & Spaced Repetition Auto-Scheduling Banner */}
                      {showResults && (
                        <div className="p-6 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                              Final Score: {calculateScore()} / {activeQuestions.length} (
                              {Math.round((calculateScore() / activeQuestions.length) * 100)}%)
                            </h3>
                            <Award className="text-amber-500" size={24} />
                          </div>
                          {srsScheduleStatus === 'scheduled' && (
                            <p className="text-xs font-medium text-indigo-800 dark:text-indigo-300">
                              ✓ Automatically scheduled {scheduledSrsCount} missed question(s) into your Spaced Repetition review deck.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================
          TAB 3: COURSE CHEAT SHEET (Formulas & Key Theorems)
         ======================================================================== */}
      {activeTab === 'cheatsheet' && (
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
          <div className="space-y-1 border-b border-slate-100 dark:border-zinc-800 pb-4">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              {activeCourseId} Quick-Reference Cheat Sheet
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400">
              Essential formulas, definitions, and unit summaries for rapid pre-exam revision.
            </p>
          </div>

          {formulas && formulas.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {formulas.map((f) => (
                <div
                  key={f.id}
                  className="p-5 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-950/50 space-y-2"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    {f.category || activeCourseId}
                  </span>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {f.title}
                  </h3>
                  <div className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800 overflow-x-auto">
                    <MarkdownInline content={`$$${(f.latex || '').replace(/^\$\$|\$\$$/g, '')}$$`} />
                  </div>
                  {f.description && (
                    <div className="text-xs text-slate-600 dark:text-zinc-400">
                      <MarkdownInline content={f.description} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {syllabus.map((mod, idx) => (
                <div
                  key={mod.id}
                  className="p-5 rounded-2xl border border-slate-200 dark:border-zinc-800 space-y-2"
                >
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Unit {idx + 1}
                  </span>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {cleanUnitTitle(mod.title)}
                  </h3>
                  <ul className="list-disc list-inside text-xs sm:text-sm text-slate-600 dark:text-zinc-400 space-y-1">
                    {(mod.subTopics || []).map((s) => (
                      <li key={s.id}>{s.title}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <PricingModal
        isOpen={showPricingModal}
        onClose={() => setShowPricingModal(false)}
        onUpgradeClick={() => setShowPricingModal(false)}
      />
    </div>
  );
}
