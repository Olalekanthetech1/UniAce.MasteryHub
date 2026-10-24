import React, { useState, useMemo } from 'react';
import { BookOpen, Plus, Trash2, AlertCircle, Layers, Search, Filter, Copy, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { useCourses } from '../context/CourseContext';
import { LEVELS, SEMESTERS } from '../constants';
import { Course, Department, Level, Semester, CourseScope } from '../types';
import { useInstitution } from '../context/InstitutionContext';

export const CurriculumManager: React.FC = () => {
  const { departments: DEPARTMENTS, departmentToFaculty: DEPARTMENT_TO_FACULTY } = useInstitution();
  const { courses } = useCourses();
  const [selectedDepartment, setSelectedDepartment] = useState<Department | ''>('');
  const [selectedLevel, setSelectedLevel] = useState<Level | ''>('');
  const [selectedSemester, setSelectedSemester] = useState<Semester | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isAddingCourse, setIsAddingCourse] = useState(false);
  const [selectedCoursesToAdd, setSelectedCoursesToAdd] = useState<Set<string>>(new Set());
  
  const [isCloning, setIsCloning] = useState(false);
  const [cloneSourceDepartment, setCloneSourceDepartment] = useState<Department | ''>('');
  
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void; isAlert?: boolean } | null>(null);

  const allCourses = Object.values(courses).filter(c => !c.deleted);

  // Filter courses that are currently allocated to the selected department
  const allocatedCourses = useMemo(() => {
    if (!selectedDepartment) return [];
    
    let filtered = allCourses.filter(c => {
      if (c.scope === 'GLOBAL') return true;
      if (c.scope === 'FACULTY') {
        const faculty = DEPARTMENT_TO_FACULTY[selectedDepartment as Department];
        if (faculty && c.faculties?.includes(faculty)) return true;
        if (c.departments?.includes(selectedDepartment as Department)) return true;
        return false;
      }
      if (c.scope === 'DEPARTMENT') {
        return c.departments?.includes(selectedDepartment as Department);
      }
      return false;
    });

    if (selectedLevel) {
      filtered = filtered.filter(c => c.level === selectedLevel);
    }
    if (selectedSemester) {
      filtered = filtered.filter(c => c.semester === selectedSemester);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(c => 
        c.id.toLowerCase().includes(q) || 
        c.title.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [allCourses, selectedDepartment, selectedLevel, selectedSemester, searchQuery]);

  // Courses available to add (not currently allocated)
  const availableCourses = useMemo(() => {
    if (!selectedDepartment) return [];
    const allocatedIds = new Set<string>(allocatedCourses.map(c => c.id));
    return allCourses.filter(c => !allocatedIds.has(c.id));
  }, [allCourses, allocatedCourses, selectedDepartment]);

  const totalCreditUnits = useMemo(() => {
    return 0;
  }, [allocatedCourses]);

  const missingPrerequisites = useMemo(() => {
    return {};
  }, [allocatedCourses]);

  const handleRemoveCourse = (course: Course) => {
    if (!selectedDepartment) return;
    
    setConfirmModal({
      title: "Remove Course",
      message: `Are you sure you want to remove ${course.id} from ${selectedDepartment}?`,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          if (course.scope === 'GLOBAL') {
            setConfirmModal({ title: "Error", message: "Cannot remove a GLOBAL course from a specific department. Change its scope first.", onConfirm: () => setConfirmModal(null), isAlert: true });
            return;
          }
          
          if (course.scope === 'FACULTY') {
            const faculty = DEPARTMENT_TO_FACULTY[selectedDepartment as Department];
            if (faculty && course.faculties?.includes(faculty)) {
              setConfirmModal({ title: "Error", message: `This course is assigned to the entire ${faculty} faculty. To remove it from just this department, you must change its scope to DEPARTMENT and manually assign it to the other departments.`, onConfirm: () => setConfirmModal(null), isAlert: true });
              return;
            }
          }

          const newDepartments = (course.departments || []).filter(d => d !== selectedDepartment);
          const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
          const res = await fetch(`/api/admin/courses/${encodeURIComponent(course.id)}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              departments: newDepartments
            })
          });
          if (!res.ok) throw new Error('Failed to update course in PostgreSQL');
          
        } catch (error) {
          console.error("Error removing course:", error);
          setConfirmModal({ title: "Error", message: "Failed to remove course.", onConfirm: () => setConfirmModal(null), isAlert: true });
        }
      }
    });
  };

  const handleBulkAddCourses = async () => {
    if (!selectedDepartment || selectedCoursesToAdd.size === 0) return;
    
    try {
      const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
      
      for (const courseId of selectedCoursesToAdd) {
        const course = courses[courseId];
        if (!course) continue;
        
        const newDepartments = Array.from(new Set([...(course.departments || []), selectedDepartment]));
        const res = await fetch(`/api/admin/courses/${encodeURIComponent(course.id)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            departments: newDepartments,
            scope: course.scope || 'DEPARTMENT'
          })
        });
        if (!res.ok) throw new Error(`Failed to update course ${course.id}`);
      }
      
      setIsAddingCourse(false);
      setSelectedCoursesToAdd(new Set());
    } catch (error) {
      console.error("Error adding courses:", error);
      alert("Failed to add courses.");
    }
  };

  const handleCloneCurriculum = () => {
    if (!selectedDepartment || !cloneSourceDepartment) return;
    if (selectedDepartment === cloneSourceDepartment) {
      setConfirmModal({ title: "Error", message: "Source and target departments must be different.", onConfirm: () => setConfirmModal(null), isAlert: true });
      return;
    }
    
    setConfirmModal({
      title: "Clone Curriculum",
      message: `Are you sure you want to clone all courses from ${cloneSourceDepartment} to ${selectedDepartment}?`,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          // Find all courses in the source department
          const sourceCourses = allCourses.filter(c => {
            if (c.scope === 'GLOBAL') return false; // Global courses are already everywhere
            if (c.scope === 'FACULTY') {
              const faculty = DEPARTMENT_TO_FACULTY[cloneSourceDepartment as Department];
              if (faculty && c.faculties?.includes(faculty)) return true;
              if (c.departments?.includes(cloneSourceDepartment as Department)) return true;
              return false;
            }
            if (c.scope === 'DEPARTMENT') {
              return c.departments?.includes(cloneSourceDepartment as Department);
            }
            return false;
          });

          const token = await (await import('firebase/auth')).getAuth().currentUser?.getIdToken();
          let count = 0;

          for (const course of sourceCourses) {
            // Skip if already in target department
            if (course.scope === 'FACULTY') {
               const targetFaculty = DEPARTMENT_TO_FACULTY[selectedDepartment as Department];
               if (targetFaculty && course.faculties?.includes(targetFaculty)) continue;
            }
            if (course.departments?.includes(selectedDepartment as Department)) continue;

            const newDepartments = Array.from(new Set([...(course.departments || []), selectedDepartment]));
            const res = await fetch(`/api/admin/courses/${encodeURIComponent(course.id)}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
              },
              body: JSON.stringify({
                departments: newDepartments
              })
            });
            if (res.ok) count++;
          }

          if (count > 0) {
            setConfirmModal({ title: "Success", message: `Successfully cloned ${count} courses to ${selectedDepartment}.`, onConfirm: () => setConfirmModal(null), isAlert: true });
          } else {
            setConfirmModal({ title: "Info", message: "No new courses to clone. The target department already has these courses or they are global.", onConfirm: () => setConfirmModal(null), isAlert: true });
          }
          
          setIsCloning(false);
          setCloneSourceDepartment('');
        } catch (error) {
          console.error("Error cloning curriculum:", error);
          setConfirmModal({ title: "Error", message: "Failed to clone curriculum.", onConfirm: () => setConfirmModal(null), isAlert: true });
        }
      }
    });
  };

  const toggleCourseSelection = (courseId: string) => {
    const newSet = new Set(selectedCoursesToAdd);
    if (newSet.has(courseId)) {
      newSet.delete(courseId);
    } else {
      newSet.add(courseId);
    }
    setSelectedCoursesToAdd(newSet);
  };

  const getScopeBadge = (course: Course) => {
    if (course.scope === 'GLOBAL') {
      return <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">Global</span>;
    }
    if (course.scope === 'FACULTY') {
      return <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 rounded-full">Faculty</span>;
    }
    return <span className="px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full">Department</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="text-indigo-500" />
            Curriculum Manager
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Manage course allocations across departments.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Department</label>
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value as Department)}
            className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Select Department...</option>
            {DEPARTMENTS.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Level</label>
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value as Level)}
            className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Levels</option>
            {LEVELS.map(lvl => (
              <option key={lvl} value={lvl}>{lvl} Level</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Semester</label>
          <select
            value={selectedSemester}
            onChange={(e) => setSelectedSemester(e.target.value as Semester)}
            className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Semesters</option>
            {SEMESTERS.map(sem => (
              <option key={sem} value={sem}>{sem}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Search Courses</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search by code or title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      {selectedDepartment ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between bg-slate-50 dark:bg-slate-800/50 gap-4">
            <div className="flex items-center gap-4">
              <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <BookOpen size={18} className="text-indigo-500" />
                Allocated Courses ({allocatedCourses.length})
              </h3>
              {selectedLevel && selectedSemester && (
                <div className="px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400">
                  {allocatedCourses.length} Courses
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsCloning(!isCloning);
                  setIsAddingCourse(false);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-xl text-sm font-medium transition-colors"
              >
                <Copy size={16} />
                Clone
              </button>
              <button
                onClick={() => {
                  setIsAddingCourse(!isAddingCourse);
                  setIsCloning(false);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors"
              >
                {isAddingCourse ? <Trash2 size={16} /> : <Plus size={16} />}
                {isAddingCourse ? 'Cancel' : 'Add Courses'}
              </button>
            </div>
          </div>

          {isCloning && (
            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Clone Curriculum From</label>
                <select
                  value={cloneSourceDepartment}
                  onChange={(e) => setCloneSourceDepartment(e.target.value as Department)}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Select source department --</option>
                  {DEPARTMENTS.filter(d => d !== selectedDepartment).map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleCloneCurriculum}
                disabled={!cloneSourceDepartment}
                className="px-6 py-2 bg-slate-800 dark:bg-slate-200 hover:bg-slate-700 dark:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-white dark:text-slate-900 rounded-xl font-medium transition-colors"
              >
                Clone Now
              </button>
            </div>
          )}

          {isAddingCourse && (
            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-indigo-900 dark:text-indigo-300">Select Courses to Add ({selectedCoursesToAdd.size} selected)</label>
                <button
                  onClick={handleBulkAddCourses}
                  disabled={selectedCoursesToAdd.size === 0}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm"
                >
                  Add Selected
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto border border-indigo-200 dark:border-indigo-700 rounded-xl bg-white dark:bg-slate-900">
                {availableCourses.length > 0 ? (
                  availableCourses.map(c => (
                    <div 
                      key={c.id} 
                      onClick={() => toggleCourseSelection(c.id)}
                      className="flex items-center gap-3 p-3 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer last:border-0"
                    >
                      {selectedCoursesToAdd.has(c.id) ? (
                        <CheckSquare className="text-indigo-600 dark:text-indigo-400" size={20} />
                      ) : (
                        <Square className="text-slate-300 dark:text-slate-600" size={20} />
                      )}
                      <div>
                        <div className="font-medium text-slate-900 dark:text-white">{c.id} - {c.title}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Level: {c.level || 'N/A'} | Semester: {c.semester || 'N/A'}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">
                    No available courses to add.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-sm">
                  <th className="p-4 font-medium">Course Code</th>
                  <th className="p-4 font-medium">Title</th>
                  <th className="p-4 font-medium">Level</th>
                  <th className="p-4 font-medium">Semester</th>
                  <th className="p-4 font-medium">Scope</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {allocatedCourses.length > 0 ? (
                  allocatedCourses.map(course => (
                    <tr key={course.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="p-4 font-bold text-slate-900 dark:text-white">
                        {course.id}
                      </td>
                      <td className="p-4 text-slate-600 dark:text-slate-300">{course.title}</td>
                      <td className="p-4 text-slate-600 dark:text-slate-300">{course.level || '-'}</td>
                      <td className="p-4 text-slate-600 dark:text-slate-300">{course.semester || '-'}</td>
                      <td className="p-4">{getScopeBadge(course)}</td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => handleRemoveCourse(course)}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                          title="Remove from department"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500 dark:text-slate-400">
                      <div className="flex flex-col items-center justify-center">
                        <AlertCircle size={32} className="mb-2 text-slate-400" />
                        <p>No courses found for this selection.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 p-12 rounded-2xl border border-slate-200 dark:border-slate-700 text-center">
          <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Filter size={32} />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Select a Department</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Choose a department from the dropdown above to view and manage its allocated courses.
          </p>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{confirmModal.title}</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              {!confirmModal.isAlert && (
                <button 
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
              )}
              <button 
                onClick={confirmModal.onConfirm}
                className="px-6 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {confirmModal.isAlert ? "OK" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{confirmModal.title}</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              {!confirmModal.isAlert && (
                <button 
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
              )}
              <button 
                onClick={confirmModal.onConfirm}
                className="px-6 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {confirmModal.isAlert ? "OK" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
