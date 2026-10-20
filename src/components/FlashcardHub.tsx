import React, { useState, useEffect } from 'react';
import { Module, CourseId, UserProgress } from '../types';
import { BrainCircuit, Book, ArrowRight, PlayCircle, Flame, Target, Trophy, AlertTriangle, BookOpen } from 'lucide-react';
import { motion } from 'motion/react';
import Flashcards from './Flashcards';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import CourseContextBar from './CourseContextBar';
import { useUserProgress } from '../hooks/useUserProgress';
import { isCourseEligibleForUser } from '../utils/courseEligibility';

interface FlashcardHubProps {
  syllabus: Module[];
  activeCourseId: CourseId | null;
  onSelectCourse: (courseId: CourseId) => void;
  activeSemester?: string;
  enrolledCourses?: CourseId[];
}

export default function FlashcardHub({ 
  syllabus, 
  activeCourseId, 
  onSelectCourse,
  activeSemester = '1st Semester',
  enrolledCourses = []
}: FlashcardHubProps) {
  const { user, profile } = useAuth();
  const { courses } = useCourses();
  const { progress } = useUserProgress();
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [isGlobalReview, setIsGlobalReview] = useState(false);
  const [stats, setStats] = useState({ learning: 0, mastered: 0, totalDue: 0, streak: 0 });

  const activeCourse = activeCourseId ? courses[activeCourseId] : null;

  // Filter program courses using shared eligibility engine
  const availableCourses = Object.values(courses).filter(c => 
    isCourseEligibleForUser(c, profile, activeSemester, enrolledCourses) || enrolledCourses.includes(c.id as CourseId)
  );

  const fetchStats = async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/user/srs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const json = await res.json();
      const cards = json.cards || [];
      let learning = 0;
      let mastered = 0;
      let due = 0;
      const now = Date.now();

      cards.forEach((card: any) => {
        if (activeCourseId && card.course_id !== activeCourseId) return;

        if ((card.review_count || 0) > 3) {
          mastered++;
        } else {
          learning++;
        }
        if (!card.next_review_at || new Date(card.next_review_at).getTime() <= now) {
          due++;
        }
      });
      
      setStats({ learning, mastered, totalDue: due, streak: profile?.streak || 0 });
    } catch (e) {
      console.error("Failed to fetch flashcard stats:", e);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [user, activeCourseId]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-zinc-950 p-3 sm:p-6 lg:p-8 pb-16 transition-colors">
      <div className="w-full space-y-8 sm:space-y-12">
        
        {/* Active Course Context Switcher */}
        <CourseContextBar
          courses={courses}
          activeCourseId={activeCourseId}
          onSelectCourse={onSelectCourse}
          profile={profile}
          activeSemester={activeSemester}
          enrolledCourses={enrolledCourses}
          titleLabel="Flashcard Hub Active Course"
        />

        {/* Header */}
        <header className="space-y-4 lg:pl-4 xl:pl-0 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 text-purple-600 dark:text-purple-400 font-semibold uppercase tracking-wider text-xs">
              <BrainCircuit size={16} />
              <span>Spaced Repetition</span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
              {activeCourse ? `${activeCourse.id}: Flashcard Hub` : 'Academic Flashcards'}
            </h1>
            <p className="text-slate-500 dark:text-zinc-400 text-sm sm:text-base max-w-2xl mt-2 leading-relaxed">
              Review key concepts and formulas using spaced repetition to ensure long-term retention.
            </p>
          </div>
          
          {activeCourseId && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsGlobalReview(true)}
              className="flex items-center gap-3 px-6 sm:px-8 py-3.5 sm:py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-3xl font-semibold shadow-xl shadow-purple-500/20 transition-colors shrink-0"
            >
              <PlayCircle size={24} />
              <div className="text-left">
                <div className="font-semibold leading-tight">Daily Global Review</div>
                <div className="text-xs text-purple-200 font-medium">{stats.totalDue > 0 ? `${stats.totalDue} cards due` : 'All caught up!'}</div>
              </div>
            </motion.button>
          )}
        </header>

        {/* STATE 1: No Course Selected */}
        {!activeCourseId && (
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 text-center space-y-6 shadow-sm">
            <div className="w-16 h-16 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-2xl flex items-center justify-center mx-auto">
              <BrainCircuit size={32} />
            </div>
            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Select a Course to View Flashcards
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                Choose a course from your program curriculum to start reviewing concepts with active recall.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-left max-w-3xl mx-auto pt-4">
              {availableCourses.map(c => (
                <button
                  key={c.id}
                  onClick={() => onSelectCourse(c.id as CourseId)}
                  className="p-5 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-700/60 rounded-2xl transition-all group flex flex-col justify-between"
                >
                  <div>
                    <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider block mb-1">
                      {c.id}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 mb-2">
                      {c.title}
                    </h4>
                  </div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-zinc-300 pt-3 border-t border-slate-200/60 dark:border-zinc-700/60">
                    <span>{c.level ? `L${c.level}` : 'L100'} • {c.semester || activeSemester}</span>
                    <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform text-purple-500" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STATE 2: Course Selected, but Syllabus Empty */}
        {activeCourseId && activeCourse && (!syllabus || syllabus.length === 0) && (
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 sm:p-12 text-center space-y-6 shadow-sm">
            <div className="w-16 h-16 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle size={32} />
            </div>
            <div className="max-w-lg mx-auto space-y-2">
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                Syllabus Pending for {activeCourse.id}
              </h3>
              <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                The core modules for <strong className="text-slate-900 dark:text-white">{activeCourse.title}</strong> are being compiled. You can request syllabus generation on the Syllabus tab.
              </p>
            </div>
          </div>
        )}

        {/* STATE 3: Course Selected & Syllabus Active */}
        {activeCourseId && syllabus && syllabus.length > 0 && (
          <>
            {/* Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-5 sm:p-6 flex flex-col items-center justify-center text-center shadow-sm">
                 <div className="w-11 h-11 sm:w-12 sm:h-12 bg-orange-100 dark:bg-orange-950/30 text-orange-500 rounded-full flex items-center justify-center mb-3">
                   <Flame size={22} />
                 </div>
                 <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{stats.streak}</div>
                 <div className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mt-1">Day Streak</div>
              </div>
              <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-5 sm:p-6 flex flex-col items-center justify-center text-center shadow-sm">
                 <div className="w-11 h-11 sm:w-12 sm:h-12 bg-blue-100 dark:bg-blue-950/30 text-blue-500 rounded-full flex items-center justify-center mb-3">
                   <Target size={22} />
                 </div>
                 <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{stats.totalDue}</div>
                 <div className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mt-1">Due Today</div>
              </div>
              <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-5 sm:p-6 flex flex-col items-center justify-center text-center shadow-sm">
                 <div className="w-11 h-11 sm:w-12 sm:h-12 bg-purple-100 dark:bg-purple-950/30 text-purple-500 rounded-full flex items-center justify-center mb-3">
                   <BrainCircuit size={22} />
                 </div>
                 <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{stats.learning}</div>
                 <div className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mt-1">Learning</div>
              </div>
              <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-5 sm:p-6 flex flex-col items-center justify-center text-center shadow-sm">
                 <div className="w-11 h-11 sm:w-12 sm:h-12 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-500 rounded-full flex items-center justify-center mb-3">
                   <Trophy size={22} />
                 </div>
                 <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{stats.mastered}</div>
                 <div className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mt-1">Mastered</div>
              </div>
            </div>

            {/* Module Grid */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {syllabus.map((module, i) => (
                <motion.div
                  key={module.id || i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 hover:shadow-xl hover:border-purple-500 transition-all duration-300 group flex flex-col h-full shadow-sm"
                >
                  <div className="flex-1 space-y-4">
                    <div className="w-12 h-12 bg-purple-50 dark:bg-purple-950/30 text-purple-500 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Book size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-tight mb-2">
                        {module.title}
                      </h3>
                      <p className="text-slate-500 dark:text-zinc-400 text-sm line-clamp-2">
                        {(module.subTopics || []).length} topics to review
                      </p>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => setSelectedModule(module)}
                    className="mt-6 w-full py-4 bg-slate-50 dark:bg-zinc-800 text-slate-900 dark:text-white rounded-2xl font-bold flex items-center justify-center gap-2 group-hover:bg-purple-500 group-hover:text-white transition-colors"
                  >
                    Start Review
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>

      {(selectedModule || isGlobalReview) && (
        <Flashcards 
          module={selectedModule || undefined}
          isGlobalReview={isGlobalReview} 
          onClose={() => {
            setSelectedModule(null);
            setIsGlobalReview(false);
            fetchStats();
          }} 
        />
      )}
    </div>
  );
}
