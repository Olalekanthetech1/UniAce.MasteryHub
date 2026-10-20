import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export interface FeatureSwitches {
  arena: boolean;
  tutor_dashboard: boolean;
  [key: string]: boolean;
}

export function useFeatureSwitches() {
  const { user } = useAuth();
  const [switches, setSwitches] = useState<FeatureSwitches>({ arena: false, tutor_dashboard: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchSwitches = async () => {
      if (!user) {
        if (isMounted) {
          setSwitches({ arena: false, tutor_dashboard: false });
          setLoading(false);
        }
        return;
      }

      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/user/bootstrap', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok && isMounted) {
          const json = await res.json();
          const fs = json.systemConfig?.feature_switches || { arena: false, tutor_dashboard: false };
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
