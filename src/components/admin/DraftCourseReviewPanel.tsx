import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Clock3, FileText, RefreshCw, Search, Send, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import MarkdownRenderer from '../MarkdownRenderer';

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
  review_notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  module_count: number;
  lesson_count: number;
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
  const [selectedId, setSelectedId] = useState('');
  const [bundle, setBundle] = useState<ReviewBundle | null>(null);
  const [search, setSearch] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [approvalChecks, setApprovalChecks] = useState({ subjectExpert: false, calculations: false, curriculum: false, rendering: false });
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState<ReviewAction | 'publish' | null>(null);
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

  const loadQueue = async () => {
    setLoadingQueue(true);
    setQueueError('');
    try {
      const response = await fetch('/api/admin/courses/drafts', { headers: await headers() });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Unable to load the draft queue.');
      if (!Array.isArray(data?.courses)) throw new Error('The draft queue response is incomplete.');
      setDrafts(data.courses);
    } catch (error: any) {
      setDrafts([]);
      setQueueError(error?.message || 'Unable to load the draft queue.');
    } finally {
      setLoadingQueue(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setDrafts([]);
      setSelectedId('');
      setBundle(null);
      return;
    }
    void loadQueue();
  }, [user, refreshKey]);

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
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-3"><MarkdownRenderer content={'$$\n' + formula.latex_expression + '\n$$'} /></div>
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
