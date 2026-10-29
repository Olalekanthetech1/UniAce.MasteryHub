import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { safeFetchJson } from '../utils/safeFetch';

export interface FeatureSwitches {
  arena: boolean;
  tutor_dashboard: boolean;
  [key: string]: boolean;
}

export function useFeatureSwitches() {
  const { user } = useAuth();
  const [switches, setSwitches] = useState<FeatureSwitches>({ arena: true, tutor_dashboard: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchSwitches = async () => {
      if (!user) {
        if (isMounted) {
          setSwitches({ arena: true, tutor_dashboard: false });
          setLoading(false);
        }
        return;
      }

      try {
        const token = await user.getIdToken();
        const res = await safeFetchJson<any>('/api/user/bootstrap', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok && res.data && isMounted) {
          const fs = {
            arena: true,
            tutor_dashboard: false,
            ...(res.data.systemConfig?.feature_switches || {})
          };
          setSwitches(fs);
        }
      } catch (err) {
        console.warn('[useFeatureSwitches] Failed to fetch feature switches:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchSwitches();
  }, [user]);

  return { switches, loading };
}
