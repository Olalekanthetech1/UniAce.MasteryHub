import React, { useState, useEffect } from 'react';
import { Brain, ArrowRight, AlertTriangle, BookOpen, Sparkles, Send, FileText, CheckCircle2, History, RefreshCw, Layers } from 'lucide-react';
import { motion } from 'motion/react';
import QuizGenerator from './QuizGenerator';
import { Module, CourseId, Semester, Course } from '../types';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { getModuleIcon } from '../utils/moduleIcons';
import CourseContextBar from './CourseContextBar';
import toast from 'react-hot-toast';

interface QuizHubProps {
  courseId?: string;
  onQuizComplete: (topicId: string, score: number) => void;
  syllabus: Module[];
  onSelectCourse: (courseId: CourseId) => void;
  activeSemester: Semester | string;
  enrolledCourses?: CourseId[];
}

export default function QuizHub({
  courseId,
  onQuizComplete,
  syllabus,
  onSelectCourse,
  activeSemester,
  enrolledCourses = []
}: QuizHubProps) {
  const { user, profile } = useAuth();
  const { courses } = useCourses();
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  
  // Custom Topic Quiz states
  const [customTopic, setCustomTopic] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);

  // Firestore Quiz Attempts
  const [recentAttempts, setRecentAttempts] = useState<any[]>([]);
  const [isLoadingAttempts, setIsLoadingAttempts] = useState(false);
  const [hasLoggedEmptyAlert, setHasLoggedEmptyAlert] = useState(false);

  const activeCourse = courseId ? courses[courseId] : null;

  // Log alert for empty syllabus via Neon system_alerts endpoint
  useEffect(() => {
    if (activeCourse && (!syllabus || syllabus.length === 0) && !hasLoggedEmptyAlert) {
      setHasLoggedEmptyAlert(true);
      (async () => {
        try {
          const token = user ? await user.getIdToken() : null;
          await fetch('/api/system/alert', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              type: 'EMPTY_SYLLABUS_ALERT',
              courseId: activeCourse.id,
              courseTitle: activeCourse.title,
              department: profile?.department || '',
              academicLevel: profile?.academic_level || '',
              semester: activeSemester,
              status: 'pending'
            })
          });
        } catch (e) {
          console.warn("Could not log empty syllabus alert:", e);
        }
      })();
    }
  }, [activeCourse, syllabus, hasLoggedEmptyAlert, profile, activeSemester, user]);

  // Fetch recent attempts for active course from Neon endpoint
  useEffect(() => {
    if (!user || !courseId) return;
    setIsLoadingAttempts(true);
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/quiz/recent-attempts?courseId=${encodeURIComponent(courseId)}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const data = await res.json();
          setRecentAttempts(data.attempts || []);
        }
      } catch (err) {
        console.warn("Failed loading quiz attempts:", err);
      } finally {
        setIsLoadingAttempts(false);
      }
    })();
  }, [user, courseId]);

  // Handle Custom Topic Quiz generation
  const handleStartCustomTopicQuiz = () => {
    if (!customTopic.trim()) {
      toast.error("Please enter a topic name.");
      return;
    }

    const customModule: Module = {
      id: `custom-${Date.now()}`,
      title: customTopic.trim(),
      subTopics: [
        {
          id: `custom-subtopic-${Date.now()}`,
          title: customTopic.trim(),
          content: customNotes.trim() ? customNotes.trim() : `Custom AI Practice for topic: ${customTopic.trim()}`
        }
      ]
    };

    setSelectedModule(customModule);
    setIsCustomModalOpen(false);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-zinc-950 p-4 sm:p-6 lg:p-12 pb-24 lg:pb-12 transition-colors">
      <div className="w-full space-y-8">
        
        {/* Active Course Context Switcher */}
        <CourseContextBar
          courses={courses}
          activeCourseId={(courseId as CourseId) || null}
          onSelectCourse={onSelectCourse}
          profile={profile}
          activeSemester={activeSemester}
          enrolledCourses={enrolledCourses}
          titleLabel="Quiz Center Active Course"
        />

        <header className="space-y-3">
          <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider text-xs">
            <Brain size={18} />
            <span>AI Master Assessment Engine</span>
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
            Master the Material.
          </h1>
          <p className="text-slate-500 dark:text-zinc-400 text-sm sm:text-base leading-relaxed max-w-3xl">
            Targeted AI-generated quizzes grounded directly in your course syllabus, lecture materials, and academic learning outcomes.
          </p>
        </header>

        {/* STATE 1: No Course Selected */}
        {!courseId && (
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-8 text-center space-y-6 shadow-sm">
            <div className="w-16 h-16 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto">
              <BookOpen size={32} />
            </div>
            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Select a Course to Begin
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                Choose a course from your program curriculum to view its quiz modules and test your understanding.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-left max-w-3xl mx-auto pt-4">
              {Object.values(courses).map(c => (
                <button
                  key={c.id}
                  onClick={() => onSelectCourse(c.id as CourseId)}
                  className="p-5 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-700/60 rounded-2xl transition-all group flex flex-col justify-between"
                >
                  <div>
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block mb-1">
                      {c.id}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 mb-2">
                      {c.title}
                    </h4>
                  </div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-zinc-300 pt-3 border-t border-slate-200/60 dark:border-zinc-700/60">
                    <span>{c.level ? `L${c.level}` : 'L100'} • {c.semester || activeSemester}</span>
                    <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform text-emerald-500" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STATE 2: Course Selected, but Syllabus Empty */}
        {courseId && activeCourse && (!syllabus || syllabus.length === 0) && (
          <div className="bg-amber-500/5 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-900/40 rounded-3xl p-8 sm:p-12 text-center space-y-6">
            <div className="w-16 h-16 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle size={32} />
            </div>
            <div className="max-w-lg mx-auto space-y-2">
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                Syllabus Pending for {activeCourse.id}
              </h3>
              <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                The module outline for <strong className="text-slate-900 dark:text-white">{activeCourse.title}</strong> is currently being compiled for your program. An alert has been automatically logged for admin verification.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
              <button
                onClick={() => setIsCustomModalOpen(true)}
                className="px-6 py-3 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl font-semibold text-sm flex items-center gap-2 shadow-sm transition-transform active:scale-95"
              >
                <Sparkles size={16} />
                Generate Custom Topic Quiz
              </button>
            </div>
          </div>
        )}

        {/* STATE 3: Course Selected with Modules */}
        {courseId && syllabus && syllabus.length > 0 && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Layers size={20} className="text-emerald-500" />
                Select a Module to Practice
              </h2>

              <button
                onClick={() => setIsCustomModalOpen(true)}
                className="px-4 py-2.5 bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-sm transition-colors"
              >
                <Sparkles size={16} className="text-emerald-400 dark:text-emerald-600" />
                Custom AI Topic Quiz
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {syllabus.map((module, i) => {
                const Icon = getModuleIcon(module.id, module.title, i);
                return (
                  <motion.button
                    key={module.id || i}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => setSelectedModule(module)}
                    className="group bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-6 sm:p-8 rounded-3xl text-left hover:border-emerald-500 dark:hover:border-emerald-500 hover:shadow-xl transition-all duration-300 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-5">
                      <div className="bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-white p-4 sm:p-5 rounded-2xl group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-300">
                        <Icon size={28} />
                      </div>
                      <div>
                        <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mb-1">
                          {module.title}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 font-medium">
                          {(module.subTopics || []).length} Topics • Multiple Choice & Essay
                        </p>
                      </div>
                    </div>
                    <div className="bg-emerald-500 text-white p-3.5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 shrink-0">
                      <ArrowRight size={20} />
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Quiz Attempts & Performance Summary */}
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <History size={18} className="text-emerald-500" />
              Recent Quiz Performance
            </h3>
            <span className="text-xs text-slate-500 dark:text-zinc-400">
              {courseId ? `History for ${courseId}` : 'Select a course to view history'}
            </span>
          </div>

          {!courseId ? (
            <div className="text-center py-6 text-sm text-slate-500 dark:text-zinc-400">
              Select a course to view your attempt history and weak spot telemetry.
            </div>
          ) : recentAttempts.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-500 dark:text-zinc-400">
              No quiz attempts recorded yet for {courseId}. Take a quiz above to start tracking your mastery!
            </div>
          ) : (
            <div className="space-y-3">
              {recentAttempts.map((attempt) => (
                <div 
                  key={attempt.id}
                  className="flex items-center justify-between p-4 bg-slate-50 dark:bg-zinc-800/50 rounded-2xl border border-slate-100 dark:border-zinc-800 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${attempt.score >= 80 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                      <CheckCircle2 size={18} />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {attempt.moduleTitle || attempt.topicId || 'Module Quiz'}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-zinc-400">
                        {attempt.completedAt ? new Date(attempt.completedAt).toLocaleDateString() : 'Recent'} • {attempt.mode || 'Practice'} Mode
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-base font-bold text-slate-900 dark:text-white">
                      {attempt.score}%
                    </span>
                    <span className="block text-[10px] text-emerald-500 font-semibold uppercase">
                      {attempt.score >= 80 ? 'Mastered' : 'Needs Review'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Custom Topic Modal */}
      {isCustomModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                <Sparkles size={18} />
                <span>Grounded Custom AI Quiz</span>
              </div>
              <button 
                onClick={() => setIsCustomModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 mb-1">
                  Topic Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  placeholder="e.g., Phase Rule in Metallurgy, Maxwell Equations..."
                  className="w-full px-4 py-3 bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 mb-1">
                  Lecture Notes / Source Material (Optional for Strict Grounding)
                </label>
                <textarea
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  rows={4}
                  placeholder="Paste lecture notes or textbook excerpts here. Leaving this empty generates an Ungrounded Practice Quiz."
                  className="w-full px-4 py-3 bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setIsCustomModalOpen(false)}
                className="px-5 py-2.5 text-xs font-semibold text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleStartCustomTopicQuiz}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-transform active:scale-95"
              >
                Generate Quiz
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quiz Modal */}
      {selectedModule && (
        <QuizGenerator 
          courseId={courseId}
          module={selectedModule} 
          onClose={() => setSelectedModule(null)} 
          onComplete={(score) => onQuizComplete(selectedModule.id, score)}
          onNextTopic={(() => {
            const currentIndex = syllabus.findIndex(m => m.id === selectedModule.id);
            if (currentIndex >= 0 && currentIndex < syllabus.length - 1) {
              return () => setSelectedModule(syllabus[currentIndex + 1]);
            }
            return undefined;
          })()}
        />
      )}
    </div>
  );
}
