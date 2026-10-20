import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  Cpu,
  Layers,
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ShieldCheck,
  Zap,
  ArrowRight,
  Server,
  Play,
  RotateCcw,
  Sparkles,
  Info,
  Terminal,
  FileCheck
} from 'lucide-react';
import { auth } from '../../firebase';

interface RuntimeFlagRecord {
  flag_key: string;
  enabled: boolean;
  cutover_at: string | null;
  description: string;
  updated_by: string;
  updated_at: string;
}

interface EngineHealth {
  connected: boolean;
  latencyMs: number | null;
  error?: string | null;
  pool: {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  } | null;
  tableCounts: Record<string, number>;
  flags: Record<string, boolean>;
  checkedAt: string;
}

interface AuditResult {
  scope: string;
  success: boolean;
  parityMatched: boolean;
  deltaCount?: number;
  pgCount?: number;
  fsCount?: number;
  auditedAt: string;
  error?: string;
}

interface DatabaseEngineTabProps {
  onSwitchTab?: (tab: string) => void;
}

export default function DatabaseEngineTab({ onSwitchTab }: DatabaseEngineTabProps) {
  // Runtime flags state
  const [flags, setFlags] = useState<RuntimeFlagRecord[]>([]);
  const [isLoadingFlags, setIsLoadingFlags] = useState(true);
  const [flagError, setFlagError] = useState<string | null>(null);

  // Modal state for flag mutation
  const [pendingFlag, setPendingFlag] = useState<RuntimeFlagRecord | null>(null);
  const [targetState, setTargetState] = useState<boolean>(false);
  const [mutationReason, setMutationReason] = useState<string>('');
  const [isMutatingFlag, setIsMutatingFlag] = useState(false);

  // Engine health telemetry state
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [isLoadingHealth, setIsLoadingHealth] = useState(true);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0); // 0 = off, 5, 15, 30
  const autoRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Parity audit studio state
  const [runningScope, setRunningScope] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditResult[]>([]);
  const [activeAuditResult, setActiveAuditResult] = useState<AuditResult | null>(null);

  // Notification / toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Fetch runtime flags from backend
  const fetchFlags = async () => {
    setIsLoadingFlags(true);
    setFlagError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/runtime-flags', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFlags(data.flags || []);
      } else {
        setFlagError(data.error || 'Failed to fetch runtime flags');
      }
    } catch (err: any) {
      setFlagError(err.message || 'Network error fetching flags');
    } finally {
      setIsLoadingFlags(false);
    }
  };

  // Fetch database engine health telemetry
  const fetchEngineHealth = async () => {
    setIsLoadingHealth(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/database/engine-health', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setHealth(data);
      }
    } catch (err: any) {
      console.error('Failed to probe engine health:', err);
    } finally {
      setIsLoadingHealth(false);
    }
  };

  // Mutate a flag
  const handleConfirmToggle = async () => {
    if (!pendingFlag) return;
    setIsMutatingFlag(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/runtime-flags/${pendingFlag.flag_key}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          enabled: targetState,
          reason: mutationReason.trim() || 'Admin manual toggle'
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(
          `Flag ${pendingFlag.flag_key} updated to ${targetState ? 'ENABLED (PostgreSQL)' : 'DISABLED (Firestore)'}`,
          'success'
        );
        setPendingFlag(null);
        setMutationReason('');
        await fetchFlags();
        await fetchEngineHealth();
      } else {
        showToast(`Failed: ${data.error}`, 'error');
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setIsMutatingFlag(false);
    }
  };

  // Trigger parity audit
  const handleRunAudit = async (scope: 'progress' | 'catalog' | 'sparks') => {
    setRunningScope(scope);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/database/run-parity-audit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ scope })
      });

      const data = await res.json();
      const result: AuditResult = {
        scope,
        success: res.ok && data.success,
        parityMatched: data.parityMatched ?? false,
        deltaCount: data.deltaCount,
        pgCount: data.pgCount,
        fsCount: data.fsCount,
        auditedAt: data.auditedAt || new Date().toISOString(),
        error: data.error
      };

      setActiveAuditResult(result);
      setAuditLogs((prev) => [result, ...prev.slice(0, 9)]);

      if (result.parityMatched) {
        showToast(`Parity Audit for [${scope.toUpperCase()}] passed 100%!`, 'success');
      } else {
        showToast(`Parity Audit for [${scope.toUpperCase()}] detected discrepancy or unmigrated state`, 'error');
      }
    } catch (err: any) {
      const errResult: AuditResult = {
        scope,
        success: false,
        parityMatched: false,
        auditedAt: new Date().toISOString(),
        error: err.message
      };
      setActiveAuditResult(errResult);
      setAuditLogs((prev) => [errResult, ...prev.slice(0, 9)]);
      showToast(`Parity execution error: ${err.message}`, 'error');
    } finally {
      setRunningScope(null);
    }
  };

  useEffect(() => {
    fetchFlags();
    fetchEngineHealth();
  }, []);

  // Handle auto-refresh interval for health probes
  useEffect(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }

    if (autoRefreshInterval > 0) {
      autoRefreshTimerRef.current = setInterval(() => {
        fetchEngineHealth();
      }, autoRefreshInterval * 1000);
    }

    return () => {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    };
  }, [autoRefreshInterval]);

  return (
    <div className="space-y-8 p-6 text-slate-100 max-w-7xl mx-auto">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-xl border flex items-center space-x-3 transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500 text-emerald-200'
              : toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500 text-rose-200'
              : 'bg-slate-800 border-slate-700 text-slate-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : toast.type === 'error' ? (
            <XCircle className="w-5 h-5 text-rose-400" />
          ) : (
            <Info className="w-5 h-5 text-blue-400" />
          )}
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      {/* Header & Quick Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Database Engine & Cutover Suite
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/30 font-mono">
                  Self-Contained Neon Control Plane
                </span>
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Manage relational routing flags, monitor Neon connection pools, and execute SHA-256 parity audits with zero server restarts.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {onSwitchTab && (
            <button
              onClick={() => onSwitchTab('db-accounting')}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium flex items-center gap-2 transition"
            >
              <span>Accounting & Reconciliation</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={() => {
              fetchFlags();
              fetchEngineHealth();
            }}
            disabled={isLoadingFlags || isLoadingHealth}
            className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFlags || isLoadingHealth ? 'animate-spin' : ''}`} />
            <span>Refresh All</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: LIVE RUNTIME ROUTING FLAGS */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              <span>Runtime Routing Flags (Zero-Firestore Dependency)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Synced to backend workers via 5s background poll + instant cache invalidation upon mutation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Policy:</span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
              Strict Zero-Fallback & Zero-Mock
            </span>
          </div>
        </div>

        {flagError ? (
          <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <div>
              <p className="font-semibold">Failed to fetch runtime flags from PostgreSQL</p>
              <p className="text-xs mt-0.5">{flagError}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {flags.map((flag) => {
              const isEnabled = flag.enabled;
              return (
                <div
                  key={flag.flag_key}
                  className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                    isEnabled
                      ? 'bg-slate-900/90 border-emerald-500/40 shadow-sm shadow-emerald-950/50'
                      : 'bg-slate-900/60 border-slate-800'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                          isEnabled
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {isEnabled ? 'PostgreSQL Primary' : 'Firestore Legacy'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {flag.updated_at ? new Date(flag.updated_at).toLocaleTimeString() : 'N/A'}
                      </span>
                    </div>

                    <h3 className="font-mono text-sm font-bold text-slate-100 break-all mb-1">
                      {flag.flag_key}
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed min-h-[36px]">
                      {flag.description || 'Database routing directive'}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Cutover:</span>
                      <span className="font-mono text-slate-300">
                        {flag.cutover_at ? new Date(flag.cutover_at).toLocaleDateString() : 'Pending'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>By:</span>
                      <span className="font-mono text-slate-300 truncate max-w-[120px]" title={flag.updated_by}>
                        {flag.updated_by}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        setPendingFlag(flag);
                        setTargetState(!isEnabled);
                        setMutationReason('');
                      }}
                      className={`w-full mt-2 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 border transition ${
                        isEnabled
                          ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30'
                          : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      }`}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{isEnabled ? 'Revert to Firestore' : 'Cutover to PostgreSQL'}</span>
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Prohibited Shadow-Write Guard Card */}
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col justify-between opacity-80">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/30">
                    Shadow Blocked
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">Immutable</span>
                </div>
                <h3 className="font-mono text-sm font-bold text-slate-300 break-all mb-1">
                  ENABLE_POSTGRES_SHADOW_WRITE
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed min-h-[36px]">
                  Dual shadow writing is permanently prohibited by architecture policy to prevent quota exhaustion and dual-write drift.
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80">
                <div className="text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Enforcement:</span>
                  <span className="font-mono text-rose-400 font-semibold">Strict Guard Active</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: NEON CONNECTION POOL & TABLE TELEMETRY */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Cpu className="w-5 h-5 text-indigo-400" />
              <span>Neon PostgreSQL Engine & Pool Telemetry</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Live serverless pool diagnostics, round-trip latency probe, and table row metrics.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400">Auto-Probe:</span>
            {[
              { label: 'Off', val: 0 },
              { label: '5s', val: 5 },
              { label: '15s', val: 15 },
              { label: '30s', val: 30 }
            ].map((btn) => (
              <button
                key={btn.val}
                onClick={() => setAutoRefreshInterval(btn.val)}
                className={`px-2.5 py-1 rounded text-xs font-mono font-medium border transition ${
                  autoRefreshInterval === btn.val
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {btn.label}
              </button>
            ))}

            <button
              onClick={fetchEngineHealth}
              disabled={isLoadingHealth}
              className="ml-2 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingHealth ? 'animate-spin' : ''}`} />
              <span>Probe Now</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Neon Connection Status */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center space-x-3">
            <div
              className={`p-3 rounded-lg border ${
                health?.connected
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              }`}
            >
              <Server className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Neon Connection</p>
              <p className="text-lg font-bold text-white flex items-center gap-2">
                {health?.connected ? 'Connected' : 'Disconnected'}
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    health?.connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                  }`}
                />
              </p>
              <p className="text-[11px] text-slate-500">Database: neondb (PostgreSQL 16)</p>
            </div>
          </div>

          {/* Round-Trip Latency */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center space-x-3">
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Ping Latency</p>
              <p className="text-lg font-bold font-mono text-white">
                {health?.latencyMs !== null && health?.latencyMs !== undefined ? `${health.latencyMs} ms` : 'N/A'}
              </p>
              <p className="text-[11px] text-slate-500">
                {health?.latencyMs && health.latencyMs < 100
                  ? 'Optimal (Sub-100ms)'
                  : health?.latencyMs && health.latencyMs < 300
                  ? 'Normal'
                  : 'Elevated'}
              </p>
            </div>
          </div>

          {/* Connection Pool Meters */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center space-x-3">
            <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-400">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Client Pool Depth</p>
              <div className="flex items-center space-x-2 text-sm font-mono mt-0.5">
                <span className="text-emerald-400 font-bold" title="Idle clients">
                  {health?.pool?.idleCount ?? 0} idle
                </span>
                <span className="text-slate-500">/</span>
                <span className="text-white font-bold" title="Total clients in pool">
                  {health?.pool?.totalCount ?? 0} total
                </span>
                <span className="text-slate-500">/</span>
                <span className="text-amber-400 font-bold" title="Waiting in queue">
                  {health?.pool?.waitingCount ?? 0} queued
                </span>
              </div>
              <p className="text-[11px] text-slate-500">Max limit: 20 clients</p>
            </div>
          </div>

          {/* Active Primary Table Routing */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center space-x-3">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Active Primary</p>
              <p className="text-sm font-bold text-white mt-0.5 font-mono">
                {health?.flags?.ENABLE_POSTGRES_CATALOG && health?.flags?.ENABLE_POSTGRES_PROGRESS
                  ? 'Catalog & Progress (Neon)'
                  : health?.flags?.ENABLE_POSTGRES_CATALOG
                  ? 'Catalog (Neon)'
                  : health?.flags?.ENABLE_POSTGRES_PROGRESS
                  ? 'Progress (Neon)'
                  : 'Firestore (Legacy)'}
              </p>
              <p className="text-[11px] text-emerald-400 font-semibold">Zero-Mock Compliant</p>
            </div>
          </div>
        </div>

        {/* Relational Table Row Counts */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Neon PostgreSQL Live Table Row Counts
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: 'courses', count: health?.tableCounts?.courses },
              { label: 'user_course_progress', count: health?.tableCounts?.user_course_progress },
              { label: 'user_study_batches', count: health?.tableCounts?.user_study_batches },
              { label: 'user_lesson_completions', count: health?.tableCounts?.user_lesson_completions },
              { label: 'user_quiz_attempts', count: health?.tableCounts?.user_quiz_attempts },
              { label: 'system_runtime_flags', count: health?.tableCounts?.system_runtime_flags },
              { label: 'user_sparks_wallets', count: health?.tableCounts?.user_sparks_wallets },
              { label: 'spark_escrow_locks', count: health?.tableCounts?.spark_escrow_locks },
              { label: 'spark_transactions_ledger', count: health?.tableCounts?.spark_transactions_ledger }
            ].map((tbl) => (
              <div key={tbl.label} className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/60">
                <p className="text-[11px] font-mono text-slate-400 truncate" title={tbl.label}>
                  {tbl.label}
                </p>
                <p className="text-lg font-bold font-mono text-white mt-1">
                  {tbl.count !== undefined ? tbl.count.toLocaleString() : '...'}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 3: PARITY AUDIT & DELTA CATCH-UP STUDIO */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-emerald-400" />
              <span>Parity Audit & Delta Catch-Up Studio</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Execute live canonical comparisons between Firestore documents and PostgreSQL rows with SHA-256 validation.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Progress Audit Card */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30">
                  Student Progress
                </span>
                <span className="text-[11px] font-mono text-slate-400">Step 6 Spec</span>
              </div>
              <h3 className="font-semibold text-white text-sm mb-1">Progress Parity & Catch-Up</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Syncs deltas from Firestore into Neon progress tables and verifies SHA-256 hash identity across all enrolled students.
              </p>
            </div>

            <button
              onClick={() => handleRunAudit('progress')}
              disabled={runningScope !== null}
              className="mt-4 w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
            >
              {runningScope === 'progress' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Auditing Progress...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Execute Progress Audit</span>
                </>
              )}
            </button>
          </div>

          {/* Catalog Audit Card */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                  Course Catalog
                </span>
                <span className="text-[11px] font-mono text-slate-400">Phase 1 Cutover</span>
              </div>
              <h3 className="font-semibold text-white text-sm mb-1">Catalog Row Parity</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Compares course catalog items between Neon PostgreSQL and Firestore to guarantee complete course catalog integrity.
              </p>
            </div>

            <button
              onClick={() => handleRunAudit('catalog')}
              disabled={runningScope !== null}
              className="mt-4 w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
            >
              {runningScope === 'catalog' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Auditing Catalog...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Execute Catalog Audit</span>
                </>
              )}
            </button>
          </div>

          {/* Sparks Escrow Audit Card */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                  AI Sparks Ledger
                </span>
                <span className="text-[11px] font-mono text-slate-400">Phase 3 Relational</span>
              </div>
              <h3 className="font-semibold text-white text-sm mb-1">Sparks Balance Parity</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Verifies user AI spark wallet balances between Firestore user profiles and Neon PostgreSQL row-locked escrow ledgers.
              </p>
            </div>

            <button
              onClick={() => handleRunAudit('sparks')}
              disabled={runningScope !== null}
              className="mt-4 w-full py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
            >
              {runningScope === 'sparks' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Auditing Sparks...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Execute Sparks Audit</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Audit Log Console */}
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-400" />
              <span>Parity Audit Results & Diagnostic Output</span>
            </h3>
            <span className="text-[11px] font-mono text-slate-500">Live Stream</span>
          </div>

          {auditLogs.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs font-mono border border-dashed border-slate-800 rounded-lg">
              No audit runs recorded in this session. Click an execution trigger above to verify parity.
            </div>
          ) : (
            <div className="space-y-2">
              {auditLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border font-mono text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                    log.parityMatched
                      ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-rose-950/20 border-rose-500/40 text-rose-300'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    {log.parityMatched ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    )}
                    <span className="font-bold uppercase tracking-wider">[{log.scope}]</span>
                    <span>
                      {log.parityMatched
                        ? '100% Hash Parity Verified'
                        : log.error || 'Parity Drift / Incomplete Migration Detected'}
                    </span>
                  </div>

                  <div className="flex items-center space-x-4 text-[11px] text-slate-400">
                    {log.deltaCount !== undefined && <span>Deltas: {log.deltaCount}</span>}
                    {log.pgCount !== undefined && (
                      <span>
                        PG: {log.pgCount} / FS: {log.fsCount}
                      </span>
                    )}
                    <span>{new Date(log.auditedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* CONFIRMATION MODAL FOR FLAG CUTOVER */}
      {pendingFlag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3">
              <div
                className={`p-2.5 rounded-lg border ${
                  targetState
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                }`}
              >
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Confirm Database Engine Cutover</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{pendingFlag.flag_key}</p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Current Routing:</span>
                <span className="font-semibold text-white">
                  {pendingFlag.enabled ? 'PostgreSQL Primary' : 'Firestore Legacy'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Target Routing:</span>
                <span
                  className={`font-semibold ${targetState ? 'text-emerald-400' : 'text-amber-400'}`}
                >
                  {targetState ? 'PostgreSQL Primary' : 'Firestore Legacy'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cutover Timestamp:</span>
                <span className="font-mono text-slate-300">Recorded as NOW() in Neon</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Reason for Mutation (Recorded in system_logs):
              </label>
              <input
                type="text"
                value={mutationReason}
                onChange={(e) => setMutationReason(e.target.value)}
                placeholder="e.g. Phase 3 Relational Cutover"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setPendingFlag(null)}
                disabled={isMutatingFlag}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>

              <button
                onClick={handleConfirmToggle}
                disabled={isMutatingFlag}
                className={`px-4 py-2 rounded-lg text-xs font-bold text-white flex items-center gap-2 transition ${
                  targetState
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                {isMutatingFlag && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm & Apply</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
