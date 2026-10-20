import React, { useState, useEffect } from 'react';
import { ToggleLeft, ToggleRight, Shield, Swords, Users, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

interface FeatureSwitches {
  arena: boolean;
  tutor_dashboard: boolean;
  [key: string]: boolean;
}

export default function FeatureSwitchesTab() {
  const { user } = useAuth();
  const [switches, setSwitches] = useState<FeatureSwitches>({ arena: false, tutor_dashboard: false });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchSwitches = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/feature-switches', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setSwitches(json.featureSwitches || { arena: false, tutor_dashboard: false });
      } else {
        toast.error('Failed to load feature switches');
      }
    } catch (err) {
      console.error('Failed to fetch feature switches:', err);
      toast.error('Network error loading feature switches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSwitches();
  }, [user]);

  const handleToggle = async (key: string) => {
    if (!user || savingKey) return;
    const newSwitches = { ...switches, [key]: !switches[key] };
    setSavingKey(key);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/feature-switches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ featureSwitches: newSwitches })
      });
      if (res.ok) {
        setSwitches(newSwitches);
        toast.success(`Feature '${key}' updated to ${newSwitches[key] ? 'ENABLED' : 'DISABLED'}`);
      } else {
        toast.error('Failed to update feature switch');
      }
    } catch (err) {
      console.error('Failed to update feature switch:', err);
      toast.error('Error updating feature switch');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-sm font-medium text-slate-500 dark:text-zinc-400">Loading Feature Switches...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center justify-between pb-6 border-b border-slate-100 dark:border-zinc-800">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-500" />
              Runtime Feature Switches
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
              Control availability of experimental or high-impact platform features dynamically without a redeploy.
            </p>
          </div>
          <button
            onClick={fetchSwitches}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 rounded-xl transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          {/* Battle Arena Switch */}
          <div className={`p-5 rounded-2xl border transition-all ${
            switches.arena
              ? 'bg-emerald-500/5 border-emerald-500/30'
              : 'bg-slate-50 dark:bg-zinc-800/50 border-slate-200 dark:border-zinc-700/60'
          }`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${switches.arena ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-zinc-700 text-slate-500 dark:text-zinc-400'}`}>
                  <Swords className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Gamified Battle Arena</h3>
                  <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mt-1 ${
                    switches.arena ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300' : 'bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-zinc-400'
                  }`}>
                    {switches.arena ? 'ACTIVE (LIVE)' : 'DISABLED (OFF)'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleToggle('arena')}
                disabled={savingKey === 'arena'}
                className="text-indigo-600 dark:text-indigo-400 hover:scale-105 transition-transform disabled:opacity-50"
              >
                {savingKey === 'arena' ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : switches.arena ? (
                  <ToggleRight className="w-10 h-10 text-emerald-500" />
                ) : (
                  <ToggleLeft className="w-10 h-10 text-slate-400 dark:text-zinc-600" />
                )}
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mt-3 leading-relaxed">
              When OFF, student menu entries and routes for Battle Arena are hidden and direct route hits display a Coming Soon card.
            </p>
          </div>

          {/* Tutor Dashboard Switch */}
          <div className={`p-5 rounded-2xl border transition-all ${
            switches.tutor_dashboard
              ? 'bg-indigo-500/5 border-indigo-500/30'
              : 'bg-slate-50 dark:bg-zinc-800/50 border-slate-200 dark:border-zinc-700/60'
          }`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${switches.tutor_dashboard ? 'bg-indigo-500 text-white' : 'bg-slate-200 dark:bg-zinc-700 text-slate-500 dark:text-zinc-400'}`}>
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Tutor & Affiliates Hub</h3>
                  <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mt-1 ${
                    switches.tutor_dashboard ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-zinc-400'
                  }`}>
                    {switches.tutor_dashboard ? 'ACTIVE (LIVE)' : 'DISABLED (OFF)'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleToggle('tutor_dashboard')}
                disabled={savingKey === 'tutor_dashboard'}
                className="text-indigo-600 dark:text-indigo-400 hover:scale-105 transition-transform disabled:opacity-50"
              >
                {savingKey === 'tutor_dashboard' ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : switches.tutor_dashboard ? (
                  <ToggleRight className="w-10 h-10 text-indigo-500" />
                ) : (
                  <ToggleLeft className="w-10 h-10 text-slate-400 dark:text-zinc-600" />
                )}
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mt-3 leading-relaxed">
              When OFF, tutor/affiliate payouts and portal features are hidden from non-admin users and return a Coming Soon state.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
