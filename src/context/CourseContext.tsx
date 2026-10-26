import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Course, CourseId } from '../types';
import { useAuth } from './AuthContext';
import { CourseService } from '../services/courseService';

interface CourseContextType {
  courses: Record<string, Course>;
  loading: boolean;
  error: string | null;
  refreshCourses: () => Promise<void>;
}

const CourseContext = createContext<CourseContextType | undefined>(undefined);

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [courses, setCourses] = useState<Record<string, Course>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  const coursesRef = useRef<Record<string, Course>>({});
  coursesRef.current = courses;

  const inFlightRef = useRef(false);
  const lastFetchTimeRef = useRef(0);

  const fetchCatalog = useCallback(async (isManualRetry = false) => {
    if (inFlightRef.current) return;

    const now = Date.now();
    // Enforce 60s minimum interval for automatic background refetches
    if (!isManualRetry && now - lastFetchTimeRef.current < 60000 && Object.keys(coursesRef.current).length > 0) {
      return;
    }

    inFlightRef.current = true;
    
    // Set loading only when courses is empty
    if (Object.keys(coursesRef.current).length === 0) {
      setLoading(true);
    }
    setError(null);

    try {
      let token: string | undefined;
      if (user) {
        try {
          token = await user.getIdToken();
        } catch {
          // Token fetch error handled gracefully
        }
      }

      const catalogList = await CourseService.getFullCatalog(token);
      const courseMap: Record<string, Course> = {};
      for (const c of catalogList) {
        courseMap[c.id] = c;
      }

      setCourses(courseMap);
      setError(null);
      lastFetchTimeRef.current = Date.now();
    } catch (err: any) {
      console.warn('[CourseContext] Notice loading catalog, scheduling retry:', err?.message || err);
      if (Object.keys(coursesRef.current).length === 0) {
        setTimeout(() => {
          inFlightRef.current = false;
          fetchCatalog(true);
        }, 1800);
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [user]);

  // Initial fetch on mount or user/auth change
  useEffect(() => {
    fetchCatalog();
  }, [user?.uid, fetchCatalog]);

  // Window focus refetch with 60s throttling
  useEffect(() => {
    const handleFocus = () => {
      fetchCatalog();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchCatalog]);

  return (
    <CourseContext.Provider value={{ courses, loading, error, refreshCourses: () => fetchCatalog(true) }}>
      {error && Object.keys(courses).length === 0 ? (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center text-red-400 mb-4 text-2xl font-bold">
            !
          </div>
          <h2 className="text-xl font-bold mb-2">Unable to Load Course Catalog</h2>
          <p className="text-slate-400 max-w-md mb-6 text-sm">
            {error}
          </p>
          <button
            onClick={() => fetchCatalog(true)}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      ) : (
        children
      )}
    </CourseContext.Provider>
  );
}

export function useCourses() {
  const context = useContext(CourseContext);
  if (context === undefined) {
    throw new Error('useCourses must be used within a CourseProvider');
  }
  return context;
}
