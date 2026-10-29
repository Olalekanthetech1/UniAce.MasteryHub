
export type Department = string;
export type Subject = string;
export type Level = '100' | '200' | '300' | '400' | '500' | '600';
export type Semester = '1st Semester' | '2nd Semester';

export type CourseId = string;

export type CourseScope = 'GLOBAL' | 'FACULTY' | 'DEPARTMENT';

export interface CourseObjective {
  outcome: string;
  bloomLevel?: 'Remember' | 'Understand' | 'Apply' | 'Analyze' | 'Evaluate' | 'Create';
}

export interface CourseProvenance {
  sources: string[];
  modelVersion: string;
  promptVersion: string;
  generatedAt: string;
  groundingScore?: number;
}

export interface CourseOffering {
  departmentId: string;
  departmentName?: string;
  level: Level;
  semester: Semester;
  type?: 'core' | 'elective' | 'global';
}

export interface Course {
  id: CourseId;
  title: string;
  description: string;
  syllabus: Module[];
  formulas?: Formula[];
  department: Department;
  objectives?: (string | CourseObjective)[];
  learningOutcomes?: CourseObjective[];
  departments?: Department[];
  faculties?: string[];
  offerings?: CourseOffering[];
  scope?: CourseScope;
  level?: Level;
  semester?: Semester;
  creditUnits?: number;
  academicStandard?: string;
  primaryDomain?: string;
  coverageScore?: number;
  consistencyScore?: number;
  confidenceState?: 'verified' | 'needs_review' | 'failed';
  provenance?: CourseProvenance;
  deleted?: boolean;
  deletedAt?: string;
  status?: string;
  faculty?: string;
  syllabusStatus?: 'pending' | 'generating' | 'ready' | 'failed';
  syllabusStatusTimestamp?: string;
}

export type View = 'hub' | 'dashboard' | 'study' | 'past-questions' | 'quizzes' | 'module-topics' | 'course-syllabus' | 'mastery' | 'formulas' | 'ai-tutor' | 'notebook' | 'profile' | 'help-support' | 'admin-support' | 'admin-dashboard' | 'tutor-dashboard' | 'pricing' | 'flashcards' | 'arena' | 'concept-map' | 'study-plan';

export interface Assignment {
  id: string;
  courseId: CourseId;
  title: string;
  dueDate: string;
  status: 'pending' | 'submitted' | 'graded';
  grade?: number;
}

export interface Flashcard {
  id: string;
  front: string; // Question or concept
  back: string; // Answer or explanation
  moduleId: string;
  subTopicId?: string;
  userId?: string;
  interval?: number;
  repetition?: number;
  efactor?: number;
  nextReviewDate?: string;
}

export interface SRSData {
  cardId: string;
  interval: number; // Days until next review
  repetition: number; // Number of times reviewed
  efactor: number; // Easiness factor
  nextReviewDate: string; // ISO date string
}

export type AIPersonality = 'encouraging' | 'strict' | 'socratic' | 'humorous' | 'master' | 'debate';

export interface TimetableEntry {
  id: string;
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  courseId: string;
  type: 'lecture' | 'lab' | 'tutorial' | 'other';
}

export interface ExamDate {
  id: string;
  courseId: string;
  date: string; // ISO date
  time?: string;
}

export interface StudySession {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  type: 'prime' | 'consolidation' | 'deep_work' | 'review';
  courseId: string;
  moduleId?: string;
  status: 'pending' | 'completed' | 'missed';
}

export interface StudyPlan {
  id: string;
  userId: string;
  timetable: TimetableEntry[];
  exams: ExamDate[];
  sessions: StudySession[];
  lastGenerated: string;
}

export type PlanType = 'free' | 'exam_cram' | 'scholar' | 'semester';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'student' | 'admin' | 'tutor' | 'moderator';
  plan_type: PlanType;
  subscription_end_date?: string;
  created_at?: string;
  themeColor?: string;
  rank?: number;
  admin_pin_verified_until?: any;
  department?: string;
  faculty?: string;
  academic_level?: string;
  semester?: string;
  referralCode?: string;
  referredBy?: string;
  referral_count?: number;
  ai_sparks?: number;
  has_seen_whatsapp?: boolean;
  onboarding_completed?: boolean;
}

export interface LearningProfile {
  strengths: string[];
  weaknesses: string[];
  lastUpdated: string;
}

export interface UserProgress {
  xp: number;
  level: number;
  streak: number;
  lastStudyDate: string | null;
  mastery: Record<string, number>; // topicId -> mastery percentage (0-100)
  achievements: Achievement[];
  studyTime: Record<string, number>; // topicId -> seconds spent
  topicLastStudied: Record<string, string>; // topicId -> ISO date string
  bookmarks: Bookmark[];
  enrolledCourses: CourseId[];
  assignments: Assignment[];
  srsData?: Record<string, SRSData>; // cardId -> SRSData
  aiPersonality?: AIPersonality;
  learningProfile?: LearningProfile;
  quizzesCompleted?: number;
  quizHistory?: { date: string; score: number; courseId: string; topicId?: string; title?: string }[];
}

export interface Bookmark {
  id: string;
  type: 'formula' | 'question';
  content: any; // Formula or QuizQuestion
  timestamp: string;
  note?: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: string | null;
}

export interface Formula {
  id: string;
  title: string;
  latex: string;
  description: string;
  category: string;
}

export interface SubTopic {
  id: string;
  title: string;
  content: string;
  relatedTo?: string[];
  groundingReferences?: string[];
  confidenceState?: 'verified' | 'needs_review' | 'failed';
}

export interface Module {
  id: string;
  title: string;
  subTopics: SubTopic[];
  groundingReferences?: string[];
  confidenceState?: 'verified' | 'needs_review' | 'failed';
  telemetry?: {
    regenerationCount: number;
    editCount: number;
    dropOffRate: number;
  };
}

export interface MessageReaction {
  id?: string;
  messageId: string;
  userId: string;
  emoji: string;
  courseId?: string;
  createdAt?: string;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'model';
  text: string;
  image?: string;
  sources?: { title: string; uri: string }[];
  pdfContent?: string;
  timestamp?: string | number | Date;
  reactions?: { [emoji: string]: number };
  userReactions?: string[];
  reportStatus?: 'pending_review' | 'verified_promoted' | 'dismissed';
  meta?: {
    providerUsed?: string;
    upstreamModel?: string | null;
    providerLabel?: string;
    taskType?: string;
    complexity?: string;
    reasoning?: string;
    latencyMs?: number;
    idempotency_token?: string;
    scrubbedPassagesCount?: number;
    estimatedCostUsd?: number;
    grossMarginUsd?: number;
    pricingStale?: boolean;
    tokens?: number;
    sparksCost?: number;
  };
}

export type QuestionType = 'multiple-choice' | 'fill-in-the-blank';

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[]; // For multiple choice
  correctAnswer: string;
  explanation: string;
  hint: string;
  difficulty?: number; // 1 to 5
  sourceReference?: string;
  bloomLevel?: 'remembering' | 'understanding' | 'applying' | 'analyzing' | 'evaluating' | 'creating';
  learningOutcomeId?: string;
  verifiedGrounded?: boolean;
}

export interface QuizAttempt {
  id: string;
  userId: string;
  courseId: string;
  moduleId?: string;
  subTopicId?: string;
  mode: 'practice' | 'exam' | 'adaptive' | 'custom';
  score: number;
  totalQuestions: number;
  accuracyPercentage: number;
  timeSpentSeconds?: number;
  completedAt: string;
  weakTopics?: string[];
}

export interface Quiz {
  moduleId: string;
  questions: QuizQuestion[];
}

export interface BattleActionRecord {
  questionIndex: number;
  selectedOption: string;
  correct: boolean;
  elapsedMs: number;
  timestamp: string;
}

export interface BattlePlayer {
  uid: string;
  name: string;
  avatar: string;
  score: number;
  currentQuestionIndex: number;
  health: number; // 0-100
  status: 'ready' | 'playing' | 'finished';
  opponentType?: 'human' | 'ghost_replay' | 'ai_challenger';
  calibratedMasteryPct?: number;
  recordedFromBattleId?: string;
  recordedAt?: string;
  actionLog?: BattleActionRecord[];
}

export interface Battle {
  id: string;
  status: 'waiting' | 'active' | 'finished';
  player1: BattlePlayer;
  player2: BattlePlayer | null;
  questions: QuizQuestion[];
  winner: string | null; // uid or 'draw'
  createdAt: string;
  createdAtEpochMs?: number;
  startedAt?: string;
  startedAtEpochMs?: number;
  expiresAt?: string;
  expiresAtEpochMs?: number;
  finishedAt?: string;
  finishedAtEpochMs?: number;
  durationSeconds?: number;
  opponentType?: 'human' | 'ghost_replay' | 'ai_challenger';
  recordedFromBattleId?: string;
  recordedBattleTimestamp?: string;
  calibrationTelemetry?: {
    calibratedMasteryPct: number;
    tier?: 'beginner' | 'intermediate' | 'advanced';
    tierLabel?: string;
    pacingRangeLabel?: string;
    minStepMs?: number;
    maxStepMs?: number;
    baseStepMs: number;
    targetAccuracyPct?: number;
    quizScorePct?: number | null;
    attemptsSampled: number;
    srsRetentionPct?: number | null;
    srsCardsSampled?: number;
    srsCardsRetained?: number;
    courseWinRatePct?: number | null;
    courseWins?: number;
    courseLosses?: number;
    arenaBattlesSampled: number;
    lessonsCompleted: number;
  };
  topicId: string; // e.g., 'MAT101'
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  photoURL: string;
  xp: number;
  rank: number;
  streak: number;
}

export interface Curriculum {
  id: string; // DEPT_LEVEL_SEM
  department: Department;
  level: Level;
  semester: Semester;
  courseIds: CourseId[];
  lastUpdated: string;
  updatedBy: string;
}

export interface LessonRelevance {
  department: string;
  concept: string;
  application: string;
}

export interface PipelineMetadata {
  hasMath?: boolean;
  hasCode?: boolean;
  audience?: string[];
  audienceHash?: string;
  promptVersion?: string;
  modelId?: string;
  generatedAt?: string;
  relevance?: LessonRelevance[];
  keyConcepts?: string[];
  [key: string]: any;
}
