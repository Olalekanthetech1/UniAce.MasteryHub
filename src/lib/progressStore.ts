import { create } from 'zustand';
import { UserProgress, Achievement } from '../types';
import { BADGES } from '../services/gamification';

const INITIAL_ACHIEVEMENTS: Achievement[] = BADGES.map(b => ({
  id: b.id,
  title: b.title,
  description: b.description,
  icon: b.icon,
  unlockedAt: null
}));

const INITIAL_PROGRESS: UserProgress = {
  xp: 0,
  level: 0,
  streak: 0,
  lastStudyDate: null,
  mastery: {},
  achievements: INITIAL_ACHIEVEMENTS,
  studyTime: {},
  topicLastStudied: {},
  bookmarks: [],
  enrolledCourses: [],
  assignments: [],
};

function cleanMasteryMap(rawMastery: any): Record<string, number> {
  if (!rawMastery || typeof rawMastery !== 'object') return {};
  const cleaned: Record<string, number> = {};
  for (const [key, val] of Object.entries(rawMastery)) {
    if (typeof val === 'number' && !isNaN(val) && val >= 0 && val <= 100) {
      cleaned[key] = val;
    }
  }
  return cleaned;
}

function getInitialProgress(): UserProgress {
  let parsed = INITIAL_PROGRESS;
  try {
    const saved = localStorage.getItem('uniace_user_progress') || localStorage.getItem('mat103_progress');
    if (saved) {
      parsed = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('localStorage access denied or invalid JSON, using initial progress');
  }
  return {
    ...INITIAL_PROGRESS,
    ...parsed,
    mastery: cleanMasteryMap(parsed?.mastery),
    assignments: Array.isArray(parsed?.assignments) ? parsed.assignments : [],
    topicLastStudied: parsed?.topicLastStudied || {},
    bookmarks: parsed?.bookmarks || []
  };
}

interface ProgressState {
  progress: UserProgress;
  isOnline: boolean;
  integrityIssues: any[];
  setProgress: (updater: UserProgress | ((prev: UserProgress) => UserProgress)) => void;
  setIsOnline: (isOnline: boolean) => void;
  setIntegrityIssues: (issues: any[]) => void;
}

export const useProgressStore = create<ProgressState>((set) => ({
  progress: getInitialProgress(),
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  integrityIssues: [],
  setProgress: (updater) => set((state) => {
    const nextProgress = typeof updater === 'function' ? updater(state.progress) : updater;
    try {
      localStorage.setItem('uniace_user_progress', JSON.stringify(nextProgress));
    } catch (e) {
      console.warn('localStorage access denied, cannot save progress locally');
    }
    return { progress: nextProgress };
  }),
  setIsOnline: (isOnline) => set({ isOnline }),
  setIntegrityIssues: (integrityIssues) => set({ integrityIssues }),
}));
