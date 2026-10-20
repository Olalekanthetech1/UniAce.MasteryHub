import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, 
  Clock, 
  Plus, 
  Trash2, 
  Zap, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Layout,
  BookOpen,
  Target,
  ChevronRight,
  Save
} from 'lucide-react';
import { TimetableEntry, ExamDate, StudySession, UserProgress } from '../types';
import { AIService } from '../services/ai';
import { auth } from '../firebase';

interface StudyArchitectProps {
  progress: UserProgress;
  onClose: () => void;
}

export const StudyArchitect: React.FC<StudyArchitectProps> = ({ progress, onClose }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [exams, setExams] = useState<ExamDate[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load existing data
  useEffect(() => {
    const loadData = async () => {
      if (!auth.currentUser) return;
      try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/api/user/study-plan', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const json = await res.json();
          if (json.plan) {
            setTimetable(json.plan.timetable || []);
            setExams(json.plan.exams || []);
            setSessions(json.plan.sessions || []);
          }
        }
      } catch (err) {
        console.error('Error loading study plan:', err);
      }
    };
    loadData();
  }, []);

  const addTimetableEntry = () => {
    const newEntry: TimetableEntry = {
      id: Math.random().toString(36).substr(2, 9),
      day: 'Monday',
      startTime: '09:00',
      endTime: '11:00',
      courseId: '',
      type: 'lecture'
    };
    setTimetable([...timetable, newEntry]);
  };

  const removeTimetableEntry = (id: string) => {
    setTimetable(timetable.filter(e => e.id !== id));
  };

  const updateTimetableEntry = (id: string, updates: Partial<TimetableEntry>) => {
    setTimetable(timetable.map(e => e.id === id ? { ...e, ...updates } : e));
  };

  const addExam = () => {
    const newExam: ExamDate = {
      id: Math.random().toString(36).substr(2, 9),
      courseId: '',
      date: new Date().toISOString().split('T')[0]
    };
    setExams([...exams, newExam]);
  };

  const removeExam = (id: string) => {
    setExams(exams.filter(e => e.id !== id));
  };

  const updateExam = (id: string, updates: Partial<ExamDate>) => {
    setExams(exams.map(e => e.id === id ? { ...e, ...updates } : e));
  };

  const generatePlan = async () => {
    setLoading(true);
    try {
      const result = await AIService.generateArchitectPlan(timetable, exams, progress);
      setSessions(result.sessions);
      setStep(3);
    } catch (error) {
      console.error('Failed to generate plan:', error);
    } finally {
      setLoading(false);
    }
  };

  const savePlan = async () => {
    if (!auth.currentUser) return;
    setSaving(true);
    try {
      const token = await auth.currentUser.getIdToken();
      await fetch('/api/user/study-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          plan: {
            timetable,
            exams,
            sessions,
            lastGenerated: new Date().toISOString()
          }
        })
      });
      onClose();
    } catch (error) {
      console.error('Failed to save plan:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-purple-200">
              <Zap size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Study Architect</h2>
              <p className="text-slate-500 text-sm">AI-Powered Schedule Optimization</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400"
          >
            <Trash2 size={20} />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-8 py-4 bg-white border-b border-slate-100 flex items-center gap-4">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                step === s ? 'bg-purple-600 text-white' : 
                step > s ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
              }`}>
                {step > s ? <CheckCircle2 size={16} /> : s}
              </div>
              <span className={`text-sm font-bold ${step === s ? 'text-slate-900' : 'text-slate-400'}`}>
                {s === 1 ? 'Timetable' : s === 2 ? 'Exams' : 'Your Plan'}
              </span>
              {s < 3 && <ChevronRight size={16} className="text-slate-300" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div 
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-slate-900">Weekly Lecture Timetable</h3>
                  <button 
                    onClick={addTimetableEntry}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-600 rounded-xl font-bold text-sm hover:bg-purple-100 transition-all"
                  >
                    <Plus size={18} /> Add Lecture
                  </button>
                </div>

                <div className="space-y-4">
                  {timetable.map((entry) => (
                    <div key={entry.id} className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <select 
                        value={entry.day}
                        onChange={(e) => updateTimetableEntry(entry.id, { day: e.target.value as any })}
                        className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-purple-500"
                      >
                        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-slate-400" />
                        <input 
                          type="time" 
                          value={entry.startTime}
                          onChange={(e) => updateTimetableEntry(entry.id, { startTime: e.target.value })}
                          className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-purple-500"
                        />
                        <span className="text-slate-400">-</span>
                        <input 
                          type="time" 
                          value={entry.endTime}
                          onChange={(e) => updateTimetableEntry(entry.id, { endTime: e.target.value })}
                          className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-purple-500"
                        />
                      </div>
                      <input 
                        type="text" 
                        placeholder="Course ID (e.g. MTH101)"
                        value={entry.courseId}
                        onChange={(e) => updateTimetableEntry(entry.id, { courseId: e.target.value })}
                        className="flex-1 min-w-[150px] bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-purple-500"
                      />
                      <button 
                        onClick={() => removeTimetableEntry(entry.id)}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                  {timetable.length === 0 && (
                    <div className="text-center py-12 border-2 border-dashed border-slate-100 rounded-[2rem]">
                      <Calendar className="mx-auto text-slate-200 mb-4" size={48} />
                      <p className="text-slate-400 font-medium">No lectures added yet. Start by adding your weekly schedule.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div 
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-slate-900">Upcoming Exams</h3>
                  <button 
                    onClick={addExam}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-600 rounded-xl font-bold text-sm hover:bg-amber-100 transition-all"
                  >
                    <Plus size={18} /> Add Exam
                  </button>
                </div>

                <div className="space-y-4">
                  {exams.map((exam) => (
                    <div key={exam.id} className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <input 
                        type="date" 
                        value={exam.date}
                        onChange={(e) => updateExam(exam.id, { date: e.target.value })}
                        className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-amber-500"
                      />
                      <input 
                        type="text" 
                        placeholder="Course ID (e.g. MTH101)"
                        value={exam.courseId}
                        onChange={(e) => updateExam(exam.id, { courseId: e.target.value })}
                        className="flex-1 min-w-[150px] bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-amber-500"
                      />
                      <button 
                        onClick={() => removeExam(exam.id)}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                  {exams.length === 0 && (
                    <div className="text-center py-12 border-2 border-dashed border-slate-100 rounded-[2rem]">
                      <Target className="mx-auto text-slate-200 mb-4" size={48} />
                      <p className="text-slate-400 font-medium">No exams added yet. Add your upcoming test dates to optimize your plan.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div 
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-slate-900">Your AI-Optimized Study Plan</h3>
                  <div className="flex items-center gap-2 text-emerald-600 font-bold text-sm bg-emerald-50 px-3 py-1 rounded-full">
                    <Zap size={14} /> High Performance
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {sessions.map((session, idx) => (
                    <motion.div 
                      key={session.id || idx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="p-5 bg-white border border-slate-100 rounded-3xl shadow-sm flex items-center gap-6 group hover:border-purple-200 transition-all"
                    >
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
                        session.type === 'prime' ? 'bg-blue-50 text-blue-600' :
                        session.type === 'consolidation' ? 'bg-emerald-50 text-emerald-600' :
                        session.type === 'deep_work' ? 'bg-purple-50 text-purple-600' : 'bg-amber-50 text-amber-600'
                      }`}>
                        {session.type === 'prime' ? <Zap size={24} /> :
                         session.type === 'consolidation' ? <Save size={24} /> :
                         session.type === 'deep_work' ? <Brain size={24} /> : <RefreshCw size={24} />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                            {session.type.replace('_', ' ')}
                          </span>
                          <span className="text-xs font-bold text-slate-300">•</span>
                          <span className="text-xs font-bold text-purple-600">{session.courseId}</span>
                        </div>
                        <h4 className="font-bold text-slate-900">{session.title}</h4>
                        <div className="flex items-center gap-3 mt-2">
                          <div className="flex items-center gap-1 text-slate-500 text-xs font-medium">
                            <Clock size={12} />
                            {new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - 
                            {new Date(session.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className="flex items-center gap-1 text-slate-500 text-xs font-medium">
                            <Calendar size={12} />
                            {new Date(session.startTime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                          </div>
                        </div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <ChevronRight size={20} className="text-slate-300" />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Actions */}
        <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <button 
            onClick={() => step > 1 ? setStep((step - 1) as any) : onClose()}
            className="px-6 py-3 text-slate-500 font-bold hover:text-slate-900 transition-colors"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          
          <div className="flex items-center gap-4">
            {step < 3 ? (
              <button 
                onClick={() => setStep((step + 1) as any)}
                className="px-8 py-3 bg-slate-900 text-white rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
              >
                Next Step <ArrowRight size={18} />
              </button>
            ) : (
              <div className="flex items-center gap-4">
                <button 
                  onClick={generatePlan}
                  disabled={loading}
                  className="px-8 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                  {loading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                  Regenerate
                </button>
                <button 
                  onClick={savePlan}
                  disabled={saving}
                  className="px-8 py-3 bg-purple-600 text-white rounded-2xl font-bold flex items-center gap-2 hover:bg-purple-700 transition-all shadow-lg shadow-purple-200 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  Save Plan
                </button>
              </div>
            )}
            
            {step === 2 && (
              <button 
                onClick={generatePlan}
                disabled={loading}
                className="px-8 py-3 bg-purple-600 text-white rounded-2xl font-bold flex items-center gap-2 hover:bg-purple-700 transition-all shadow-lg shadow-purple-200 disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
                Generate Plan
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const RefreshCw = ({ size, className }: { size?: number, className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size || 24} 
    height={size || 24} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

const Brain = ({ size, className }: { size?: number, className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size || 24} 
    height={size || 24} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.54Z" />
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.54Z" />
  </svg>
);
