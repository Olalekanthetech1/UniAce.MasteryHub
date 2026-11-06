import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { safeFetchJson } from '../utils/safeFetch';
import { isMarketingSnapshot, MarketingSnapshot } from '../services/marketingSnapshot';

export function useMarketingSnapshot() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<MarketingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setSnapshot(null);
      setError('An authenticated administrator session is required to load marketing evidence.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      if (!token) throw new Error('The authenticated session did not provide an access token.');

      const response = await safeFetchJson<any>('/api/admin/marketing/snapshot', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok || !response.data?.snapshot) {
        throw new Error(response.error || 'The authoritative marketing snapshot is unavailable.');
      }
      if (!isMarketingSnapshot(response.data.snapshot)) {
        throw new Error('The marketing snapshot failed its data contract validation.');
      }

      setSnapshot(response.data.snapshot);
      setError(null);
    } catch (failure: any) {
      // Fail closed: never keep an older snapshot and present it as current after a failed refresh.
      setSnapshot(null);
      setError(failure?.message || 'Marketing data could not be verified.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 60000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}
