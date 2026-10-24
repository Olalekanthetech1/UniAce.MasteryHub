import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { Course, Module, Department, Level, Semester, CourseScope } from '../types';
import { LEVELS, SEMESTERS } from '../constants';
import { useInstitution } from '../context/InstitutionContext';
import { normalizeDeptId } from '../utils/normalization';

interface CourseCreateModalProps {
  onClose: () => void;
  onSave: () => void;
}

export default function CourseCreateModal({ onClose, onSave }: CourseCreateModalProps) {
  const { departments: DEPARTMENTS, faculties: FACULTIES } = useInstitution();
  
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState<Department | ''>('');
  const [level, setLevel] = useState<Level>('100');
  const [semester, setSemester] = useState<Semester>('1st Semester');
  const [scope, setScope] = useState<CourseScope>('GLOBAL');
  const [academicStandard, setAcademicStandard] = useState<string>('Globally Adaptive (Universal University Standard)');
  const [customStandard, setCustomStandard] = useState<string>('');
  const [faculties, setFaculties] = useState<string[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    const sanitizedId = id.replace(/\s+/g, '').toUpperCase();
    if (!sanitizedId || !title || !department) {
      alert("Please provide Course ID, Title, and select a Department.");
      return;
    }
    setIsSaving(true);
    try {
      const activeStandard = academicStandard === 'Custom Academic Benchmark'
        ? (customStandard.trim() || 'Custom Dynamic Academic Benchmark')
        : academicStandard;

      const targetDepts = scope === 'DEPARTMENT'
        ? Array.from(new Set([department, ...departments].filter(Boolean)))
        : (scope === 'GLOBAL' ? [] : departments);

      const offerings = targetDepts.map(dept => ({
        departmentId: normalizeDeptId(dept),
        departmentName: dept,
        level,
        semester,
        type: scope === 'GLOBAL' ? ('global' as const) : ('core' as const)
      }));

      const idToken = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
      const res = await fetch('/api/admin/courses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          id: sanitizedId,
          code: sanitizedId,
          title,
          description,
          department,
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
        throw new Error(errJson.error || 'Failed to create course via Neon');
      }

      onSave();
      onClose();
    } catch (error) {
      console.error("Error creating course:", error);
      alert("Failed to create course.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-800 z-10">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Create New Course</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Course ID (e.g., MTH101)</label>
              <input 
                type="text" 
                value={id}
                onChange={(e) => setId(e.target.value.toUpperCase())}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Title</label>
              <input 
                type="text" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Description</label>
            <textarea 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Department</label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value as Department)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
              >
                <option value="">-- Select Department --</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Level</label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as Level)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white"
              >
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
            {isSaving ? 'Creating...' : <><Save size={18} /> Create Course</>}
          </button>
        </div>
      </div>
    </div>
  );
}
