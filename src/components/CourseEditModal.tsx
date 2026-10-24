import React, { useState } from 'react';
import { X, Save, Trash2, Edit2 } from 'lucide-react';
import { Course, Module, Department, Level, Semester, CourseScope } from '../types';
import { LEVELS, SEMESTERS } from '../constants';
import { useInstitution } from '../context/InstitutionContext';
import { normalizeDeptId } from '../utils/normalization';

interface CourseEditModalProps {
  course: Course;
  onClose: () => void;
  onSave: () => void;
}

export default function CourseEditModal({ course, onClose, onSave }: CourseEditModalProps) {
  const { departments: DEPARTMENTS, faculties: FACULTIES } = useInstitution();
  
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description);
  const [level, setLevel] = useState<Level | undefined>(course.level);
  const [semester, setSemester] = useState<Semester | undefined>(course.semester);
  const [scope, setScope] = useState<CourseScope | undefined>(course.scope || 'GLOBAL');
  const [academicStandard, setAcademicStandard] = useState<string>(course.academicStandard || 'Globally Adaptive (Universal University Standard)');
  const [customStandard, setCustomStandard] = useState<string>('');
  const [faculties, setFaculties] = useState<string[]>(course.faculties || []);
  const [departments, setDepartments] = useState<Department[]>(course.departments || []);
  const [modules, setModules] = useState<Module[]>(course.syllabus);
  const [isSaving, setIsSaving] = useState(false);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const activeStandard = academicStandard === 'Custom Academic Benchmark'
        ? (customStandard.trim() || 'Custom Dynamic Academic Benchmark')
        : academicStandard;

      const idToken = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();

      // Track instructor edits telemetry
      try {
        if (idToken) {
          // Find modules that were edited (simple comparison of syllabus array)
          modules.forEach(m => {
            const original = course.syllabus.find(om => om.id === m.id);
            if (!original || JSON.stringify(original) !== JSON.stringify(m)) {
              fetch('/api/telemetry/module-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ courseId: course.id, moduleId: m.id, action: 'edit' })
              }).catch(err => console.warn('Failed to track edit telemetry:', err));
            }
          });
        }
      } catch (e) {}

      const targetDepts = scope === 'DEPARTMENT'
        ? Array.from(new Set([(course.department || ''), ...departments].filter(Boolean)))
        : (scope === 'GLOBAL' ? [] : departments);

      const res = await fetch(`/api/admin/courses/${encodeURIComponent(course.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          title,
          description,
          level,
          semester,
          scope,
          faculties: scope === 'FACULTY' ? faculties : [],
          departments: targetDepts,
          syllabus: modules
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to update course via Neon');
      }

      onSave();
      onClose();
    } catch (error) {
      console.error("Error updating course:", error);
      alert("Failed to update course.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteModule = (moduleId: string) => {
    setConfirmModal({
      title: "Delete Module",
      message: "Are you sure you want to delete this module?",
      onConfirm: () => {
        setModules(modules.filter(m => m.id !== moduleId));
        setConfirmModal(null);
      }
    });
  };

  const handleAddModule = () => {
    const newModule: Module = {
      id: `module-${Date.now()}`,
      title: 'New Module',
      subTopics: []
    };
    setModules([...modules, newModule]);
    setEditingModuleId(newModule.id);
  };

  const handleUpdateModuleTitle = (moduleId: string, newTitle: string) => {
    setModules(modules.map(m => m.id === moduleId ? { ...m, title: newTitle } : m));
  };

  const handleAddSubTopic = (moduleId: string) => {
    setModules(modules.map(m => {
      if (m.id === moduleId) {
        return {
          ...m,
          subTopics: [
            ...m.subTopics,
            { id: `st-${Date.now()}`, title: 'New Subtopic', content: '' }
          ]
        };
      }
      return m;
    }));
  };

  const handleUpdateSubTopic = (moduleId: string, subTopicId: string, updates: Partial<{ title: string; content: string }>) => {
    setModules(modules.map(m => {
      if (m.id === moduleId) {
        return {
          ...m,
          subTopics: m.subTopics.map(st => st.id === subTopicId ? { ...st, ...updates } : st)
        };
      }
      return m;
    }));
  };

  const handleDeleteSubTopic = (moduleId: string, subTopicId: string) => {
    setModules(modules.map(m => {
      if (m.id === moduleId) {
        return {
          ...m,
          subTopics: m.subTopics.filter(st => st.id !== subTopicId)
        };
      }
      return m;
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-800 z-10">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Edit Course: {course.id}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Title</label>
              <input 
                type="text" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Description</label>
              <textarea 
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full h-11 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Level</label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as Level)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
              >
                <option value="">Select Level</option>
                {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Semester</label>
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value as Semester)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
              >
                <option value="">Select Semester</option>
                {SEMESTERS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as CourseScope)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
              >
                <option value="GLOBAL">Global</option>
                <option value="FACULTY">Faculty</option>
                <option value="DEPARTMENT">Department</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
              Academic Standard & Curriculum Framework
            </label>
            <select
              value={academicStandard}
              onChange={(e) => setAcademicStandard(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="Globally Adaptive (Universal University Standard)">Globally Adaptive (Universal University Standard)</option>
              <option value="International Higher Education Curriculum Standard">International Higher Education Curriculum Standard</option>
              <option value="Global Accreditation & Outcomes-Based Framework">Global Accreditation & Outcomes-Based Framework</option>
              <option value="North American University Benchmark (ABET/CSAB Aligned)">North American University Benchmark (ABET/CSAB Aligned)</option>
              <option value="European Higher Education Area / Bologna Process">European Higher Education Area / Bologna Process</option>
              <option value="Commonwealth Higher Education Quality Framework">Commonwealth Higher Education Quality Framework</option>
              <option value="Custom Academic Benchmark">Custom Academic Benchmark (Enter Custom Standard)...</option>
            </select>
            {academicStandard === 'Custom Academic Benchmark' && (
              <div className="mt-3">
                <input
                  type="text"
                  placeholder="e.g., Oxford/Cambridge Tripos, IEEE/ACM 2023, National University Benchmark"
                  value={customStandard}
                  onChange={(e) => setCustomStandard(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Courses and AI tutoring for this course will dynamically calibrate to this accredited academic standard.
                </p>
              </div>
            )}
          </div>

          {scope === 'FACULTY' && (
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Select Faculties</label>
              <div className="grid grid-cols-2 gap-2">
                {FACULTIES.map(f => (
                  <label key={f} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={faculties.includes(f)}
                      onChange={(e) => {
                        if (e.target.checked) setFaculties([...faculties, f]);
                        else setFaculties(faculties.filter(item => item !== f));
                      }}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    {f}
                  </label>
                ))}
              </div>
            </div>
          )}

          {scope === 'DEPARTMENT' && (
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Select Departments</label>
              <div className="grid grid-cols-2 gap-2">
                {DEPARTMENTS.map(d => (
                  <label key={d} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={departments.includes(d)}
                      onChange={(e) => {
                        if (e.target.checked) setDepartments([...departments, d]);
                        else setDepartments(departments.filter(item => item !== d));
                      }}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    {d}
                  </label>
                ))}
              </div>
            </div>
          )}
          
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Modules & Syllabus</h3>
              <button 
                onClick={handleAddModule}
                className="px-4 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl text-sm font-bold hover:bg-emerald-200"
              >
                + Add Module
              </button>
            </div>

            <div className="space-y-4">
              {modules.map((module) => (
                <div key={module.id} className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="p-4 flex items-center gap-4 bg-slate-100 dark:bg-slate-800/50">
                    <input 
                      type="text"
                      value={module.title}
                      onChange={(e) => handleUpdateModuleTitle(module.id, e.target.value)}
                      className="flex-1 bg-transparent border-none focus:ring-0 font-bold text-slate-900 dark:text-white"
                    />
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setEditingModuleId(editingModuleId === module.id ? null : module.id)}
                        className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => handleDeleteModule(module.id)}
                        className="p-2 text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>

                  {editingModuleId === module.id && (
                    <div className="p-4 space-y-4 border-t border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Subtopics</h4>
                        <button 
                          onClick={() => handleAddSubTopic(module.id)}
                          className="text-xs font-bold text-emerald-600 hover:text-emerald-700"
                        >
                          + Add Subtopic
                        </button>
                      </div>
                      
                      <div className="space-y-4">
                        {module.subTopics.map((st) => (
                          <div key={st.id} className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                            <div className="flex items-center gap-3">
                              <input 
                                type="text"
                                value={st.title}
                                onChange={(e) => handleUpdateSubTopic(module.id, st.id, { title: e.target.value })}
                                className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1 text-sm font-medium"
                                placeholder="Subtopic Title"
                              />
                              <button 
                                onClick={() => handleDeleteSubTopic(module.id, st.id)}
                                className="text-red-400 hover:text-red-600"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            <textarea 
                              value={st.content}
                              onChange={(e) => handleUpdateSubTopic(module.id, st.id, { content: e.target.value })}
                              className="w-full h-32 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm"
                              placeholder="Subtopic Content (Markdown supported)..."
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3 sticky bottom-0 bg-white dark:bg-slate-800 z-10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2"
          >
            {isSaving ? 'Saving...' : <><Save size={18} /> Save Changes</>}
          </button>
        </div>
      </div>

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[150] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{confirmModal.title}</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button 
                onClick={confirmModal.onConfirm}
                className="px-6 py-2 rounded-xl font-bold bg-red-600 hover:bg-red-700 text-white"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
