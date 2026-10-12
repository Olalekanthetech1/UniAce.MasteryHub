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
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { getToken } from "firebase/messaging";
import toast from "react-hot-toast";
import { auth, db, messaging } from "../firebase";
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
    if (!db) return;
    console.log("AuthContext: Syncing user profile for", currentUser.uid);
    const cachedProfile = loadCachedProfile(currentUser.uid);

    try {
      const userRef = doc(db, "users", currentUser.uid);
      
      let userDoc: any = { exists: () => false, data: () => ({}) };
      try {
        const userDocPromise = getDoc(userRef);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Firestore getDoc timeout")), 6000)
        );
        userDoc = await Promise.race([userDocPromise, timeoutPromise]) as any;
      } catch (docErr) {
        console.warn("AuthContext: Client getDoc fallback to backend/cached profile:", docErr);
      }

      const firestoreData: Record<string, any> = userDoc.exists() ? (userDoc.data() || {}) : {};
      let backendProfile: Record<string, any> | null = null;

      let userRole: 'student' | 'admin' | 'tutor' | 'moderator' = firestoreData.role || cachedProfile?.role || 'student';
      
      // Default admin emails
      const adminEmails = (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
      if (currentUser.email && adminEmails.includes(currentUser.email.toLowerCase())) {
        userRole = 'admin';
      }

      let plan_type: PlanType = firestoreData.plan_type || cachedProfile?.plan_type || (userRole === 'admin' ? 'scholar' : 'free');
      let ai_sparks: number = firestoreData.ai_sparks ?? cachedProfile?.ai_sparks ?? 0;
      let subscription_expiry: string | undefined = firestoreData.subscription_expiry || cachedProfile?.subscription_expiry;
      let subscription_status: 'active' | 'expired' | 'none' = firestoreData.subscription_status || cachedProfile?.subscription_status || 'none';
      let subscription_start_date: string | undefined = firestoreData.subscription_start_date || cachedProfile?.subscription_start_date;

      // Fetch accurate quota and authoritative profile from backend (Single Source of Truth)
      const fetchQuota = async (retries = 4, attempt = 1): Promise<boolean> => {
        try {
          const token = await currentUser.getIdToken();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

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
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
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
            } else {
              throw new Error(`Server returned non-JSON response (${contentType || 'unknown'})`);
            }
          } else if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, attempt * 1500));
            return fetchQuota(retries - 1, attempt + 1);
          }
          return false;
        } catch (err) {
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, attempt * 1500));
            return fetchQuota(retries - 1, attempt + 1);
          }
          console.warn("Quota fetch fallback to cached/default profile:", err);
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

      if (!userDoc.exists() && !referredBy) {
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
          : (userDoc.exists() ? true : false),
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
        lastActive: serverTimestamp(),
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

      const docExistsOnServer = userDoc.exists() || Boolean(backendProfile);
      if (!docExistsOnServer) {
        try {
          await Promise.race([
            setDoc(userRef, dataToSave, { merge: true }),
            new Promise((resolve) => setTimeout(resolve, 2500))
          ]);
          activeSessionIdRef.current = currentSessionId;
        } catch (err) {
          console.warn("Skipping initial client profile write (handled by backend):", err);
        }
      } else {
        const existingSessionId = firestoreData.sessionId || backendProfile?.sessionId;
        if (!existingSessionId) {
          activeSessionIdRef.current = currentSessionId;
          setDoc(userRef, { sessionId: currentSessionId }, { merge: true }).catch(() => {});
        } else {
          activeSessionIdRef.current = existingSessionId;
          try {
            localStorage.setItem('uniace_session_id', existingSessionId);
          } catch {}
        }
      }

      saveCachedProfile(currentUser.uid, profileData);
      setProfile(profileData);
      console.log("AuthContext: Profile synced successfully");
      
      // Handle FCM Token in background
      (async () => {
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const msg = await messaging();
            if (msg) {
              const token = await getToken(msg, {
                vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || 'YOUR_PUBLIC_VAPID_KEY'
              });
              if (token && firestoreData.fcmToken !== token && backendProfile?.fcmToken !== token) {
                await setDoc(userRef, { fcmToken: token }, { merge: true });
              }
            }
          }
        } catch (err) {
          console.log("FCM not supported or permission denied", err);
        }
      })();
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
    }, 20000);

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
            profileUnsubscribe = onSnapshot(doc(db, "users", currentUser.uid), (docSnap) => {
              if (docSnap.exists() && isMounted) {
                const data = docSnap.data() as UserProfile;
                
                if (activeSessionIdRef.current && 
                    data.sessionId && 
                    data.sessionId !== activeSessionIdRef.current && 
                    data.sessionId !== currentSessionId) {
                  console.warn("AuthContext: New session detected elsewhere. Logging out...");
                  toast.error("Logged out: Your account is being used on another device.", {
                    duration: 6000,
                    icon: '🔒'
                  });
                  logout();
                  return;
                }

                setProfile((prev) => {
                  if (!prev) return prev;
                  const prevTime = prev.updatedAt ? Date.parse(prev.updatedAt) || 0 : 0;
                  const snapTime = data.updatedAt ? Date.parse(data.updatedAt) || 0 : 0;
                  const keepPrevEditable = prevTime > snapTime;

                  const nextProfile: UserProfile = {
                    ...prev,
                    ...data,
                    displayName: keepPrevEditable ? (prev.displayName || data.displayName) : (data.displayName || prev.displayName),
                    bio: keepPrevEditable ? (prev.bio ?? data.bio) : (data.bio ?? prev.bio),
                    photoURL: keepPrevEditable ? (prev.photoURL || data.photoURL) : (data.photoURL || prev.photoURL),
                    themeColor: keepPrevEditable ? (prev.themeColor || data.themeColor) : (data.themeColor || prev.themeColor),
                    department: keepPrevEditable ? (prev.department || data.department) : (data.department || prev.department),
                    faculty: keepPrevEditable ? (prev.faculty || data.faculty) : (data.faculty || prev.faculty),
                    academic_level: keepPrevEditable ? (prev.academic_level || data.academic_level) : (data.academic_level || prev.academic_level),
                    semester: keepPrevEditable ? (prev.semester || data.semester) : (data.semester || prev.semester),
                    onboarding_completed: keepPrevEditable
                      ? (prev.onboarding_completed ?? data.onboarding_completed)
                      : (data.onboarding_completed ?? prev.onboarding_completed),
                    has_seen_whatsapp: keepPrevEditable
                      ? (prev.has_seen_whatsapp ?? data.has_seen_whatsapp)
                      : (data.has_seen_whatsapp ?? prev.has_seen_whatsapp),
                    updatedAt: keepPrevEditable ? prev.updatedAt : (data.updatedAt || prev.updatedAt)
                  };
                  saveCachedProfile(currentUser.uid, nextProfile);
                  return nextProfile;
                });
              }
            }, (err) => {
              console.error("AuthContext: Profile snapshot error", err);
            });
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
    if (!user || !profile || !db) return;
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

    // 3. Only attempt direct client Firestore update if backend API sync was unavailable
    if (!backendSynced) {
      try {
        const userRef = doc(db, "users", user.uid);
        await Promise.race([
          setDoc(userRef, dataToSave, { merge: true }),
          new Promise((resolve) => setTimeout(resolve, 2500))
        ]);
      } catch (error) {
        console.warn("Client Firestore profile update deferred:", error);
      }
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
