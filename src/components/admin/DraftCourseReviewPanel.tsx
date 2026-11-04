import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Clock3, FileText, Play, RefreshCw, Search, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import MarkdownRenderer from '../MarkdownRenderer';
import { asDisplayMath } from '../../shared/mathText';

type ReviewStatus = 'pending' | 'in_review' | 'needs_revision' | 'approved';
type ReviewAction = 'start_review' | 'request_revision' | 'approve';

interface DraftCourse {
  id: string;
  code: string;
  title: string;
  description: string;
  department: string;
  faculty: string;
  level: string;
  semester: string;
  scope: string;
  status: string;
  review_status: ReviewStatus;
  generation_status?: 'generating' | 'failed' | 'cancelled' | 'completed';
  generation_error?: string | null;
  is_actively_running?: boolean;
  generation_progress?: number | null;
  status_message?: string | null;
  current_module?: string | null;
  current_lesson?: string | null;
  completed_lessons?: number | null;
  total_lessons?: number | null;
  active_provider?: string | null;
  elapsed_seconds?: number | null;
  review_notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  module_count: number;
  lesson_count: number;
  empty_module_count?: number;
}
interface LiveJobTelemetry {
  progress: number;
  message: string;
  currentModule?: string | null;
  currentLesson?: string | null;
  completedLessons?: number | null;
  totalLessons?: number | null;
  activeProvider?: string | null;
  elapsedSeconds?: number | null;
  updatedAt?: string | null;
}
interface DraftLesson {
  id: string;
  title: string;
  content_markdown: string;
  instructional_content?: any;
  order_index: number;
}
interface DraftModule {
  id: string;
  title: string;
  description?: string | null;
  order_index: number;
  lessons: DraftLesson[];
}
interface DraftFormula {
  id: string;
  name: string;
  latex_expression: string;
  variables_breakdown?: any;
  derivation_notes?: string | null;
}
interface ReviewEvent {
  event_id: number;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  notes?: string | null;
  actor_email?: string | null;
  created_at: string;
}
interface ReviewBundle {
  course: DraftCourse;
  modules: DraftModule[];
  formulas: DraftFormula[];
  reviewHistory: ReviewEvent[];
}
interface Props {
  refreshKey?: number;
  onCoursePublished?: () => void;
}

const statusLabel = (status: string) => ({
  pending: 'Pending review',
  in_review: 'In review',
  needs_revision: 'Changes requested',
  approved: 'Approved for publishing'
}[status] || status);

const statusStyle = (status: string) => ({
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_review: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  needs_revision: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
}[status] || 'bg-slate-100 text-slate-700');

function dateLabel(value?: string | null): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not recorded' : parsed.toLocaleString();
}

function RichBlock({ title, value }: { title: string; value?: unknown }) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
      <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h5>
      <MarkdownRenderer content={value} className="!text-sm" />
    </section>
  );
}

function RichList({ title, values }: { title: string; values?: unknown }) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
      <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h5>
      <ul className="space-y-2">
        {values.map((value, index) => (
          <li key={index} className="flex items-start gap-2 text-sm">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
            <div className="min-w-0 flex-1"><MarkdownRenderer content={String(value)} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StructuredLessonPreview({ content }: { content: any }) {
  if (!content || typeof content !== 'object') {
    return <p className="text-sm text-slate-500">No structured mastery payload is stored for this lesson.</p>;
  }
  return (
    <div className="space-y-4">
      <RichList title="Learning objectives" values={content.learningObjectives} />
      {Array.isArray(content.prerequisites) && content.prerequisites.length > 0 && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">Prerequisites</h5>
          {content.prerequisites.map((item: any, index: number) => (
            <div key={index} className="border-l-2 border-indigo-400 pl-3 space-y-2">
              <MarkdownRenderer content={String(item.concept || '')} inline />
              <RichBlock title="Why it is needed" value={item.whyNeeded} />
              <RichBlock title="Readiness check" value={item.readinessCheck} />
            </div>
          ))}
        </section>
      )}
      <RichBlock title="Concept introduction" value={content.conceptIntroduction} />
      <RichBlock title="Deep explanation" value={content.deepExplanation} />
      <RichBlock title="Formal development and derivation" value={content.formalDevelopment} />
      {Array.isArray(content.workedExamples) && content.workedExamples.length > 0 && (
        <section className="space-y-3">
          <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">Worked examples</h5>
          {content.workedExamples.map((example: any, index: number) => (
            <details key={index} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4" open={index === 0}>
              <summary className="cursor-pointer font-semibold text-sm">{example.title || 'Worked example ' + (index + 1)}</summary>
              <div className="mt-3 space-y-3">
                <RichBlock title="Problem" value={example.problem} />
                <RichList title="Reasoning steps" values={example.reasoningSteps} />
                <RichBlock title="Solution" value={example.solution} />
                <RichBlock title="Verification" value={example.verification} />
              </div>
            </details>
          ))}
        </section>
      )}
      {Array.isArray(content.applications) && content.applications.length > 0 && (
        <section className="space-y-3">
          <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">Applications</h5>
          {content.applications.map((item: any, index: number) => (
            <div key={index} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
              <MarkdownRenderer content={String(item.context || '')} inline />
              <RichBlock title="Connection to the concept" value={item.conceptConnection} />
              <RichBlock title="Assumptions and constraints" value={item.constraintsOrAssumptions} />
            </div>
          ))}
        </section>
      )}
      <RichBlock title="Application rationale" value={content.applicationRationale} />
      {Array.isArray(content.misconceptions) && content.misconceptions.length > 0 && (
        <section className="space-y-3">
          <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">Common misconceptions</h5>
          {content.misconceptions.map((item: any, index: number) => (
            <div key={index} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
              <RichBlock title="Misconception" value={item.misconception} />
              <RichBlock title="Why it is incorrect" value={item.whyItIsWrong} />
              <RichBlock title="Correction" value={item.correction} />
            </div>
          ))}
        </section>
      )}
      <RichBlock title="Misconception rationale" value={content.misconceptionRationale} />
      {(['guidedPractice', 'independentPractice'] as const).map((key) => (
        Array.isArray(content[key]) && content[key].length > 0 ? (
          <section key={key} className="space-y-3">
            <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">{key === 'guidedPractice' ? 'Guided practice' : 'Independent practice'}</h5>
            {content[key].map((item: any, index: number) => (
              <details key={index} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <summary className="cursor-pointer font-semibold text-sm">Exercise {index + 1}</summary>
                <div className="mt-3 space-y-3">
                  <RichBlock title="Prompt" value={item.prompt} />
                  <RichList title="Hints" values={item.hints} />
                  <RichBlock title="Expected approach" value={item.expectedApproach} />
                  <RichBlock title="Expected answer" value={item.expectedAnswer} />
                  <RichBlock title="Explanation" value={item.explanation} />
                </div>
              </details>
            ))}
          </section>
        ) : null
      ))}
      {Array.isArray(content.knowledgeChecks) && content.knowledgeChecks.length > 0 && (
        <section className="space-y-3">
          <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">Knowledge checks</h5>
          {content.knowledgeChecks.map((item: any, index: number) => (
            <details key={index} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <summary className="cursor-pointer font-semibold text-sm">Check {index + 1} · {item.responseMode || 'Reasoning'}</summary>
              <div className="mt-3 space-y-3">
                <RichBlock title="Prompt" value={item.prompt} />
                <RichBlock title="Expected reasoning" value={item.expectedReasoning} />
                <RichBlock title="Answer / rubric" value={item.answerOrRubric} />
              </div>
            </details>
          ))}
        </section>
      )}
      {content.mastery && (
        <section className="rounded-xl border border-indigo-200 dark:border-indigo-900 p-4 space-y-3">
          <h5 className="font-bold text-sm">Mastery criteria · Target level {content.mastery.targetLevel || 'not specified'} / 5</h5>
          <RichList title="Criteria" values={content.mastery.criteria} />
          <RichList title="Retrieval prompts" values={content.mastery.retentionPrompts} />
        </section>
      )}
      {content.verification && (
        <section className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-2">
          <h5 className="font-bold text-sm">Verification record</h5>
          <p className="text-sm">Structure: {content.verification.structureValidation || 'not recorded'}</p>
          <p className="text-sm">Academic accuracy: {content.verification.academicAccuracy || 'not recorded'}</p>
          <p className="text-sm">Calculation validation: {content.verification.calculationValidation || 'not recorded'}</p>
          <p className="text-sm">Subject-expert review: {content.verification.subjectExpertReview || 'not recorded'}</p>
          <p className="text-xs text-amber-800 dark:text-amber-200">A structural pass or successful formula rendering is not evidence of academic accuracy or independent calculation verification.</p>
        </section>
      )}
    </div>
  );
}

export default function DraftCourseReviewPanel({ refreshKey = 0, onCoursePublished }: Props) {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<DraftCourse[]>([]);
  const [incompleteDrafts, setIncompleteDrafts] = useState<DraftCourse[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [bundle, setBundle] = useState<ReviewBundle | null>(null);
  const [search, setSearch] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [approvalChecks, setApprovalChecks] = useState({ subjectExpert: false, calculations: false, curriculum: false, rendering: false });
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState<ReviewAction | 'publish' | null>(null);
  const [resumingCourseId, setResumingCourseId] = useState<string | null>(null);
  const [resumeStatusMap, setResumeStatusMap] = useState<Record<string, LiveJobTelemetry>>({});
  const [discardingCourseId, setDiscardingCourseId] = useState<string | null>(null);
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [queueError, setQueueError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [reloadDetail, setReloadDetail] = useState(0);

  const filteredDrafts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return drafts;
    return drafts.filter((item) =>
      [item.id, item.code, item.title, item.department, item.faculty]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(term))
    );
  }, [drafts, search]);

  const headers = async () => {
    if (!user) throw new Error('Your admin session is not available. Sign in again.');
    return { Authorization: 'Bearer ' + await user.getIdToken() };
  };

  const loadQueue = async (silent = false) => {
    if (!silent) {
      setLoadingQueue(true);
      setQueueError('');
    }
    try {
      const response = await fetch('/api/admin/courses/drafts', { headers: await headers() });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Unable to load the draft queue.');
      if (!Array.isArray(data?.courses)) throw new Error('The draft queue response is incomplete.');
      setDrafts(data.courses);
      const nextIncomplete: DraftCourse[] = Array.isArray(data?.incompleteCourses) ? data.incompleteCourses : [];
      setIncompleteDrafts(nextIncomplete);

      // Hydrate live telemetry map for any job actively running on the server
      setResumeStatusMap((prev) => {
        const next = { ...prev };
        for (const item of nextIncomplete) {
          if (item.is_actively_running) {
            next[item.id] = {
              progress: typeof item.generation_progress === 'number' ? item.generation_progress : (prev[item.id]?.progress ?? 10),
              message: item.status_message || prev[item.id]?.message || 'Authoring course curriculum on server…',
              currentModule: item.current_module ?? prev[item.id]?.currentModule ?? null,
              currentLesson: item.current_lesson ?? prev[item.id]?.currentLesson ?? null,
              completedLessons: item.completed_lessons ?? prev[item.id]?.completedLessons ?? item.lesson_count ?? 0,
              totalLessons: item.total_lessons ?? prev[item.id]?.totalLessons ?? null,
              activeProvider: item.active_provider ?? prev[item.id]?.activeProvider ?? null,
              elapsedSeconds: item.elapsed_seconds ?? prev[item.id]?.elapsedSeconds ?? null,
              updatedAt: item.updated_at ?? null
            };
          } else if (resumingCourseId !== item.id) {
            delete next[item.id];
          }
        }
        return next;
      });
    } catch (error: any) {
      if (!silent) {
        setDrafts([]);
        setIncompleteDrafts([]);
        setQueueError(error?.message || 'Unable to load the draft queue.');
      }
    } finally {
      if (!silent) setLoadingQueue(false);
    }
  };

  const pollCourseStatusOnce = async (courseId: string): Promise<'generating' | 'completed' | 'failed' | 'cancelled'> => {
    const statusRes = await fetch('/api/course/status/' + encodeURIComponent(courseId), {
      headers: await headers()
    });
    const statusData = await statusRes.json().catch(() => null);
    if (!statusRes.ok || !statusData) return 'generating';

    const genStatus = statusData.generationStatus as 'generating' | 'completed' | 'failed' | 'cancelled';
    const progress = typeof statusData.generationProgress === 'number' ? statusData.generationProgress : 15;
    const message = statusData.statusMessage || 'Authoring remaining modules and lessons…';

    if (genStatus === 'generating') {
      setResumeStatusMap((prev) => ({
        ...prev,
        [courseId]: {
          progress,
          message,
          currentModule: statusData.currentModule || null,
          currentLesson: statusData.currentLesson || null,
          completedLessons: typeof statusData.completedLessons === 'number' ? statusData.completedLessons : null,
          totalLessons: typeof statusData.totalLessons === 'number' ? statusData.totalLessons : null,
          activeProvider: statusData.activeProvider || null,
          elapsedSeconds: typeof statusData.elapsedSeconds === 'number' ? statusData.elapsedSeconds : null,
          updatedAt: statusData.updatedAt || new Date().toISOString()
        }
      }));
    } else {
      setResumeStatusMap((prev) => {
        const next = { ...prev };
        delete next[courseId];
        return next;
      });
    }

    return genStatus;
  };

  const handleResumeIncompleteDraft = async (courseId: string) => {
    setResumingCourseId(courseId);
    setQueueError('');
    setResumeStatusMap((prev) => ({
      ...prev,
      [courseId]: {
        progress: 8,
        message: 'Starting server generation worker from checkpoint…',
        updatedAt: new Date().toISOString()
      }
    }));
    try {
      const response = await fetch('/api/admin/courses/' + encodeURIComponent(courseId) + '/resume-generation', {
        method: 'POST',
        headers: { ...(await headers()), 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to resume course generation.');
      }

      // Poll live course generation status and refresh saved module/lesson counts
      let attempts = 0;
      while (attempts < 240) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        attempts++;
        const genStatus = await pollCourseStatusOnce(courseId);
        await loadQueue(true);

        if (genStatus === 'completed') {
          setSelectedId(courseId);
          break;
        }
        if (genStatus === 'failed' || genStatus === 'cancelled') {
          throw new Error('Course generation stopped before all modules and lessons were completed.');
        }
      }
    } catch (error: any) {
      setQueueError(error?.message || 'Unable to resume course generation.');
      await loadQueue(true);
    } finally {
      setResumingCourseId(null);
    }
  };

  const handleDiscardIncompleteDraft = async (courseId: string) => {
    setDiscardingCourseId(courseId);
    setQueueError('');
    try {
      const response = await fetch('/api/admin/courses/' + encodeURIComponent(courseId) + '/failed-draft', {
        method: 'DELETE',
        headers: await headers()
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Unable to discard incomplete draft.');
      }
      setConfirmDiscardId(null);
      if (selectedId === courseId) {
        setSelectedId('');
        setBundle(null);
      }
      await loadQueue();
    } catch (error: any) {
      setQueueError(error?.message || 'Unable to discard incomplete draft.');
    } finally {
      setDiscardingCourseId(null);
    }
  };

  useEffect(() => {
    if (!user) {
      setDrafts([]);
      setIncompleteDrafts([]);
      setSelectedId('');
      setBundle(null);
      return;
    }
    void loadQueue();
  }, [user, refreshKey]);

  // Automatically poll live telemetry if any incomplete draft is actively running on the server on page load
  useEffect(() => {
    if (!user || resumingCourseId) return;
    const runningIds = incompleteDrafts
      .filter((item) => item.is_actively_running === true)
      .map((item) => item.id);
    if (runningIds.length === 0) return;

    const timer = setInterval(() => {
      void (async () => {
        for (const id of runningIds) {
          await pollCourseStatusOnce(id).catch(() => undefined);
        }
        await loadQueue(true);
      })();
    }, 3000);

    return () => clearInterval(timer);
  }, [user, incompleteDrafts, resumingCourseId]);

  useEffect(() => {
    setApprovalChecks({ subjectExpert: false, calculations: false, curriculum: false, rendering: false });
    setReviewNote('');
  }, [selectedId]);

  useEffect(() => {
    if (!drafts.length) {
      setSelectedId('');
      setBundle(null);
      return;
    }
    if (!selectedId || !drafts.some((item) => item.id === selectedId)) setSelectedId(drafts[0].id);
  }, [drafts, selectedId]);

  useEffect(() => {
    let current = true;
    if (!user || !selectedId) {
      setBundle(null);
      setLoadingDetail(false);
      setDetailError('');
      return () => { current = false; };
    }
    setBundle(null);
    setLoadingDetail(true);
    setDetailError('');
    (async () => {
      try {
        const response = await fetch('/api/admin/courses/' + encodeURIComponent(selectedId) + '/review', { headers: await headers() });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Unable to load the selected draft.');
        if (!data?.course || !Array.isArray(data.modules) || !Array.isArray(data.formulas) || !Array.isArray(data.reviewHistory)) {
          throw new Error('The course review response is incomplete.');
        }
        if (current) setBundle(data as ReviewBundle);
      } catch (error: any) {
        if (current) setDetailError(error?.message || 'Unable to load the selected draft.');
      } finally {
        if (current) setLoadingDetail(false);
      }
    })();
    return () => { current = false; };
  }, [user, selectedId, reloadDetail]);

  const submitReviewAction = async (action: ReviewAction) => {
    if (!bundle) return;
    if (action === 'request_revision' && reviewNote.trim().length < 10) {
      setDetailError('Add specific revision instructions (at least 10 characters).');
      return;
    }
    if (action === 'approve' && !Object.values(approvalChecks).every(Boolean)) {
      setDetailError('Complete all four review attestations before approving this course.');
      return;
    }
    setBusy(action);
    setDetailError('');
    try {
      const response = await fetch('/api/admin/courses/' + encodeURIComponent(bundle.course.id) + '/review-status', {
        method: 'POST',
        headers: { ...(await headers()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes: reviewNote.trim() || undefined, approvalChecks: action === 'approve' ? approvalChecks : undefined })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'The review decision could not be saved.');
      setReviewNote('');
      setApprovalChecks({ subjectExpert: false, calculations: false, curriculum: false, rendering: false });
      await loadQueue();
      setReloadDetail((value) => value + 1);
    } catch (error: any) {
      setDetailError(error?.message || 'The review decision could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const publishCourse = async () => {
    if (!bundle || bundle.course.review_status !== 'approved') return;
    if (!window.confirm('Publishing makes this course visible to students. Confirm that the required academic review has been completed.')) return;
    setBusy('publish');
    setDetailError('');
    try {
      const response = await fetch('/api/admin/courses/' + encodeURIComponent(bundle.course.id) + '/publish', {
        method: 'POST',
        headers: await headers()
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'The course could not be published.');
      await loadQueue();
      setBundle(null);
      setSelectedId('');
      onCoursePublished?.();
    } catch (error: any) {
      setDetailError(error?.message || 'The course could not be published.');
    } finally {
      setBusy(null);
    }
  };

  const counts = {
    pending: drafts.filter((item) => item.review_status === 'pending').length,
    inReview: drafts.filter((item) => item.review_status === 'in_review').length,
    revisions: drafts.filter((item) => item.review_status === 'needs_revision').length,
    approved: drafts.filter((item) => item.review_status === 'approved').length
  };

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 sm:p-7 shadow-sm space-y-6" aria-label="Draft course review workspace">
      <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400"><ShieldCheck size={19} /><span className="text-xs font-bold uppercase tracking-[0.16em]">Academic content governance</span></div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Drafts &amp; Review</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">Inspect generated course structure, lessons, derivations, worked examples, practice, assessments and formulas before publishing.</p>
          </div>
        </div>
        <button type="button" onClick={() => { void loadQueue(); if (selectedId) setReloadDetail((value) => value + 1); }} disabled={loadingQueue} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">
          <RefreshCw size={16} className={loadingQueue ? 'animate-spin' : ''} />Refresh queue
        </button>
      </header>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-slate-50 dark:bg-slate-900 p-4"><p className="text-xs text-slate-500">Pending</p><p className="text-2xl font-bold">{counts.pending}</p></div>
        <div className="rounded-2xl bg-blue-50 dark:bg-blue-950/30 p-4"><p className="text-xs text-blue-700 dark:text-blue-300">In review</p><p className="text-2xl font-bold">{counts.inReview}</p></div>
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 p-4"><p className="text-xs text-amber-700 dark:text-amber-300">Changes requested</p><p className="text-2xl font-bold">{counts.revisions}</p></div>
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 p-4"><p className="text-xs text-emerald-700 dark:text-emerald-300">Approved</p><p className="text-2xl font-bold">{counts.approved}</p></div>
      </div>

      {queueError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-sm text-rose-700 dark:text-rose-300">{queueError}</div>}

      {incompleteDrafts.length > 0 && (
        <section className="rounded-2xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/60 dark:bg-amber-950/20 p-4 sm:p-5 space-y-3" aria-label="Interrupted or incomplete course generations">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
              <AlertTriangle size={18} />
              <h3 className="font-bold text-sm sm:text-base">Interrupted / Incomplete Generations ({incompleteDrafts.length})</h3>
            </div>
            <span className="text-xs text-amber-700 dark:text-amber-400">
              Excluded from Pending Review until all modules and lessons finish generating
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {incompleteDrafts.map((course) => {
              const isActivelyRunning = resumingCourseId === course.id || course.is_actively_running === true;
              const isDiscarding = discardingCourseId === course.id;
              const liveProgress = resumeStatusMap[course.id] || (
                isActivelyRunning
                  ? {
                      progress: typeof course.generation_progress === 'number' ? course.generation_progress : 10,
                      message: course.status_message || 'Authoring course curriculum on server…',
                      currentModule: course.current_module || null,
                      currentLesson: course.current_lesson || null,
                      completedLessons: course.completed_lessons ?? course.lesson_count ?? 0,
                      totalLessons: course.total_lessons ?? null,
                      activeProvider: course.active_provider || null,
                      elapsedSeconds: course.elapsed_seconds ?? null,
                      updatedAt: course.updated_at || null
                    }
                  : null
              );
              const badgeText = isActivelyRunning
                ? 'Active worker running…'
                : course.generation_status === 'cancelled'
                  ? 'Generation cancelled'
                  : 'Generation failed';

              return (
                <div key={course.id} className="rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">{course.code || course.id}</span>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white mt-0.5">{course.title}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">{course.department || 'Department not recorded'} · {course.level || 'Level not recorded'}</p>
                    </div>
                    <span className={
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold ' +
                      (isActivelyRunning
                        ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300'
                        : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300')
                    }>
                      {badgeText}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-400">
                    <span>{Number(course.module_count) || 0} modules saved in Neon</span>
                    <span>·</span>
                    <span>
                      {liveProgress?.totalLessons
                        ? `${liveProgress.completedLessons ?? Number(course.lesson_count) ?? 0} / ${liveProgress.totalLessons} lessons saved`
                        : `${Number(course.lesson_count) || 0} lessons saved`}
                    </span>
                    {!isActivelyRunning && Number(course.empty_module_count) > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-rose-600 dark:text-rose-400 font-medium">
                          {Number(course.empty_module_count)} module(s) with 0 lessons
                        </span>
                      </>
                    )}
                  </div>

                  {isActivelyRunning && liveProgress ? (
                    <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/80 dark:bg-indigo-950/40 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-indigo-800 dark:text-indigo-200">
                        <span className="truncate">{liveProgress.message}</span>
                        <span className="shrink-0">{liveProgress.progress}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-indigo-100 dark:bg-indigo-900 overflow-hidden">
                        <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${Math.max(5, Math.min(100, liveProgress.progress))}%` }} />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-indigo-700 dark:text-indigo-300">
                        <span>
                          {liveProgress.currentModule
                            ? `Module: ${liveProgress.currentModule}${liveProgress.currentLesson ? ` · Lesson: ${liveProgress.currentLesson}` : ''}`
                            : 'Verifying academic sources & curriculum structure…'}
                        </span>
                        <span>
                          {liveProgress.activeProvider ? `Provider: ${liveProgress.activeProvider}` : ''}
                          {typeof liveProgress.elapsedSeconds === 'number' ? ` · ${liveProgress.elapsedSeconds}s elapsed` : ''}
                        </span>
                      </div>
                    </div>
                  ) : course.generation_error ? (
                    <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 rounded-lg p-2.5 break-words">
                      {course.generation_error}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Generation stopped before all curriculum modules and lessons were completed.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleResumeIncompleteDraft(course.id)}
                      disabled={isActivelyRunning || isDiscarding}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {isActivelyRunning ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                      {isActivelyRunning ? 'Worker generating live…' : 'Resume generation'}
                    </button>

                    {confirmDiscardId === course.id ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleDiscardIncompleteDraft(course.id)}
                          disabled={isDiscarding}
                          className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                        >
                          <Trash2 size={13} />
                          {isDiscarding ? 'Discarding…' : 'Confirm discard'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDiscardId(null)}
                          disabled={isDiscarding}
                          className="rounded-xl border border-slate-200 dark:border-slate-700 px-2.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDiscardId(course.id)}
                        disabled={isDiscarding}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900/70 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        Discard failed draft
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,2fr)] gap-5">
        <aside className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-slate-900 dark:text-white">Draft queue</h3><span className="text-xs text-slate-500">{drafts.length} courses</span></div>
            <label className="relative block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, title or department" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            </label>
          </div>
          <div className="max-h-[620px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
            {loadingQueue && <p className="p-4 text-sm text-slate-500">Loading draft courses from Neon…</p>}
            {!loadingQueue && filteredDrafts.length === 0 && !queueError && <div className="p-6 text-center space-y-2"><FileText size={24} className="mx-auto text-slate-400" /><p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No draft courses awaiting review</p><p className="text-xs text-slate-500">Generated courses appear here after they are persisted as drafts.</p></div>}
            {filteredDrafts.map((course) => (
              <button key={course.id} type="button" onClick={() => setSelectedId(course.id)} className={'w-full text-left p-4 transition-colors ' + (selectedId === course.id ? 'bg-indigo-50 dark:bg-indigo-950/30 border-l-4 border-indigo-500' : 'hover:bg-slate-50 dark:hover:bg-slate-900/60')}>
                <div className="flex items-start justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{course.code || course.id}</span><span className={'rounded-full px-2 py-1 text-[10px] font-semibold ' + statusStyle(course.review_status)}>{statusLabel(course.review_status)}</span></div>
                <p className="font-semibold text-sm text-slate-900 dark:text-white mt-1">{course.title}</p>
                <p className="text-xs text-slate-500 mt-1">{course.department || 'Department not recorded'} · {course.level || 'Level not recorded'}</p>
                <div className="flex gap-3 mt-3 text-[11px] text-slate-500"><span>{Number(course.module_count) || 0} modules</span><span>{Number(course.lesson_count) || 0} lessons</span></div>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {loadingDetail && <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-8 text-center text-sm text-slate-500"><RefreshCw size={18} className="inline animate-spin mr-2" />Loading course review…</div>}
          {detailError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-sm text-rose-700 dark:text-rose-300">{detailError}</div>}
          {!loadingDetail && !bundle && !detailError && <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-10 text-center text-sm text-slate-500"><BookOpen size={28} className="mx-auto mb-3" />Select a draft course to inspect its content.</div>}

          {bundle && (
            <>
              <section className="rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">{bundle.course.code || bundle.course.id}</p><h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-1">{bundle.course.title}</h3><p className="text-xs text-slate-500 mt-2">{bundle.course.department || 'Department not recorded'} · {bundle.course.level || 'Level not recorded'} · {bundle.course.semester || 'Semester not recorded'}</p></div>
                  <span className={'rounded-full px-3 py-1.5 text-xs font-bold ' + statusStyle(bundle.course.review_status)}>{statusLabel(bundle.course.review_status)}</span>
                </div>
                <RichBlock title="Course description" value={bundle.course.description} />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-900 p-3"><span className="block text-slate-500">Modules</span><strong className="text-lg">{bundle.modules.length}</strong></div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-900 p-3"><span className="block text-slate-500">Lessons</span><strong className="text-lg">{bundle.modules.reduce((sum, item) => sum + item.lessons.length, 0)}</strong></div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-900 p-3"><span className="block text-slate-500">Stored formulas</span><strong className="text-lg">{bundle.formulas.length}</strong></div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-900 p-3"><span className="block text-slate-500">Last updated</span><strong className="block mt-1">{dateLabel(bundle.course.updated_at)}</strong></div>
                </div>
                {bundle.course.review_notes && <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-sm"><strong>Reviewer note</strong><p className="mt-1 whitespace-pre-wrap">{bundle.course.review_notes}</p></div>}
                <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs leading-5 text-amber-900 dark:text-amber-200">A structurally complete lesson and correctly rendered equation do not prove academic accuracy. Check assumptions, units, derivations, calculations, references and curriculum coverage with an appropriately qualified reviewer before approving.</div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3"><h4 className="font-bold text-slate-900 dark:text-white">Course content preview</h4><span className="text-xs text-slate-500">Shared Markdown + KaTeX renderer</span></div>
                {bundle.modules.map((module) => (
                  <details key={module.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <summary className="cursor-pointer p-4 bg-slate-50 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2"><span className="font-bold text-sm">{module.order_index + 1}. {module.title}</span><span className="text-xs text-slate-500">{module.lessons.length} lessons</span></summary>
                    <div className="p-4 space-y-4">
                      {module.description && <RichBlock title="Module description" value={module.description} />}
                      {module.lessons.map((lesson) => (
                        <details key={lesson.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                          <summary className="cursor-pointer font-semibold text-sm">{lesson.order_index + 1}. {lesson.title}</summary>
                          <div className="mt-4 space-y-4">
                            <RichBlock title="Lesson Markdown" value={lesson.content_markdown} />
                            <div className="space-y-3"><h5 className="text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Structured mastery content</h5><StructuredLessonPreview content={lesson.instructional_content} /></div>
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
                {bundle.modules.length === 0 && <p className="text-sm text-slate-500 p-4">No persisted modules were returned for this draft.</p>}
              </section>

              <section className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2"><h4 className="font-bold text-slate-900 dark:text-white">Course formula reference</h4><span className="text-xs text-slate-500">{bundle.formulas.length} formulas</span></div>
                {bundle.formulas.map((formula) => (
                  <div key={formula.id} className="rounded-xl bg-slate-50 dark:bg-slate-900 p-4 space-y-2">
                    <h5 className="font-semibold text-sm">{formula.name}</h5>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-3"><MarkdownRenderer content={asDisplayMath(formula.latex_expression)} /></div>
                    <RichBlock title="Derivation / notes" value={formula.derivation_notes} />
                    {formula.variables_breakdown && <pre className="overflow-x-auto text-xs whitespace-pre-wrap text-slate-500">{JSON.stringify(formula.variables_breakdown, null, 2)}</pre>}
                  </div>
                ))}
                {bundle.formulas.length === 0 && <p className="text-sm text-slate-500">No course formulas are stored for this draft.</p>}
              </section>

              <section className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="font-bold text-slate-900 dark:text-white">Review decision</h4>
                <label className="block space-y-1"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Reviewer note / revision instructions</span><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} rows={4} maxLength={5000} placeholder="Record specific corrections, missing topics, calculation checks or references that need attention." className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /></label>
                {bundle.course.review_status === 'in_review' && (
                  <fieldset className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                    <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Required approval attestations</legend>
                    <p className="text-xs text-slate-500 dark:text-slate-400">These are explicit reviewer confirmations, not checks performed automatically by the AI.</p>
                    {([
                      ['subjectExpert', 'A qualified subject reviewer has checked the academic content.'],
                      ['calculations', 'Equations, derivations, units, assumptions and worked calculations have been checked.'],
                      ['curriculum', 'The course syllabus, learning outcomes and module coverage have been checked.'],
                      ['rendering', 'Mathematical notation, diagrams, tables and lesson formatting have been visually checked.']
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
                        <input type="checkbox" checked={approvalChecks[key]} onChange={(event) => setApprovalChecks((current) => ({ ...current, [key]: event.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                        <span>{label}</span>
                      </label>
                    ))}
                  </fieldset>
                )}

                <div className="flex flex-wrap gap-2">
                  {(bundle.course.review_status === 'pending' || bundle.course.review_status === 'needs_revision') && <button type="button" onClick={() => void submitReviewAction('start_review')} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Clock3 size={16} />Start review</button>}
                  {bundle.course.review_status === 'in_review' && <><button type="button" onClick={() => void submitReviewAction('request_revision')} disabled={Boolean(busy) || reviewNote.trim().length < 10} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 dark:border-amber-800 px-4 py-2.5 text-sm font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-50"><Send size={16} />Request changes</button><button type="button" onClick={() => void submitReviewAction('approve')} disabled={Boolean(busy) || !Object.values(approvalChecks).every(Boolean)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={16} />Approve course</button></>}
                  {bundle.course.review_status === 'approved' && <button type="button" onClick={() => void publishCourse()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><BookOpen size={16} />Publish to student catalog</button>}
                  {busy && <span className="inline-flex items-center gap-2 text-xs text-slate-500"><RefreshCw size={14} className="animate-spin" />{busy === 'publish' ? 'Publishing…' : 'Saving review decision…'}</span>}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="font-bold text-slate-900 dark:text-white">Review history</h4>
                {bundle.reviewHistory.length === 0 ? <p className="text-sm text-slate-500">No review events have been recorded yet.</p> : bundle.reviewHistory.map((event) => (
                  <div key={event.event_id} className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b last:border-0 border-slate-100 dark:border-slate-700 py-2">
                    <div><p className="text-sm font-semibold">{event.action.replace(/_/g, ' ')}</p><p className="text-xs text-slate-500">{event.actor_email || 'Admin account'} · {dateLabel(event.created_at)}</p>{event.notes && <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{event.notes}</p>}</div>
                    <span className="text-xs text-slate-500">{event.from_status || '—'} → {event.to_status || '—'}</span>
                  </div>
                ))}
              </section>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
