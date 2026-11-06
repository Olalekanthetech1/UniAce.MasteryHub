import React, { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Loader2, Plus, RefreshCw, History } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCourses } from '../../context/CourseContext';
import {
  CourseService,
  type AcademicLevelOption,
  type AcademicAvailabilityAuditEntry,
  type StudentAvailability
} from '../../services/courseService';

const STATE_LABELS: Record<StudentAvailability, string> = {
  live: 'Live',
  coming_soon: 'Coming Soon',
  hidden: 'Hidden'
};

function normalizeLevelKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().toLowerCase()
    .replace(/^level\s*/, '')
    .replace(/\s*(?:level|lvl|l)$/, '')
    .replace(/[^a-z0-9_-]/g, '');
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

export default function AcademicAvailabilityManager() {
  const { courses } = useCourses();
  const [levels, setLevels] = useState<AcademicLevelOption[]>([]);
  const [auditEntries, setAuditEntries] = useState<AcademicAvailabilityAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setAuditLoading(true);
    setError(null);
    setAuditError(null);

    const [levelsResult, auditResult] = await Promise.allSettled([
      CourseService.getAdminAcademicLevels(),
      CourseService.getAcademicAvailabilityAudit(15)
    ]);

    if (levelsResult.status === 'fulfilled') {
      setLevels(levelsResult.value);
    } else {
      setError((levelsResult.reason as Error)?.message || 'Academic level settings could not be loaded.');
    }
    if (auditResult.status === 'fulfilled') {
      setAuditEntries(auditResult.value);
    } else {
      setAuditError((auditResult.reason as Error)?.message || 'Availability history could not be loaded.');
    }

    setLoading(false);
    setAuditLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateAvailability = async (levelKey: string, availability: StudentAvailability) => {
    setUpdatingKey(levelKey);
    try {
      await CourseService.updateAcademicLevel(levelKey, { availability });
      toast.success(`${levelKey} Level availability updated to ${STATE_LABELS[availability]}.`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Academic level update failed.');
    } finally {
      setUpdatingKey(null);
    }
  };

  const addLevel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newKey.trim() || !newLabel.trim() || creating) return;
    setCreating(true);
    try {
      await CourseService.createAcademicLevel({
        levelKey: newKey.trim(),
        label: newLabel.trim(),
        availability: 'hidden',
        sortOrder: levels.length ? Math.max(...levels.map(level => level.sort_order)) + 100 : 100
      });
      setNewKey('');
      setNewLabel('');
      toast.success('Academic level added as Hidden. Make it Live only when its curriculum is ready.');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Academic level could not be added.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
            <GraduationCap className="text-indigo-500" size={23} />
            Academic Level Availability
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Control which levels students can select. Coming Soon remains visible but locked; Hidden is removed from student views.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading || auditLoading}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <RefreshCw size={15} className={loading || auditLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 size={18} className="animate-spin" /> Loading authoritative level settings…
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {levels.map(level => {
            const key = normalizeLevelKey(level.level_key);
            const levelCourses = Object.values(courses).filter(course => normalizeLevelKey(course.level) === key);
            const liveCount = levelCourses.filter(course =>
              course.studentVisibility === 'live' && course.levelAvailability === 'live'
            ).length;
            const lockedCount = levelCourses.length - liveCount;

            return (
              <div key={level.level_key} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900 dark:text-white">{level.label}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Key: {level.level_key}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {updatingKey === level.level_key && <Loader2 size={15} className="animate-spin text-indigo-500" />}
                    <select
                      aria-label={`Availability for ${level.label}`}
                      value={level.availability}
                      disabled={updatingKey !== null}
                      onChange={event => void updateAvailability(level.level_key, event.target.value as StudentAvailability)}
                      className="min-h-11 max-w-[145px] rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                    >
                      {Object.entries(STATE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
                  <div>
                    <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{levelCourses.length}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Published</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{liveCount}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Student live</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">{lockedCount}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Locked/hidden</p>
                  </div>
                </div>
                {level.availability === 'live' && liveCount === 0 && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    This level is Live, but no published courses are currently available to students.
                  </p>
                )}
              </div>
            );
          })}
          {levels.length === 0 && (
            <p className="col-span-full py-4 text-sm text-slate-500 dark:text-slate-400">
              No academic levels are configured. Add a level below.
            </p>
          )}
        </div>
      )}

      <form onSubmit={addLevel} className="mt-5 grid gap-3 border-t border-slate-100 pt-5 dark:border-slate-700 sm:grid-cols-[1fr_1.5fr_auto]">
        <input
          value={newKey}
          onChange={event => setNewKey(event.target.value)}
          maxLength={20}
          placeholder="Level key (e.g. 600)"
          aria-label="New academic level key"
          className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
        <input
          value={newLabel}
          onChange={event => setNewLabel(event.target.value)}
          maxLength={80}
          placeholder="Display label (e.g. 600 Level)"
          aria-label="New academic level label"
          className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
        <button
          type="submit"
          disabled={creating || !newKey.trim() || !newLabel.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Add Level
        </button>
      </form>

      <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-700">
        <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
          <History size={18} className="text-indigo-500" />
          Recent availability changes
        </h3>
        {auditLoading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Loading history…
          </div>
        ) : auditError ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{auditError}</p>
        ) : auditEntries.length === 0 ? (
          <p className="py-3 text-sm text-slate-500 dark:text-slate-400">No availability changes have been recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {auditEntries.map(entry => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5 dark:border-slate-700">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {entry.entity_type === 'academic_level' ? 'Level' : 'Course'}: {entry.entity_id}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {entry.previous_state || 'Initial state'} → {entry.next_state} · Admin {entry.actor_uid.slice(0, 8)}
                  </p>
                </div>
                <time className="text-xs text-slate-500 dark:text-slate-400">{formatDate(entry.created_at)}</time>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
