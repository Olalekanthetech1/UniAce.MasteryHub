import React, { useState, useEffect } from 'react';
import {
  Landmark,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ArrowUpRight,
  TrendingDown,
  Database,
  Search,
  DollarSign,
  Cpu,
  Layers,
  History,
  FileCheck,
  AlertCircle
} from 'lucide-react';
import { auth } from '../../firebase';

export default function DatabaseAccountingTab() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Reconciliation state
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<any>(null);
  const [isCommitModalOpen, setIsCommitModalOpen] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Search filter for reversals table
  const [reversalSearch, setReversalSearch] = useState('');

  // Neon PostgreSQL probe state
  const [probingNeon, setProbingNeon] = useState(false);
  const [neonProbeResult, setNeonProbeResult] = useState<any>(null);

  const handleProbeNeon = async () => {
    setProbingNeon(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/database/health', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.health) {
        setNeonProbeResult(data.health);
      }
    } catch (err: any) {
      console.error('Failed to probe Neon health:', err);
    } finally {
      setProbingNeon(false);
    }
  };

  const fetchStats = async () => {
    try {
      setError(null);
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/spark-governance/stats', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setStats(data);
    } catch (err: any) {
      console.error('Failed to load governance stats:', err);
      setError(err.message || 'Failed to load database governance statistics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleRunReconcile = async (dryRun: boolean) => {
    setIsReconciling(true);
    setActionSuccess(null);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/spark-governance/reconcile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          dryRun,
          confirmedToken: dryRun ? undefined : confirmationInput
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Reconciliation failed');
      }

      setReconcileReport(data.report);
      if (!dryRun) {
        setIsCommitModalOpen(false);
        setConfirmationInput('');
        setActionSuccess(`Reconciliation committed successfully (Batch: ${data.report.batchId.slice(0, 8)})`);
        await fetchStats();
      } else {
        setActionSuccess('Dry-run completed successfully (Read-only verification pass)');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to run reconciliation');
    } finally {
      setIsReconciling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
        <RefreshCw className="w-8 h-8 animate-spin mb-3 text-indigo-500" />
        <p className="text-sm font-medium">Loading Database & Accounting Governance telemetry...</p>
      </div>
    );
  }

  const rollups = stats?.rollups?.allTime || {};
  const circulation = stats?.circulation || {};
  const telemetry = stats?.telemetry || {};
  const recentReversals = (stats?.recentReversals || []).filter((r: any) => {
    if (!reversalSearch) return true;
    const term = reversalSearch.toLowerCase();
    return (
      r.reference?.toLowerCase().includes(term) ||
      r.email?.toLowerCase().includes(term) ||
      r.uid?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                Database & Financial Accounting Governance
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Authoritative Double-Entry Ledger, Paystack Gateway Cashflow & Quota Telemetry
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setRefreshing(true);
              fetchStats();
            }}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-indigo-500' : ''}`} />
            Refresh Telemetry
          </button>
          <button
            onClick={() => handleRunReconcile(true)}
            disabled={isReconciling}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm transition"
          >
            <ShieldCheck className="w-4 h-4" />
            {isReconciling ? 'Running Check...' : 'Run Dry-Run Reconcile'}
          </button>
        </div>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Governance System Error</div>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Reconciliation Notice</div>
            <p className="mt-0.5">{actionSuccess}</p>
          </div>
        </div>
      )}

      {/* Section 1: Executive Cash & LLM Margin Summary */}
      <div>
        <h2 className="text-base font-bold text-slate-900 dark:text-white uppercase tracking-wider text-xs mb-3">
          1. Gateway Cashflow & External LLM Unit Economics
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Gross Captured Cash
            </div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white font-mono">
              ₦{(rollups.grossPaymentRevenueNgn ?? 0).toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Kobo: {(rollups.grossPaymentRevenueKobo ?? 0).toLocaleString()} kobo
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Net Cash Revenue
            </div>
            <div className="mt-2 text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
              ₦{(rollups.netCashRevenueNgn ?? 0).toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Net after refunds & lost disputes
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              External LLM Token Cost
            </div>
            <div className="mt-2 text-2xl font-extrabold text-rose-600 dark:text-rose-400 font-mono">
              ${(rollups.externalLlmTokenCostUsd ?? 0).toFixed(4)}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Provider API spend (excludes hosting)
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Estimated Model Value & Margin
            </div>
            <div className="mt-2 text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 font-mono">
              ${(rollups.grossLlmMarginUsd ?? 0).toFixed(4)}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Margin: {rollups.grossLlmMarginPct ?? 0}% (benchmark at $0.01/Spark)
            </div>
          </div>
        </div>

        {/* Semantic Cache Breakdown */}
        <div className="mt-4 p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/50 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-300 font-medium">
            <Cpu className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Semantic Cache Telemetry:</span>
            <span className="font-mono font-bold">{rollups.cacheHitSettleCount ?? 0}</span> cache hits served at <span className="font-bold text-emerald-600 dark:text-emerald-400">$0.00 provider cost</span>
          </div>
          <div className="flex items-center gap-4 text-slate-600 dark:text-slate-400 font-mono">
            <span>Tokens Saved: {(rollups.cacheTokensSaved ?? 0).toLocaleString()}</span>
            <span>Sparks Preserved: {(rollups.cacheHitSparksSaved ?? 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Section 2: Double-Entry Equity & Conservation Health */}
      <div>
        <h2 className="text-base font-bold text-slate-900 dark:text-white uppercase tracking-wider text-xs mb-3">
          2. Double-Entry Equity & Currency Conservation
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Available Spendable Paid Sparks
            </div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white font-mono">
              {(circulation.totalSpendablePaidSparks ?? 0).toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Net of in-flight active leases
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Free Daily Quota Allowance
            </div>
            <div className="mt-2 text-2xl font-extrabold text-blue-600 dark:text-blue-400 font-mono">
              {(circulation.totalSpendableFreeSparks ?? 0).toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Daily reset tier sparks
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Quarantined Disputed Sparks
            </div>
            <div className="mt-2 text-2xl font-extrabold text-amber-600 dark:text-amber-400 font-mono">
              {(circulation.totalFrozenDisputedSparks ?? 0).toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Locked in chargeback escrow
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Total System Unsettled Equity
            </div>
            <div className="mt-2 text-2xl font-extrabold text-purple-600 dark:text-purple-400 font-mono">
              {(circulation.totalUnsettledEquity ?? 0).toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Paid + Quarantined (Sample: {circulation.totalUsersSampled ?? 0} users)
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Reconciliation & Cutoff Console */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Rollup Reconciliation & Cutoff Console
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Strictly bounded by timestamp watermark to prevent race conditions during live concurrent writes. Zero silent balance rewrites.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleRunReconcile(true)}
              disabled={isReconciling}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold transition"
            >
              Run Dry-Run (Read-Only)
            </button>
            <button
              onClick={() => setIsCommitModalOpen(true)}
              disabled={isReconciling}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold shadow-sm transition"
            >
              Execute Reconciliation Commit
            </button>
          </div>
        </div>

        {/* Reconcile Report Display */}
        {reconcileReport && (
          <div className="mt-5 p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {reconcileReport.status === 'CLEAN' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                )}
                <span className="font-bold text-sm text-slate-900 dark:text-white">
                  Reconciliation Status: {reconcileReport.status}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 font-mono text-slate-600 dark:text-slate-300">
                  {reconcileReport.dryRun ? 'DRY_RUN' : 'LIVE_COMMITTED'}
                </span>
              </div>
              <div className="text-xs text-slate-500 font-mono">
                Watermark: {reconcileReport.cutoffWatermark}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-xs font-mono">
              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block">Payments Scanned</span>
                <span className="font-bold text-sm">{reconcileReport.totalPaymentsScanned}</span>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block">Ledger Events Scanned</span>
                <span className="font-bold text-sm">{reconcileReport.totalLedgerEventsScanned}</span>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block">Accounts Audited</span>
                <span className="font-bold text-sm">{reconcileReport.userBalancesAuditedCount}</span>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block">Discrepancies</span>
                <span className={`font-bold text-sm ${reconcileReport.discrepancies?.length === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {reconcileReport.discrepancies?.length ?? 0}
                </span>
              </div>
            </div>

            {reconcileReport.discrepancies?.length > 0 && (
              <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-lg">
                <div className="text-xs font-bold text-rose-700 dark:text-rose-300 mb-2">
                  Detected Discrepancies (Not silently repaired):
                </div>
                <div className="space-y-1 text-xs font-mono text-rose-800 dark:text-rose-400">
                  {reconcileReport.discrepancies.map((d: any, idx: number) => (
                    <div key={idx}>
                      • {d.field}: stored={d.storedValue} vs recomputed={d.recomputedValue} (delta: {d.delta})
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 4: Refunds, Disputes & Shortfall Table */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Refunds, Disputes & Clawback Shortfalls
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Tracks partial and full reversals. Unrecovered balances are permanently logged as shortfalls and never deducted from future pack purchases.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by ref or email..."
              value={reversalSearch}
              onChange={(e) => setReversalSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                <th className="py-3 px-3">Reference</th>
                <th className="py-3 px-3">Customer</th>
                <th className="py-3 px-3">Gross (NGN)</th>
                <th className="py-3 px-3">Refunded (NGN)</th>
                <th className="py-3 px-3">Sparks Added</th>
                <th className="py-3 px-3">Clawed Back</th>
                <th className="py-3 px-3">Shortfall</th>
                <th className="py-3 px-3">Dispute</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {recentReversals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400 font-sans">
                    No payment refunds, clawbacks, or disputes recorded.
                  </td>
                </tr>
              ) : (
                recentReversals.map((r: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                      {r.reference}
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400 font-sans">
                      {r.email || r.uid}
                    </td>
                    <td className="py-3 px-3">₦{r.amountNgn?.toLocaleString()}</td>
                    <td className="py-3 px-3 text-rose-600">
                      ₦{r.refundedAmountNgn ? r.refundedAmountNgn.toLocaleString() : 0}
                    </td>
                    <td className="py-3 px-3">{r.sparksAdded?.toLocaleString()}</td>
                    <td className="py-3 px-3 text-rose-600 font-bold">
                      -{r.sparksClawedBack?.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-amber-600">
                      {r.sparksShortfall > 0 ? `${r.sparksShortfall} sparks` : '0'}
                    </td>
                    <td className="py-3 px-3 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          r.disputeStatus === 'none'
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                            : r.disputeStatus === 'won'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                            : r.disputeStatus === 'lost'
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                            : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {r.disputeStatus}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 5: Database Quota & Telemetry Health */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Process-Level Database Telemetry & Quota Health
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time operations attributed to this Node.js instance (Stage 4B write-suppression verified).
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
          <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 block uppercase">Total Read Ops</span>
            <span className="text-xl font-bold text-slate-900 dark:text-white mt-1 block">
              {(telemetry.totals?.totalReadOps ?? 0).toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400 font-sans">
              Docs Read: {(telemetry.totals?.totalDocsRead ?? 0).toLocaleString()}
            </span>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 block uppercase">Total Write Ops</span>
            <span className="text-xl font-bold text-slate-900 dark:text-white mt-1 block">
              {(telemetry.totals?.totalWriteOps ?? 0).toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400 font-sans">
              Deletes: {(telemetry.totals?.totalDeleteOps ?? 0).toLocaleString()}
            </span>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 block uppercase text-emerald-600 dark:text-emerald-400">
              Suppressed Writes
            </span>
            <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">
              {(telemetry.totals?.totalSuppressedWrites ?? 0).toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400 font-sans">
              Purged duplicate/routine writes
            </span>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 block uppercase">Quota Errors</span>
            <span
              className={`text-xl font-bold mt-1 block ${
                (telemetry.totals?.totalQuotaExhaustedErrors ?? 0) === 0
                  ? 'text-emerald-600'
                  : 'text-rose-600'
              }`}
            >
              {(telemetry.totals?.totalQuotaExhaustedErrors ?? 0).toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400 font-sans">RESOURCE_EXHAUSTED events</span>
          </div>
        </div>
      </div>

      {/* Section 6: Neon Relational Database & Connection Health (Stage 5B) */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Neon PostgreSQL Relational Database (Stage 5B)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Target primary datastore for course catalog, student progress batches, and background job queues.
            </p>
          </div>
          <button
            onClick={handleProbeNeon}
            disabled={probingNeon}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probingNeon ? 'animate-spin text-indigo-500' : ''}`} />
            {probingNeon ? 'Probing...' : 'Re-probe Connection'}
          </button>
        </div>

        {(() => {
          const neon = neonProbeResult || stats?.neonHealth || {};
          const isConnected = neon.status === 'CONNECTED';
          const isNotConfigured = neon.status === 'NOT_CONFIGURED';

          return (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 block uppercase font-sans">Connection Status</span>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        isConnected
                          ? 'bg-emerald-500 animate-pulse'
                          : isNotConfigured
                          ? 'bg-amber-400'
                          : 'bg-rose-500'
                      }`}
                    />
                    <span
                      className={`text-sm font-bold ${
                        isConnected
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isNotConfigured
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {neon.status || 'NOT_CONFIGURED'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-sans mt-1 block">
                    {isConnected ? 'Active TLS connection verified' : 'Requires DATABASE_URL in .env'}
                  </span>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 block uppercase font-sans">Round-Trip Latency</span>
                  <span className="text-xl font-bold text-slate-900 dark:text-white mt-1 block">
                    {neon.latencyMs ? `${neon.latencyMs} ms` : 'N/A'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-sans">TCP + TLS Handshake</span>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 block uppercase font-sans">Database Target</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white mt-1 block truncate">
                    {neon.database || 'defaultdb'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-sans">
                    SSL: {neon.sslMode || 'require'}
                  </span>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 block uppercase font-sans">Endpoint Host</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white mt-1 block truncate">
                    {neon.host || 'ep-xyz.neon.tech'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-sans">Port {neon.port || 5432}</span>
                </div>
              </div>

              {/* Masked Connection URI & Environment Guidance */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
                <div className="flex items-center justify-between gap-2 text-slate-500 font-sans mb-1">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    Masked Connection URI (Configured in server .env):
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Zero raw secrets exposed</span>
                </div>
                <div className="font-mono text-slate-700 dark:text-slate-300 break-all select-all py-1 px-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                  {neon.sanitizedUri || 'postgresql://user:••••••••@ep-xyz.neon.tech/uniace_db?sslmode=require'}
                </div>
                {isNotConfigured && (
                  <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 font-sans">
                    💡 <strong>Setup Step:</strong> To connect your live Neon database, add your connection string to <code>DATABASE_URL</code> in your development <code>.env</code> file or hosting provider secrets panel.
                  </p>
                )}
                {neon.error && !isNotConfigured && (
                  <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400 font-sans">
                    ⚠️ <strong>Probe Diagnostic:</strong> {neon.error}
                  </p>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Confirmation Modal for Live Reconciliation Commit */}
      {isCommitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400 mb-3">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Authorize Reconciliation Commit
              </h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              This operation executes a watermarked reconciliation pass, acquires the cutoff lock, updates the aggregate rollups in <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">spark_ledger_rollups/all_time</code>, and writes an immutable audit record.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Note: This never silently alters user balances. To proceed, please type <strong className="font-mono text-slate-900 dark:text-white">CONFIRM_RECONCILE</strong> below:
            </p>

            <input
              type="text"
              placeholder="CONFIRM_RECONCILE"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              className="mt-4 w-full px-3 py-2 text-sm font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setIsCommitModalOpen(false);
                  setConfirmationInput('');
                }}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRunReconcile(false)}
                disabled={confirmationInput !== 'CONFIRM_RECONCILE' || isReconciling}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white transition shadow-sm"
              >
                {isReconciling ? 'Committing...' : 'Confirm & Commit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
