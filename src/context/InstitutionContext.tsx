import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { DEPARTMENTS as INITIAL_DEPARTMENTS, FACULTIES as INITIAL_FACULTIES, DEPARTMENT_TO_FACULTY as INITIAL_MAP } from '../constants';
import { Department } from '../types';
import { auth } from '../firebase';
import { safeFetchJson } from '../utils/safeFetch';

interface InstitutionState {
  departments: Department[];
  faculties: string[];
  departmentToFaculty: Record<string, string>;
  isLoading: boolean;
  addDepartment: (dept: string, faculty: string) => Promise<void>;
  removeDepartment: (dept: string) => Promise<void>;
  addFaculty: (faculty: string) => Promise<void>;
  removeFaculty: (faculty: string) => Promise<void>;
}

const InstitutionContext = createContext<InstitutionState | undefined>(undefined);

export function InstitutionProvider({ children }: { children: ReactNode }) {
  const [departments, setDepartments] = useState<Department[]>(INITIAL_DEPARTMENTS);
  const [faculties, setFaculties] = useState<string[]>(INITIAL_FACULTIES);
  const [departmentToFaculty, setDepartmentToFaculty] = useState<Record<string, string>>(INITIAL_MAP);
  const [isLoading, setIsLoading] = useState(true);

  const fetchInstitution = async (isMounted = true) => {
    try {
      const res = await safeFetchJson<any>('/api/system/config/institution');
      if (res.ok && res.data && isMounted) {
        const json = res.data;
        const data = json.data || {};
        if (Array.isArray(data.departments)) setDepartments(data.departments);
        if (Array.isArray(data.faculties)) setFaculties(data.faculties);
        if (data.departmentToFaculty) setDepartmentToFaculty(data.departmentToFaculty);
      }
    } catch (err) {
      console.warn('Non-fatal: using default institution config:', err);
    } finally {
      if (isMounted) setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    fetchInstitution(true);

    const onFocus = () => { fetchInstitution(true); };
    window.addEventListener('focus', onFocus);

    return () => {
      isMounted = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const saveConfig = async (newDepts: Department[], newFaculties: string[], newMap: Record<string, string>) => {
    try {
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : '';
      await fetch('/api/admin/system-config/institution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          departments: newDepts,
          faculties: newFaculties,
          departmentToFaculty: newMap
        })
      });
    } catch (err) {
      console.warn('Failed to save institution config:', err);
    }
  };

  const addDepartment = async (dept: string, faculty: string) => {
    if (!departments.includes(dept)) {
      const newDepts = [...departments, dept].sort();
      const newMap = { ...departmentToFaculty, [dept]: faculty };
      setDepartments(newDepts);
      setDepartmentToFaculty(newMap);
      await saveConfig(newDepts, faculties, newMap);
    }
  };

  const removeDepartment = async (dept: string) => {
    const newDepts = departments.filter(d => d !== dept);
    const newMap = { ...departmentToFaculty };
    delete newMap[dept];
    setDepartments(newDepts);
    setDepartmentToFaculty(newMap);
    await saveConfig(newDepts, faculties, newMap);
  };

  const addFaculty = async (faculty: string) => {
    if (!faculties.includes(faculty)) {
      const newFaculties = [...faculties, faculty].sort();
      setFaculties(newFaculties);
      await saveConfig(departments, newFaculties, departmentToFaculty);
    }
  };

  const removeFaculty = async (faculty: string) => {
    const newFaculties = faculties.filter(f => f !== faculty);
    setFaculties(newFaculties);
    await saveConfig(departments, newFaculties, departmentToFaculty);
  };

  return (
    <InstitutionContext.Provider value={{
      departments,
      faculties,
      departmentToFaculty,
      isLoading,
      addDepartment,
      removeDepartment,
      addFaculty,
      removeFaculty
    }}>
      {children}
    </InstitutionContext.Provider>
  );
}

export function useInstitution() {
  const context = useContext(InstitutionContext);
  if (context === undefined) {
    throw new Error('useInstitution must be used within an InstitutionProvider');
  }
  return context;
}
