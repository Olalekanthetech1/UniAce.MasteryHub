import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  RefreshCw,
  Plus,
  Trash2,
  Scale,
  FileCheck2,
  Sliders,
  DollarSign,
  ExternalLink,
  Calculator,
  Award,
  Clock
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import MarkdownRenderer from '../MarkdownRenderer';

type SubView = 'triage' | 'corpus' | 'evaluator' | 'policy';

export const GoldenSetTrustTab: React.FC = () => {
  const { user } = useAuth();
  const [activeSubView, setActiveSubView] = useState<SubView>('triage');
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // 01. Triage State
  const [reports, setReports] = useState<any[]>([]);
  const [reportCounts, setReportCounts] = useState({ total: 0, pendingCount: 0, verifiedCount: 0, dismissedCount: 0 });
  const [reportFilter, setReportFilter] = useState<'pending_review' | 'verified_promoted' | 'dismissed' | 'ALL'>('pending_review');
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [promoteEnabled, setPromoteEnabled] = useState(false);
  const [promoteSuiteType, setPromoteSuiteType] = useState<'regression_promoted' | 'core_150'>('regression_promoted');
  const [promoteSplit, setPromoteSplit] = useState<'dev_routing' | 'locked_holdout'>('dev_routing');
  const [promoteDomain, setPromoteDomain] = useState<'Mathematics' | 'Physics' | 'Computer Science' | 'Chemistry'>('Mathematics');
  const [promoteTopic, setPromoteTopic] = useState('');
  const [promoteDifficulty, setPromoteDifficulty] = useState<'undergraduate_core' | 'advanced_honors'>('undergraduate_core');
  const [promoteGradingMode, setPromoteGradingMode] = useState<'numeric_with_tolerance' | 'symbolic_domain_sampling' | 'exact_choice' | 'cross_family_llm_judge'>('numeric_with_tolerance');
  const [promoteFinalAnswer, setPromoteFinalAnswer] = useState('');
  const [promoteTolerance, setPromoteTolerance] = useState('0.0001');
  const [promoteUnits, setPromoteUnits] = useState('');
  const [promoteProofLatex, setPromoteProofLatex] = useState('');
  const [promoteCitation, setPromoteCitation] = useState('');
  const [triageBusy, setTriageBusy] = useState(false);

  // Interactive Expression Verifier State
  const [verifyCandidateExpr, setVerifyCandidateExpr] = useState('');
  const [verifyTruthExpr, setVerifyTruthExpr] = useState('');
  const [verifyMode, setVerifyMode] = useState<'numeric_with_tolerance' | 'symbolic_domain_sampling' | 'exact_choice'>('numeric_with_tolerance');
  const [verifyResult, setVerifyResult] = useState<any | null>(null);

  // 02. Corpus State
  const [corpusItems, setCorpusItems] = useState<any[]>([]);
  const [corpusSummary, setCorpusSummary] = useState<any>({
    humanVerifiedCore150Count: 0,
    targetCore150Slots: 150,
    missingSlotsTo150: 150,
    regressionPromotedCount: 0,
    domainCounts: { Mathematics: 0, Physics: 0, 'Computer Science': 0, Chemistry: 0 },
    splitCounts: { dev_routing: 0, locked_holdout: 0 }
  });
  const [newItemSuite, setNewItemSuite] = useState<'core_150' | 'regression_promoted'>('core_150');
  const [newItemSplit, setNewItemSplit] = useState<'dev_routing' | 'locked_holdout'>('dev_routing');
  const [newItemDomain, setNewItemDomain] = useState<'Mathematics' | 'Physics' | 'Computer Science' | 'Chemistry'>('Mathematics');
  const [newItemTopic, setNewItemTopic] = useState('');
  const [newItemCourseCode, setNewItemCourseCode] = useState('');
  const [newItemDifficulty, setNewItemDifficulty] = useState<'undergraduate_core' | 'advanced_honors'>('undergraduate_core');
  const [newItemGradingMode, setNewItemGradingMode] = useState<'numeric_with_tolerance' | 'symbolic_domain_sampling' | 'exact_choice' | 'cross_family_llm_judge'>('numeric_with_tolerance');
  const [newItemQuestion, setNewItemQuestion] = useState('');
  const [newItemFinalAnswer, setNewItemFinalAnswer] = useState('');
  const [newItemTolerance, setNewItemTolerance] = useState('0.0001');
  const [newItemUnits, setNewItemUnits] = useState('');
  const [newItemDomainMin, setNewItemDomainMin] = useState('0.5');
  const [newItemDomainMax, setNewItemDomainMax] = useState('2.5');
  const [newItemProofLatex, setNewItemProofLatex] = useState('');
  const [newItemRubric, setNewItemRubric] = useState('');
  const [newItemCitation, setNewItemCitation] = useState('');
  const [savingItem, setSavingItem] = useState(false);

  // 03. Resumable Evaluator State
  const [evalRuns, setEvalRuns] = useState<any[]>([]);
  const [runSuiteType, setRunSuiteType] = useState<'core_150' | 'regression_promoted'>('core_150');
  const [runDomainFilter, setRunDomainFilter] = useState<'ALL' | 'Mathematics' | 'Physics' | 'Computer Science' | 'Chemistry'>('ALL');
  const [runTargetProvider, setRunTargetProvider] = useState<string>('production_routed');
  const [startingRun, setStartingRun] = useState(false);
  const [steppingRunId, setSteppingRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<any | null>(null);

  // 04. Policy & Token Pricing State
  const [policy, setPolicy] = useState<any | null>(null);
  const [tokenPricing, setTokenPricing] = useState<any | null>(null);
  const [staleProviders, setStaleProviders] = useState<string[]>([]);
  const [policyReason, setPolicyReason] = useState('');
  const [pricingReason, setPricingReason] = useState('');
  const [editProviderKey, setEditProviderKey] = useState('groq');
  const [editStandardRate, setEditStandardRate] = useState('0.00059');
  const [editHighRate, setEditHighRate] = useState('0.00079');
  const [editSourceUrl, setEditSourceUrl] = useState('https://wow.groq.com/pricing/');

  const getToken = useCallback(async () => {
    if (!user) return '';
    return await user.getIdToken();
  }, [user]);

  const fetchAllData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };

      const [repRes, corpRes, runsRes, polRes] = await Promise.all([
        fetch('/api/admin/answer-reports', { headers }),
        fetch('/api/admin/golden-set/items', { headers }),
        fetch('/api/admin/golden-set/runs', { headers }),
        fetch('/api/admin/evaluation-policy', { headers })
      ]);

      if (repRes.ok) {
        const repData = await repRes.json();
        setReports(repData.reports || []);
        if (repData.counts) setReportCounts(repData.counts);
      }
      if (corpRes.ok) {
        const corpData = await corpRes.json();
        setCorpusItems(corpData.items || []);
        if (corpData.summary) setCorpusSummary(corpData.summary);
      }
      if (runsRes.ok) {
        const runsData = await runsRes.json();
        const list = runsData.runs || [];
        setEvalRuns(list);
        if (list.length > 0 && !selectedRun) {
          setSelectedRun(list[0]);
        } else if (selectedRun) {
          const updated = list.find((r: any) => r.id === selectedRun.id);
          if (updated) setSelectedRun(updated);
        }
      }
      if (polRes.ok) {
        const polData = await polRes.json();
        setPolicy(polData.policy || null);
        setTokenPricing(polData.tokenPricing || null);
        setStaleProviders(polData.staleProviders || []);
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to load Golden Set & Trust data.');
    } finally {
      setLoading(false);
    }
  }, [user, getToken, selectedRun]);

  useEffect(() => {
    fetchAllData();
  }, [user]);

  // Automatically step any active 'running' evaluation run in Cloud-Run-safe chunks
  useEffect(() => {
    const activeRunning = evalRuns.find((r) => r.status === 'running');
    if (!activeRunning || steppingRunId) return;

    let cancelled = false;
    const stepNext = async () => {
      setSteppingRunId(activeRunning.id);
      try {
        const token = await getToken();
        const res = await fetch(`/api/admin/golden-set/runs/${activeRunning.id}/step`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ batchSize: 3 })
        });
        const data = await res.json();
        if (!cancelled && res.ok && data.run) {
          setEvalRuns((prev) => prev.map((r) => (r.id === data.run.id ? data.run : r)));
          if (selectedRun?.id === data.run.id) {
            setSelectedRun(data.run);
          }
        }
      } catch (e) {
        console.error('Chunk step error:', e);
      } finally {
        if (!cancelled) setSteppingRunId(null);
      }
    };

    const timer = setTimeout(stepNext, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [evalRuns, steppingRunId, getToken, selectedRun]);

  const handleVerifyExpression = async () => {
    setErrorBanner(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/answer-reports/verify-expression', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          candidateRaw: verifyCandidateExpr,
          groundTruthRaw: verifyTruthExpr,
          gradingMode: verifyMode,
          relativeTolerance: Number(promoteTolerance) || 1e-4,
          acceptedUnits: promoteUnits
            .split(',')
            .map((u) => u.trim())
            .filter(Boolean)
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Verification failed');
      setVerifyResult(data);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Expression check failed.');
    }
  };

  const handleTriageDecision = async (decision: 'approve' | 'dismiss') => {
    if (!selectedReport) return;
    setTriageBusy(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/answer-reports/${selectedReport.id}/triage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          decision,
          reviewerNotes,
          promoteToBenchmark:
            decision === 'approve' && promoteEnabled
              ? {
                  enabled: true,
                  suiteType: promoteSuiteType,
                  split: promoteSplit,
                  domain: promoteDomain,
                  topic: promoteTopic || selectedReport.courseId || 'University STEM',
                  difficulty: promoteDifficulty,
                  gradingMode: promoteGradingMode,
                  finalAnswer: promoteFinalAnswer,
                  relativeTolerance: Number(promoteTolerance) || 1e-4,
                  acceptedUnits: promoteUnits
                    .split(',')
                    .map((u) => u.trim())
                    .filter(Boolean),
                  groundTruthProofLatex: promoteProofLatex,
                  academicCitation: promoteCitation
                }
              : { enabled: false }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Triage action failed');

      setSuccessBanner(
        decision === 'approve'
          ? `Report verified! Credited +${data.bountyResult?.creditedSparks || 0} Sparks (${data.bountyResult?.queryRefundSparks || 0} refund + ${data.bountyResult?.bonusSparksAwarded || 0} first-reporter bonus).${data.promotedItem ? ` Promoted as ${data.promotedItem.id}.` : ''}`
          : `Report ${selectedReport.id} dismissed and student notified.`
      );
      setSelectedReport(null);
      setReviewerNotes('');
      setPromoteEnabled(false);
      await fetchAllData();
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to process triage decision.');
    } finally {
      setTriageBusy(false);
    }
  };

  const handleCreateCorpusItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingItem(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/golden-set/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          suiteType: newItemSuite,
          split: newItemSplit,
          domain: newItemDomain,
          topic: newItemTopic,
          courseCode: newItemCourseCode,
          difficulty: newItemDifficulty,
          gradingMode: newItemGradingMode,
          question: newItemQuestion,
          finalAnswer: newItemFinalAnswer,
          relativeTolerance: Number(newItemTolerance) || 1e-4,
          acceptedUnits: newItemUnits
            .split(',')
            .map((u) => u.trim())
            .filter(Boolean),
          sampleDomain: {
            x: [Number(newItemDomainMin) || 0.5, Number(newItemDomainMax) || 2.5]
          },
          groundTruthProofLatex: newItemProofLatex,
          rubricCheckpoints: newItemRubric
            .split('\n')
            .map((r) => r.trim())
            .filter(Boolean),
          academicCitation: newItemCitation
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save benchmark item');

      setSuccessBanner(`SME-Signed Benchmark Item ${data.item.id} added (${data.item.domain} · ${data.item.split}).`);
      setNewItemQuestion('');
      setNewItemFinalAnswer('');
      setNewItemProofLatex('');
      setNewItemRubric('');
      setNewItemCitation('');
      await fetchAllData();
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to author benchmark item.');
    } finally {
      setSavingItem(false);
    }
  };

  const handleDeleteCorpusItem = async (id: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/golden-set/items/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setSuccessBanner(`Deleted benchmark item ${id}.`);
        await fetchAllData();
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to delete item.');
    }
  };

  const handleStartEvaluationRun = async () => {
    setStartingRun(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/golden-set/runs/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          suiteType: runSuiteType,
          domainFilter: runDomainFilter,
          targetProvider: runTargetProvider
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not start evaluation run');

      setEvalRuns((prev) => [data.run, ...prev]);
      setSelectedRun(data.run);
      setSuccessBanner(`Started resumable evaluation run ${data.run.id} (${data.run.counts.queuedCount} SME-verified items queued).`);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to start evaluation run.');
    } finally {
      setStartingRun(false);
    }
  };

  const handleTogglePauseRun = async (runId: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/golden-set/runs/${runId}/pause`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setEvalRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, status: data.status } : r)));
        if (selectedRun?.id === runId) {
          setSelectedRun((prev: any) => (prev ? { ...prev, status: data.status } : null));
        }
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not toggle run status.');
    }
  };

  const handleSyncRoutingFromDevSplit = async (runId: string) => {
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/golden-set/runs/${runId}/sync-routing`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to sync routing');
      setPolicy(data.policy);
      setSuccessBanner(
        `Synced empirical Tier-1 providers [${(data.derivedTier1Providers || []).join(', ') || 'none'}] and domain routing strictly from dev_routing split of ${runId}.`
      );
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not sync routing from dev_routing split.');
    }
  };

  const handleSaveEvaluationPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policy) return;
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/evaluation-policy', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          updates: {
            accuracyGatePointPercent: Number(policy.accuracyGatePointPercent),
            accuracyGateCiLowPercent: Number(policy.accuracyGateCiLowPercent),
            dailyReportCapPerUser: Number(policy.dailyReportCapPerUser),
            firstReporterBonusSparks: Number(policy.firstReporterBonusSparks),
            minValidSamplePoints: Number(policy.minValidSamplePoints),
            pricingStaleAfterDays: Number(policy.pricingStaleAfterDays)
          },
          reason: policyReason
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update policy');
      setPolicy(data.policy);
      setPolicyReason('');
      setSuccessBanner('Evaluation policy updated and recorded to system_logs.');
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not update policy.');
    }
  };

  const handleSaveTokenPricingRate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/token-pricing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          rates: {
            [editProviderKey]: {
              standardUsdPer1k: Number(editStandardRate),
              highUsdPer1k: Number(editHighRate),
              sourceUrl: editSourceUrl,
              lastVerifiedAt: new Date().toISOString()
            }
          },
          reason: pricingReason
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update token pricing');
      setTokenPricing(data.tokenPricing);
      setStaleProviders(data.staleProviders || []);
      setPricingReason('');
      setSuccessBanner(`Verified pricing rate for ${editProviderKey} saved with official source URL.`);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to update token pricing.');
    }
  };

  const filteredReports = reports.filter((r) => (reportFilter === 'ALL' ? true : r.status === reportFilter));

  return (
    <div className="space-y-6">
      {/* Top Header & Zero-Mock Telemetry Summary */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 dark:border-zinc-800 pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              <ShieldCheck size={15} />
              <span>Student Trust · SME Verification · 150-Question Golden Set Harness</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 mt-1">
              Academic Accuracy & Provenance Verification Console
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              Zero-Mock Policy Active: Upstream-only model provenance · Explicit <code className="font-mono">ungraded</code> accounting · Named SME sign-off required · Audited <code className="font-mono">system_config</code> thresholds.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchAllData}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 flex items-center gap-1.5"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>Refresh Live State</span>
            </button>
          </div>
        </div>

        {/* 4-Column Hairline Metric Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 dark:bg-zinc-800 mt-4 border border-slate-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <div className="bg-white dark:bg-zinc-900 p-3.5">
            <span className="text-[11px] font-mono uppercase text-slate-400 dark:text-zinc-500">
              01 · SME Triage Queue
            </span>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-zinc-100 mt-1">
              {reportCounts.pendingCount} Pending
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono mt-0.5">
              {reportCounts.verifiedCount} Verified · {reportCounts.dismissedCount} Dismissed
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-3.5">
            <span className="text-[11px] font-mono uppercase text-slate-400 dark:text-zinc-500">
              02 · Core-150 SME Corpus
            </span>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-zinc-100 mt-1">
              {corpusSummary.humanVerifiedCore150Count} / 150
            </div>
            <div className="text-[11px] text-amber-600 dark:text-amber-400 font-mono mt-0.5">
              {corpusSummary.missingSlotsTo150} slots awaiting SME sign-off · {corpusSummary.regressionPromotedCount} Regression
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-3.5">
            <span className="text-[11px] font-mono uppercase text-slate-400 dark:text-zinc-500">
              03 · Latest Eval Gate ({policy?.accuracyGatePointPercent ?? 90}% / {policy?.accuracyGateCiLowPercent ?? 85}% CI)
            </span>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-zinc-100 mt-1">
              {evalRuns[0]?.overallMetrics?.accuracyPercent !== null && evalRuns[0]?.overallMetrics?.accuracyPercent !== undefined
                ? `${evalRuns[0].overallMetrics.accuracyPercent}%`
                : 'No Graded Runs'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono mt-0.5">
              {evalRuns[0]
                ? `95% CI [${evalRuns[0].overallMetrics.wilson95CiLow ?? '—'}%, ${evalRuns[0].overallMetrics.wilson95CiHigh ?? '—'}%] · ${evalRuns[0].counts?.ungraded ?? 0} Ungraded`
                : '0 evaluation runs executed'}
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-3.5">
            <span className="text-[11px] font-mono uppercase text-slate-400 dark:text-zinc-500">
              04 · Empirically Verified Tier-1
            </span>
            <div className="text-sm font-bold font-mono text-slate-900 dark:text-zinc-100 mt-1 truncate">
              {policy?.verifiedTier1Providers?.length > 0
                ? policy.verifiedTier1Providers.join(', ')
                : 'Unverified (Run Dev Split)'}
            </div>
            <div className="text-[11px] font-mono mt-1">
              {staleProviders.length > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">
                  ▲ {staleProviders.length} provider pricing rate(s) stale
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">
                  ✓ All provider pricing rates verified
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Sub-Navigation Bar */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-zinc-800">
          {[
            { id: 'triage', label: `01. Manual SME Triage (${reportCounts.pendingCount})`, icon: Scale },
            { id: 'corpus', label: `02. SME Benchmark Corpus (${corpusSummary.humanVerifiedCore150Count}/150)`, icon: FileCheck2 },
            { id: 'evaluator', label: `03. Resumable Production Evaluator (${evalRuns.length})`, icon: Play },
            { id: 'policy', label: '04. Audited Policy & Token Pricing', icon: Sliders }
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeSubView === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubView(tab.id as SubView)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-slate-900 dark:border-zinc-100'
                    : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800'
                }`}
              >
                <Icon size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {errorBanner && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} />
            <span>{errorBanner}</span>
          </div>
          <button onClick={() => setErrorBanner(null)} className="text-[11px] underline">
            Dismiss
          </button>
        </div>
      )}

      {successBanner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} />
            <span>{successBanner}</span>
          </div>
          <button onClick={() => setSuccessBanner(null)} className="text-[11px] underline">
            Dismiss
          </button>
        </div>
      )}

      {/* =====================================================================
          SUB-VIEW 01: MANUAL SME TRIAGE QUEUE & POST-SETTLE QUALITY_BOUNTY
         ===================================================================== */}
      {activeSubView === 'triage' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Reports List */}
          <div className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                Student Wrong-Answer Reports
              </h3>
              <select
                value={reportFilter}
                onChange={(e) => setReportFilter(e.target.value as any)}
                className="px-2.5 py-1 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300"
              >
                <option value="pending_review">Pending Review ({reportCounts.pendingCount})</option>
                <option value="verified_promoted">Verified ({reportCounts.verifiedCount})</option>
                <option value="dismissed">Dismissed ({reportCounts.dismissedCount})</option>
                <option value="ALL">All Reports ({reportCounts.total})</option>
              </select>
            </div>

            {filteredReports.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <Scale size={24} className="mx-auto text-slate-400 dark:text-zinc-600" />
                <p className="text-xs font-semibold text-slate-600 dark:text-zinc-400">
                  0 student reports in "{reportFilter}" state
                </p>
                <p className="text-[11px] text-slate-400 dark:text-zinc-500 max-w-xs mx-auto">
                  Authentic Empty State: Student reports appear here in real time when submitted via the "Report Wrong Answer" action in chat.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-zinc-800 max-h-[620px] overflow-y-auto">
                {filteredReports.map((rep) => {
                  const isSelected = selectedReport?.id === rep.id;
                  return (
                    <button
                      key={rep.id}
                      onClick={() => {
                        setSelectedReport(rep);
                        setReviewerNotes(rep.reviewerNotes || '');
                        setVerifyTruthExpr(rep.studentCorrection || '');
                      }}
                      className={`w-full text-left p-3 transition-colors ${
                        isSelected
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-zinc-400">
                        <span>{rep.providerLabel || rep.providerUsed}</span>
                        <span>{new Date(rep.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 mt-1 line-clamp-2">
                        {rep.promptText}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] font-mono">
                        <span className="text-amber-600 dark:text-amber-400">{rep.category}</span>
                        <span>·</span>
                        <span>{rep.sparksCharged} Sparks Settled</span>
                        <span>·</span>
                        <span className={rep.isFirstReporterForTopic ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>
                          {rep.isFirstReporterForTopic ? '★ First Reporter (+Bonus)' : 'Duplicate Topic (Refund Only)'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Triage Inspector & SymPy/MathJS Verifier */}
          <div className="lg:col-span-7 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5">
            {!selectedReport ? (
              <div className="py-16 text-center space-y-2">
                <Award size={28} className="mx-auto text-slate-400 dark:text-zinc-600" />
                <p className="text-xs font-semibold text-slate-600 dark:text-zinc-400">
                  Select a student report from the queue to inspect & verify
                </p>
                <p className="text-[11px] text-slate-400 dark:text-zinc-500 max-w-md mx-auto">
                  Approving a report executes an atomic post-SETTLE <code className="font-mono">QUALITY_BOUNTY</code> transaction (verifying the stream was not already refunded on abort) and notifies the student.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="border-b border-slate-200 dark:border-zinc-800 pb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-mono text-slate-400">
                      Report ID: {selectedReport.id} · Token: {selectedReport.idempotency_token || 'N/A'}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                      Student: {selectedReport.userDisplayName} · Provenance: {selectedReport.providerLabel}
                    </h4>
                  </div>
                  <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {selectedReport.isFirstReporterForTopic
                      ? `Eligible: ${selectedReport.sparksCharged} Refund + ${policy?.firstReporterBonusSparks ?? 5} Bonus Sparks`
                      : `Duplicate Topic: ${selectedReport.sparksCharged} Refund Only (0 Bonus)`}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-700 dark:text-zinc-300">Student Question:</div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-xs text-slate-800 dark:text-zinc-200 whitespace-pre-wrap">
                    {selectedReport.promptText}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-zinc-300">
                    <span>Model Response Under Review:</span>
                    <span className="font-mono text-[11px]">
                      LaTeX Delimiters: {selectedReport.latexBalancedInModelResponse ? '✓ Balanced' : '✗ Unbalanced'}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-xs max-h-56 overflow-y-auto">
                    <MarkdownRenderer content={selectedReport.modelResponseText} />
                  </div>
                </div>

                {selectedReport.studentCorrection && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      Student Proposed Correction:
                    </div>
                    <div className="p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs font-mono text-amber-900 dark:text-amber-200">
                      {selectedReport.studentCorrection}
                    </div>
                  </div>
                )}

                {/* Interactive Numeric / Symbolic Domain Equivalence Tester */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                      <Calculator size={14} className="text-emerald-600" />
                      Interactive Symbolic / Numeric Equivalence Sandbox
                    </span>
                    <select
                      value={verifyMode}
                      onChange={(e) => setVerifyMode(e.target.value as any)}
                      className="px-2 py-1 text-[11px] rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                    >
                      <option value="numeric_with_tolerance">Numeric with Tolerance</option>
                      <option value="symbolic_domain_sampling">Symbolic Domain Sampling</option>
                      <option value="exact_choice">Exact Choice</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={verifyCandidateExpr}
                      onChange={(e) => setVerifyCandidateExpr(e.target.value)}
                      placeholder="Model's extracted answer (e.g. \frac{\pi}{2})"
                      className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                    />
                    <input
                      type="text"
                      value={verifyTruthExpr}
                      onChange={(e) => setVerifyTruthExpr(e.target.value)}
                      placeholder="SME ground-truth answer (e.g. \frac{\pi}{4})"
                      className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleVerifyExpression}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
                    >
                      Run Equivalence Check
                    </button>
                    {verifyResult && (
                      <span className="text-xs font-mono">
                        Outcome:{' '}
                        <strong
                          className={
                            verifyResult.outcome === 'passed'
                              ? 'text-emerald-600'
                              : verifyResult.outcome === 'failed'
                                ? 'text-rose-600'
                                : 'text-amber-600'
                          }
                        >
                          {String(verifyResult.outcome).toUpperCase()}
                          {verifyResult.ungradedReason ? ` (${verifyResult.ungradedReason})` : ''}
                        </strong>{' '}
                        · {verifyResult.details}
                      </span>
                    )}
                  </div>
                </div>

                {selectedReport.status === 'pending_review' && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-zinc-800">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                        SME Review Explanation (Sent to Student Notification & Audit Log)
                      </label>
                      <textarea
                        rows={2}
                        value={reviewerNotes}
                        onChange={(e) => setReviewerNotes(e.target.value)}
                        placeholder="Explain why the model's derivation or final answer was flawed (or why the original answer is valid)..."
                        className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                      />
                    </div>

                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-zinc-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={promoteEnabled}
                        onChange={(e) => setPromoteEnabled(e.target.checked)}
                      />
                      <span>Promote SME-Verified Problem to Golden Set Benchmark Corpus</span>
                    </label>

                    {promoteEnabled && (
                      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[11px] font-mono text-slate-500 mb-1">Target Suite</label>
                            <select
                              value={promoteSuiteType}
                              onChange={(e) => setPromoteSuiteType(e.target.value as any)}
                              className="w-full px-2 py-1.5 text-xs rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                            >
                              <option value="regression_promoted">Regression Suite (Default)</option>
                              <option value="core_150">Core-150 Gate Suite</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-mono text-slate-500 mb-1">Evaluation Split</label>
                            <select
                              value={promoteSplit}
                              onChange={(e) => setPromoteSplit(e.target.value as any)}
                              className="w-full px-2 py-1.5 text-xs rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                            >
                              <option value="dev_routing">dev_routing (80%)</option>
                              <option value="locked_holdout">locked_holdout (20%)</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-mono text-slate-500 mb-1">Academic Domain</label>
                            <select
                              value={promoteDomain}
                              onChange={(e) => setPromoteDomain(e.target.value as any)}
                              className="w-full px-2 py-1.5 text-xs rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                            >
                              <option value="Mathematics">Mathematics</option>
                              <option value="Physics">Physics</option>
                              <option value="Computer Science">Computer Science</option>
                              <option value="Chemistry">Chemistry</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={promoteFinalAnswer}
                            onChange={(e) => setPromoteFinalAnswer(e.target.value)}
                            placeholder="Canonical Final Answer (e.g. \pi/4)"
                            className="px-2.5 py-1.5 text-xs font-mono rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                          />
                          <input
                            type="text"
                            value={promoteTolerance}
                            onChange={(e) => setPromoteTolerance(e.target.value)}
                            placeholder="Rel. Tolerance (e.g. 0.001)"
                            className="px-2.5 py-1.5 text-xs font-mono rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                          />
                          <input
                            type="text"
                            value={promoteCitation}
                            onChange={(e) => setPromoteCitation(e.target.value)}
                            placeholder="Mandatory Textbook/Exam Citation"
                            className="px-2.5 py-1.5 text-xs rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                          />
                        </div>

                        <textarea
                          rows={2}
                          value={promoteProofLatex}
                          onChange={(e) => setPromoteProofLatex(e.target.value)}
                          placeholder="SME Ground-Truth LaTeX Proof ($...$ or $$...$$ balanced)..."
                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        disabled={triageBusy}
                        onClick={() => handleTriageDecision('dismiss')}
                        className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800"
                      >
                        Dismiss Report
                      </button>
                      <button
                        type="button"
                        disabled={triageBusy}
                        onClick={() => handleTriageDecision('approve')}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {triageBusy ? 'Processing Transaction...' : 'Approve & Credit Sparks (Post-Settle Bounty)'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-VIEW 02: SME BENCHMARK CORPUS MANAGER (V / 150 SME-VERIFIED)
         ===================================================================== */}
      {activeSubView === 'corpus' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Author / Sign Off Form */}
          <form
            onSubmit={handleCreateCorpusItem}
            className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 space-y-3"
          >
            <div className="border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Plus size={15} className="text-emerald-600" />
                Author & Sign Off Ground-Truth Item
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                Zero-Mock Rule: Every item requires your authenticated SME signature and a textbook/exam citation. Unverified slots are never padded.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Suite</label>
                <select
                  value={newItemSuite}
                  onChange={(e) => setNewItemSuite(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                >
                  <option value="core_150">Core-150 Gate Suite</option>
                  <option value="regression_promoted">Regression Suite</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Split</label>
                <select
                  value={newItemSplit}
                  onChange={(e) => setNewItemSplit(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                >
                  <option value="dev_routing">dev_routing (Routing Dev)</option>
                  <option value="locked_holdout">locked_holdout (Unbiased Holdout)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Domain</label>
                <select
                  value={newItemDomain}
                  onChange={(e) => setNewItemDomain(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                >
                  <option value="Mathematics">Mathematics</option>
                  <option value="Physics">Physics</option>
                  <option value="Computer Science">Computer Science</option>
                  <option value="Chemistry">Chemistry</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Grading Mode</label>
                <select
                  value={newItemGradingMode}
                  onChange={(e) => setNewItemGradingMode(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                >
                  <option value="numeric_with_tolerance">Numeric with Tolerance</option>
                  <option value="symbolic_domain_sampling">Symbolic Domain Sampling</option>
                  <option value="exact_choice">Exact Choice</option>
                  <option value="cross_family_llm_judge">Cross-Family Reference Judge</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                required
                value={newItemTopic}
                onChange={(e) => setNewItemTopic(e.target.value)}
                placeholder="Topic (e.g. Multivariable Calculus)"
                className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
              <input
                type="text"
                value={newItemCourseCode}
                onChange={(e) => setNewItemCourseCode(e.target.value)}
                placeholder="Course Code (e.g. MTH201)"
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-500 mb-1">University Question Prompt</label>
              <textarea
                rows={3}
                required
                value={newItemQuestion}
                onChange={(e) => setNewItemQuestion(e.target.value)}
                placeholder="State the exact problem..."
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                required
                value={newItemFinalAnswer}
                onChange={(e) => setNewItemFinalAnswer(e.target.value)}
                placeholder="Final Answer (e.g. 2*x*cos(x^2))"
                className="col-span-2 px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
              <input
                type="text"
                value={newItemTolerance}
                onChange={(e) => setNewItemTolerance(e.target.value)}
                placeholder="Tol (1e-4)"
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={newItemUnits}
                onChange={(e) => setNewItemUnits(e.target.value)}
                placeholder="Units (J, N, m/s)"
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
              <input
                type="text"
                value={newItemDomainMin}
                onChange={(e) => setNewItemDomainMin(e.target.value)}
                placeholder="Domain x_min (0.5)"
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
              <input
                type="text"
                value={newItemDomainMax}
                onChange={(e) => setNewItemDomainMax(e.target.value)}
                placeholder="Domain x_max (2.5)"
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-500 mb-1">
                Ground-Truth LaTeX Proof (Balanced $...$ or $$...$$)
              </label>
              <textarea
                rows={3}
                required
                value={newItemProofLatex}
                onChange={(e) => setNewItemProofLatex(e.target.value)}
                placeholder="By the Fundamental Theorem of Calculus, $$\int_0^1 3x^2 dx = [x^3]_0^1 = 1$$..."
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-500 mb-1">
                Mandatory Academic Citation (Accredited Textbook, Paper, or University Exam)
              </label>
              <input
                type="text"
                required
                value={newItemCitation}
                onChange={(e) => setNewItemCitation(e.target.value)}
                placeholder="e.g., Stewart Calculus 8th Ed., Section 5.3, Exercise 19"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </div>

            <button
              type="submit"
              disabled={savingItem}
              className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
            >
              {savingItem ? 'Signing & Persisting...' : 'Sign Off & Add to Golden Set Corpus'}
            </button>
          </form>

          {/* Corpus List & Progress Toward 150 */}
          <div className="lg:col-span-7 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                  SME-Signed Ground-Truth Corpus ({corpusSummary.humanVerifiedCore150Count} / 150 Core-150 Verified)
                </h3>
                <p className="text-[11px] font-mono text-slate-500 dark:text-zinc-400">
                  Math: {corpusSummary.domainCounts?.Mathematics || 0} · Physics: {corpusSummary.domainCounts?.Physics || 0} · CS: {corpusSummary.domainCounts?.['Computer Science'] || 0} · Chem: {corpusSummary.domainCounts?.Chemistry || 0} · Holdout: {corpusSummary.splitCounts?.locked_holdout || 0}
                </p>
              </div>
              <span className="text-xs font-mono text-amber-600 dark:text-amber-400">
                {corpusSummary.missingSlotsTo150} slots unfilled (Zero Synthetic Padding)
              </span>
            </div>

            {corpusItems.length === 0 ? (
              <div className="py-16 text-center space-y-2">
                <FileCheck2 size={28} className="mx-auto text-slate-400 dark:text-zinc-600" />
                <p className="text-xs font-semibold text-slate-600 dark:text-zinc-400">
                  0 / 150 SME-Verified Benchmark Items in Firestore
                </p>
                <p className="text-[11px] text-slate-400 dark:text-zinc-500 max-w-md mx-auto">
                  In compliance with the Zero-Mock Policy, no LLM-generated placeholder items are pre-seeded. Use the form on the left or promote verified student reports to populate the corpus with SME sign-off.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-zinc-800 max-h-[600px] overflow-y-auto">
                {corpusItems.map((item) => (
                  <div key={item.id} className="py-3.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-zinc-400">
                      <span>
                        <strong className="text-slate-800 dark:text-zinc-200">{item.id}</strong> · {item.domain} · {item.topic} · {item.suiteType} · {item.split} · {item.gradingMode}
                      </span>
                      <button
                        onClick={() => handleDeleteCorpusItem(item.id)}
                        className="text-slate-400 hover:text-rose-600 p-1"
                        title="Delete benchmark item"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <p className="text-xs text-slate-900 dark:text-zinc-100 font-medium">{item.question}</p>
                    <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                      Final Answer: <code>{item.finalAnswer}</code> (Tol: {item.relativeTolerance ?? 1e-4})
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono">
                      SME Signed: {item.verifiedByName} ({item.verifiedByRole}) · Citation: {item.academicCitation}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-VIEW 03: RESUMABLE PRODUCTION-PIPELINE EVALUATOR
         ===================================================================== */}
      {activeSubView === 'evaluator' && (
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Suite</label>
                <select
                  value={runSuiteType}
                  onChange={(e) => setRunSuiteType(e.target.value as any)}
                  className="px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                >
                  <option value="core_150">Core-150 Benchmark ({corpusSummary.humanVerifiedCore150Count} Verified)</option>
                  <option value="regression_promoted">Promoted Regression Suite ({corpusSummary.regressionPromotedCount} Verified)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Domain Filter</label>
                <select
                  value={runDomainFilter}
                  onChange={(e) => setRunDomainFilter(e.target.value as any)}
                  className="px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                >
                  <option value="ALL">All 4 STEM Domains</option>
                  <option value="Mathematics">Mathematics</option>
                  <option value="Physics">Physics</option>
                  <option value="Computer Science">Computer Science</option>
                  <option value="Chemistry">Chemistry</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">Target Provider</label>
                <select
                  value={runTargetProvider}
                  onChange={(e) => setRunTargetProvider(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                >
                  <option value="production_routed">Production Routed Pipeline (Default)</option>
                  <option value="groq">Groq Direct</option>
                  <option value="gemini_direct">Gemini Direct</option>
                  <option value="mistral_direct">Mistral Direct</option>
                  <option value="cohere">Cohere</option>
                  <option value="nvidia">NVIDIA NIM</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleStartEvaluationRun}
              disabled={startingRun}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              <Play size={14} />
              <span>{startingRun ? 'Initializing Run...' : 'Launch Resumable Production Eval'}</span>
            </button>
          </div>

          {evalRuns.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl py-16 text-center space-y-2">
              <Clock size={28} className="mx-auto text-slate-400 dark:text-zinc-600" />
              <p className="text-xs font-semibold text-slate-600 dark:text-zinc-400">
                0 Golden Set Evaluation Runs Recorded
              </p>
              <p className="text-[11px] text-slate-400 dark:text-zinc-500 max-w-md mx-auto">
                Author at least 1 SME-verified ground-truth item in Tab 02, then click "Launch Resumable Production Eval" to evaluate live providers through <code className="font-mono">buildTutorSystemPrompt</code> + <code className="font-mono">sanitizeAIResponse</code>.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Runs List */}
              <div className="lg:col-span-4 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-4 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 pb-2 border-b border-slate-200 dark:border-zinc-800">
                  Evaluation Run History
                </h4>
                <div className="divide-y divide-slate-200 dark:divide-zinc-800 max-h-[540px] overflow-y-auto">
                  {evalRuns.map((run) => {
                    const isSelected = selectedRun?.id === run.id;
                    return (
                      <div
                        key={run.id}
                        onClick={() => setSelectedRun(run)}
                        className={`p-3 cursor-pointer transition-colors ${
                          isSelected ? 'bg-emerald-50/70 dark:bg-emerald-950/30' : 'hover:bg-slate-50 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="font-bold text-slate-800 dark:text-zinc-200">{run.id}</span>
                          <span
                            className={
                              run.status === 'completed'
                                ? 'text-emerald-600'
                                : run.status === 'running'
                                  ? 'text-amber-600'
                                  : 'text-slate-500'
                            }
                          >
                            {run.status.toUpperCase()} ({run.counts?.evaluatedCount || 0}/{run.counts?.queuedCount || 0})
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-amber-600 dark:text-amber-400 mt-0.5">
                          {run.officialBadgeLabel}
                        </div>
                        <div className="text-xs font-mono mt-1 text-slate-700 dark:text-zinc-300">
                          Graded Accuracy:{' '}
                          <strong>
                            {run.overallMetrics?.accuracyPercent !== null
                              ? `${run.overallMetrics.accuracyPercent}%`
                              : 'N/A'}
                          </strong>{' '}
                          · 95% CI [{run.overallMetrics?.wilson95CiLow ?? '—'}%, {run.overallMetrics?.wilson95CiHigh ?? '—'}%] ·{' '}
                          <span className="text-amber-600">{run.counts?.ungraded || 0} Ungraded</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Selected Run Telemetry & Question Results */}
              <div className="lg:col-span-8 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                {selectedRun && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-zinc-800 pb-3">
                      <div>
                        <span className="text-[11px] font-mono text-amber-600 dark:text-amber-400 font-semibold">
                          {selectedRun.officialBadgeLabel}
                        </span>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                          Run {selectedRun.id} · Target: {selectedRun.targetProvider}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        {(selectedRun.status === 'running' || selectedRun.status === 'paused') && (
                          <button
                            onClick={() => handleTogglePauseRun(selectedRun.id)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-xs font-semibold flex items-center gap-1"
                          >
                            {selectedRun.status === 'paused' ? <Play size={12} /> : <Pause size={12} />}
                            <span>{selectedRun.status === 'paused' ? 'Resume Run' : 'Pause Run'}</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleSyncRoutingFromDevSplit(selectedRun.id)}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
                          title="Derives verifiedTier1Providers and domain routing strictly from dev_routing items"
                        >
                          Sync Empirical Tiers & Routing (from dev_routing Split)
                        </button>
                      </div>
                    </div>

                    {/* Statistical Gate & Split Summary */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800">
                        <div className="text-[11px] font-mono text-slate-500">Overall Graded Score</div>
                        <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-zinc-100">
                          {selectedRun.overallMetrics?.accuracyPercent !== null
                            ? `${selectedRun.overallMetrics.accuracyPercent}%`
                            : 'Ungraded'}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          95% Wilson CI: [{selectedRun.overallMetrics?.wilson95CiLow ?? '—'}%, {selectedRun.overallMetrics?.wilson95CiHigh ?? '—'}%]
                        </div>
                        <div className="text-[11px] font-mono mt-1">
                          Gate ({selectedRun.overallMetrics?.gatePointTarget}% pt / {selectedRun.overallMetrics?.gateCiLowTarget}% CI low):{' '}
                          <strong className={selectedRun.overallMetrics?.passedGate ? 'text-emerald-600' : 'text-rose-600'}>
                            {selectedRun.overallMetrics?.passedGate ? 'PASSED' : 'BELOW GATE'}
                          </strong>
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800">
                        <div className="text-[11px] font-mono text-slate-500">Split Breakdown (Unbiased Holdout)</div>
                        <div className="text-xs font-mono mt-1 text-slate-800 dark:text-zinc-200">
                          <strong>locked_holdout:</strong>{' '}
                          {selectedRun.holdoutMetrics?.accuracyPercent !== null
                            ? `${selectedRun.holdoutMetrics.accuracyPercent}% (${selectedRun.holdoutMetrics.passed}/${selectedRun.holdoutMetrics.gradedTotal})`
                            : '0 graded'}
                        </div>
                        <div className="text-xs font-mono mt-1 text-slate-800 dark:text-zinc-200">
                          <strong>dev_routing:</strong>{' '}
                          {selectedRun.devRoutingMetrics?.accuracyPercent !== null
                            ? `${selectedRun.devRoutingMetrics.accuracyPercent}% (${selectedRun.devRoutingMetrics.passed}/${selectedRun.devRoutingMetrics.gradedTotal})`
                            : '0 graded'}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800">
                        <div className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
                          Explicit Ungraded Telemetry ({selectedRun.counts?.ungraded || 0})
                        </div>
                        <div className="text-[11px] font-mono text-slate-600 dark:text-zinc-400 mt-1 space-y-0.5">
                          {Object.keys(selectedRun.counts?.ungradedByReason || {}).length === 0 ? (
                            <span>0 ungraded items</span>
                          ) : (
                            Object.entries(selectedRun.counts.ungradedByReason).map(([reason, cnt]) => (
                              <div key={reason}>
                                {reason}: <strong>{String(cnt)}</strong>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Per-Item Results Table */}
                    <div className="overflow-x-auto border border-slate-200 dark:border-zinc-800 rounded-lg max-h-96">
                      <table className="w-full text-left border-collapse text-xs font-mono">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800 text-[11px] text-slate-500">
                            <th className="p-2.5">Item</th>
                            <th className="p-2.5">Domain / Split</th>
                            <th className="p-2.5">Upstream Provenance</th>
                            <th className="p-2.5">Outcome</th>
                            <th className="p-2.5">Extracted vs. Expected</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-zinc-800">
                          {(selectedRun.results || []).map((r: any, idx: number) => (
                            <tr key={`${r.questionId}_${idx}`}>
                              <td className="p-2.5 font-bold">{r.questionId}</td>
                              <td className="p-2.5">
                                {r.domain} · <span className="text-slate-400">{r.split}</span>
                              </td>
                              <td className="p-2.5">
                                {r.providerUsed} ({r.upstreamModel || 'unverified'}) · {r.latencyMs}ms
                              </td>
                              <td className="p-2.5">
                                {r.outcome === 'passed' && (
                                  <span className="text-emerald-600 flex items-center gap-1">
                                    <CheckCircle2 size={12} /> PASSED
                                  </span>
                                )}
                                {r.outcome === 'failed' && (
                                  <span className="text-rose-600 flex items-center gap-1">
                                    <XCircle size={12} /> FAILED
                                  </span>
                                )}
                                {r.outcome === 'ungraded' && (
                                  <span className="text-amber-600 flex items-center gap-1">
                                    <AlertTriangle size={12} /> UNGRADED ({r.ungradedReason})
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5">
                                <div>Cand: {r.extractedAnswer ?? '—'}</div>
                                <div className="text-slate-400">Truth: {r.expectedAnswer}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SUB-VIEW 04: AUDITED POLICY & VERSIONED TOKEN PRICING CONFIG
         ===================================================================== */}
      {activeSubView === 'policy' && policy && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Evaluation Policy Form */}
          <form
            onSubmit={handleSaveEvaluationPolicy}
            className="lg:col-span-6 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 space-y-4"
          >
            <div className="border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                Audited Evaluation Policy (<code className="font-mono">system_config/evaluation_policy</code>)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                Last Updated: {policy.updatedAt || 'Bootstrap'} by {policy.updatedBy || 'system'} · Reason: {policy.auditReason || 'N/A'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">
                  Accuracy Point Gate (%)
                </label>
                <input
                  type="number"
                  value={policy.accuracyGatePointPercent}
                  onChange={(e) => setPolicy({ ...policy, accuracyGatePointPercent: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">
                  95% Wilson CI Lower-Bound Floor (%)
                </label>
                <input
                  type="number"
                  value={policy.accuracyGateCiLowPercent}
                  onChange={(e) => setPolicy({ ...policy, accuracyGateCiLowPercent: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">
                  Daily Student Report Cap (24h)
                </label>
                <input
                  type="number"
                  value={policy.dailyReportCapPerUser}
                  onChange={(e) => setPolicy({ ...policy, dailyReportCapPerUser: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">
                  First-Reporter Bonus Sparks
                </label>
                <input
                  type="number"
                  value={policy.firstReporterBonusSparks}
                  onChange={(e) => setPolicy({ ...policy, firstReporterBonusSparks: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">
                  Min Valid Domain Sample Points
                </label>
                <input
                  type="number"
                  value={policy.minValidSamplePoints}
                  onChange={(e) => setPolicy({ ...policy, minValidSamplePoints: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 mb-1">
                  Pricing Stale Window (Days)
                </label>
                <input
                  type="number"
                  value={policy.pricingStaleAfterDays}
                  onChange={(e) => setPolicy({ ...policy, pricingStaleAfterDays: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-500 mb-1">
                Mandatory Audit Reason (Logged to <code className="font-mono">system_logs</code>)
              </label>
              <input
                type="text"
                required
                value={policyReason}
                onChange={(e) => setPolicyReason(e.target.value)}
                placeholder="Explain why these governance thresholds are being updated..."
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
            >
              Save Audited Policy Config
            </button>
          </form>

          {/* Versioned Token Pricing & Stale Rate Tracker */}
          <div className="lg:col-span-6 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <DollarSign size={15} className="text-emerald-600" />
                Versioned Provider Token Pricing (<code className="font-mono">system_config/token_pricing</code>)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                Each provider rate tracks its official vendor pricing URL and <code className="font-mono">lastVerifiedAt</code> timestamp. Rates older than {policy.pricingStaleAfterDays} days are flagged as <strong className="text-amber-600">▲ STALE RATE</strong> on ledger settlements.
              </p>
            </div>

            {/* Existing Rates Table */}
            <div className="overflow-x-auto border border-slate-200 dark:border-zinc-800 rounded-lg">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800 text-[11px] text-slate-500">
                    <th className="p-2">Provider</th>
                    <th className="p-2">Std / High ($/1k)</th>
                    <th className="p-2">Status & Verified Date</th>
                    <th className="p-2">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-zinc-800">
                  {['groq', 'gemini_direct', 'mistral_direct', 'cohere', 'huggingface', 'openrouter_free', 'nvidia'].map((pKey) => {
                    const entry = tokenPricing?.rates?.[pKey];
                    const isStale = staleProviders.includes(pKey);
                    return (
                      <tr key={pKey}>
                        <td className="p-2 font-bold">{pKey}</td>
                        <td className="p-2">
                          {entry ? `$${entry.standardUsdPer1k} / $${entry.highUsdPer1k}` : 'Unconfigured'}
                        </td>
                        <td className="p-2">
                          {isStale ? (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              ▲ STALE RATE {entry?.lastVerifiedAt ? `(${new Date(entry.lastVerifiedAt).toLocaleDateString()})` : '(Never verified)'}
                            </span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              ✓ Verified ({new Date(entry.lastVerifiedAt).toLocaleDateString()})
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          {entry?.sourceUrl ? (
                            <a
                              href={entry.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-600 hover:underline inline-flex items-center gap-1"
                            >
                              <span>Vendor URL</span>
                              <ExternalLink size={11} />
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Verify / Update Provider Pricing Form */}
            <form onSubmit={handleSaveTokenPricingRate} className="space-y-3 pt-2 border-t border-slate-200 dark:border-zinc-800">
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={editProviderKey}
                  onChange={(e) => setEditProviderKey(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                >
                  <option value="groq">groq</option>
                  <option value="gemini_direct">gemini_direct</option>
                  <option value="mistral_direct">mistral_direct</option>
                  <option value="cohere">cohere</option>
                  <option value="huggingface">huggingface</option>
                  <option value="openrouter_free">openrouter_free</option>
                  <option value="nvidia">nvidia</option>
                </select>
                <input
                  type="text"
                  required
                  value={editStandardRate}
                  onChange={(e) => setEditStandardRate(e.target.value)}
                  placeholder="Std $/1k (0.00059)"
                  className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                />
                <input
                  type="text"
                  required
                  value={editHighRate}
                  onChange={(e) => setEditHighRate(e.target.value)}
                  placeholder="High $/1k (0.00079)"
                  className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="url"
                  required
                  value={editSourceUrl}
                  onChange={(e) => setEditSourceUrl(e.target.value)}
                  placeholder="Official Vendor Pricing URL (https://...)"
                  className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                />
                <input
                  type="text"
                  required
                  value={pricingReason}
                  onChange={(e) => setPricingReason(e.target.value)}
                  placeholder="Audit Reason (e.g. Q4 vendor rate check)"
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                Verify & Save Provider Token Rate
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoldenSetTrustTab;
