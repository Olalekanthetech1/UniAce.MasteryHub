import React, { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Loader2, Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  CourseService,
  type AcademicLevelOption,
  type StudentAvailability
} from '../../services/courseService';

const STATE_LABELS: Record<StudentAvailability, string> = {
  live: 'Live',
  coming_soon: 'Coming Soon',
  hidden: 'Hidden'
};

export default function AcademicAvailabilityManager() {
  const [levels, setLevels] = useState<AcademicLevelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLevels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await CourseService.getAdminAcademicLevels();
      setLevels(result);
    } catch (err: any) {
      setError(err?.message || 'Academic level settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLevels();
  }, [loadLevels]);

  const updateAvailability = async (levelKey: string, availability: StudentAvailability) => {
    setUpdatingKey(levelKey);
    try {
      await CourseService.updateAcademicLevel(levelKey, { availability });
      toast.success(`${levelKey} Level availability updated to ${STATE_LABELS[availability]}.`);
      await loadLevels();
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
      await loadLevels();
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
          onClick={() => void loadLevels()}
          disabled={loading}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
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
          {levels.map(level => (
            <div key={level.level_key} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
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
          ))}
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
    </section>
  );
}
