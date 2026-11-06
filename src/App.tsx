import { lazy, Suspense, useEffect, useState, useTransition } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import Sidebar from './components/Sidebar';
import BottomNav from './components/BottomNav';
import CourseHub from './components/CourseHub';
import AcademicProfileModal from './components/AcademicProfileModal';
import PaywallManager from './components/PaywallManager';
import ComingSoon from './components/ComingSoon';
import ErrorBoundary from './components/ErrorBoundary';
import GlobalErrorInterceptor from './components/GlobalErrorInterceptor';
import GlobalNotification from './components/GlobalNotification';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import PushNotificationPrompt from './components/PushNotificationPrompt';
import StudyNotificationScheduler from './components/StudyNotificationScheduler';
import { useFeatureSwitches } from './hooks/useFeatureSwitches';
import { useDemoReel } from './context/DemoReelContext';
import { CalculatorProvider, useCalculator } from './context/CalculatorContext';
import { useUserProgress } from './hooks/useUserProgress';
import { useSelfHealing } from './hooks/useSelfHealing';
import { useAuth } from './context/AuthContext';
import { useCourses } from './context/CourseContext';
import { Bot, Menu, Mic, Video } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { View, ChatMessage, CourseId, Department, Semester } from './types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstitutionProvider } from './context/InstitutionContext';
import { safeFetchJson } from './utils/safeFetch';



const queryClient = new QueryClient();

type LazyModule<T extends ComponentType<any>> = Promise<{ default: T }>;
type PreloadableComponent<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  preload: () => LazyModule<T>;
};

function lazyWithPreload<T extends ComponentType<any>>(
  loader: () => LazyModule<T>
): PreloadableComponent<T> {
  let promise: LazyModule<T> | undefined;
  const load = () => {
    if (!promise) {
      promise = loader().catch((error) => {
        promise = undefined;
        throw error;
      });
    }
    return promise;
  };

  return Object.assign(lazy(load), { preload: load });
}

// Keep the initial student shell small. Screens with heavier charts, editors,
// simulations, and administrative tools are fetched only when first needed.
const Dashboard = lazyWithPreload(() => import('./components/Dashboard'));
const ModuleTopics = lazyWithPreload(() => import('./components/ModuleTopics'));
const CourseSyllabus = lazyWithPreload(() => import('./components/CourseSyllabus'));
const ContentArea = lazyWithPreload(() => import('./components/ContentArea'));
const ChatBot = lazyWithPreload(() => import('./components/ChatBot'));
const AdminLogin = lazyWithPreload(() => import('./components/AdminLogin'));
const FirebaseSetup = lazyWithPreload(() => import('./components/FirebaseSetup'));
const LandingPage = lazyWithPreload(() => import('./components/LandingPage'));
const Calculator = lazyWithPreload(() => import('./components/Calculator'));
const QuizHub = lazyWithPreload(() => import('./components/QuizHub'));
const FlashcardHub = lazyWithPreload(() => import('./components/FlashcardHub'));
const SkillPracticeHub = lazyWithPreload(() => import('./components/SkillPracticeHub'));
const MasteryCenter = lazyWithPreload(() => import('./components/MasteryCenter'));
const FormulaReference = lazyWithPreload(() => import('./components/FormulaReference'));
const Notebook = lazyWithPreload(() => import('./components/Notebook'));
const PricingPage = lazyWithPreload(() => import('./components/PricingPage'));
const UserProfile = lazyWithPreload(() => import('./components/UserProfile'));
const HelpSupport = lazyWithPreload(() => import('./components/HelpSupport'));
const AdminSupport = lazyWithPreload(() => import('./components/AdminSupport'));
const AdminDashboard = lazyWithPreload(() => import('./components/AdminDashboard'));
const TutorDashboard = lazyWithPreload(() => import('./components/TutorDashboard'));
const Arena = lazyWithPreload(() => import('./components/Arena'));
const ConceptMap = lazyWithPreload(() => import('./components/ConceptMap'));
const StudyPlan = lazyWithPreload(() => import('./components/StudyPlan'));
const VoiceTutor = lazyWithPreload(() => import('./components/VoiceTutor'));
const DemoDirectorHUD = lazyWithPreload(() => import('./components/DemoDirectorHUD'));
const DemoReelPreviewModal = lazyWithPreload(() => import('./components/DemoReelPreviewModal'));
const AdaptiveRecalibratorModal = lazyWithPreload(() =>
  import('./components/AdaptiveRecalibratorModal').then(({ AdaptiveRecalibratorModal }) => ({
    default: AdaptiveRecalibratorModal
  }))
);

function preloadView(view: View): void {
  let load: (() => Promise<unknown>) | undefined;
  switch (view) {
    case 'dashboard': load = Dashboard.preload; break;
    case 'study': load = ContentArea.preload; break;
    case 'past-questions': load = SkillPracticeHub.preload; break;
    case 'quizzes': load = QuizHub.preload; break;
    case 'module-topics': load = ModuleTopics.preload; break;
    case 'course-syllabus': load = CourseSyllabus.preload; break;
    case 'mastery': load = MasteryCenter.preload; break;
    case 'formulas': load = FormulaReference.preload; break;
    case 'ai-tutor': load = ChatBot.preload; break;
    case 'notebook': load = Notebook.preload; break;
    case 'profile': load = UserProfile.preload; break;
    case 'help-support': load = HelpSupport.preload; break;
    case 'admin-support': load = AdminSupport.preload; break;
    case 'admin-dashboard': load = AdminDashboard.preload; break;
    case 'tutor-dashboard': load = TutorDashboard.preload; break;
    case 'pricing': load = PricingPage.preload; break;
    case 'flashcards': load = FlashcardHub.preload; break;
    case 'arena': load = Arena.preload; break;
    case 'concept-map': load = ConceptMap.preload; break;
    case 'study-plan': load = StudyPlan.preload; break;
    default: break;
  }

  if (load) void load().catch(() => undefined);
}

function LoadingFallback({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div
      className={`${fullScreen ? 'h-screen' : 'min-h-[40vh]'} w-full flex items-center justify-center bg-slate-50 dark:bg-zinc-950`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-zinc-400">
        <span
          className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-500 dark:border-zinc-700 dark:border-t-emerald-400"
          aria-hidden="true"
        />
        <span>Loading UniAce...</span>
      </div>
    </div>
  );
}

export default function App() {
  console.log('App.tsx: Rendering...');
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <InstitutionProvider>
          <CalculatorProvider>
            <AppContent />
            <GlobalErrorInterceptor />
          </CalculatorProvider>
        </InstitutionProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  const { isConfigured, user, profile, loading, signInWithGoogle } = useAuth();
  const { switches: featureSwitches } = useFeatureSwitches();
  const [isPending, startTransition] = useTransition();
  const { courses, refreshCourses } = useCourses();
  const { progress, addXp, updateMastery, recordQuizScore, recordStudyTime, addBookmark, removeBookmark, enrollCourse, unenrollCourse, updateAIPersonality, isOnline, checkAndUpdateStreak } = useUserProgress();
  const { isRecording, startDemoReel, stopAndSaveReel, elapsedSeconds } = useDemoReel();
  const isAdmin = Boolean(user && profile?.role === 'admin');
  
  // Activate advanced self-healing for robust dynamic client-state integrity
  useSelfHealing();

  const [currentPath, setCurrentPath] = useState(() => typeof window !== 'undefined' ? window.location.pathname : '/');

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (path: string, view: View = 'hub') => {
    preloadView(view);
    if (path === '/admin/dashboard') void AdminDashboard.preload().catch(() => undefined);
    if (path === '/admin/login') void AdminLogin.preload().catch(() => undefined);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
      setCurrentPath(path);
      setActiveView(view);
      try { localStorage.setItem('uniace_active_view', view); } catch {}
    }
  };

  const [activeCourseId, setActiveCourseId] = useState<CourseId | null>(null);
  const [activeView, setActiveView] = useState<View>(() => {
    try {
      const saved = localStorage.getItem('uniace_active_view');
      if (saved && saved !== 'landing') return saved as View;
    } catch {}
    return 'hub';
  });
  const [recalibrationTopicId, setRecalibrationTopicId] = useState<string | null>(null);
  const [recalibrationScore, setRecalibrationScore] = useState<number | null>(null);
  const [isRecalibrationOpen, setIsRecalibrationOpen] = useState(false);

  const [shownRecalibrations, setShownRecalibrations] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('shownRecalibrations');
        return saved ? JSON.parse(saved) : {};
      } catch { return {}; }
    }
    return {};
  });

  const triggerRecalibration = (topicId: string, score: number) => {
    const isPerfect = score === 100;
    const isLow = score < 60;
    if (isPerfect || isLow) {
      const key = `${topicId}-${isPerfect ? 'perfect' : 'low'}`;
      if (!shownRecalibrations[key]) {
        setShownRecalibrations(prev => {
          const next = { ...prev, [key]: score };
          if (typeof window !== 'undefined') {
            localStorage.setItem('shownRecalibrations', JSON.stringify(next));
          }
          return next;
        });
        setRecalibrationTopicId(topicId);
        setRecalibrationScore(score);
        setIsRecalibrationOpen(true);
      }
    }
  };
  const [activeDepartment, setActiveDepartment] = useState<Department>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('activeDepartment');
      if (saved) return saved as Department;
    }
    return 'Mathematics';
  });

  const [activeSemester, setActiveSemester] = useState<Semester>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('activeSemester');
      if (saved) return saved as Semester;
    }
    return '1st Semester';
  });

  useEffect(() => {
    if (profile?.department) {
      setActiveDepartment(profile.department as Department);
      localStorage.setItem('activeDepartment', profile.department);
    }
  }, [profile?.department]);

  useEffect(() => {
    if (profile?.semester) {
      setActiveSemester(profile.semester as Semester);
      localStorage.setItem('activeSemester', profile.semester);
    }
  }, [profile?.semester]);
  
  const activeCourse = activeCourseId ? courses[activeCourseId] : null;

  useEffect(() => {
    if (user && profile) {
      checkAndUpdateStreak();
    }
  }, [user, profile?.uid]);
  const syllabus = activeCourse?.syllabus || [];

  const [activeModuleId, setActiveModuleId] = useState('');
  const [activeSubTopicId, setActiveSubTopicId] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => 
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // Keep only the small launcher in the initial bundle; mount the full tutor on first use.
  const [isChatMounted, setIsChatMounted] = useState(false);
  const [openChatOnMount, setOpenChatOnMount] = useState(false);
  const [autoStartQuiz, setAutoStartQuiz] = useState(false);
  const [regenerationProgress, setRegenerationProgress] = useState(0);
  const [regenerationStatus, setRegenerationStatus] = useState('');
  const { isCalculatorOpen, setIsCalculatorOpen } = useCalculator();
  const [isVoiceTutorOpen, setIsVoiceTutorOpen] = useState(false);
  const [activePdfText, setActivePdfText] = useState<string | null>(null);
  const [activeLessonContent, setActiveLessonContent] = useState<string | null>(null);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };

    const handleCustomNavigate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        handleViewSelect(customEvent.detail);
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('navigate', handleCustomNavigate);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('navigate', handleCustomNavigate);
    };
  }, []);

  useEffect(() => {
    setActiveLessonContent(null);
  }, [activeSubTopicId]);

  const activeModule = syllabus.find(m => m.id === activeModuleId) || syllabus[0];
  const activeSubTopicContent = activeModule?.subTopics?.find(s => s.id === activeSubTopicId)?.content;

  const handleCourseSelect = (id: CourseId) => {
    preloadView('course-syllabus');
    setActiveLessonContent(null);
    startTransition(() => {
      setActiveCourseId(id);
      const course = courses[id];
      if (course?.syllabus?.[0]) {
        setActiveModuleId(course.syllabus[0].id || '');
        if (course.syllabus[0].subTopics?.[0]) {
          setActiveSubTopicId(course.syllabus[0].subTopics[0].id || '');
        } else {
          setActiveSubTopicId('');
        }
      } else {
        setActiveModuleId('');
        setActiveSubTopicId('');
      }
      setActiveView('course-syllabus');
    });
  };

  const handleModuleSelect = (id: string) => {
    preloadView('module-topics');
    setActiveLessonContent(null);
    startTransition(() => {
      setActiveModuleId(id);
      const module = syllabus.find(m => m.id === id);
      if (module && module.subTopics && module.subTopics.length > 0) {
        setActiveSubTopicId(module.subTopics[0].id);
      } else {
        setActiveSubTopicId('');
      }
      setActiveView('module-topics');
    });
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  const handleSubTopicSelect = (subTopicId: string) => {
    preloadView('study');
    // Reset lesson content state immediately before transition render to prevent stale content flicker
    setActiveLessonContent(null);
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    startTransition(() => {
      setActiveSubTopicId(subTopicId);
      setActiveView('study');
      setAutoStartQuiz(false);
    });
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  const handleTakeQuiz = (subTopicId: string) => {
    preloadView('study');
    setActiveLessonContent(null);
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    startTransition(() => {
      setActiveSubTopicId(subTopicId);
      setActiveView('study');
      setAutoStartQuiz(true);
    });
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  const handleViewSelect = (view: View) => {
    preloadView(view);
    setActiveView(view);
    if (currentPath !== '/') {
      window.history.pushState({}, '', '/');
      setCurrentPath('/');
    }
    try {
      localStorage.setItem('uniace_active_view', view);
    } catch {}
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const checkConnectivity = async () => {
      try {
        const res = await safeFetchJson<any>('/api/health');
        if (res.ok && isMounted) {
          console.log('Backend connectivity check:', res.data);
        } else if (isMounted) {
          console.warn('Backend connectivity check non-200:', res.status);
        }
      } catch (err) {
        if (isMounted) console.warn('Backend connectivity check pending server initialization:', err);
      }
    };
    checkConnectivity();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (activeView === 'ai-tutor') {
      setOpenChatOnMount(true);
      setIsChatMounted(true);
    }
  }, [activeView]);

  useEffect(() => {
    let isSubscribed = true;
    if (user && isChatMounted && chatMessages.length === 0) {
      user.getIdToken()
        .then(token => {
          if (!token) return null;
          return safeFetchJson<any>('/api/chat/nudge', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
        })
        .then(res => {
          if (!res || !res.ok || !res.data) return null;
          return res.data;
        })
        .then(data => {
          if (isSubscribed && data?.message) {
            setChatMessages([{
              id: `nudge-${Date.now()}`,
              role: 'model',
              text: data.message,
              timestamp: new Date().toISOString()
            }]);
          }
        })
        .catch(err => {
          console.warn('Personalized nudge not retrieved, using default welcome message:', err?.message || err);
          if (isSubscribed && chatMessages.length === 0) {
            setChatMessages([{
              id: 'nudge-welcome-initial',
              role: 'model',
              text: "Hello! I'm UniAce AI, your university academic tutor. How can I help you study today?",
              timestamp: new Date().toISOString()
            }]);
          }
        });
    }
    return () => {
      isSubscribed = false;
    };
  }, [user, isChatMounted]);

  if (!isConfigured) {
    return (
      <Suspense fallback={<LoadingFallback fullScreen />}>
        <FirebaseSetup />
      </Suspense>
    );
  }

  if (loading && !profile && !user) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!user) {
    if (currentPath === '/admin/login' || currentPath === '/admin/dashboard') {
      return (
        <Suspense fallback={<LoadingFallback fullScreen />}>
          <AdminLogin 
            requireGoogleLogin={true} 
            onBackToApp={() => navigateTo('/', 'hub')} 
            onSuccess={() => navigateTo('/admin/dashboard')} 
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<LoadingFallback fullScreen />}>
        <LandingPage />
      </Suspense>
    );
  }

  if (currentPath === '/admin/login') {
    if (!isAdmin) {
      navigateTo('/', 'hub');
      return null;
    }
    
    const verifiedUntil = profile?.admin_pin_verified_until;
    const isVerified = (verifiedUntil && new Date(verifiedUntil.toDate ? verifiedUntil.toDate() : verifiedUntil).getTime() > Date.now()) || (typeof window !== 'undefined' && sessionStorage.getItem('admin_pin_verified') === 'true');
    
    if (isVerified) {
      navigateTo('/admin/dashboard');
      return null;
    }
    
    return (
      <Suspense fallback={<LoadingFallback fullScreen />}>
        <AdminLogin 
          onBackToApp={() => navigateTo('/', 'hub')} 
          onSuccess={() => navigateTo('/admin/dashboard')} 
        />
      </Suspense>
    );
  }

  if (currentPath === '/admin/dashboard') {
    if (!isAdmin) {
      navigateTo('/', 'hub');
      return null;
    }
    
    // Check if PIN verified recently (within last 2 hours or in current session)
    const verifiedUntil = profile?.admin_pin_verified_until;
    const isVerified = (verifiedUntil && new Date(verifiedUntil.toDate ? verifiedUntil.toDate() : verifiedUntil).getTime() > Date.now()) || (typeof window !== 'undefined' && sessionStorage.getItem('admin_pin_verified') === 'true');
    
    if (!isVerified) {
      navigateTo('/admin/login');
      return null;
    }

    return (
      <Suspense fallback={<LoadingFallback fullScreen />}>
        <AdminDashboard onBackToApp={() => navigateTo('/', 'hub')} />
      </Suspense>
    );
  }

  const needsAcademicProfile = user && profile && !profile.onboarding_completed && (!profile.department || !profile.academic_level || !profile.semester);

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-zinc-950 font-sans overflow-hidden relative transition-colors duration-300">
      {needsAcademicProfile && <AcademicProfileModal />}
      {user && (
        <PaywallManager onUpgrade={() => handleViewSelect('pricing')} />
      )}
      {/* Sidebar Navigation (Desktop) */}
      <Sidebar 
        activeModuleId={activeModuleId} 
        onModuleSelect={(id) => {
          preloadView('study');
          startTransition(() => {
            setActiveModuleId(id);
            setActiveView('study');
            const module = syllabus.find(m => m.id === id);
            if (module && module.subTopics && module.subTopics.length > 0) {
              setActiveSubTopicId(module.subTopics[0].id);
            } else {
              setActiveSubTopicId('');
            }
          });
          if (window.innerWidth < 1024) setIsSidebarOpen(false);
        }} 
        activeView={activeView}
        onViewSelect={handleViewSelect}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        progress={progress}
        activeCourseId={activeCourseId}
        syllabus={syllabus}
        isOnline={isOnline}
        onToggleCalculator={() => setIsCalculatorOpen(!isCalculatorOpen)}
      />

      <AnimatePresence>
        {isCalculatorOpen && (
          <Suspense fallback={null}>
            <Calculator isOpen={isCalculatorOpen} onClose={() => setIsCalculatorOpen(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className={`flex-1 min-w-0 w-full max-w-full overflow-x-hidden flex flex-col h-full overflow-y-auto relative ${activeView === 'ai-tutor' ? '' : 'pb-16 lg:pb-0'}`}>
        {/* Toggle Button for Sidebar (Visible when sidebar is closed on Desktop) */}
        {!isSidebarOpen && activeView !== 'study' && (
          <div className="hidden lg:block absolute top-4 left-4 z-40">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 bg-white border border-slate-200 rounded-xl shadow-sm text-slate-600 hover:text-slate-900 transition-all hover:scale-105 active:scale-95"
            >
              <Menu size={20} />
            </button>
          </div>
        )}

        {/* Quick-Access Demo Reel Button for Admins (Positioned bottom right to prevent overlapping top header actions) */}
        {isAdmin && (
          <div className="fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-[99] flex items-center gap-2">
            <button
              onClick={() => {
                if (isRecording) {
                  stopAndSaveReel();
                } else {
                  startDemoReel('full_ecosystem', handleViewSelect);
                }
              }}
              className={`px-3.5 py-2.5 rounded-2xl font-bold text-xs shadow-2xl transition-all active:scale-95 flex items-center gap-2 border ${
                isRecording
                  ? 'bg-rose-600 text-white animate-pulse border-rose-400 shadow-rose-500/20'
                  : 'bg-slate-900/90 dark:bg-zinc-900/90 text-white dark:text-white hover:bg-slate-800 dark:hover:bg-zinc-800 backdrop-blur-md border-slate-700/50 dark:border-zinc-800 shadow-slate-950/20'
              }`}
              title={isRecording ? 'Click to finish and save demo reel' : 'Launch Auto Demo Reel'}
            >
              <Video size={15} className={isRecording ? 'text-white' : 'text-rose-400 dark:text-rose-400'} />
              <span>{isRecording ? `🔴 REC (${elapsedSeconds}s)` : '🎬 Record Reel'}</span>
            </button>
          </div>
        )}

        {/* View Switcher */}
        <Suspense fallback={<LoadingFallback />}>
        {activeView === 'hub' && (
          <CourseHub 
            onSelectCourse={handleCourseSelect} 
            onProfileClick={() => { preloadView('profile'); setActiveView('profile'); }}
            onViewSelect={handleViewSelect}
            enrolledCourses={progress.enrolledCourses || []}
            progress={progress}
            activeSemester={activeSemester}
            setActiveSemester={setActiveSemester}
          />
        )}

        {activeView === 'dashboard' && (
          <Dashboard 
            activeDepartment={activeDepartment}
            activeSemester={activeSemester}
            setActiveSemester={setActiveSemester}
            onModuleSelect={handleModuleSelect} 
            onSubTopicSelect={handleSubTopicSelect}
            onViewSelect={handleViewSelect}
            onProfileClick={() => handleViewSelect('profile')}
            onCourseSelect={handleCourseSelect}
            progress={progress}
            activeCourseId={activeCourseId}
            syllabus={syllabus}
            onToggleCalculator={() => setIsCalculatorOpen(!isCalculatorOpen)}
          />
        )}

        {activeView === 'profile' && (
          <UserProfile 
            onBack={() => handleViewSelect(activeCourseId ? 'dashboard' : 'hub')}
            onNavigate={handleViewSelect}
          />
        )}

        {activeView === 'course-syllabus' && (
          <CourseSyllabus 
            onModuleSelect={handleModuleSelect}
            onBack={() => handleViewSelect('dashboard')}
            onViewSelect={handleViewSelect}
            activeCourseId={activeCourseId}
            syllabus={syllabus}
            objectives={activeCourse?.learningOutcomes || activeCourse?.objectives}
            isEnrolled={activeCourseId ? (progress.enrolledCourses || []).includes(activeCourseId) : false}
            onEnroll={() => {
              if (activeCourseId && activeCourse) {
                enrollCourse(activeCourseId, activeCourse.title, activeCourse.description);
              }
            }}
            onUnenroll={() => {
              if (activeCourseId) {
                unenrollCourse(activeCourseId);
                setActiveCourseId(null);
                handleViewSelect('hub');
              }
            }}
            onRegenerate={isAdmin ? async () => {
              toast.error("Syllabus regeneration writes to Firestore are paused during Postgres catalog migration.");
              return;
            } : undefined}
            regenerationProgress={regenerationProgress}
            regenerationStatus={regenerationStatus}
            onSelectCourse={(cId) => setActiveCourseId(cId)}
            activeSemester={activeSemester}
            enrolledCourses={progress.enrolledCourses || []}
            progress={progress}
          />
        )}

        {activeView === 'module-topics' && activeModule && (
          <ModuleTopics 
            courseId={activeCourseId}
            module={activeModule}
            onBack={() => { preloadView('course-syllabus'); setActiveView('course-syllabus'); }}
            onSubTopicSelect={handleSubTopicSelect}
            onTakeQuiz={handleTakeQuiz}
            onOpenChat={() => { preloadView('ai-tutor'); setActiveView('ai-tutor'); }}
            progress={progress}
          />
        )}
        
        {activeView === 'study' && (
          <ContentArea 
            courseId={activeCourseId}
            courseTitle={activeCourse?.title || 'Course'}
            module={activeModule}
            activeSubTopicId={activeSubTopicId}
            onSubTopicSelect={handleSubTopicSelect}
            onBackToSyllabus={() => { preloadView('module-topics'); setActiveView('module-topics'); }}
            isSidebarOpen={isSidebarOpen}
            toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            onQuizComplete={(topicId, score) => {
              updateMastery(topicId, score);
              if (activeCourseId) recordQuizScore(activeCourseId, topicId, score);
              addXp(score * 2);
              triggerRecalibration(topicId, score);
            }}
            onQuickCheckComplete={(topicId) => {
              addXp(20); // Bonus XP for quick check
              updateMastery(topicId, 100); // Mark as mastered if correct
              triggerRecalibration(topicId, 100);
            }}
            autoStartQuiz={autoStartQuiz}
            onViewSelect={handleViewSelect}
            progress={progress}
            onToggleCalculator={() => setIsCalculatorOpen(!isCalculatorOpen)}
            onLessonContentChange={setActiveLessonContent}
          />
        )}

        {activeView === 'quizzes' && (
          <ErrorBoundary>
            <QuizHub 
              courseId={activeCourseId || undefined}
              onQuizComplete={(topicId, score) => {
                updateMastery(topicId, score);
                if (activeCourseId) recordQuizScore(activeCourseId, topicId, score);
                addXp(score * 2);
                triggerRecalibration(topicId, score);
              }}
              syllabus={syllabus}
              onSelectCourse={(cId) => setActiveCourseId(cId)}
              activeSemester={activeSemester}
              enrolledCourses={progress.enrolledCourses || []}
            />
          </ErrorBoundary>
        )}

        {activeView === 'flashcards' && (
          <ErrorBoundary>
            <FlashcardHub 
              syllabus={syllabus} 
              activeCourseId={activeCourseId}
              onSelectCourse={handleCourseSelect}
              activeSemester={activeSemester}
              enrolledCourses={progress.enrolledCourses || []}
            />
          </ErrorBoundary>
        )}

        {activeView === 'past-questions' && (
          <SkillPracticeHub 
            activeCourseId={activeCourseId} 
            onSelectCourse={(cId) => setActiveCourseId(cId)}
            activeSemester={activeSemester}
            enrolledCourses={progress.enrolledCourses || []}
            onComplete={addXp}
          />
        )}

        {activeView === 'mastery' && (
          <MasteryCenter 
            progress={progress}
            onBack={() => handleViewSelect('dashboard')}
            activeCourseId={activeCourseId}
            onSelectCourse={handleCourseSelect}
            activeSemester={activeSemester}
            enrolledCourses={progress.enrolledCourses || []}
            syllabus={syllabus}
          />
        )}

        {activeView === 'notebook' && (
          <Notebook 
            bookmarks={progress.bookmarks}
            onRemoveBookmark={removeBookmark}
          />
        )}

        {activeView === 'formulas' && (
          <FormulaReference 
            onBack={() => handleViewSelect('dashboard')}
            activeCourseId={activeCourseId}
            onSelectCourse={handleCourseSelect}
            activeSemester={activeSemester}
            enrolledCourses={progress.enrolledCourses || []}
            formulas={activeCourse?.formulas || []}
            onBookmark={(item) => addBookmark(item, 'formula')}
          />
        )}

        {activeView === 'pricing' && (
          <PricingPage />
        )}

        {activeView === 'help-support' && (
          <HelpSupport 
            onBack={() => handleViewSelect('profile')}
          />
        )}

        {activeView === 'admin-support' && (
          <AdminSupport 
            onBack={() => handleViewSelect('profile')}
          />
        )}

        {activeView === 'arena' && (
          featureSwitches.arena ? (
            <Arena activeCourseId={activeCourseId} />
          ) : (
            <ComingSoon 
              title="Gamified Battle Arena" 
              description="The Arena feature is undergoing scheduled performance optimization. Check back soon!" 
              onBack={() => handleViewSelect('dashboard')} 
            />
          )
        )}

        {activeView === 'concept-map' && (
          <ConceptMap 
            syllabus={syllabus}
            onSubTopicSelect={handleSubTopicSelect}
            onClose={() => handleViewSelect('dashboard')}
          />
        )}

        {activeView === 'study-plan' && (
          <ErrorBoundary>
            <StudyPlan progress={progress} syllabus={syllabus} />
          </ErrorBoundary>
        )}

        {activeView === 'tutor-dashboard' && (
          featureSwitches.tutor_dashboard ? (
            <TutorDashboard onBack={() => handleViewSelect('profile')} />
          ) : (
            <ComingSoon 
              title="Tutor & Affiliates Hub" 
              description="The Tutor Portal is undergoing scheduled maintenance. Check back soon!" 
              onBack={() => handleViewSelect('profile')} 
            />
          )
        )}

        {activeView === 'admin-dashboard' && (
          (() => {
            if (!isAdmin) {
              return <Dashboard 
                activeDepartment={activeDepartment}
                activeSemester={activeSemester}
                setActiveSemester={setActiveSemester}
                onModuleSelect={handleModuleSelect} 
                onSubTopicSelect={handleSubTopicSelect}
                onViewSelect={handleViewSelect}
                onProfileClick={() => handleViewSelect('profile')}
                onCourseSelect={handleCourseSelect}
                progress={progress}
                activeCourseId={activeCourseId}
                syllabus={syllabus}
                onToggleCalculator={() => setIsCalculatorOpen(!isCalculatorOpen)}
              />;
            }
            
            return (
              <ErrorBoundary>
                <AdminDashboard />
              </ErrorBoundary>
            );
          })()
        )}

        </Suspense>

        {/* Consolidated Single Instance of ChatBot (Full page in 'ai-tutor' view, otherwise bottom-corner overlay) */}
      </div>

      {!isChatMounted && activeView !== 'ai-tutor' && (
        <button
          type="button"
          onClick={() => {
            setOpenChatOnMount(true);
            setIsChatMounted(true);
          }}
          className="fixed bottom-6 right-6 z-50 p-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full shadow-2xl hover:scale-105 transition-all flex items-center gap-2 group"
          title="Open UniAce AI Academic Tutor"
          aria-label="Open UniAce AI Academic Tutor"
        >
          <Bot size={24} />
          <span className="hidden group-hover:inline text-xs font-bold pr-1">Ask UniAce</span>
        </button>
      )}

      {isChatMounted && (
        <Suspense fallback={
          activeView === 'ai-tutor' ? (
            <LoadingFallback fullScreen />
          ) : (
            <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-full bg-emerald-600 text-white shadow-xl flex items-center gap-2 text-sm" role="status" aria-live="polite">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
              Opening UniAce AI...
            </div>
          )
        }>
          <ChatBot
            isFullPage={activeView === 'ai-tutor'}
            initiallyOpen={openChatOnMount}
            onToggleFullPage={() => handleViewSelect(activeView === 'ai-tutor' ? 'dashboard' : 'ai-tutor')}
            messages={chatMessages}
            setMessages={setChatMessages}
            activeCourseId={activeCourseId}
            activeModule={activeModule?.title}
            activeSubTopic={activeModule?.subTopics?.find(s => s.id === activeSubTopicId)?.title}
            subTopicContent={activeLessonContent || activeSubTopicContent}
            progress={progress}
            profile={profile}
            onUpdatePersonality={updateAIPersonality}
            onToggleCalculator={() => setIsCalculatorOpen(!isCalculatorOpen)}
            onOpenVoiceTutor={() => setIsVoiceTutorOpen(true)}
            onPdfTextChange={setActivePdfText}
            onSaveBookmark={(b) => addBookmark(b.content, b.type, b.note)}
            onSelectTopicContext={(cId, mTitle, sTitle, content) => {
              setActiveCourseId(cId);
              if (content) setActiveLessonContent(content);
            }}
          />
        </Suspense>
      )}

      {/* Bottom Navigation (Mobile) */}
      <BottomNav activeView={activeView} onViewSelect={handleViewSelect} />

      {/* Push Notification Prompt */}
      <PushNotificationPrompt />

      {/* PWA Install Prompt */}
      <PWAInstallPrompt />

      {/* Study Notification Scheduler */}
      <StudyNotificationScheduler />

      {/* Voice Tutor */}
      {isVoiceTutorOpen && (
        <Suspense fallback={null}>
          <VoiceTutor 
          isOpen={isVoiceTutorOpen} 
          onClose={() => setIsVoiceTutorOpen(false)} 
          pdfContent={activePdfText || undefined}
          personality={progress?.aiPersonality}
          systemInstruction={`You are UniAce, a Senior Academic AI Tutor. You dynamically adapt to accredited global university curriculum standards and international academic benchmarks, with your primary role being to teach the specific academic subject the student is currently studying.

Your teaching strategy:
1. SUBJECT FOCUS: Your primary goal is to explain the current academic topic (e.g., Science, Math, Engineering).
2. CURRICULUM ALIGNMENT: Dynamically align with accredited global university standards to ensure the content is exam-ready and globally competitive.
3. INTERNATIONAL DEPTH: Do not just list facts. Provide deep, step-by-step explanations, clear derivations, and multiple worked examples.
4. UNIACE TUTOR STYLE: 
   - Use simple, relatable language for complex parts.
   - Include a "Pro-Tip: Common Exam Pitfalls" section highlighting where students usually lose marks.
   - Add a "Step-by-Step Breakdown" for any calculation or complex process.
   - Include 2-3 "Self-Check Questions" at the end of the content.

CRITICAL: Do NOT discuss university administration or specific regulatory agencies unless the student's current topic is specifically about them. Focus 100% on academic mastery.`}
          />
        </Suspense>
      )}

      {recalibrationTopicId && recalibrationScore !== null && (
        <Suspense fallback={null}>
          <AdaptiveRecalibratorModal
          topicId={recalibrationTopicId}
          score={recalibrationScore}
          isOpen={isRecalibrationOpen}
          onClose={() => setIsRecalibrationOpen(false)}
          progress={progress}
          syllabus={syllabus}
          onViewStudyPlan={() => {
            setIsRecalibrationOpen(false);
            preloadView('study-plan');
            setActiveView('study-plan');
          }}
          />
        </Suspense>
      )}

      {/* Global Admin Alert */}
      <GlobalNotification />

      {/* Floating Demo Director HUD and Export Modal */}
      <Suspense fallback={null}>
        <DemoDirectorHUD />
        <DemoReelPreviewModal />
      </Suspense>

      {/* Toaster for notifications */}
      <Toaster position="top-center" />
    </div>
  );
}
