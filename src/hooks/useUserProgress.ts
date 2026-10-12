import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { UserProgress, Achievement, Bookmark, CourseId, AIPersonality, Department } from '../types';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { doc, setDoc, onSnapshot, getDoc, updateDoc, arrayUnion, arrayRemove, increment } from 'firebase/firestore';
import { GamificationService, BADGES } from '../services/gamification';
import { useCourses } from '../context/CourseContext';
import { DEPARTMENT_TO_FACULTY } from '../constants';
import { CurriculumIntegrityService } from '../services/curriculumIntegrity';
import { useProgressStore } from '../lib/progressStore';
import { LogService } from '../services/logService';
import { isCourseEligibleForUser } from '../utils/courseEligibility';
import { CourseService } from '../services/courseService';
import { generateCourseContent } from '../services/aiCourseGenerator';

const INITIAL_ACHIEVEMENTS: Achievement[] = BADGES.map(b => ({
  id: b.id,
  title: b.title,
  description: b.description,
  icon: b.icon,
  unlockedAt: null
}));

const INITIAL_PROGRESS: UserProgress = {
  xp: 0,
  level: 1,
  streak: 0,
  lastStudyDate: null,
  mastery: {},
  achievements: INITIAL_ACHIEVEMENTS,
  studyTime: {},
  topicLastStudied: {},
  bookmarks: [],
  enrolledCourses: [], // Default enrollment
  assignments: [],
};

// Module-level singleton state to prevent multiple mounted useUserProgress() hooks
// from registering duplicate onSnapshot listeners or firing parallel duplicate writes.
const PROGRESS_SESSION_ID = `${Date.now()}`;
let progressBatchSeq = 0;
let activeListenerUid: string | null = null;
let activeListenerUnsubscribe: (() => void) | null = null;
let activeListenerRefCount = 0;
let hasCompletedInitialServerSync = false;
let lastServerCommittedFullJson = '';
let lastServerCommittedMilestoneJson = '';
let pendingMilestoneTimer: ReturnType<typeof setTimeout> | null = null;
let pendingStudyCheckpointTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightBatchId: string | null = null;

function extractAllowedProgressPayload(progressObj: UserProgress): Record<string, any> {
  const {
    xp,
    level,
    mastery,
    achievements,
    enrolledCourses,
    role,
    plan_type,
    subscription_expiry,
    subscription_status,
    subscription_start_date,
    last_spark_reset,
    last_payment_ref,
    ai_sparks,
    free_sparks,
    paid_sparks,
    frozen_disputed_sparks,
    bucketSource,
    ...allowedProgress
  } = (progressObj || {}) as any;
  return allowedProgress;
}

function extractMilestoneOnlyJson(allowed: Record<string, any>): string {
  const { studyTime, topicLastStudied, ...milestoneOnly } = allowed;
  return JSON.stringify(milestoneOnly);
}

async function flushCoalescedProgressBatch(
  currentUser: { uid: string; getIdToken: (force?: boolean) => Promise<string> },
  allowedPayload: Record<string, any>,
  existingBatchId?: string
): Promise<boolean> {
  const fullJson = JSON.stringify(allowedPayload);
  if (fullJson === lastServerCommittedFullJson) {
    return true;
  }

  const pendingStorageKey = `uniace_pending_progress_batch_v1_${currentUser.uid}`;
  let syncBatchId = existingBatchId;
  let clientSequence = progressBatchSeq;

  if (!syncBatchId) {
    progressBatchSeq += 1;
    clientSequence = progressBatchSeq;
    syncBatchId = `${currentUser.uid}_${PROGRESS_SESSION_ID}_${clientSequence}`;
    try {
      localStorage.setItem(
        pendingStorageKey,
        JSON.stringify({
          syncBatchId,
          clientSequence,
          payload: allowedPayload,
          savedAtIso: new Date().toISOString()
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  if (inFlightBatchId === syncBatchId) {
    return false;
  }
  inFlightBatchId = syncBatchId;

  try {
    const token = await currentUser.getIdToken(false);
    const response = await fetch('/api/user/progress-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      keepalive: true,
      body: JSON.stringify({
        syncBatchId,
        clientSequence,
        ...allowedPayload
      })
    });

    if (response.ok) {
      lastServerCommittedFullJson = fullJson;
      lastServerCommittedMilestoneJson = extractMilestoneOnlyJson(allowedPayload);
      try {
        const storedRaw = localStorage.getItem(pendingStorageKey);
        if (storedRaw) {
          const stored = JSON.parse(storedRaw);
          if (stored?.syncBatchId === syncBatchId) {
            localStorage.removeItem(pendingStorageKey);
          }
        }
      } catch {
        // Ignore localStorage parse errors
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[ProgressSync] Deferred progress batch retry:', err);
    return false;
  } finally {
    if (inFlightBatchId === syncBatchId) {
      inFlightBatchId = null;
    }
  }
}

export function useUserProgress() {
  const { user, profile } = useAuth();
  const { progress, setProgress, isOnline, setIsOnline, integrityIssues, setIntegrityIssues } = useProgressStore();
  const hasInitialSyncRef = useRef(false);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Merge function to combine local and server data
  const mergeProgress = useCallback((local: UserProgress, server: UserProgress): UserProgress => {
    const mergedMastery: Record<string, number> = {};
    const allMasteryKeys = new Set([
      ...Object.keys(local.mastery || {}),
      ...Object.keys(server.mastery || {})
    ]);
    allMasteryKeys.forEach(key => {
      const lVal = local.mastery?.[key];
      const sVal = server.mastery?.[key];
      const cleanL = typeof lVal === 'number' && !isNaN(lVal) && lVal >= 0 && lVal <= 100 ? lVal : 0;
      const cleanS = typeof sVal === 'number' && !isNaN(sVal) && sVal >= 0 && sVal <= 100 ? sVal : 0;
      const best = Math.max(cleanL, cleanS);
      if (best > 0) {
        mergedMastery[key] = best;
      }
    });

    const mergedStudyTime = { ...local.studyTime, ...server.studyTime };
    Object.keys(mergedStudyTime).forEach(key => {
      if (local.studyTime[key] && server.studyTime[key]) {
        mergedStudyTime[key] = Math.max(local.studyTime[key], server.studyTime[key]);
      }
    });

    const mergedTopicLastStudied = { ...local.topicLastStudied, ...server.topicLastStudied };
    Object.keys(mergedTopicLastStudied).forEach(key => {
      if (local.topicLastStudied[key] && server.topicLastStudied[key]) {
        const localDate = new Date(local.topicLastStudied[key]);
        const serverDate = new Date(server.topicLastStudied[key]);
        mergedTopicLastStudied[key] = localDate > serverDate ? local.topicLastStudied[key] : server.topicLastStudied[key];
      }
    });

    const bookmarkMap = new Map<string, Bookmark>();
    [...(local.bookmarks || []), ...(server.bookmarks || [])].forEach(b => {
      if (b && b.id) bookmarkMap.set(b.id, b);
    });
    const mergedBookmarks = Array.from(bookmarkMap.values());

    const achievementMap = new Map<string, Achievement>();
    [...(local.achievements || []), ...(server.achievements || [])].forEach(a => {
      if (!a || !a.id) return;
      const existing = achievementMap.get(a.id);
      if (!existing || (a.unlockedAt && !existing.unlockedAt)) {
        achievementMap.set(a.id, a);
      }
    });
    const mergedAchievements = Array.from(achievementMap.values());

    const mergedAssignments = (Array.isArray(server.assignments) && server.assignments.length > 0)
      ? server.assignments
      : (Array.isArray(local.assignments) ? local.assignments : []);

    const mergedEnrolledCourses = Array.from(new Set([
      ...(local.enrolledCourses || []),
      ...(server.enrolledCourses || [])
    ])).filter(Boolean);

    const mergedXp = Math.max(local.xp || 0, server.xp || 0);
    const mergedLevel = GamificationService.calculateLevel(mergedXp).level;

    return {
      xp: mergedXp,
      level: mergedLevel,
      streak: Math.max(local.streak || 0, server.streak || 0),
      lastStudyDate: local.lastStudyDate && server.lastStudyDate 
        ? (new Date(local.lastStudyDate) > new Date(server.lastStudyDate) ? local.lastStudyDate : server.lastStudyDate)
        : (local.lastStudyDate || server.lastStudyDate || null),
      mastery: mergedMastery,
      achievements: mergedAchievements,
      studyTime: mergedStudyTime,
      topicLastStudied: mergedTopicLastStudied,
      bookmarks: mergedBookmarks,
      enrolledCourses: mergedEnrolledCourses,
      assignments: mergedAssignments,
      srsData: { ...(local.srsData || {}), ...(server.srsData || {}) },
      aiPersonality: server.aiPersonality || local.aiPersonality,
      quizHistory: (Array.isArray(server.quizHistory) && server.quizHistory.length >= (local.quizHistory?.length || 0))
        ? server.quizHistory
        : (local.quizHistory || server.quizHistory || []),
      quizzesCompleted: Math.max(local.quizzesCompleted || 0, server.quizzesCompleted || 0)
    };
  }, []);

  // Singleton Firestore listener shared across all hook consumers
  useEffect(() => {
    if (!user) {
      hasInitialSyncRef.current = false;
      hasCompletedInitialServerSync = false;
      return;
    }

    activeListenerRefCount += 1;
    if (activeListenerUid !== user.uid || !activeListenerUnsubscribe) {
      if (activeListenerUnsubscribe) {
        activeListenerUnsubscribe();
      }
      activeListenerUid = user.uid;
      const userDocRef = doc(db, 'users', user.uid);

      activeListenerUnsubscribe = onSnapshot(
        userDocRef,
        (docSnap) => {
          hasInitialSyncRef.current = true;
          hasCompletedInitialServerSync = true;
          if (docSnap.exists()) {
            const serverData = docSnap.data() as UserProgress;
            setProgress(prev => {
              const mergedData = mergeProgress(prev, {
                ...INITIAL_PROGRESS,
                ...serverData,
                assignments: Array.isArray(serverData.assignments) ? serverData.assignments : [],
                topicLastStudied: serverData.topicLastStudied || {},
                bookmarks: serverData.bookmarks || []
              });

              const allowedFromMerged = extractAllowedProgressPayload(mergedData);
              lastServerCommittedFullJson = JSON.stringify(allowedFromMerged);
              lastServerCommittedMilestoneJson = extractMilestoneOnlyJson(allowedFromMerged);

              if (JSON.stringify(prev) !== JSON.stringify(mergedData)) {
                return mergedData;
              }
              return prev;
            });
          }
        },
        (error) => {
          hasInitialSyncRef.current = true;
          hasCompletedInitialServerSync = true;
          console.error('Error syncing user progress:', error);
        }
      );

      // Replay any unacknowledged durable batch from a prior tab session
      const pendingStorageKey = `uniace_pending_progress_batch_v1_${user.uid}`;
      try {
        const rawPending = localStorage.getItem(pendingStorageKey);
        if (rawPending) {
          const parsed = JSON.parse(rawPending);
          if (parsed?.syncBatchId && parsed?.payload) {
            void flushCoalescedProgressBatch(user, parsed.payload, parsed.syncBatchId);
          }
        }
      } catch {
        // Ignore malformed localStorage entry
      }
    } else {
      hasInitialSyncRef.current = hasCompletedInitialServerSync;
    }

    return () => {
      activeListenerRefCount = Math.max(0, activeListenerRefCount - 1);
      if (activeListenerRefCount === 0 && activeListenerUnsubscribe) {
        activeListenerUnsubscribe();
        activeListenerUnsubscribe = null;
        activeListenerUid = null;
      }
    };
  }, [user?.uid, isOnline, mergeProgress]);

  // Coalesced, idempotent persistence: 5s debounce for milestone changes, 5-minute checkpoint for studyTime
  useEffect(() => {
    try {
      localStorage.setItem('uniace_user_progress', JSON.stringify(progress));
    } catch {
      // Ignore storage access errors
    }

    if (!user || !isOnline || !hasCompletedInitialServerSync || !profile) {
      return;
    }

    const allowedProgress = extractAllowedProgressPayload(progress);
    const fullJson = JSON.stringify(allowedProgress);
    if (fullJson === lastServerCommittedFullJson) {
      return;
    }

    const milestoneJson = extractMilestoneOnlyJson(allowedProgress);
    const isMilestoneMutation = milestoneJson !== lastServerCommittedMilestoneJson;

    if (isMilestoneMutation) {
      if (pendingMilestoneTimer) {
        clearTimeout(pendingMilestoneTimer);
      }
      pendingMilestoneTimer = setTimeout(() => {
        pendingMilestoneTimer = null;
        void flushCoalescedProgressBatch(user, extractAllowedProgressPayload(useProgressStore.getState().progress));
      }, 5000);
    } else if (!pendingStudyCheckpointTimer) {
      // Study-time only change: coalesce into a 5-minute durable checkpoint flush
      pendingStudyCheckpointTimer = setTimeout(() => {
        pendingStudyCheckpointTimer = null;
        void flushCoalescedProgressBatch(user, extractAllowedProgressPayload(useProgressStore.getState().progress));
      }, 5 * 60 * 1000);
    }
  }, [progress, user?.uid, isOnline, Boolean(profile)]);

  // Flush pending progress on visibilitychange (when tab is hidden)
  useEffect(() => {
    if (!user) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && hasCompletedInitialServerSync) {
        const latestAllowed = extractAllowedProgressPayload(useProgressStore.getState().progress);
        void flushCoalescedProgressBatch(user, latestAllowed);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user?.uid]);

  const saveImmediately = useCallback(async (newProgress: UserProgress) => {
    if (!user || !isOnline || !hasCompletedInitialServerSync) return;
    try {
      if (pendingMilestoneTimer) {
        clearTimeout(pendingMilestoneTimer);
        pendingMilestoneTimer = null;
      }
      if (pendingStudyCheckpointTimer) {
        clearTimeout(pendingStudyCheckpointTimer);
        pendingStudyCheckpointTimer = null;
      }
      const allowedProgress = extractAllowedProgressPayload(newProgress);
      await flushCoalescedProgressBatch(user, allowedProgress);
    } catch (err) {
      console.error('Error in immediate sync:', err);
    }
  }, [user, isOnline]);

  const processNewBadges = (prevAchievements: Achievement[], newBadges: Achievement[]) => {
    let updatedAchievements = [...prevAchievements];
    let totalSparksReward = 0;
    
    if (newBadges.length > 0) {
      newBadges.forEach(newBadge => {
        const index = updatedAchievements.findIndex(a => a.id === newBadge.id);
        if (index !== -1) {
          updatedAchievements[index] = newBadge;
        } else {
          updatedAchievements.push(newBadge);
          // Award sparks for new badges (e.g., 50 sparks per badge)
          totalSparksReward += 50; 
        }
      });
    }

    return { updatedAchievements, totalSparksReward };
  };

  const awardBadgeSparks = async (amount: number) => {
    if (amount > 0 && user && isOnline) {
      try {
        const idToken = await user.getIdToken();
        await fetch('/api/user/reward-badge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ amount })
        });
        import('../services/logService').then(({ LogService }) => {
          LogService.log('success', 'user', `Awarded ${amount} AI Sparks for unlocking badges!`).catch(console.error);
        });
      } catch (err) {
        console.error("Error awarding sparks:", err);
      }
    }
  };

  const addXp = (amount: number) => {
    let sparksToAward = 0;
    setProgress(prev => {
      const newXp = prev.xp + amount;
      const newLevel = GamificationService.calculateLevel(newXp).level;
      
      const tempProgress = { ...prev, xp: newXp, level: newLevel };
      const newBadges = GamificationService.checkNewBadges(tempProgress);
      
      const { updatedAchievements, totalSparksReward } = processNewBadges(prev.achievements, newBadges);
      sparksToAward = totalSparksReward;

      const finalProgress = { ...prev, xp: newXp, level: newLevel, achievements: updatedAchievements };
      if (newLevel > prev.level) {
        saveImmediately(finalProgress);
      }
      return finalProgress;
    });

    if (sparksToAward > 0) {
      awardBadgeSparks(sparksToAward);
    }

    if (user && isOnline) {
      user.getIdToken().then(idToken => {
        fetch('/api/user/reward-xp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ amount })
        }).catch(err => console.error("Error rewarding XP on server:", err));
      });
    }
  };

  const checkAndUpdateStreak = () => {
    setProgress(prev => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let newStreak = prev.streak;
      let newLastStudyDate = prev.lastStudyDate;

      if (prev.lastStudyDate) {
        const lastStudy = new Date(prev.lastStudyDate);
        lastStudy.setHours(0, 0, 0, 0);
        
        const diffTime = Math.abs(today.getTime() - lastStudy.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

        if (diffDays === 1) {
          // Studied yesterday, increment streak
          newStreak += 1;
          newLastStudyDate = new Date().toISOString();
        } else if (diffDays > 1) {
          // Missed a day, reset streak
          newStreak = 1;
          newLastStudyDate = new Date().toISOString();
        } else {
          // Already studied today, do nothing
          return prev;
        }
      } else {
        // First time studying
        newStreak = 1;
        newLastStudyDate = new Date().toISOString();
      }

      const tempProgress = { ...prev, streak: newStreak, lastStudyDate: newLastStudyDate };
      const newBadges = GamificationService.checkNewBadges(tempProgress);
      
      const { updatedAchievements, totalSparksReward } = processNewBadges(prev.achievements, newBadges);
      
      if (totalSparksReward > 0) {
        awardBadgeSparks(totalSparksReward);
      }

      const finalProgress = { ...tempProgress, achievements: updatedAchievements };
      saveImmediately(finalProgress);
      return finalProgress;
    });
  };

  const updateMastery = async (topicId: string, score: number) => {
    let sparksToAward = 0;
    setProgress(prev => {
      const currentMastery = prev.mastery[topicId] || 0;
      const newMastery = Math.max(currentMastery, score);
      
      if (score > currentMastery) {
        // Log mastery improvement
        import('../services/logService').then(({ LogService }) => {
          LogService.log('success', 'user', `Improved mastery for ${topicId}: ${currentMastery}% -> ${score}%`).catch(console.error);
        });
      }

      const tempProgress = { 
        ...prev, 
        mastery: { ...prev.mastery, [topicId]: newMastery },
        topicLastStudied: { ...prev.topicLastStudied, [topicId]: new Date().toISOString() },
        lastStudyDate: new Date().toISOString()
      };

      // Check for achievements
      const newBadges = GamificationService.checkNewBadges(tempProgress);
      const { updatedAchievements, totalSparksReward } = processNewBadges(prev.achievements, newBadges);
      sparksToAward = totalSparksReward;

      const finalProgress = { 
        ...tempProgress,
        achievements: updatedAchievements,
      };

      // If mastery improved significantly (e.g., > 10% or reached 100%), save immediately
      if (score - currentMastery > 10 || score === 100) {
        saveImmediately(finalProgress);
      }
      return finalProgress;
    });

    if (sparksToAward > 0) {
      awardBadgeSparks(sparksToAward);
    }

    if (user && isOnline) {
      user.getIdToken().then(idToken => {
        fetch('/api/user/update-mastery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ topicId, score })
        }).catch(err => console.error("Error updating mastery on server:", err));
      });
    }
  };

  
  const recordQuizScore = (courseId: string, topicId: string, score: number) => {
    setProgress(prev => {
      const history = prev.quizHistory || [];
      const newHistory = [...history, {
        date: new Date().toISOString(),
        score,
        courseId,
        topicId
      }];
      // Keep only last 100 quizzes to prevent unlimited growth
      if (newHistory.length > 100) newHistory.shift();
      const tempProgress = {
        ...prev,
        quizHistory: newHistory,
        quizzesCompleted: (prev.quizzesCompleted || 0) + 1
      };
      saveImmediately(tempProgress);
      return tempProgress;
    });
  };

  const recordStudyTime = (topicId: string, seconds: number) => {
    setProgress(prev => ({
      ...prev,
      studyTime: { ...prev.studyTime, [topicId]: (prev.studyTime[topicId] || 0) + seconds }
    }));
    // Check streak when studying
    checkAndUpdateStreak();
  };

  const unlockAchievement = (id: string) => {
    setProgress(prev => ({
      ...prev,
      achievements: prev.achievements.map(a => 
        a.id === id && !a.unlockedAt ? { ...a, unlockedAt: new Date().toISOString() } : a
      )
    }));
  };

  const markTopicAsStudied = (topicId: string) => {
    setProgress(prev => ({
      ...prev,
      topicLastStudied: { ...prev.topicLastStudied, [topicId]: new Date().toISOString() },
      lastStudyDate: new Date().toISOString()
    }));
  };

  const addBookmark = (item: any, type: 'formula' | 'question', note?: string) => {
    const newBookmark = {
      id: crypto.randomUUID(),
      type,
      content: item,
      timestamp: new Date().toISOString(),
      note
    };
    setProgress(prev => ({
      ...prev,
      bookmarks: [...prev.bookmarks, newBookmark]
    }));
  };

  const removeBookmark = (bookmarkId: string) => {
    setProgress(prev => ({
      ...prev,
      bookmarks: prev.bookmarks.filter(b => b.id !== bookmarkId)
    }));
  };

  const enrollCourse = async (courseId: CourseId, courseTitle?: string, courseDesc?: string) => {
    setProgress(prev => {
      if (prev.enrolledCourses?.includes(courseId)) return prev;
      
      // Log enrollment
      LogService.log('info', 'user', `Enrolled in course: ${courseTitle || courseId}`).catch(console.error);

      return {
        ...prev,
        enrolledCourses: [...(prev.enrolledCourses || []), courseId]
      };
    });

    if (user && isOnline) {
      try {
        const idToken = await user.getIdToken();
        await fetch('/api/user/enroll-course', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ courseId })
        });

        // Check if course content exists in Firestore
        const { CourseService } = await import('../services/courseService');
        const course = await CourseService.getCourse(courseId);
        
        // If course doesn't exist or has no modules, and we have info to generate it
        if ((!course || !course.syllabus || course.syllabus.length === 0) && courseTitle) {
          const { generateCourseContent } = await import('../services/aiCourseGenerator');
          const generatedData = await generateCourseContent(courseTitle, courseDesc || '');
          await CourseService.saveGeneratedCourse(courseId, generatedData);
        }
      } catch (error: any) {
        console.error("Error updating enrolled courses or generating content:", error);
      }
    }
  };

  const unenrollCourse = async (courseId: CourseId) => {
    setProgress(prev => {
      if (!prev.enrolledCourses?.includes(courseId)) return prev;
      
      // Log unenrollment
      import('../services/logService').then(({ LogService }) => {
        LogService.log('info', 'user', `Unenrolled from course: ${courseId}`).catch(console.error);
      });

      return {
        ...prev,
        enrolledCourses: prev.enrolledCourses.filter(id => id !== courseId)
      };
    });

    if (user && isOnline) {
      try {
        const idToken = await user.getIdToken();
        await fetch('/api/user/unenroll-course', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ courseId })
        });
      } catch (error: any) {
        console.error("Error updating enrolled courses:", error);
      }
    }
  };

  const updateSRSData = (cardId: string, data: any) => {
    setProgress(prev => ({
      ...prev,
      srsData: {
        ...prev.srsData,
        [cardId]: data
      }
    }));
  };

  const updateAIPersonality = (personality: AIPersonality) => {
    setProgress(prev => ({
      ...prev,
      aiPersonality: personality
    }));
  };

  const { courses } = useCourses();

  const effectiveEnrolledCourses = useMemo(() => {
    const explicit = progress.enrolledCourses || [];
    if (!profile?.department || !profile?.academic_level || !profile?.semester) {
      return explicit;
    }

    const activeSemester = profile.semester;
    const programCourses = Object.values(courses)
      .filter(c => isCourseEligibleForUser(c, profile, activeSemester, explicit))
      .map(c => c.id as CourseId);

    return Array.from(new Set([...explicit, ...programCourses]));
  }, [progress.enrolledCourses, profile, courses]);

  const effectiveProgress = useMemo(() => ({
    ...progress,
    enrolledCourses: effectiveEnrolledCourses
  }), [progress, effectiveEnrolledCourses]);

  // Curriculum Integrity Watchdog
  useEffect(() => {
    if (!user || !profile || !isOnline) return;
    
    // Only validate if profile is complete
    if (!profile.department || !profile.academic_level || !profile.semester) return;

    const validate = async () => {
      try {
        const issues = await CurriculumIntegrityService.validateUserCurriculum(
          user.uid,
          profile,
          effectiveEnrolledCourses
        );
        setIntegrityIssues(issues);
      } catch (error) {
        console.error("Integrity validation failed:", error);
      }
    };

    // Debounce validation to avoid spamming Firestore
    const timer = setTimeout(validate, 2000);
    return () => clearTimeout(timer);
  }, [user, profile, effectiveEnrolledCourses, isOnline]);

  return { progress: effectiveProgress, integrityIssues, addXp, updateMastery, recordQuizScore, recordStudyTime, unlockAchievement, markTopicAsStudied, addBookmark, removeBookmark, enrollCourse, unenrollCourse, updateSRSData, updateAIPersonality, isOnline, checkAndUpdateStreak };
}
