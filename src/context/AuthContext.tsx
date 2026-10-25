import React, { createContext, useContext, useEffect, useState } from "react";
import { 
  User, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile 
} from "firebase/auth";
import { getToken } from "firebase/messaging";
import toast from "react-hot-toast";
import { auth, messaging } from "../firebase";
import { LogService } from "../services/logService";
import { PlanType } from "../types";

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  bio?: string;
  photoURL: string;
  role: 'student' | 'admin' | 'tutor' | 'moderator';
  fcmToken?: string;
  plan_type: PlanType;
  subscription_expiry?: string;
  subscription_start_date?: string;
  subscription_status?: 'active' | 'expired' | 'none';
  ai_sparks: number;
  xp: number;
  level: number;
  streak: number;
  themeColor?: string;
  rank?: number;
  created_at?: string;
  sessionId?: string;
  admin_pin_verified_until?: any;
  department?: string;
  faculty?: string;
  academic_level?: string;
  semester?: string;
  learningProfile?: {
    strengths: string[];
    weaknesses: string[];
    lastUpdated: string;
    fastMode?: boolean;
  };
  has_seen_whatsapp?: boolean;
  onboarding_completed?: boolean;
  referralCode?: string;
  referredBy?: string;
  referral_count?: number;
  updatedAt?: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfileData: (data: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [currentSessionId] = useState(() => {
    try {
      const stored = localStorage.getItem('uniace_session_id');
      if (stored) return stored;
      const newId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('uniace_session_id', newId);
      return newId;
    } catch {
      return Math.random().toString(36).substring(2, 15);
    }
  });
  const activeSessionIdRef = React.useRef<string | null>(null);
  const userIdRef = React.useRef<string | null>(null);

  const loadCachedProfile = (uid: string): Partial<UserProfile> | null => {
    try {
      const raw = localStorage.getItem(`uniace_user_profile_${uid}`);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Ignore storage read errors
    }
    return null;
  };

  const saveCachedProfile = (uid: string, prof: UserProfile) => {
    try {
      localStorage.setItem(`uniace_user_profile_${uid}`, JSON.stringify(prof));
    } catch {
      // Ignore storage write errors
    }
  };

  const syncUserProfile = async (currentUser: User) => {
    console.log("AuthContext: Syncing user profile for", currentUser.uid);
    const cachedProfile = loadCachedProfile(currentUser.uid);

    // Resolve immediate admin role if applicable
    const adminEmails = (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
    const isUserAdmin = Boolean(currentUser.email && adminEmails.includes(currentUser.email.toLowerCase()));

    // Instant optimistic hydration from cache or user object to prevent blank-screen blocking
    const initialProfile: UserProfile = {
      uid: currentUser.uid,
      email: currentUser.email || cachedProfile?.email || "",
      displayName: cachedProfile?.displayName || currentUser.displayName || "Scholar",
      bio: cachedProfile?.bio,
      photoURL: cachedProfile?.photoURL || currentUser.photoURL || "",
      role: isUserAdmin ? 'admin' : (cachedProfile?.role || 'student'),
      plan_type: cachedProfile?.plan_type || (isUserAdmin ? 'scholar' : 'free'),
      subscription_expiry: cachedProfile?.subscription_expiry,
      subscription_status: cachedProfile?.subscription_status || 'none',
      subscription_start_date: cachedProfile?.subscription_start_date,
      ai_sparks: cachedProfile?.ai_sparks ?? (isUserAdmin ? 999999 : 50),
      xp: cachedProfile?.xp ?? 0,
      level: cachedProfile?.level ?? 1,
      streak: cachedProfile?.streak ?? 0,
      themeColor: cachedProfile?.themeColor,
      rank: cachedProfile?.rank,
      created_at: cachedProfile?.created_at || new Date().toISOString(),
      sessionId: currentSessionId,
      department: cachedProfile?.department || (typeof window !== 'undefined' ? localStorage.getItem('activeDepartment') || undefined : undefined),
      faculty: cachedProfile?.faculty,
      academic_level: cachedProfile?.academic_level,
      semester: cachedProfile?.semester || (typeof window !== 'undefined' ? localStorage.getItem('activeSemester') || undefined : undefined),
      learningProfile: cachedProfile?.learningProfile,
      has_seen_whatsapp: cachedProfile?.has_seen_whatsapp ?? false,
      onboarding_completed: cachedProfile?.onboarding_completed ?? false,
      referralCode: cachedProfile?.referralCode || currentUser.uid.substring(0, 6).toUpperCase(),
      referredBy: cachedProfile?.referredBy
    };

    setProfile(initialProfile);
    setLoading(false);

    try {
      const firestoreData: Record<string, any> = {};
      let backendProfile: Record<string, any> | null = null;

      let userRole: 'student' | 'admin' | 'tutor' | 'moderator' = isUserAdmin ? 'admin' : (firestoreData.role || cachedProfile?.role || 'student');
      let plan_type: PlanType = firestoreData.plan_type || cachedProfile?.plan_type || (userRole === 'admin' ? 'scholar' : 'free');
      let ai_sparks: number = firestoreData.ai_sparks ?? cachedProfile?.ai_sparks ?? (userRole === 'admin' ? 999999 : 50);
      let subscription_expiry: string | undefined = firestoreData.subscription_expiry || cachedProfile?.subscription_expiry;
      let subscription_status: 'active' | 'expired' | 'none' = firestoreData.subscription_status || cachedProfile?.subscription_status || 'none';
      let subscription_start_date: string | undefined = firestoreData.subscription_start_date || cachedProfile?.subscription_start_date;

      // Fetch accurate quota and authoritative profile from backend without blocking UI
      const fetchQuota = async (retries = 1, attempt = 1): Promise<boolean> => {
        try {
          const token = await currentUser.getIdToken();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);

          const response = await fetch('/api/user/quota', {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            },
            cache: 'no-store',
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const data = await response.json();
              ai_sparks = data.sparks;
              plan_type = data.plan;
              userRole = data.role;
              if (data.subscription_expiry) subscription_expiry = data.subscription_expiry;
              if (data.subscription_status) subscription_status = data.subscription_status;
              if (data.subscription_start_date) subscription_start_date = data.subscription_start_date;
              if (data.profile && typeof data.profile === 'object') {
                backendProfile = data.profile;
              }
              return true;
            }
          } else if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 800));
            return fetchQuota(retries - 1, attempt + 1);
          }
          return false;
        } catch {
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 800));
            return fetchQuota(retries - 1, attempt + 1);
          }
          return false;
        }
      };

      await fetchQuota();

      // Determine chronological priority among firestoreData, backendProfile, and cachedProfile
      const sources = [
        { data: firestoreData, time: firestoreData.updatedAt ? Date.parse(firestoreData.updatedAt) || 0 : 0 },
        { data: backendProfile || {}, time: backendProfile?.updatedAt ? Date.parse(backendProfile.updatedAt) || 0 : 1 },
        { data: cachedProfile || {}, time: cachedProfile?.updatedAt ? Date.parse(cachedProfile.updatedAt) || 0 : 2 }
      ].sort((a, b) => a.time - b.time);

      const mergedSource: Record<string, any> = {};
      for (const src of sources) {
        for (const [k, v] of Object.entries(src.data)) {
          if (v !== undefined && v !== null && v !== '') {
            mergedSource[k] = v;
          } else if (mergedSource[k] === undefined && v !== undefined) {
            mergedSource[k] = v;
          }
        }
      }

      let referralCode = mergedSource.referralCode;
      let referredBy = mergedSource.referredBy;

      if (!referralCode) {
        referralCode = currentUser.uid.substring(0, 6).toUpperCase();
      }

      if (!backendProfile && !referredBy) {
        const storedRef = sessionStorage.getItem('ref_code');
        if (storedRef) {
          referredBy = storedRef;
          try {
            await fetch('/api/track-signup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refCode: storedRef, newUserId: currentUser.uid })
            });
          } catch (e) {
            console.warn('Failed to increment referral count', e);
          }
        }
      }

      const resolvedDepartment = mergedSource.department || localStorage.getItem('activeDepartment') || undefined;
      const resolvedAcademicLevel = mergedSource.academic_level || undefined;
      const resolvedSemester = mergedSource.semester || localStorage.getItem('activeSemester') || undefined;
      const resolvedOnboardingCompleted = Boolean(
        mergedSource.onboarding_completed ??
        (resolvedDepartment && resolvedAcademicLevel && resolvedSemester)
      );

      const profileData: UserProfile = {
        uid: currentUser.uid,
        email: currentUser.email || mergedSource.email || "",
        displayName: mergedSource.displayName || currentUser.displayName || "Scholar",
        bio: mergedSource.bio,
        photoURL: mergedSource.photoURL || currentUser.photoURL || "",
        role: userRole,
        plan_type,
        subscription_expiry,
        subscription_status,
        subscription_start_date,
        ai_sparks,
        xp: Math.max(Number(firestoreData.xp || 0), Number(mergedSource.xp || 0)),
        level: Math.max(Number(firestoreData.level || 1), Number(mergedSource.level || 1)),
        streak: Math.max(Number(firestoreData.streak || 0), Number(mergedSource.streak || 0)),
        themeColor: mergedSource.themeColor,
        rank: mergedSource.rank,
        created_at: firestoreData.createdAt?.toDate
          ? firestoreData.createdAt.toDate().toISOString()
          : (mergedSource.createdAt || mergedSource.created_at || new Date().toISOString()),
        sessionId: currentSessionId,
        admin_pin_verified_until: firestoreData.admin_pin_verified_until || mergedSource.admin_pin_verified_until,
        department: resolvedDepartment,
        faculty: mergedSource.faculty,
        academic_level: resolvedAcademicLevel,
        semester: resolvedSemester,
        learningProfile: mergedSource.learningProfile,
        has_seen_whatsapp: mergedSource.has_seen_whatsapp !== undefined
          ? Boolean(mergedSource.has_seen_whatsapp)
          : (backendProfile ? true : false),
        onboarding_completed: resolvedOnboardingCompleted,
        referralCode,
        referredBy,
        updatedAt: mergedSource.updatedAt
      };

      // If cachedProfile had newer academic profile fields that weren't in backendProfile yet, sync them to backend
      if (
        cachedProfile?.updatedAt &&
        (!backendProfile?.updatedAt || Date.parse(cachedProfile.updatedAt) > Date.parse(backendProfile.updatedAt))
      ) {
        currentUser.getIdToken().then(token => {
          fetch('/api/user/profile', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              displayName: profileData.displayName,
              bio: profileData.bio,
              photoURL: profileData.photoURL,
              themeColor: profileData.themeColor,
              department: profileData.department,
              faculty: profileData.faculty,
              academic_level: profileData.academic_level,
              semester: profileData.semester,
              onboarding_completed: profileData.onboarding_completed,
              has_seen_whatsapp: profileData.has_seen_whatsapp,
              updatedAt: cachedProfile.updatedAt
            })
          }).catch(() => {});
        }).catch(() => {});
      }

      const dataToSave: any = {
        ...profileData,
        lastActive: new Date().toISOString(),
        sessionId: currentSessionId,
      };
      
      dataToSave.uid = currentUser.uid;
      
      const protectedFields = [
        'ai_sparks', 
        'plan_type', 
        'role', 
        'subscription_expiry', 
        'subscription_status', 
        'subscription_start_date',
        'last_spark_reset',
        'last_payment_ref',
        'xp',
        'level'
      ];
      protectedFields.forEach(field => delete dataToSave[field]);
      Object.keys(dataToSave).forEach(key => dataToSave[key] === undefined && delete dataToSave[key]);

      activeSessionIdRef.current = backendProfile?.sessionId || currentSessionId;
      try {
        localStorage.setItem('uniace_session_id', activeSessionIdRef.current);
      } catch {}

      saveCachedProfile(currentUser.uid, profileData);
      setProfile(profileData);
      console.log("AuthContext: Profile synced successfully");
    } catch (error) {
      console.error("Error syncing user profile:", error);
      if (!profile) {
        const fallbackProfile: UserProfile = {
          uid: currentUser.uid,
          email: currentUser.email || cachedProfile?.email || "",
          displayName: cachedProfile?.displayName || currentUser.displayName || "Scholar",
          bio: cachedProfile?.bio,
          photoURL: cachedProfile?.photoURL || currentUser.photoURL || "",
          role: cachedProfile?.role || 'student',
          plan_type: cachedProfile?.plan_type || 'free',
          ai_sparks: cachedProfile?.ai_sparks ?? 0,
          xp: cachedProfile?.xp ?? 0,
          level: cachedProfile?.level ?? 1,
          streak: cachedProfile?.streak ?? 0,
          themeColor: cachedProfile?.themeColor,
          department: cachedProfile?.department || localStorage.getItem('activeDepartment') || undefined,
          faculty: cachedProfile?.faculty,
          academic_level: cachedProfile?.academic_level,
          semester: cachedProfile?.semester || localStorage.getItem('activeSemester') || undefined,
          onboarding_completed: cachedProfile?.onboarding_completed ?? Boolean(cachedProfile?.department && cachedProfile?.academic_level && cachedProfile?.semester),
          has_seen_whatsapp: cachedProfile?.has_seen_whatsapp,
          updatedAt: cachedProfile?.updatedAt
        };
        setProfile(fallbackProfile);
      }
    }
  };

  useEffect(() => {
    console.log("AuthContext: Initializing...");
    if (!auth) {
      console.warn("AuthContext: Firebase Auth not initialized");
      setLoading(false);
      return;
    }
    
    let profileUnsubscribe: () => void;
    let isMounted = true;

    const safetyTimeout = setTimeout(() => {
      if (isMounted && loading) {
        console.warn("AuthContext: Safety timeout reached, forcing loading to false");
        setLoading(false);
      }
    }, 2500);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log("AuthContext: Auth state changed", currentUser?.uid || "No user");
      if (!isMounted) return;

      if (currentUser?.uid === userIdRef.current && currentUser !== null) {
        console.log("AuthContext: User unchanged, skipping sync");
        return;
      }
      userIdRef.current = currentUser?.uid || null;

      if (profileUnsubscribe) {
        profileUnsubscribe();
      }

      setUser(currentUser);
      if (currentUser) {
        try {
          await syncUserProfile(currentUser);
          
          if (isMounted) {
            // Check session on window focus / visibility change instead of Firestore onSnapshot
            const checkSessionOnFocus = async () => {
              if (!isMounted || !currentUser) return;
              try {
                const token = await currentUser.getIdToken();
                const res = await fetch('/api/user/quota', {
                  headers: { 'Authorization': `Bearer ${token}` },
                  cache: 'no-store'
                });
                if (res.ok) {
                  const data = await res.json();
                  const backendSessionId = data.session_id || data.profile?.sessionId;
                  if (activeSessionIdRef.current && 
                      backendSessionId && 
                      backendSessionId !== activeSessionIdRef.current && 
                      backendSessionId !== currentSessionId) {
                    console.warn("AuthContext: Remote session change detected. Logging out...");
                    toast.error("Logged out: Your account is being used on another device.", {
                      duration: 6000,
                      icon: '🔒'
                    });
                    logout();
                  }
                }
              } catch {
                // Non-fatal network error
              }
            };

            window.addEventListener('focus', checkSessionOnFocus);
            const intervalId = setInterval(checkSessionOnFocus, 90000);
            profileUnsubscribe = () => {
              window.removeEventListener('focus', checkSessionOnFocus);
              clearInterval(intervalId);
            };
          }
        } catch (err) {
          console.error("AuthContext: Error during auth state change handling", err);
        }
      } else {
        setProfile(null);
        if (profileUnsubscribe) profileUnsubscribe();
      }
      
      if (isMounted) {
        setLoading(false);
        clearTimeout(safetyTimeout);
      }
    });
    
    return () => {
      isMounted = false;
      unsubscribe();
      clearTimeout(safetyTimeout);
      if (profileUnsubscribe) profileUnsubscribe();
    };
  }, []);

  const updateProfileData = async (data: Partial<UserProfile>) => {
    if (!user || !profile) return;
    const updatedAt = new Date().toISOString();
    const dataToSave: Record<string, any> = { ...data, updatedAt };
    Object.keys(dataToSave).forEach(key => dataToSave[key] === undefined && delete dataToSave[key]);

    // 1. Immediately update state and localStorage so UI never blocks or loses changes on refresh
    const nextProfile: UserProfile = {
      ...profile,
      ...dataToSave
    };
    setProfile(nextProfile);
    saveCachedProfile(user.uid, nextProfile);

    if (dataToSave.department) {
      try { localStorage.setItem('activeDepartment', dataToSave.department); } catch {}
    }
    if (dataToSave.semester) {
      try { localStorage.setItem('activeSemester', dataToSave.semester); } catch {}
    }

    // 2. Persist via backend API (idempotent write-through to Firestore)
    let backendSynced = false;
    try {
      const token = await user.getIdToken(false);
      const res = await fetch('/api/user/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(dataToSave)
      });
      backendSynced = res.ok;
    } catch (apiErr) {
      console.warn("Backend profile sync warning:", apiErr);
    }

    if (!backendSynced) {
      console.warn("Backend profile sync queued locally.");
    }
  };

  const signInWithGoogle = async () => {
    if (!auth) {
      const err = "Firebase is not configured. Please check your configuration.";
      toast.error(err);
      throw new Error(err);
    }
    if (isSigningIn) return; // Prevent multiple clicks

    setIsSigningIn(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: 'select_account'
    });

    try {
      console.log("AuthContext: Starting signInWithPopup...");
      await signInWithPopup(auth, provider);
      console.log("AuthContext: signInWithPopup completed successfully.");
    } catch (error: any) {
      console.error("Error signing in with Google", error);
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        console.log('User closed or cancelled the sign-in popup.');
        return;
      }
      
      let friendlyMessage = error.message || 'Google sign-in failed.';
      if (error.code === 'auth/unauthorized-domain') {
        const domain = window.location.hostname;
        friendlyMessage = `Unauthorized Domain: ${domain}. Please add "${domain}" to Firebase Console > Authentication > Settings > Authorized domains.`;
      } else if (error.code === 'auth/network-request-failed') {
        const isIframe = typeof window !== 'undefined' && window.self !== window.top;
        if (isIframe) {
          friendlyMessage = "Google popup was blocked by the embedded preview iframe. Please click 'Open in Direct Tab' or sign in/sign up with email.";
        } else {
          friendlyMessage = "Network request failed. If you are using Brave Browser, please turn Brave Shields OFF for this site, or use email login.";
        }
      } else if (error.code === 'auth/popup-blocked') {
        friendlyMessage = "Popups are blocked by your browser. Please allow popups or open in a direct tab.";
      }
      
      toast.error(friendlyMessage, { duration: 6000 });
      throw new Error(friendlyMessage);
    } finally {
      setIsSigningIn(false);
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    if (!auth) {
      const err = "Firebase is not configured.";
      toast.error(err);
      throw new Error(err);
    }
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  const signUpWithEmail = async (email: string, password: string, displayName?: string) => {
    if (!auth) {
      const err = "Firebase is not configured.";
      toast.error(err);
      throw new Error(err);
    }
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (displayName && cred.user) {
      await updateProfile(cred.user, { displayName });
    }
  };

  const logout = async () => {
    if (!auth) return;
    try {
      try {
        localStorage.removeItem('uniace_session_id');
        sessionStorage.removeItem('admin_pin_verified');
      } catch {}
      const userEmail = user?.email;
      const userDisplayName = profile?.displayName;
      await signOut(auth);
      LogService.log('info', 'user', `User logged out: ${userDisplayName || userEmail || 'Unknown'}`).catch(console.error);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      loading, 
      isConfigured: !!auth, 
      signInWithGoogle, 
      signInWithEmail, 
      signUpWithEmail, 
      logout, 
      updateProfileData 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
