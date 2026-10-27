import { Book, Layers, Activity, FileText, Brain, ArrowRight, GraduationCap, Award, Calculator, Zap, Flame, Sparkles, RefreshCw, Target, Loader2, Calendar, CheckCircle2, MessageCircle, Bot, Bell, Maximize2, Swords, Lightbulb, ShieldCheck, Camera, Layout, Lock, Download } from 'lucide-react';
import { motion } from 'motion/react';
import { UserProgress, View, Module, CourseId, Assignment, Department, Semester } from '../types';
import { getRecommendations } from '../utils/learningPath';
import { LogService } from '../services/logService';
import { StudyArchitect } from './StudyArchitect';
import { VisionToQuiz } from './VisionToQuiz';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { TrialExpirationBanner } from './TrialExpirationBanner';
import NotificationCenter from './NotificationCenter';
import { useState, useEffect } from 'react';
import { AIService } from '../services/ai';
import { useNotifications } from '../hooks/useNotifications';
import { SRSService, SRSRecord } from '../services/srsService';
import CalendarExportModal from './CalendarExportModal';


const THEME_COLORS: Record<string, { bg: string, text: string, bgHover: string, bgLight: string, shadow: string, border: string, borderHover: string, textLight: string }> = {
  blue: { bg: 'bg-blue-500', text: 'text-blue-600', bgHover: 'hover:bg-blue-600', bgLight: 'bg-blue-50', shadow: 'shadow-blue-500/20', border: 'border-blue-200', borderHover: 'hover:border-blue-200', textLight: 'text-blue-400' },
  emerald: { bg: 'bg-emerald-500', text: 'text-emerald-600', bgHover: 'hover:bg-emerald-600', bgLight: 'bg-emerald-50', shadow: 'shadow-emerald-500/20', border: 'border-emerald-200', borderHover: 'hover:border-emerald-200', textLight: 'text-emerald-400' },
  purple: { bg: 'bg-purple-500', text: 'text-purple-600', bgHover: 'hover:bg-purple-600', bgLight: 'bg-purple-50', shadow: 'shadow-purple-500/20', border: 'border-purple-200', borderHover: 'hover:border-purple-200', textLight: 'text-purple-400' },
  rose: { bg: 'bg-rose-500', text: 'text-rose-600', bgHover: 'hover:bg-rose-600', bgLight: 'bg-rose-50', shadow: 'shadow-rose-500/20', border: 'border-rose-200', borderHover: 'hover:border-rose-200', textLight: 'text-rose-400' },
  amber: { bg: 'bg-amber-500', text: 'text-amber-600', bgHover: 'hover:bg-amber-600', bgLight: 'bg-amber-50', shadow: 'shadow-amber-500/20', border: 'border-amber-200', borderHover: 'hover:border-amber-200', textLight: 'text-amber-400' }
};

interface DashboardProps {
  onModuleSelect: (moduleId: string) => void;
  onSubTopicSelect?: (subTopicId: string) => void;
  onViewSelect: (view: View | 'pricing') => void;
  onProfileClick: () => void;
  onCourseSelect: (courseId: CourseId) => void;
  progress: UserProgress;
  activeCourseId: CourseId | null;
  syllabus: Module[];
  activeDepartment: Department;
  activeSemester: Semester;
  setActiveSemester: (semester: Semester) => void;
  onToggleCalculator: () => void;
}

interface SmartMission {
  title: string;
  reason: string;
  moduleId: string;
  subTopicId: string;
  type: 'review' | 'new' | 'mastery';
}

export default function Dashboard({ onModuleSelect, onSubTopicSelect, onViewSelect, onProfileClick, onCourseSelect, progress, activeCourseId, syllabus, activeDepartment, activeSemester, setActiveSemester, onToggleCalculator }: DashboardProps) {
  const { user, profile, signInWithGoogle } = useAuth();
  const { courses } = useCourses();
  const { isPremium, isTrialActive, daysRemaining } = usePremiumStatus();
  const { notifications, sendNotification, permissionStatus, requestNotificationPermission } = useNotifications();
  const isAdmin = Boolean(user && profile?.role === 'admin');
  const isLocked = !isPremium && !isAdmin;
  const [dailyMission, setDailyMission] = useState<SmartMission | null>(null);
  const [missionCourseId, setMissionCourseId] = useState<CourseId | null>(null);
  const [isLoadingMission, setIsLoadingMission] = useState(false);
  const [dueReviews, setDueReviews] = useState<SRSRecord[]>([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);


  useEffect(() => {
    const isStaffRole = ['admin', 'moderator', 'tutor'].includes(profile?.role || '');
    const isStaff = isStaffRole || isAdmin;
    if (!isStaff && profile?.plan_type === 'free' && isTrialActive && daysRemaining <= 2 && user) {
      const today = new Date().toISOString().split('T')[0];
      const notifId = `trial_ending_${user.uid}_${today}`;
      const hasNotification = notifications.some(n => n.id === notifId || n.title === 'Trial Ending Soon!');
      if (!hasNotification) {
        sendNotification('Trial Ending Soon!', `Your premium trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Upgrade now to keep your access.`, 'warning', notifId);
      }
    }
  }, [isTrialActive, daysRemaining, notifications, sendNotification, profile, isAdmin, user]);

  useEffect(() => {
    const fetchReviews = async () => {
      if (!user) return;
      setIsLoadingReviews(true);
      try {
        const reviews = await SRSService.getDueReviews(user.uid);
        setDueReviews(reviews);
      } catch (error) {
        console.error('Failed to fetch due reviews:', error);
      } finally {
        setIsLoadingReviews(false);
      }
    };
    fetchReviews();
  }, [user]);

  const theme = THEME_COLORS[profile?.themeColor || 'emerald'] || THEME_COLORS.emerald;

  const [showStudyArchitect, setShowStudyArchitect] = useState(false);
  const [showVisionToQuiz, setShowVisionToQuiz] = useState(false);

  const recommendations = getRecommendations(progress, syllabus);

  const extractLevel = (lvl: any) => String(lvl || '').match(/\d+/)?.[0] || '';
  const userLevel = extractLevel(profile?.academic_level);

  // All enrolled courses should be visible in the dashboard, filtered by semester and level
  const enrolledCourses = (progress.enrolledCourses || []).filter(courseId => {
    const course = courses[courseId];
    if (!course) return false;
    
    // Filter by semester
    if (course.semester !== activeSemester) return false;
    
    // Filter by level
    if (userLevel) {
      const courseLevel = extractLevel(course.level);
      if (courseLevel !== userLevel) return false;
    }
    
    return true;
  });

  const upcomingAssignments = (progress.assignments || [])
    .filter(a => {
      const course = courses[a.courseId];
      if (!course || course.semester !== activeSemester) return false;
      if (userLevel && extractLevel(course.level) !== userLevel) return false;
      return a.status === 'pending';
    })
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const recentGrades = (progress.assignments || [])
    .filter(a => {
      const course = courses[a.courseId];
      if (!course || course.semester !== activeSemester) return false;
      if (userLevel && extractLevel(course.level) !== userLevel) return false;
      return a.status === 'graded';
    })
    .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());

  const filteredDueReviews = dueReviews.filter(review => {
    const course = courses[review.courseId];
    if (!course || course.semester !== activeSemester) return false;
    if (userLevel && extractLevel(course.level) !== userLevel) return false;
    return true;
  });

  useEffect(() => {
    const fetchSmartMission = async () => {
      let effectiveSyllabus = syllabus || [];
      let effectiveCourseId = activeCourseId;

      if (!activeCourseId && enrolledCourses.length > 0) {
        effectiveCourseId = enrolledCourses[0];
        effectiveSyllabus = courses[effectiveCourseId]?.syllabus || [];
      }

      if (!effectiveCourseId || !effectiveSyllabus || effectiveSyllabus.length === 0) return;
      
      setIsLoadingMission(true);
      try {
        const mission = await AIService.generateSmartRecommendation(progress, effectiveSyllabus);
        setDailyMission(mission);
        setMissionCourseId(effectiveCourseId);
      } catch (error) {
        console.error('Failed to fetch smart mission:', error);
      } finally {
        setIsLoadingMission(false);
      }
    };

    fetchSmartMission();
  }, [activeCourseId, progress.mastery, enrolledCourses.length]);

  return (
    <div className="flex-1 bg-slate-50 dark:bg-zinc-950 p-3 sm:p-6 lg:p-8 pb-8 no-scrollbar">
      <div className="w-full space-y-6 sm:space-y-8">
        <TrialExpirationBanner />

        {/* New Header Design */}
        <header className="flex items-center justify-between mb-8 lg:pl-4 xl:pl-0">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-3 flex-wrap">
              🎓 Hi {user?.displayName?.split(' ')[0] || 'Scholar'}
              <div className="flex items-center gap-2">
                <span className="text-sm sm:text-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 whitespace-nowrap">
                  Lvl {progress.level}
                </span>
                <select 
                  value={activeSemester}
                  onChange={(e) => setActiveSemester(e.target.value as Semester)}
                  className="text-xs sm:text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-3 py-1 rounded-full border border-blue-200 dark:border-blue-800 outline-none cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                >
                  <option value="1st Semester">1st Sem</option>
                  <option value="2nd Semester">2nd Sem</option>
                </select>
              </div>
            </h1>
            <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 font-medium">Ready to master your courses today?</p>
          </div>
          
          <div className="flex items-center gap-4 sm:gap-6">
            {!isAdmin && (
              <>
                {isLocked ? (
                  <button 
                    onClick={() => onViewSelect('pricing')}
                    className="text-emerald-500 font-bold text-[10px] sm:text-sm tracking-widest hover:text-emerald-600 transition-colors"
                  >
                    ACTIVATE
                  </button>
                ) : null}
              </>
            )}
            
            <NotificationCenter />
            
            <button 
              onClick={onToggleCalculator}
              className="p-3 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
            >
              <Calculator size={20} />
            </button>
            
            <button 
              onClick={onProfileClick}
              className="w-12 h-12 rounded-full overflow-hidden border-2 border-white dark:border-zinc-800 shadow-lg bg-blue-100 dark:bg-blue-900/30 hover:scale-105 transition-transform"
            >
              <img 
                src={profile?.photoURL || user?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid || 'Felix'}`} 
                alt="User" 
                className="w-full h-full object-cover"
              />
            </button>
          </div>
        </header>

        {/* Quick Access Grid */}
        <div className="flex flex-col gap-6">
          {/* Due Reviews Section */}
          {filteredDueReviews.length > 0 && (
            <section className="w-full">
              <div className="flex items-center gap-3 mb-4">
                <RefreshCw className="text-emerald-600 dark:text-emerald-400" size={24} />
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Due for Review</h2>
                <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-3 py-1 rounded-full text-xs font-bold">
                  {filteredDueReviews.length} Topics
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredDueReviews.slice(0, 3).map((review) => (
                  <motion.div
                    key={review.topicId}
                    whileHover={{ y: -2 }}
                    className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-emerald-100 dark:border-emerald-900/30 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                    onClick={() => {
                      if (review.courseId !== activeCourseId) {
                        onCourseSelect(review.courseId as CourseId);
                      }
                      setTimeout(() => {
                        if (onSubTopicSelect) {
                          onSubTopicSelect(review.topicId);
                        }
                      }, 50);
                    }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 p-2 rounded-lg text-emerald-600 dark:text-emerald-400">
                        <Brain size={20} />
                      </div>
                      <span className="text-xs font-bold text-slate-400 dark:text-slate-500">
                        Lvl {review.repetitions}
                      </span>
                    </div>
                    <h3 className="font-bold text-slate-900 dark:text-white mb-1 line-clamp-1">{review.topicTitle}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                      Review to strengthen memory
                    </p>
                    <div className="flex items-center text-emerald-600 dark:text-emerald-400 text-sm font-bold group-hover:translate-x-1 transition-transform">
                      Review Now <ArrowRight size={16} className="ml-1" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* Daily Mission Card (AI Powered) */}
          <section className="w-full">
            <div className="flex items-center gap-3 mb-4">
              <Target className="text-blue-600 dark:text-blue-400" size={24} />
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Today's Smart Mission</h2>
            </div>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[2.5rem] p-8 sm:p-10 text-white shadow-2xl shadow-blue-500/20 h-full flex flex-col justify-center"
            >
              {isLoadingMission ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <Loader2 size={40} className="animate-spin text-blue-200" />
                  <p className="text-blue-100 font-medium animate-pulse">Cohere AI is analyzing your progress...</p>
                </div>
              ) : dailyMission ? (
                <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                  <div className="space-y-6 max-w-xl">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-xs font-bold uppercase tracking-widest">
                      <Sparkles size={14} className="text-amber-300" />
                      <span>{dailyMission.type === 'review' ? 'Critical Review' : dailyMission.type === 'mastery' ? 'Mastery Push' : 'New Challenge'}</span>
                      <span className="ml-2 pl-2 border-l border-white/30 text-[10px] opacity-80">Powered by Cohere AI</span>
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold leading-tight">{dailyMission.title}</h3>
                      <p className="text-blue-100 text-base sm:text-lg leading-relaxed opacity-90">
                        {dailyMission.reason}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        if (missionCourseId && missionCourseId !== activeCourseId) {
                          onCourseSelect(missionCourseId);
                        }
                        setTimeout(() => {
                          if (onSubTopicSelect) {
                            onSubTopicSelect(dailyMission.subTopicId);
                          } else {
                            onModuleSelect(dailyMission.moduleId);
                          }
                        }, 50);
                      }}
                      className="group flex items-center gap-3 bg-white text-blue-600 px-6 sm:px-8 py-3.5 sm:py-4 rounded-2xl font-bold text-base sm:text-lg hover:bg-blue-50 transition-all shadow-xl active:scale-95"
                    >
                      Accept Mission
                      <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                  
                  <div className="hidden xl:block">
                    <div className="w-48 h-48 rounded-full border-8 border-white/10 flex items-center justify-center relative">
                      <div className="absolute inset-0 rounded-full border-4 border-white/20 animate-ping" />
                      <Target size={80} className="text-white/80" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-blue-100 text-lg">No mission available. Start a course to get Cohere AI recommendations!</p>
                </div>
              )}
            </motion.div>
          </section>
        </div>

        {/* Enrolled Courses */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <GraduationCap className="text-slate-900 dark:text-white" size={24} />
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">My Courses</h2>
            </div>
            <button onClick={() => onViewSelect('hub')} className="text-sm font-bold text-blue-600 hover:underline">Browse All</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {enrolledCourses.length > 0 ? (
              enrolledCourses.map((courseId) => {
                const course = courses[courseId];
                if (!course) return null;
                
                const courseTotalTopics = (course.syllabus || []).reduce((acc, m) => acc + (m.subTopics || []).length, 0);
                const courseMasteredTopics = progress?.mastery ? Object.keys(progress.mastery).filter(k => k.startsWith(courseId)).length : 0;
                const progressPercentage = courseTotalTopics > 0 ? (courseMasteredTopics / courseTotalTopics) * 100 : 0;

                return (
                  <motion.div
                    key={courseId}
                    whileHover={{ y: -5 }}
                    className="bg-white dark:bg-zinc-900 p-6 rounded-[2rem] border border-slate-200 dark:border-zinc-800 shadow-sm hover:shadow-md transition-all group"
                  >
                    <div className="w-12 h-12 bg-slate-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center mb-4 group-hover:bg-slate-900 dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-zinc-900 transition-colors">
                      <Book size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">{course.id}</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4 line-clamp-1">{course.title}</p>
                    <div className="w-full bg-slate-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden mb-6">
                      <div 
                        className="bg-emerald-500 h-full rounded-full transition-all duration-1000" 
                        style={{ width: `${progressPercentage}%` }}
                      />
                    </div>
                    <button 
                      onClick={() => {
                        onCourseSelect(courseId);
                      }}
                      className="w-full py-2 bg-slate-50 dark:bg-zinc-800 text-slate-900 dark:text-white rounded-xl font-bold text-xs hover:bg-slate-900 dark:hover:bg-white hover:text-white dark:hover:text-zinc-900 transition-all"
                    >
                      Continue Learning
                    </button>
                  </motion.div>
                );
              })
            ) : (
              <div className="col-span-full text-center py-12 text-slate-400">
                <p>No enrolled courses for {activeDepartment}. Visit the Course Hub to enroll!</p>
              </div>
            )}
          </div>
        </section>

        {/* Assignments & Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Upcoming Assignments */}
          <section className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-[2.5rem] p-8 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <Calendar className="text-amber-500" size={24} />
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Upcoming</h2>
              </div>
              <div className="flex items-center gap-2">
                {upcomingAssignments.length > 0 && (
                  <button
                    onClick={() => setIsExportModalOpen(true)}
                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-bold"
                    title="Export deadlines to digital calendar"
                  >
                    <Download size={14} className="text-amber-500" />
                    <span className="hidden sm:inline">Sync Cal</span>
                  </button>
                )}
                <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-3 py-1 rounded-full text-xs font-bold">
                  {upcomingAssignments.length} Pending
                </span>
              </div>
            </div>
            
            <div className="space-y-4">
              {upcomingAssignments.length > 0 ? upcomingAssignments.map((assignment) => (
                <div 
                  key={assignment.id} 
                  onClick={() => onCourseSelect(assignment.courseId)}
                  className="flex items-center justify-between p-4 bg-slate-50 dark:bg-zinc-800/50 rounded-2xl border border-slate-100 dark:border-zinc-700 hover:border-amber-200 dark:hover:border-amber-500/50 transition-colors group cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-white dark:bg-zinc-800 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                      <FileText size={20} className="text-slate-400 dark:text-zinc-500" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-sm">{assignment.title}</h4>
                      <p className="text-xs text-slate-500 dark:text-zinc-400">{assignment.courseId} • Due {new Date(assignment.dueDate).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <button className="p-2 text-slate-400 dark:text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    <ArrowRight size={18} />
                  </button>
                </div>
              )) : (
                <div className="text-center py-8 text-slate-400 dark:text-zinc-500">
                  <CheckCircle2 size={40} className="mx-auto mb-2 opacity-20" />
                  <p>All caught up! No pending assignments.</p>
                </div>
              )}
            </div>
          </section>

          {/* Recent Performance */}
          <section className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-[2.5rem] p-8 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <Activity className="text-emerald-500" size={24} />
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Performance</h2>
              </div>
              <span className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Recent Grades</span>
            </div>
            
            <div className="space-y-4">
              {recentGrades.length > 0 ? recentGrades.map((grade) => (
                <div 
                  key={grade.id} 
                  onClick={() => onCourseSelect(grade.courseId)}
                  className="flex items-center justify-between p-4 bg-slate-50 dark:bg-zinc-800/50 rounded-2xl border border-slate-100 dark:border-zinc-700 hover:border-emerald-200 dark:hover:border-emerald-500/50 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-white dark:bg-zinc-800 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                      <Award size={20} className="text-emerald-500" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-sm">{grade.title}</h4>
                      <p className="text-xs text-slate-500 dark:text-zinc-400">{grade.courseId} • Completed</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-slate-900 dark:text-white">{grade.grade}%</div>
                    <div className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">Passed</div>
                  </div>
                </div>
              )) : (
                <div className="text-center py-8 text-slate-400 dark:text-zinc-500">
                  <Activity size={40} className="mx-auto mb-2 opacity-20" />
                  <p>No graded assignments yet. Keep studying!</p>
                </div>
              )}
            </div>
          </section>

        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-8 rounded-[2.5rem] flex items-center gap-6 shadow-sm">
            <div className="bg-amber-500 p-5 rounded-2xl text-white shadow-lg shadow-amber-500/20">
              <Flame size={32} />
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">{progress.streak}</div>
              <div className="text-xs font-semibold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Day Streak</div>
            </div>
          </div>
          <div className="bg-slate-900 dark:bg-zinc-900 text-white p-8 rounded-[2.5rem] flex items-center gap-6 shadow-xl shadow-slate-900/10 border border-slate-800 dark:border-zinc-800">
            <div className="bg-emerald-500 p-5 rounded-2xl text-white shadow-lg shadow-emerald-500/20">
              <Zap size={32} />
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-bold">{progress.xp}</div>
              <div className="text-xs font-semibold text-slate-500 dark:text-zinc-500 uppercase tracking-wider">Total XP</div>
            </div>
          </div>
        </div>

        {/* Recommended for You */}
        {recommendations.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <Sparkles className="text-amber-500" size={24} />
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Recommended for You</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {recommendations.map((rec, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="bg-white dark:bg-zinc-900 p-6 rounded-[2rem] border border-slate-200 dark:border-zinc-800 shadow-sm hover:shadow-md transition-all hover:-translate-y-1"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`p-2 rounded-xl ${rec.type === 'new' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'}`}>
                      {rec.type === 'new' ? <Sparkles size={18} /> : <RefreshCw size={18} />}
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      {rec.type === 'new' ? 'New Topic' : 'Review'}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 leading-tight">{rec.title}</h3>
                  <p className="text-slate-500 dark:text-zinc-400 text-sm mb-6 line-clamp-2">{rec.reason}</p>
                  <button
                    onClick={() => onModuleSelect(rec.moduleId)}
                    className="w-full py-3 px-4 bg-slate-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl font-bold text-sm hover:bg-slate-800 dark:hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
                  >
                    Start Learning <ArrowRight size={16} />
                  </button>
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {/* Mastery Hacks Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Zap className="text-purple-600" size={24} />
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Mastery Hacks</h2>
            </div>
            <span className="text-xs font-bold text-purple-600 bg-purple-50 dark:bg-purple-900/30 px-3 py-1 rounded-full uppercase tracking-wider">
              Elite Exam Strategies
            </span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <motion.div 
              whileHover={{ scale: 1.02 }}
              className="bg-gradient-to-br from-slate-900 to-slate-800 dark:from-zinc-900 dark:to-zinc-800 p-8 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden group border dark:border-zinc-800"
            >
              <div className="relative z-10 space-y-4">
                <div className="bg-purple-500/20 p-3 rounded-2xl w-fit">
                  <Brain size={24} className="text-purple-400" />
                </div>
                <h3 className="text-2xl font-bold">The "Reverse Feynman" Protocol</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Teach the AI Tutor as if it were a beginner. It will only interrupt if you make a logical error or miss a key derivation. This is the ultimate test of true mastery.
                </p>
                <div className="flex items-center gap-2 text-purple-400 font-bold text-xs uppercase tracking-widest">
                  <ShieldCheck size={14} />
                  <span>Verified Mastery Technique</span>
                </div>
              </div>
              <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all" />
            </motion.div>

            <motion.div 
              whileHover={{ scale: 1.02 }}
              className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-8 rounded-[2.5rem] shadow-sm relative overflow-hidden group"
            >
              <div className="relative z-10 space-y-4">
                <div className="bg-emerald-50 dark:bg-emerald-900/30 p-3 rounded-2xl w-fit">
                  <Lightbulb size={24} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Active Recall Sprints</h3>
                <p className="text-slate-500 dark:text-zinc-400 text-sm leading-relaxed">
                  Before reading a new module, spend 2 minutes writing down everything you already know about the topic. This "primes" your brain for faster absorption.
                </p>
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs uppercase tracking-widest">
                  <Zap size={14} />
                  <span>2x Learning Speed</span>
                </div>
              </div>
              <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl group-hover:bg-emerald-500/10 transition-all" />
            </motion.div>
          </div>
        </section>

        {/* Tools & Resources */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Study Architect */}
          <motion.button
            onClick={() => {
              if (isLocked) {
                LogService.log('info', 'user', 'locked_feature_click', { feature: 'study-architect', userId: user?.uid });
                onViewSelect('pricing');
              } else {
                setShowStudyArchitect(true);
              }
            }}
            className={`group bg-gradient-to-br from-purple-600 to-indigo-700 p-8 rounded-[2.5rem] text-left hover:scale-[1.02] transition-all duration-500 flex flex-col justify-between min-h-[280px] shadow-xl shadow-purple-200 relative overflow-hidden ${isLocked ? 'opacity-80' : ''}`}
          >
            <div className="space-y-6">
              <div className="bg-white/20 text-white p-3 rounded-2xl w-fit">
                <Layout size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-bold text-white leading-tight">Study Architect</h3>
                <p className="text-purple-100 text-xs sm:text-sm">Optimize your study sessions around your lecture timetable.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-bold text-white text-sm">
              <span>{isLocked ? 'Upgrade to Unlock' : 'Optimize Schedule'}</span>
              <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
            </div>
            {isLocked && <Lock size={20} className="absolute top-6 right-6 text-white/50" />}
          </motion.button>

          {/* Vision-to-Quiz */}
          <motion.button
            onClick={() => {
              if (isLocked) {
                LogService.log('info', 'user', 'locked_feature_click', { feature: 'vision-to-quiz', userId: user?.uid });
                onViewSelect('pricing');
              } else {
                setShowVisionToQuiz(true);
              }
            }}
            className={`group bg-gradient-to-br from-emerald-500 to-teal-600 p-8 rounded-[2.5rem] text-left hover:scale-[1.02] transition-all duration-500 flex flex-col justify-between min-h-[280px] shadow-xl shadow-emerald-200 relative overflow-hidden ${isLocked ? 'opacity-80' : ''}`}
          >
            <div className="space-y-6">
              <div className="bg-white/20 text-white p-3 rounded-2xl w-fit">
                <Camera size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-bold text-white leading-tight">Vision-to-Mastery</h3>
                <p className="text-emerald-50 text-xs sm:text-sm">Snap a photo of your notes to generate instant quizzes.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-bold text-white text-sm">
              <span>{isLocked ? 'Upgrade to Unlock' : 'Snap Notes'}</span>
              <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
            </div>
            {isLocked && <Lock size={20} className="absolute top-6 right-6 text-white/50" />}
          </motion.button>

          {/* AI Arena */}
          <motion.button
            onClick={() => onViewSelect('arena')}
            className="group bg-slate-900 dark:bg-zinc-900 border border-slate-800 dark:border-zinc-800 p-8 rounded-[2.5rem] text-left hover:border-purple-500 transition-all duration-500 flex flex-col justify-between min-h-[280px] shadow-2xl"
          >
            <div className="space-y-6">
              <div className="bg-purple-500/10 text-purple-400 p-3 rounded-2xl w-fit group-hover:bg-purple-500 group-hover:text-white transition-colors duration-500">
                <Swords size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-bold text-white leading-tight">AI Arena</h3>
                <p className="text-slate-400 dark:text-zinc-500 text-xs sm:text-sm">Challenge other students in real-time PvP battles.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-bold text-purple-400 text-sm">
              <span>Enter Arena</span>
              <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
            </div>
          </motion.button>

          {/* Quizzes */}
          <motion.button
            onClick={() => onViewSelect('quizzes')}
            className="group bg-slate-900 dark:bg-white text-white dark:text-zinc-900 p-8 rounded-[2.5rem] text-left hover:scale-[1.02] transition-all duration-500 flex flex-col justify-between min-h-[280px] shadow-lg shadow-slate-200 dark:shadow-none"
          >
            <div className="space-y-6">
              <div className="bg-emerald-500 p-3 rounded-2xl w-fit">
                <Brain size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-bold leading-tight">Quiz Hub</h3>
                <p className="text-slate-400 dark:text-zinc-500 dark:group-hover:text-zinc-600 text-xs sm:text-sm">Generate custom quizzes to master the material.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-bold text-emerald-400 dark:text-emerald-600 text-sm">
              <span>Go to Quizzes</span>
              <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
            </div>
          </motion.button>

          {/* Mastery Center */}
          <motion.button
            onClick={() => {
              if (isLocked) {
                LogService.log('info', 'user', 'locked_feature_click', { feature: 'mastery', userId: user?.uid });
                onViewSelect('pricing');
              } else {
                onViewSelect('mastery');
              }
            }}
            className={`group bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-8 rounded-[2.5rem] text-left hover:border-slate-900 dark:hover:border-white transition-all duration-500 flex flex-col justify-between min-h-[280px] shadow-sm relative overflow-hidden ${isLocked ? 'opacity-80' : ''}`}
          >
            <div className="space-y-6">
              <div className="bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400 p-3 rounded-2xl w-fit group-hover:bg-blue-500 group-hover:text-white transition-colors duration-500">
                <Award size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white leading-tight">Mastery Center</h3>
                <p className="text-slate-500 dark:text-zinc-400 text-xs sm:text-sm">View your knowledge heatmap and learning analytics.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
              <span>{isLocked ? 'Upgrade to Unlock' : 'View Progress'}</span>
              <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
            </div>
            {isLocked && <Lock size={20} className="absolute top-6 right-6 text-slate-300 dark:text-zinc-700" />}
          </motion.button>

          {/* Formula Vault */}
          <motion.button
            onClick={() => onViewSelect('formulas')}
            className="group bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-8 rounded-[2.5rem] text-left hover:border-slate-900 dark:hover:border-white transition-all duration-500 flex flex-col justify-between min-h-[280px] shadow-sm"
          >
            <div className="space-y-6">
              <div className="bg-purple-50 dark:bg-purple-900/30 text-purple-500 dark:text-purple-400 p-3 rounded-2xl w-fit group-hover:bg-purple-500 group-hover:text-white transition-colors duration-500">
                <Calculator size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white leading-tight">Formula Vault</h3>
                <p className="text-slate-500 dark:text-zinc-400 text-xs sm:text-sm">A centralized repository of every formula and theorem.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
              <span>Open Vault</span>
              <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
            </div>
          </motion.button>

          {/* Skill & CBT Practice Hub */}
          <motion.button
            onClick={() => onViewSelect('past-questions')}
            className="group bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-8 rounded-[2.5rem] text-left hover:border-slate-900 dark:hover:border-white transition-all duration-500 flex flex-col justify-between min-h-[280px] shadow-sm"
          >
            <div className="space-y-6">
              <div className="bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-white p-3 rounded-2xl w-fit group-hover:bg-slate-900 dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-zinc-900 transition-colors duration-500">
                <FileText size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white leading-tight">Skill & CBT Hub</h3>
                <p className="text-slate-500 dark:text-zinc-400 text-xs sm:text-sm">Interactive concept carousels, pair matching, smart MCQs, and timed syllabus CBT mock exams.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
              <span>Launch Practice Hub</span>
              <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
            </div>
          </motion.button>

          {/* Concept Map */}
          <motion.button
            onClick={() => {
              if (isLocked) {
                LogService.log('info', 'user', 'locked_feature_click', { feature: 'concept-map', userId: user?.uid });
                onViewSelect('pricing');
              } else {
                onViewSelect('concept-map');
              }
            }}
            className={`group bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-8 rounded-[2.5rem] text-left hover:border-slate-900 dark:hover:border-white transition-all duration-500 flex flex-col justify-between min-h-[280px] shadow-sm relative overflow-hidden ${isLocked ? 'opacity-80' : ''}`}
          >
            <div className="space-y-6">
              <div className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-500 dark:text-emerald-400 p-3 rounded-2xl w-fit group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-500">
                <Maximize2 size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white leading-tight">Concept Map</h3>
                <p className="text-slate-500 dark:text-zinc-400 text-xs sm:text-sm">Visualize how biological concepts are interconnected.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
              <span>{isLocked ? 'Upgrade to Unlock' : 'Explore Map'}</span>
              <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
            </div>
            {isLocked && <Lock size={20} className="absolute top-6 right-6 text-slate-300 dark:text-zinc-700" />}
          </motion.button>

        </section>

        {/* Modals */}
        {showStudyArchitect && (
          <StudyArchitect 
            progress={progress} 
            onClose={() => setShowStudyArchitect(false)} 
          />
        )}
        {showVisionToQuiz && (
          <VisionToQuiz 
            onClose={() => setShowVisionToQuiz(false)}
            onQuizGenerated={(quiz) => {
              // Handle generated quiz (e.g. open quiz view)
              setShowVisionToQuiz(false);
              onViewSelect('quizzes');
            }}
          />
        )}
        <CalendarExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          type="assignments"
          assignments={upcomingAssignments}
        />
      </div>
    </div>
  );
}
