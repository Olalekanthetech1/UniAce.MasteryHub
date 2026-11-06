import React, { useEffect, useState } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import toast from 'react-hot-toast';
import { Course } from '../../types';
import { CourseService, type StudentAvailability } from '../../services/courseService';

interface CourseAvailabilityControlProps {
  course: Course;
  onChanged: () => Promise<void> | void;
}

const OPTIONS: Array<{ value: StudentAvailability; label: string }> = [
  { value: 'live', label: 'Live' },
  { value: 'coming_soon', label: 'Coming Soon' },
  { value: 'hidden', label: 'Hidden' }
];

export default function CourseAvailabilityControl({ course, onChanged }: CourseAvailabilityControlProps) {
  const [availability, setAvailability] = useState<StudentAvailability>(
    course.studentVisibility === 'live' || course.studentVisibility === 'coming_soon'
      ? course.studentVisibility
      : 'hidden'
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAvailability(
      course.studentVisibility === 'live' || course.studentVisibility === 'coming_soon'
        ? course.studentVisibility
        : 'hidden'
    );
  }, [course.studentVisibility]);

  const handleChange = async (next: StudentAvailability) => {
    if (saving || next === availability) return;
    const previous = availability;
    setAvailability(next);
    setSaving(true);
    try {
      await CourseService.updateCourseAvailability(course.id, next);
      toast.success(`${course.id} student availability set to ${OPTIONS.find(option => option.value === next)?.label}.`);
      await onChanged();
    } catch (error: any) {
      setAvailability(previous);
      toast.error(error?.message || 'Course availability update failed.');
    } finally {
      setSaving(false);
    }
  };

  const levelLocked = course.levelAvailability !== 'live';

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label htmlFor={`course-availability-${course.id}`} className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        Student access
      </label>
      <div className="flex items-center gap-2">
        {saving ? (
          <Loader2 size={15} className="animate-spin text-indigo-500" />
        ) : (
          <LockKeyhole size={14} className={availability === 'live' && !levelLocked ? 'text-emerald-500' : 'text-amber-500'} />
        )}
        <select
          id={`course-availability-${course.id}`}
          aria-label={`Student availability for ${course.title}`}
          value={availability}
          disabled={saving}
          onChange={event => void handleChange(event.target.value as StudentAvailability)}
          className="min-h-10 max-w-[145px] rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        >
          {OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      {levelLocked && (
        <span className="w-full text-[11px] text-amber-600 dark:text-amber-400">
          The academic level is not Live, so students remain locked out.
        </span>
      )}
    </div>
  );
}
