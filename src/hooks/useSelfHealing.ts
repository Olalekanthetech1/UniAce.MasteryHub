import { useEffect, useRef, useState, useCallback } from 'react';
import { useProgressStore } from '../lib/progressStore';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from './useNotifications';
import { LogService } from '../services/logService';
import { GamificationService, GamificationPolicy } from '../services/gamification';
import { UserProgress, Achievement } from '../types';
import { safeFetchJson } from '../utils/safeFetch';


export function useSelfHealing() {
  const { user, profile } = useAuth();
  const { progress, setProgress, isOnline } = useProgressStore();
  const { sendNotification } = useNotifications();
  const [isHealing, setIsHealing] = useState(false);
  const [gamificationPolicy, setGamificationPolicy] = useState<GamificationPolicy | null>(null);
  
  // Prevent concurrent or loop healing
  const healingRef = useRef(false);
  const lastCheckRef = useRef<number>(0);

  // Resolve the authoritative gamification policy before evaluating levels or repairing badges.
  useEffect(() => {
    let active = true;
    setGamificationPolicy(null);
    if (!user || !isOnline) {
      return () => { active = false; };
    }

    GamificationService.getPolicy()
      .then(policy => {
        if (active) setGamificationPolicy(policy);
      })
      .catch(error => {
        if (active) {
          console.error('[Self-Healing] Live gamification policy unavailable; level and badge repair is paused.', error);
        }
      });

    return () => { active = false; };
  }, [user?.uid, isOnline]);

  // Checks whether the current local progress has any corruption/discrepancies
  const checkStateCorruption = useCallback((currentProgress: UserProgress): { corrupted: boolean; reason: string } => {
    if (!currentProgress) {
      return { corrupted: true, reason: 'Progress state is null or undefined.' };
    }

    // 1. Check for basic type or undefined/null/NaN structural failures
    if (
      typeof currentProgress.xp !== 'number' || 
      isNaN(currentProgress.xp) || 
      currentProgress.xp < 0
    ) {
      return { corrupted: true, reason: 'Invalid or negative XP detected.' };
    }

    if (
      typeof currentProgress.level !== 'number' || 
      isNaN(currentProgress.level) || 
      currentProgress.level < 1
    ) {
      return { corrupted: true, reason: 'Invalid level value detected.' };
    }

    if (
      typeof currentProgress.streak !== 'number' || 
      isNaN(currentProgress.streak) || 
      currentProgress.streak < 0
    ) {
      return { corrupted: true, reason: 'Streak counter is invalid.' };
    }

    // 2. Verify level calculations only when the live policy has been loaded.
    if (gamificationPolicy) {
      const calculatedLevel = GamificationService.calculateLevel(currentProgress.xp, gamificationPolicy).level;
      if (calculatedLevel !== currentProgress.level) {
        return { corrupted: true, reason: `Level mismatch. Expected: ${calculatedLevel}, Current: ${currentProgress.level}` };
      }
    }

    // 3. Check for array structures
    if (!Array.isArray(currentProgress.achievements)) {
      return { corrupted: true, reason: 'Achievements array is missing.' };
    }

    if (!Array.isArray(currentProgress.enrolledCourses)) {
      return { corrupted: true, reason: 'Enrolled courses list is missing.' };
    }

    if (!Array.isArray(currentProgress.assignments)) {
      return { corrupted: true, reason: 'Assignments structure is invalid.' };
    }

    if (!Array.isArray(currentProgress.bookmarks)) {
      return { corrupted: true, reason: 'Bookmarks list is missing.' };
    }

    // 4. Validate mastery data structure
    if (typeof currentProgress.mastery !== 'object' || currentProgress.mastery === null) {
      return { corrupted: true, reason: 'Mastery records are missing or invalid.' };
    }

    // Check for any NaN values or invalid formats in mastery values
    const masteryValues = Object.values(currentProgress.mastery);
    if (masteryValues.some(val => typeof val !== 'number' || isNaN(val) || val < 0 || val > 100)) {
      return { corrupted: true, reason: 'Corrupt mastery percentage values detected.' };
    }

    // 5. Check if study date logic is broken
    if (currentProgress.streak > 0 && !currentProgress.lastStudyDate) {
      return { corrupted: true, reason: 'Active streak exists, but last study date is null.' };
    }

    // 6. Check for duplicate enrolled courses
    const duplicates = currentProgress.enrolledCourses.filter((item, index) => currentProgress.enrolledCourses.indexOf(item) !== index);
    if (duplicates.length > 0) {
      return { corrupted: true, reason: 'Duplicate enrolled courses detected.' };
    }

    return { corrupted: false, reason: '' };
  }, [gamificationPolicy]);

  // Triggers silent healing using authoritative server data; no repair occurs without live policy.
  const healState = useCallback(async (reason: string) => {
    if (healingRef.current || !user || !isOnline) return;
    if (!gamificationPolicy) {
      console.warn('[Self-Healing] Repair deferred because the authoritative gamification policy is unavailable.');
      return;
    }
    
    healingRef.current = true;
    setIsHealing(true);
    
    console.warn(`[Self-Healing] State corruption/stalled progress detected. Reason: ${reason}. Initiating repair...`);
    
    try {
      // 1. Silent re-sync with authoritative Neon server data via bootstrap endpoint
      const token = await user.getIdToken(false);
      const bootstrapRes = await safeFetchJson<any>('/api/user/bootstrap', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const serverData = (bootstrapRes.ok && bootstrapRes.data?.profile as Partial<UserProgress>) || {};
      
      // 2. Perform advanced data cleaning & repairs
      const repairedXp = Math.max(0, serverData.xp ?? progress.xp ?? 0);
      const repairedLevel = GamificationService.calculateLevel(repairedXp, gamificationPolicy).level;
      const repairedStreak = Math.max(0, serverData.streak ?? progress.streak ?? 0);
      
      // Repair achievements mapping to ensure no badges are lost or missing
      const policyAchievements: Achievement[] = gamificationPolicy.badges.map(badge => ({
        id: badge.id,
        title: badge.title,
        description: badge.description,
        icon: badge.icon,
        unlockedAt: null
      }));
      const achievementMap = new Map<string, Achievement>(
        policyAchievements.map(achievement => [achievement.id, { ...achievement }])
      );
      
      const combinedAchievements = [
        ...(progress.achievements || []),
        ...(serverData.achievements || [])
      ];

      combinedAchievements.forEach(ach => {
        if (!ach || typeof ach.id !== 'string' || !ach.id.trim() ||
            typeof ach.title !== 'string' || !ach.title.trim() ||
            typeof ach.description !== 'string' || !ach.description.trim() ||
            typeof ach.icon !== 'string' || !ach.icon.trim()) return;
        const base = achievementMap.get(ach.id);
        achievementMap.set(ach.id, {
          id: ach.id,
          title: base?.title || ach.title,
          description: base?.description || ach.description,
          icon: base?.icon || ach.icon,
          unlockedAt: typeof ach.unlockedAt === 'string' && ach.unlockedAt
            ? ach.unlockedAt
            : (base?.unlockedAt || null)
        });
      });
      const repairedAchievements = Array.from(achievementMap.values());

      // Restore enrolled courses and remove duplicates
      const enrolledRaw = [
        ...(progress.enrolledCourses || []),
        ...(serverData.enrolledCourses || [])
      ];
      const repairedEnrolledCourses = Array.from(new Set(enrolledRaw)).filter(Boolean);

      // Clean mastery percentages
      const repairedMastery: Record<string, number> = {};
      const combinedMasteryKeys = Array.from(new Set([
        ...Object.keys(progress.mastery || {}),
        ...Object.keys(serverData.mastery || {})
      ]));

      combinedMasteryKeys.forEach(topicId => {
        const localVal = progress.mastery?.[topicId] ?? 0;
        const serverVal = serverData.mastery?.[topicId] ?? 0;
        const cleanVal = Math.max(0, Math.min(100, typeof serverVal === 'number' && !isNaN(serverVal) ? serverVal : localVal));
        if (!isNaN(cleanVal) && cleanVal > 0) {
          repairedMastery[topicId] = cleanVal;
        }
      });

      // Clean study times
      const repairedStudyTime: Record<string, number> = {};
      const combinedStudyTimeKeys = Array.from(new Set([
        ...Object.keys(progress.studyTime || {}),
        ...Object.keys(serverData.studyTime || {})
      ]));
      combinedStudyTimeKeys.forEach(topicId => {
        const localTime = progress.studyTime?.[topicId] ?? 0;
        const serverTime = serverData.studyTime?.[topicId] ?? 0;
        repairedStudyTime[topicId] = Math.max(0, typeof serverTime === 'number' && !isNaN(serverTime) ? serverTime : localTime);
      });

      // Clean last study dates
      const repairedTopicLastStudied = {
        ...(progress.topicLastStudied || {}),
        ...(serverData.topicLastStudied || {})
      };
      Object.keys(repairedTopicLastStudied).forEach(key => {
        const dateStr = repairedTopicLastStudied[key];
        if (dateStr) {
          const timestamp = Date.parse(dateStr);
          if (isNaN(timestamp)) {
            delete repairedTopicLastStudied[key];
          }
        }
      });

      const repairedLastStudyDate = serverData.lastStudyDate || progress.lastStudyDate || null;
      const repairedBookmarks = serverData.bookmarks || progress.bookmarks || [];
      const repairedAssignments = Array.isArray(serverData.assignments) 
        ? serverData.assignments 
        : (Array.isArray(progress.assignments) ? progress.assignments : []);

      const repairedProgress: UserProgress = {
        ...progress,
        xp: repairedXp,
        level: repairedLevel,
        streak: repairedStreak,
        lastStudyDate: repairedLastStudyDate,
        mastery: repairedMastery,
        achievements: repairedAchievements,
        studyTime: repairedStudyTime,
        topicLastStudied: repairedTopicLastStudied,
        bookmarks: repairedBookmarks,
        enrolledCourses: repairedEnrolledCourses,
        assignments: repairedAssignments,
        srsData: serverData.srsData || progress.srsData || {},
        aiPersonality: serverData.aiPersonality || progress.aiPersonality || 'encouraging'
      };

      // 3. Update the dynamic client state
      setProgress(repairedProgress);

      // 4. Update the server state in Firestore to ensure absolute consistency
      const { 
        xp, level, mastery, achievements, enrolledCourses, 
        role, plan_type, subscription_expiry, subscription_status, 
        subscription_start_date, last_spark_reset, last_payment_ref, 
        ai_sparks, ...allowedProgress 
      } = repairedProgress as any;

      const syncToken = await user.getIdToken(false);
      await fetch('/api/user/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${syncToken}`
        },
        body: JSON.stringify(allowedProgress)
      }).catch(() => {});

      console.log('[Self-Healing] State repaired and synced via server profile endpoint.');
    } catch (error) {
      console.error('[Self-Healing] Silent state restoration failed:', error);
      await LogService.log('error', 'system', `State self-healing failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsHealing(false);
      healingRef.current = false;
    }
  }, [user, isOnline, progress, setProgress, sendNotification, gamificationPolicy]);

  // Periodic Watchdog Trigger
  useEffect(() => {
    if (!user || !profile || !isOnline || healingRef.current) return;

    const runWatchdog = () => {
      const now = Date.now();
      // Throttle checks to run at most once every 10 seconds to save performance
      if (now - lastCheckRef.current < 10000) return;
      lastCheckRef.current = now;

      const check = checkStateCorruption(progress);
      if (check.corrupted) {
        healState(check.reason);
      }
    };

    // Run a check on mount/user change
    runWatchdog();

    // Check periodically
    const intervalId = setInterval(runWatchdog, 15000);

    return () => clearInterval(intervalId);
  }, [progress, user, isOnline, checkStateCorruption, healState]);

  return { isHealing, triggerManualCheck: healState };
}
