import { useState, useEffect, useTransition } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import Sidebar from './components/Sidebar';
import BottomNav from './components/BottomNav';
import ContentArea from './components/ContentArea';
import ChatBot from './components/ChatBot';
import Dashboard from './components/Dashboard';
import ModuleTopics from './components/ModuleTopics';
import CourseSyllabus from './components/CourseSyllabus';
import CourseHub from './components/CourseHub';
import AdminLogin from './components/AdminLogin';
import FirebaseSetup from './components/FirebaseSetup';
import LandingPage from './components/LandingPage';
import PushNotificationPrompt from './components/PushNotificationPrompt';
import GlobalNotification from './components/GlobalNotification';
import GlobalErrorInterceptor from './components/GlobalErrorInterceptor';
import PaywallManager from './components/PaywallManager';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import Calculator from './components/Calculator';
import ErrorBoundary from './components/ErrorBoundary';
import StudyNotificationScheduler from './components/StudyNotificationScheduler';

// Direct imports for instant, zero-latency navigation across all tabs
import QuizHub from './components/QuizHub';
import FlashcardHub from './components/FlashcardHub';
import SkillPracticeHub from './components/SkillPracticeHub';
import MasteryCenter from './components/MasteryCenter';
import FormulaReference from './components/FormulaReference';
import Notebook from './components/Notebook';
import PricingPage from './components/PricingPage';
import UserProfile from './components/UserProfile';
import HelpSupport from './components/HelpSupport';
import AdminSupport from './components/AdminSupport';
import AdminDashboard from './components/AdminDashboard';
import TutorDashboard from './components/TutorDashboard';
import Arena from './components/Arena';
import ConceptMap from './components/ConceptMap';
import StudyPlan from './components/StudyPlan';
import VoiceTutor from './components/VoiceTutor';
import ComingSoon from './components/ComingSoon';
import { useFeatureSwitches } from './hooks/useFeatureSwitches';

import AcademicProfileModal from './components/AcademicProfileModal';
import WhatsAppPromoModal from './components/WhatsAppPromoModal';
import DemoDirectorHUD from './components/DemoDirectorHUD';
import DemoReelPreviewModal from './components/DemoReelPreviewModal';
import { useDemoReel } from './context/DemoReelContext';
import { CalculatorProvider, useCalculator } from './context/CalculatorContext';
import { useUserProgress } from './hooks/useUserProgress';
import { useSelfHealing } from './hooks/useSelfHealing';
import { AdaptiveRecalibratorModal } from './components/AdaptiveRecalibratorModal';
import { useAuth } from './context/AuthContext';
import { useCourses } from './context/CourseContext';
import { Menu, Mic, Video } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { View, ChatMessage, CourseId, Department, Semester } from './types';
import { generateModuleContent, generateCourseSkeleton } from './services/aiCourseGenerator';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstitutionProvider } from './context/InstitutionContext';
import { safeFetchJson } from './utils/safeFetch';

const queryClient = new QueryClient();

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
    let isSubscribed = true;
    if (user && chatMessages.length === 0) {
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
  }, [user]);

  if (!isConfigured) {
    return <FirebaseSetup />;
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
        <AdminLogin 
          requireGoogleLogin={true} 
          onBackToApp={() => navigateTo('/', 'hub')} 
          onSuccess={() => navigateTo('/admin/dashboard')} 
        />
      );
    }
    return <LandingPage />;
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
      <AdminLogin 
        onBackToApp={() => navigateTo('/', 'hub')} 
        onSuccess={() => navigateTo('/admin/dashboard')} 
      />
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

    return <AdminDashboard onBackToApp={() => navigateTo('/', 'hub')} />;
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
          <Calculator isOpen={isCalculatorOpen} onClose={() => setIsCalculatorOpen(false)} />
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
        {activeView === 'hub' && (
          <CourseHub 
            onSelectCourse={handleCourseSelect} 
            onProfileClick={() => setActiveView('profile')}
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
            module={activeModule}
            onBack={() => setActiveView('course-syllabus')}
            onSubTopicSelect={handleSubTopicSelect}
            onTakeQuiz={handleTakeQuiz}
            onOpenChat={() => setActiveView('ai-tutor')}
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
            onBackToSyllabus={() => setActiveView('module-topics')}
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

        {/* Consolidated Single Instance of ChatBot (Full page in 'ai-tutor' view, otherwise bottom-corner overlay) */}
      </div>

      <ChatBot 
        isFullPage={activeView === 'ai-tutor'} 
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
      )}

      {recalibrationTopicId && recalibrationScore !== null && (
        <AdaptiveRecalibratorModal
          topicId={recalibrationTopicId}
          score={recalibrationScore}
          isOpen={isRecalibrationOpen}
          onClose={() => setIsRecalibrationOpen(false)}
          progress={progress}
          syllabus={syllabus}
          onViewStudyPlan={() => {
            setIsRecalibrationOpen(false);
            setActiveView('study-plan');
          }}
        />
      )}

      {/* Global Admin Alert */}
      <GlobalNotification />

      {/* Floating Demo Director HUD and Export Modal */}
      <DemoDirectorHUD />
      <DemoReelPreviewModal />

      {/* Toaster for notifications */}
      <Toaster position="top-center" />
    </div>
  );
}
