import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, X, Zap, ExternalLink, Info, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { safeFetchJson } from '../utils/safeFetch';

export interface AnnouncementDoc {
  id: string;
  title: string;
  message: string;
  active: boolean;
  severity?: 'info' | 'warning' | 'urgent';
  audience?: 'all' | 'department' | 'academic_level';
  targetDepartment?: string;
  targetLevel?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  createdAt?: any;
  expiresAt?: string | null;
  publishedBy?: string;
  impressions?: number;
  dismissalsCount?: number;
}

export default function GlobalNotification() {
  const { user, profile } = useAuth();
  const [announcements, setAnnouncements] = useState<AnnouncementDoc[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [loadingDismissals, setLoadingDismissals] = useState<boolean>(true);
  const [isDismissing, setIsDismissing] = useState<boolean>(false);

  // 1. Fetch user dismissals from Neon
  useEffect(() => {
    if (!user) {
      setDismissedIds(new Set());
      setLoadingDismissals(false);
      return;
    }

    let isMounted = true;
    const loadDismissals = async () => {
      try {
        const token = await user.getIdToken(false);
        if (!token) return;
        const res = await safeFetchJson<any>('/api/user/announcements/dismissals', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok && res.data && isMounted) {
          setDismissedIds(new Set(res.data.dismissedIds || []));
        }
      } catch (err) {
        console.warn('Failed to load announcement dismissals:', err);
      } finally {
        if (isMounted) setLoadingDismissals(false);
      }
    };

    loadDismissals();
  }, [user]);

  // 2. Fetch active announcements from Neon with focus-refresh and polling
  useEffect(() => {
    let isMounted = true;
    const fetchAnnouncements = async () => {
      try {
        const res = await safeFetchJson<any>('/api/announcements/active');
        if (res.ok && res.data && isMounted) {
          const json = res.data;
          const items: AnnouncementDoc[] = [];
          const now = new Date();

          (json.announcements || []).forEach((data: any) => {
            const docId = data.id;
            if (!docId) return;

            if (data.expires_at) {
              const expireDate = new Date(data.expires_at);
              if (!isNaN(expireDate.getTime()) && expireDate < now) {
                return;
              }
            }

            if (data.audience && data.audience !== 'all') {
              if (data.audience === 'department' && profile?.department && data.target_department) {
                if (profile.department.toLowerCase() !== data.target_department.toLowerCase()) return;
              }
              if (data.audience === 'academic_level' && profile?.academic_level && data.target_level) {
                if (profile.academic_level.toLowerCase() !== data.target_level.toLowerCase()) return;
              }
            }

            items.push({
              id: docId,
              title: data.title || 'Global Announcement',
              message: data.message || '',
              active: data.active !== false,
              severity: data.severity || 'info',
              audience: data.audience || 'all',
              targetDepartment: data.target_department,
              targetLevel: data.target_level,
              ctaLabel: data.cta_label,
              ctaUrl: data.cta_url,
              createdAt: data.created_at,
              expiresAt: data.expires_at
            });
          });

          setAnnouncements(items);
        }
      } catch (err) {
        console.warn('Failed to fetch announcements:', err);
      }
    };

    fetchAnnouncements();
    const interval = setInterval(fetchAnnouncements, 60000);
    const onFocus = () => { fetchAnnouncements(); };
    window.addEventListener('focus', onFocus);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, profile]);

  // Wait until user dismissals are fully loaded
  if (loadingDismissals || !user) {
    return null;
  }

  // Find first active announcement that user hasn't dismissed yet
  const activeAnnouncement = announcements.find(a => !dismissedIds.has(a.id));

  if (!activeAnnouncement) {
    return null;
  }

  // Handle server-side dismissal write to Neon
  const handleDismiss = async () => {
    if (isDismissing) return;
    setIsDismissing(true);

    const announcementId = activeAnnouncement.id;

    // Optimistic local update
    setDismissedIds(prev => new Set(prev).add(announcementId));

    try {
      if (user) {
        const token = await user.getIdToken(false);
        const res = await fetch('/api/user/announcements/dismiss', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ announcementId })
        });
        if (!res.ok) {
          throw new Error('Dismissal endpoint returned error');
        }
      }
    } catch (err: any) {
      console.warn("GlobalNotification: Failed to save dismissal server-side:", err);
      setDismissedIds(prev => {
        const next = new Set(prev);
        next.delete(announcementId);
        return next;
      });
      toast.error("Could not dismiss banner permanently. Please try again.");
    } finally {
      setIsDismissing(false);
    }
  };

  const getSeverityStyles = (severity?: string) => {
    switch (severity) {
      case 'urgent':
        return {
          bg: 'bg-rose-950/90 border-rose-500/40 shadow-rose-500/10',
          badge: 'bg-rose-500 text-white',
          title: 'text-rose-400',
          icon: <AlertTriangle size={18} className="text-rose-400" />
        };
      case 'warning':
        return {
          bg: 'bg-amber-950/90 border-amber-500/40 shadow-amber-500/10',
          badge: 'bg-amber-500 text-slate-950',
          title: 'text-amber-400',
          icon: <AlertCircle size={18} className="text-amber-400" />
        };
      default:
        return {
          bg: 'bg-slate-900/95 border-emerald-500/30 shadow-emerald-500/10',
          badge: 'bg-emerald-500 text-slate-950',
          title: 'text-emerald-400',
          icon: <Zap size={18} className="text-emerald-400" />
        };
    }
  };

  const styles = getSeverityStyles(activeAnnouncement.severity);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -80, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -80, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 z-[90] w-[92%] max-w-2xl pointer-events-auto"
      >
        <div className={`${styles.bg} backdrop-blur-md border rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-white transition-all`}>
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 rounded-xl shrink-0 bg-slate-800/80 border border-slate-700/50 mt-0.5 sm:mt-0">
              {styles.icon}
            </div>
            <div className="flex-1 min-w-0 pr-2">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${styles.badge}`}>
                  {activeAnnouncement.severity || 'Announcement'}
                </span>
                <span className={`text-xs font-bold truncate ${styles.title}`}>
                  {activeAnnouncement.title}
                </span>
              </div>
              <p className="text-xs font-medium text-slate-200 leading-relaxed line-clamp-2">
                {activeAnnouncement.message}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800 shrink-0">
            {/* Data-driven CTA Button: only shown if ctaUrl is present */}
            {activeAnnouncement.ctaUrl && activeAnnouncement.ctaUrl.trim() !== '' && (
              <a
                href={activeAnnouncement.ctaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-all active:scale-95 shadow-md shadow-emerald-500/20 whitespace-nowrap"
              >
                <span>{activeAnnouncement.ctaLabel && activeAnnouncement.ctaLabel.trim() !== '' ? activeAnnouncement.ctaLabel : 'Learn More'}</span>
                <ExternalLink size={13} />
              </a>
            )}

            <button
              onClick={handleDismiss}
              disabled={isDismissing}
              title="Dismiss announcement"
              className="p-1.5 hover:bg-slate-800/80 active:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
