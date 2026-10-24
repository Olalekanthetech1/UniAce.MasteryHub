import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Sparkles, Globe, Search, Users, Calendar, ArrowRight, Loader2, Edit2, Clock, GraduationCap, Rocket, BellRing } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useCourses } from '../context/CourseContext';
import { CourseId, View, Course, UserProgress, Department, Semester } from '../types';
import { useAuth } from '../context/AuthContext';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import NotificationCenter from './NotificationCenter';
import AcademicProfileModal from './AcademicProfileModal';
import { useDebounce } from 'use-debounce';
import { formatDistanceToNow } from 'date-fns';
import { useAppStore } from '../lib/store';
import { isCourseEligibleForUser, getCourseProgramStatus } from '../utils/courseEligibility';

interface CourseHubProps {
  onSelectCourse: (id: CourseId) => void;
  onProfileClick: () => void;
  onViewSelect: (view: View) => void;
  enrolledCourses: CourseId[];
  progress: UserProgress;
  activeSemester: Semester;
  setActiveSemester: (semester: Semester) => void;
}

type Tab = 'your-courses' | 'explore';

export default function CourseHub({ onSelectCourse, onProfileClick, onViewSelect, enrolledCourses, progress, activeSemester, setActiveSemester }: CourseHubProps) {
  const { user, profile, isConfigured } = useAuth();
  const { courses, loading: coursesLoading } = useCourses();
  const { isPremium } = usePremiumStatus();
  const isAdmin = profile?.role === 'admin' || (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').includes(user?.email || '');
  
  const [activeTab, setActiveTab] = useState<Tab>('your-courses');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const { addLastAccessedCourse } = useAppStore();

  const handleRequestCurriculum = async () => {
    if (!user || isRequesting) return;
    setIsRequesting(true);
    try {
      await addDoc(collection(db, 'curriculum_requests'), {
        userId: user.uid,
        email: user.email,
        department: profile?.department || '',
        level: profile?.academic_level || '',
        semester: activeSemester,
        timestamp: serverTimestamp(),
        status: 'pending'
      });
      toast.success("We've recorded your request! We'll notify you when courses are added.", { duration: 5000, icon: '🚀' });
    } catch (err) {
      console.error(err);
      toast.error("Failed to submit request.");
    } finally {
      setIsRequesting(false);
    }
  };

  const filteredCourses = useMemo(() => {
    let result = Object.values(courses);

    const normalize = (s: any) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const extractLevel = (lvl: any) => String(lvl || '').match(/\d+/)?.[0] || '';

    // Apply Tab Filter
    if (activeTab === 'your-courses') {
      result = result.filter(c => isCourseEligibleForUser(c, profile, activeSemester, enrolledCourses));
    } else if (activeTab === 'explore' && !isAdmin) {
      result = result.filter(c => {
        const status = getCourseProgramStatus(c, profile, activeSemester);
        return status === 'current_program' || status === 'global_core' || status === 'elective';
      });
    }

    // Apply Search Filter
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      result = result.filter(c => 
        c.title.toLowerCase().includes(query) || 
        c.description.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query) ||
        c.departments?.some(d => d.toLowerCase().includes(query)) ||
        c.faculties?.some(f => f.toLowerCase().includes(query)) ||
        c.scope?.toLowerCase().includes(query)
      );
    }

    // Sort: Courses with progress first
    result.sort((a, b) => {
      const aHasProgress = a.syllabus?.some(module => 
        module.subTopics?.some(topic => 
          (progress.mastery?.[`${module.id}-${topic.id}`] || 0) > 0 || 
          progress.topicLastStudied?.[`${module.id}-${topic.id}`]
        )
      );
      const bHasProgress = b.syllabus?.some(module => 
        module.subTopics?.some(topic => 
          (progress.mastery?.[`${module.id}-${topic.id}`] || 0) > 0 || 
          progress.topicLastStudied?.[`${module.id}-${topic.id}`]
        )
      );
      
      if (aHasProgress && !bHasProgress) return -1;
      if (!aHasProgress && bHasProgress) return 1;
      return 0;
    });

    return result;
  }, [courses, activeTab, debouncedSearchQuery, profile, activeSemester, enrolledCourses, progress]);

  if (coursesLoading && Object.keys(courses).length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-slate-900 dark:text-white animate-spin" />
          <p className="text-slate-500 dark:text-zinc-400 font-medium">Loading your courses...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 transition-colors overflow-x-hidden">
      <div className="w-full flex flex-col lg:flex-row p-3 sm:p-6 lg:p-8 gap-6 lg:gap-8 relative">
        {/* Configuration Warning */}
        {!isConfigured && (
          <div className="fixed top-0 left-0 right-0 bg-amber-500 text-white p-2 text-center text-xs font-bold z-50 shadow-lg">
            Firebase is not configured. Please set the VITE_FIREBASE_* environment variables.
          </div>
        )}

        {showEditProfile && (
          <AcademicProfileModal onClose={() => setShowEditProfile(false)} />
        )}

        {/* Left Sidebar / Header Area */}
        <div className="w-full lg:w-72 flex-shrink-0 flex flex-col gap-6 lg:gap-8 relative z-20">
        <div className="sticky top-12 space-y-8">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
                {profile?.displayName ? `Hello, ${profile.displayName.split(' ')[0]}` : 'Welcome back'}
              </h1>
              <span className="text-2xl sm:text-3xl origin-bottom-right hover:animate-wave cursor-default">👋</span>
            </div>
            
            {profile?.department && profile?.academic_level && profile?.semester ? (
              <div className="group relative bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm border border-slate-200/60 dark:border-zinc-800/60 p-4 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                      Current Program
                    </p>
                    <h2 className="text-base sm:text-lg font-semibold text-slate-800 dark:text-zinc-100 leading-tight">
                      {profile.department}
                    </h2>
                  </div>
                  <button 
                    onClick={() => setShowEditProfile(true)}
                    className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-100/50 dark:bg-zinc-800/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-xl transition-all duration-200 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                    title="Edit Academic Profile"
                  >
                    <Edit2 size={16} />
                  </button>
                </div>
                
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-1.5 bg-indigo-50/80 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 px-2.5 py-1 rounded-lg text-xs font-semibold border border-indigo-100/50 dark:border-indigo-800/50">
                    <GraduationCap size={14} />
                    {profile.academic_level} Level
                  </div>
                  <div className="inline-flex items-center gap-1.5 bg-emerald-50/80 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 px-2.5 py-1 rounded-lg text-xs font-semibold border border-emerald-100/50 dark:border-emerald-800/50">
                    <Calendar size={14} />
                    {activeSemester}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 items-start">
                <p className="text-slate-500 dark:text-zinc-400 font-medium">
                  Set up your academic profile to get personalized courses.
                </p>
                <button 
                  onClick={() => setShowEditProfile(true)}
                  className="px-4 py-2 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-xl font-bold text-sm hover:scale-105 transition-transform"
                >
                  Setup Profile
                </button>
              </div>
            )}
          </div>

          <nav className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-4 lg:pb-0 no-scrollbar">
            <button 
              onClick={() => setActiveTab('your-courses')}
              className={`flex-shrink-0 flex items-center gap-3 px-5 py-3.5 rounded-2xl font-bold transition-all ${
                activeTab === 'your-courses' 
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xl shadow-slate-900/10' 
                  : 'text-slate-500 hover:bg-slate-200/50 dark:hover:bg-zinc-800/50'
              }`}
            >
              <Sparkles size={20} className={activeTab === 'your-courses' ? 'text-amber-400' : ''} />
              Your Courses
            </button>
          </nav>
        </div>
      </div>

      {/* Right Content Area */}
      <div className="flex-1 relative z-20">
        <div className="mb-8 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="text" 
              placeholder="Search courses..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-2xl pl-12 pr-4 py-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-white outline-none transition-all shadow-sm"
            />
          </div>
          
          <div className="flex items-center gap-4 self-end sm:self-auto">
            <button
              onClick={() => setActiveTab('explore')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-colors ${
                activeTab === 'explore'
                  ? 'bg-slate-200 text-slate-900 dark:bg-zinc-800 dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800/50'
              }`}
            >
              <Globe size={16} />
              Explore All
            </button>
            <NotificationCenter />
            <button 
              onClick={onProfileClick}
              className="w-12 h-12 rounded-full overflow-hidden border-2 border-white dark:border-zinc-800 shadow-sm bg-blue-100 dark:bg-blue-900/30 hover:scale-105 transition-transform"
            >
              <img 
                src={profile?.photoURL || user?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid || 'User'}`} 
                alt="Profile" 
                className="w-full h-full object-cover"
              />
            </button>
          </div>
        </div>

        {filteredCourses.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-3xl p-12 text-center flex flex-col items-center justify-center min-h-[400px]">
            <div className={`w-20 h-20 ${activeTab === 'your-courses' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-500' : 'bg-slate-100 dark:bg-zinc-800 text-slate-400'} rounded-full flex items-center justify-center mb-6`}>
              {activeTab === 'your-courses' ? <Rocket size={32} /> : <Search size={32} />}
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              {activeTab === 'your-courses' ? 'Courses for your profile are coming soon' : 'No courses found'}
            </h3>
            <p className="text-slate-500 dark:text-zinc-400 max-w-md mx-auto mb-8">
              {activeTab === 'your-courses' 
                ? `We are actively working on adding curriculum courses for ${profile?.department}, ${profile?.academic_level} Level, ${activeSemester}. In the meantime, you can explore our global courses!`
                : "Try adjusting your search terms to find what you're looking for."}
            </p>

            <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3 w-full max-w-3xl">
              <button 
                onClick={() => setActiveTab('explore')}
                className="px-6 py-3 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-xl font-bold hover:scale-105 transition-transform flex items-center gap-2 w-full sm:w-auto justify-center order-1 sm:order-3"
              >
                <Globe size={18} />
                Explore Global Courses
              </button>
              {activeTab === 'your-courses' && (
                <button 
                  onClick={() => setShowEditProfile(true)}
                  className="px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 w-full sm:w-auto justify-center order-2"
                >
                  Edit Academic Profile
                </button>
              )}
              {activeTab === 'your-courses' && (
                <button 
                  onClick={handleRequestCurriculum}
                  disabled={isRequesting}
                  className="px-6 py-3 border border-orange-200 dark:border-orange-900/30 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/10 rounded-xl font-bold hover:bg-orange-100 dark:hover:bg-orange-900/20 transition-colors flex items-center gap-2 w-full sm:w-auto justify-center order-3 sm:order-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRequesting ? <Loader2 size={18} className="animate-spin" /> : <BellRing size={18} />}
                  {isRequesting ? 'Requesting...' : 'Notify Me When Added'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6">
            {filteredCourses.map((course, index) => (
              <motion.div
                key={course.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-white dark:bg-zinc-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200 dark:border-zinc-800 flex flex-col h-full hover:shadow-xl hover:border-slate-300 dark:hover:border-zinc-700 transition-all group"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      {course.scope === 'GLOBAL' ? 'Global Course' : 
                       course.scope === 'FACULTY' ? `${course.faculties?.join(', ')} Faculty` :
                       course.departments?.length === 1 ? course.departments[0] : 
                       `${course.departments?.length || 0} Departments`}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800 px-2.5 py-1 rounded-md">
                    {course.id}
                  </span>
                </div>
                
                <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mb-2.5 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors leading-snug">
                  {course.title}
                </h3>
                
                <p className="text-sm text-slate-500 dark:text-zinc-400 mb-8 flex-grow line-clamp-3 leading-relaxed">
                  {course.description}
                </p>
                
                <div className="flex items-center justify-between mt-auto pt-6 border-t border-slate-100 dark:border-zinc-800/50">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-zinc-400">
                        <Users size={14} />
                        {course.level ? `L ${course.level}` : 'L 100'}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-zinc-400">
                        <Calendar size={14} />
                        {course.semester === '2nd Semester' ? 'Sem 2' : 'Sem 1'}
                      </div>
                    </div>
                    {(() => {
                      const lastStudied = Object.entries(progress.topicLastStudied || {})
                        .filter(([key]) => key.startsWith(course.id))
                        .map(([, date]) => new Date(date))
                        .sort((a, b) => b.getTime() - a.getTime())[0];
                      
                      if (!lastStudied) return null;
                      
                      return (
                        <div className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          <Clock size={10} />
                          Last studied {formatDistanceToNow(lastStudied)} ago
                        </div>
                      );
                    })()}
                  </div>
                  
                  <button 
                    onClick={() => {
                      addLastAccessedCourse(course.id);
                      onSelectCourse(course.id as CourseId);
                    }}
                    className="bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-5 sm:px-6 py-2.5 rounded-xl font-semibold text-sm hover:scale-105 active:scale-95 transition-transform flex items-center gap-2"
                  >
                    {(() => {
                      const isEnrolled = activeTab === 'your-courses' || enrolledCourses.includes(course.id as CourseId);
                      if (!isEnrolled) return 'Enroll Now';
                      
                      const hasProgress = course.syllabus?.some(module => 
                        module.subTopics?.some(topic => 
                          (progress.mastery?.[`${module.id}-${topic.id}`] || 0) > 0 || 
                          progress.topicLastStudied?.[`${module.id}-${topic.id}`]
                        )
                      );
                      
                      return hasProgress ? 'Continue Learning' : 'Start Learning';
                    })()}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
