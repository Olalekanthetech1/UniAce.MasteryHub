import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Department } from '../types';
import { auth } from '../firebase';

interface InstitutionState {
  departments: Department[];
  faculties: string[];
  departmentToFaculty: Record<string, string>;
  isLoading: boolean;
  error: string | null;
  addDepartment: (dept: string, faculty: string) => Promise<void>;
  removeDepartment: (dept: string) => Promise<void>;
  addFaculty: (faculty: string) => Promise<void>;
  removeFaculty: (faculty: string) => Promise<void>;
}

const InstitutionContext = createContext<InstitutionState | undefined>(undefined);

export function InstitutionProvider({ children }: { children: ReactNode }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [faculties, setFaculties] = useState<string[]>([]);
  const [departmentToFaculty, setDepartmentToFaculty] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInstitution = async (isMounted = true) => {
    try {
      let payload: any = null;
      let lastErr: Error | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await fetch('/api/system/config/institution', { cache: 'no-store' });
          const contentType = response.headers.get('content-type') || '';
          if (!response.ok || !contentType.includes('application/json')) {
            throw new Error(
              !contentType.includes('application/json')
                ? `Institution configuration endpoint returned non-JSON response (HTTP ${response.status})`
                : `Institution configuration request failed with HTTP ${response.status}`
            );
          }
          payload = await response.json();
          lastErr = null;
          break;
        } catch (attemptErr: any) {
          lastErr = attemptErr instanceof Error ? attemptErr : new Error(String(attemptErr));
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
          }
        }
      }
      if (lastErr) throw lastErr;

      const data = payload?.data?.data || payload?.data;
      if (!data || !Array.isArray(data.departments) || !Array.isArray(data.faculties) ||
          !data.departmentToFaculty || typeof data.departmentToFaculty !== 'object') {
        throw new Error('Authoritative institution configuration is missing or malformed.');
      }
      if (isMounted) {
        setDepartments(data.departments);
        setFaculties(data.faculties);
        setDepartmentToFaculty(data.departmentToFaculty);
        setError(null);
      }
    } catch (err) {
      if (isMounted) {
        setError(err instanceof Error ? err.message : String(err));
        setDepartments([]);
        setFaculties([]);
        setDepartmentToFaculty({});
      }
      console.warn('[InstitutionContext] Live institution data unavailable:', err instanceof Error ? err.message : String(err));
    } finally {
      if (isMounted) setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    void fetchInstitution(true);
    const onFocus = () => { void fetchInstitution(true); };
    window.addEventListener('focus', onFocus);
    return () => {
      isMounted = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const saveConfig = async (newDepts: Department[], newFaculties: string[], newMap: Record<string, string>) => {
    const user = auth.currentUser;
    if (!user) throw new Error('An authenticated administrator session is required to update institution configuration.');
    const token = await user.getIdToken();
    const response = await fetch('/api/admin/system-config/institution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        departments: newDepts,
        faculties: newFaculties,
        departmentToFaculty: newMap
      })
    });
    if (!response.ok) throw new Error(`Institution configuration save failed with HTTP ${response.status}`);
  };

  const addDepartment = async (dept: string, faculty: string) => {
    if (!departments.includes(dept)) {
      const nextDepartments = [...departments, dept].sort();
      const nextMap = { ...departmentToFaculty, [dept]: faculty };
      await saveConfig(nextDepartments, faculties, nextMap);
      setDepartments(nextDepartments);
      setDepartmentToFaculty(nextMap);
    }
  };

  const removeDepartment = async (dept: string) => {
    const nextDepartments = departments.filter(d => d !== dept);
    const nextMap = { ...departmentToFaculty };
    delete nextMap[dept];
    await saveConfig(nextDepartments, faculties, nextMap);
    setDepartments(nextDepartments);
    setDepartmentToFaculty(nextMap);
  };

  const addFaculty = async (faculty: string) => {
    if (!faculties.includes(faculty)) {
      const nextFaculties = [...faculties, faculty].sort();
      await saveConfig(departments, nextFaculties, departmentToFaculty);
      setFaculties(nextFaculties);
    }
  };

  const removeFaculty = async (faculty: string) => {
    const nextFaculties = faculties.filter(f => f !== faculty);
    await saveConfig(departments, nextFaculties, departmentToFaculty);
    setFaculties(nextFaculties);
  };

  return (
    <InstitutionContext.Provider value={{
      departments,
      faculties,
      departmentToFaculty,
      isLoading,
      error,
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
  if (context === undefined) throw new Error('useInstitution must be used within an InstitutionProvider');
  return context;
}
