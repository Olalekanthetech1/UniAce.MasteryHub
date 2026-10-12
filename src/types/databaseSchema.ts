/**
 * UniAce Mastery Hub: PostgreSQL Database Domain Schema & Types
 * Defines the relational models, composite constraints, durable queue states,
 * normalized progress models, and transactional outbox contracts.
 */

// 1. Courses Table
export interface CourseEntity {
  id: string;
  code: string;
  title: string;
  description: string | null;
  level: '100L' | '200L' | '300L' | '400L' | 'undergraduate' | 'postgraduate';
  department: string | null;
  faculty: string | null;
  semester: 'first' | 'second' | null;
  thumbnail_url: string | null;
  author_id: string;
  status: 'draft' | 'in_review' | 'published' | 'archived';
  generation_status: 'none' | 'queued' | 'generating' | 'completed' | 'failed';
  generation_job_id: string | null;
  version: number;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

// 2. Course Modules Table (Unique on course_id, order_index)
export interface CourseModuleEntity {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  order_index: number;
  estimated_minutes: number;
  created_at: string;
  updated_at: string;
}

// 3. Course Lessons Table (Composite FK on course_id, module_id)
export interface CourseLessonEntity {
  id: string;
  course_id: string;
  module_id: string;
  title: string;
  content_markdown: string;
  order_index: number;
  key_terms: string[];
  learning_outcomes: string[];
  asset_references: Array<{
    type: 'pdf' | 'image' | 'video' | 'diagram';
    url: string;
    caption?: string;
  }>;
  created_at: string;
  updated_at: string;
}

// 4. Course Quizzes Table
export interface CourseQuizEntity {
  id: string;
  course_id: string;
  module_id: string | null;
  title: string;
  passing_score: number; // percentage, e.g. 70
  version: number;
  questions_snapshot_hash: string;
  questions: Array<{
    id: string;
    question: string;
    options: string[];
    correct_option_index: number;
    explanation: string;
    latex_proof?: string;
  }>;
  created_at: string;
  updated_at: string;
}

// 5. Course Formulas Table
export interface CourseFormulaEntity {
  id: string;
  course_id: string;
  name: string;
  latex_expression: string;
  variables_breakdown: Record<string, string>;
  derivation_notes: string | null;
  created_at: string;
}

// 6. User Course Progress Table
export interface UserCourseProgressEntity {
  id: string; // `${uid}_${course_id}`
  uid: string;
  course_id: string;
  total_study_seconds: number;
  last_studied_lesson_id: string | null;
  last_studied_at: string;
  completed_lessons_count: number;
  completed_modules_count: number;
  version: number;
  updated_at: string;
}

// 7. User Study Batches Table (Unique on uid, course_id, batch_id)
export interface UserStudyBatchEntity {
  id: string;
  uid: string;
  course_id: string;
  batch_id: string;
  delta_seconds: number;
  client_timestamp: string | null;
  recorded_at: string;
}

// 8. User Lesson Completions Table (Primary Key on uid, lesson_id)
export interface UserLessonCompletionEntity {
  uid: string;
  lesson_id: string;
  course_id: string;
  module_id: string;
  completed_at: string;
  source_batch_id: string | null;
}

// 9. User Quiz Attempts Table (Idempotency token NOT NULL UNIQUE)
export interface UserQuizAttemptEntity {
  id: string;
  uid: string;
  quiz_id: string;
  course_id: string;
  score: number;
  passed: boolean;
  quiz_version: number;
  answers: Record<string, number | string>;
  answers_hash: string;
  idempotency_token: string;
  submitted_at: string;
}

// 10. Course Generation Jobs Table
export type GenerationJobStatus = 'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'cancelled';
export type GenerationJobStage = 'planning' | 'syllabus' | 'modules' | 'lessons' | 'quizzes' | 'validating';

export interface CourseGenerationJobEntity {
  id: string;
  course_id: string | null;
  requested_by: string;
  prompt_params: {
    topic: string;
    department?: string;
    level?: string;
    targetModuleCount?: number;
    provider?: string;
  };
  status: GenerationJobStatus;
  current_stage: GenerationJobStage;
  progress_pct: number;
  attempt_count: number;
  max_attempts: number;
  worker_id: string | null;
  worker_heartbeat_at: string | null;
  lease_expires_at: string | null;
  next_retry_at: string | null;
  checkpoint_data: {
    lastCompletedUnitType?: 'syllabus' | 'module' | 'lesson' | 'quiz';
    lastCompletedUnitIndex?: number;
    lastCompletedUnitId?: string;
    inputHash?: string;
    savedModules?: string[];
    savedLessons?: string[];
  };
  error_message: string | null;
  tokens_consumed: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// 11. Transactional Outbox Table
export interface TransactionalOutboxEntity {
  id: string;
  aggregate_type: 'QUIZ_REWARD' | 'COURSE_COMPLETION' | 'QUALITY_BOUNTY';
  aggregate_id: string;
  idempotency_token: string;
  payload: Record<string, any>;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  retry_count: number;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

// 12. Reconciled Financial Models (Reconciled with server/sparkLedger.ts & server/sparkRollups.ts)
export interface UserRelationalEntity {
  uid: string;
  email: string | null;
  role: 'student' | 'admin' | 'tutor' | 'moderator';
  plan_type: 'free' | 'scholar';
  ai_sparks: number;
  free_sparks: number;
  paid_sparks: number;
  frozen_disputed_paid_sparks: number;
  bucket_tracking_initialized: boolean;
  bucket_source: 'tracked' | 'legacy';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentRelationalEntity {
  reference: string;
  uid: string;
  email: string | null;
  amount_ngn: number;
  amount_kobo: number; // Integer minor units (100 Kobo = 1 NGN)
  amount_usd: number | null;
  snapshot_ngn_per_usd_rate: number | null;
  sparks_added: number;
  sparks_clawed_back: number;
  sparks_shortfall_unrecovered: number;
  refunded_amount_kobo: number;
  dispute_status: 'none' | 'pending' | 'won' | 'lost';
  status: 'success' | 'partially_refunded' | 'refunded' | 'disputed';
  created_at: string;
  updated_at: string;
}

export interface SparkLedgerRelationalEntity {
  entry_id: string;
  sequence_id?: number; // BIGSERIAL watermark for reliable delta change-capture
  uid: string;
  action: 'PRE_AUTH' | 'SETTLE' | 'REFUND' | 'QUALITY_BOUNTY' | 'PAYMENT_REFUND_CLAWBACK' | 'ADMIN_ADJUST';
  amount_sparks: number;
  free_sparks_delta: number;
  paid_sparks_delta: number;
  idempotency_token: string;
  created_at: string;
}
