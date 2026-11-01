import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Calculator, 
  Cpu, 
  Play, 
  Save, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Zap, 
  Layers, 
  BarChart3,
  Activity,
  Sliders,
  Check,
  Copy
} from 'lucide-react';
import MarkdownRenderer from '../MarkdownRenderer';
import { auth } from '../../firebase';

interface MathStep {
  title: string;
  latex: string;
  explanation: string;
}

interface MathTestResponse {
  success: boolean;
  resultLatex: string;
  resultPlain: string;
  steps: MathStep[];
  engineUsed: string;
  latencyMs: number;
  error?: string;
  astAnalysis?: {
    complexity: number;
    variables: string[];
    operations: string[];
  };
}

interface MathConfig {
  defaultEngine: 'sympy_local' | 'wolfram_cloud' | 'smart_hybrid';
  timeoutMs: number;
  defaultRigor: 'granular' | 'concise';
  wolframAppId?: string;
  enableAutoHeuristic: boolean;
  maxMatrixDimension: number;
}

interface MathStats {
  totalComputations: number;
  avgLatencyMs: number;
  successRate: number;
  operationDistribution: Record<string, number>;
  activeEngine: string;
  recentEvents: Array<{
    id: string;
    timestamp: string;
    operation: string;
    query: string;
    engineUsed: string;
    latencyMs: number;
    success: boolean;
  }>;
}



export default function MathEngineTab() {
  // Configuration State
  const [config, setConfig] = useState<MathConfig | null>(null);
  const [configDraft, setConfigDraft] = useState<Partial<MathConfig>>({});
  const [configError, setConfigError] = useState<string | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSaveSuccess, setConfigSaveSuccess] = useState(false);

  // Sandbox State
  const [selectedOp, setSelectedOp] = useState<'derivative' | 'integral' | 'solve_equation' | 'ode' | 'matrix_operations' | 'simplify'>('derivative');
  const [expression, setExpression] = useState('');
  const [variable, setVariable] = useState('');
  const [lowerBound, setLowerBound] = useState('');
  const [upperBound, setUpperBound] = useState('');
  const [matrixAStr, setMatrixAStr] = useState('');
  const [matrixOp, setMatrixOp] = useState<'determinant' | 'inverse' | 'multiply' | 'transpose'>('determinant');

  // Execution & Diagnostics
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testResult, setTestResult] = useState<MathTestResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [copiedLatex, setCopiedLatex] = useState(false);

  // Telemetry & Stats
  const [stats, setStats] = useState<MathStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // Fetch initial config & telemetry
  const fetchMathData = async () => {
    setIsLoadingStats(true);
    setIsLoadingConfig(true);
    setConfigError(null);
    const idToken = await auth.currentUser?.getIdToken().catch(() => undefined);
    const headers = idToken ? { Authorization: `Bearer ${idToken}` } : undefined;

    try {
      const configRes = await fetch('/api/admin/math-config', { headers, cache: 'no-store' });
      if (!configRes.ok) throw new Error(`Math Engine configuration request failed with HTTP ${configRes.status}.`);
      const cfgData = await configRes.json();
      const valid = cfgData &&
        ['sympy_local', 'wolfram_cloud', 'smart_hybrid'].includes(cfgData.defaultEngine) &&
        ['granular', 'concise'].includes(cfgData.defaultRigor) &&
        Number.isFinite(cfgData.timeoutMs) && cfgData.timeoutMs > 0 &&
        typeof cfgData.enableAutoHeuristic === 'boolean' &&
        Number.isInteger(cfgData.maxMatrixDimension) && cfgData.maxMatrixDimension > 0;
      if (!valid) throw new Error('Stored Math Engine configuration is missing required verified fields.');
      setConfig(cfgData as MathConfig);
    } catch (error) {
      setConfig(null);
      setConfigError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingConfig(false);
    }

    try {
      const statsRes = await fetch('/api/math/stats', { headers, cache: 'no-store' });
      if (!statsRes.ok) throw new Error(`Math Engine telemetry request failed with HTTP ${statsRes.status}.`);
      setStats(await statsRes.json());
    } catch (error) {
      setStats(null);
      console.warn('[MathEngineTab] Live telemetry unavailable:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  useEffect(() => {
    fetchMathData();
  }, []);

  // Save Configuration Handler
  const handleSaveConfig = async () => {
    const candidate = config || configDraft;
    const validCandidate =
      ['sympy_local', 'wolfram_cloud', 'smart_hybrid'].includes(String(candidate.defaultEngine)) &&
      ['granular', 'concise'].includes(String(candidate.defaultRigor)) &&
      Number.isFinite(candidate.timeoutMs) && Number(candidate.timeoutMs) > 0 &&
      typeof candidate.enableAutoHeuristic === 'boolean' &&
      Number.isInteger(candidate.maxMatrixDimension) && Number(candidate.maxMatrixDimension) > 0;
    if (!validCandidate) {
      setConfigError('Complete every required setting with an explicit value before saving.');
      return;
    }
    setIsSavingConfig(true);
    setConfigSaveSuccess(false);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Administrator authentication is required to update Math Engine configuration.');
      const res = await fetch('/api/admin/math-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify(candidate)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to save configuration (HTTP ${res.status}).`);
      }
      const result = await res.json();
      if (!result?.config) throw new Error('The server did not confirm the persisted Math Engine configuration.');
      setConfig(result.config);
      setConfigDraft(result.config);
      setConfigError(null);
      setConfigSaveSuccess(true);
      setTimeout(() => setConfigSaveSuccess(false), 3500);
    } catch (err: any) {
      alert(err.message || 'Network error saving configuration');
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Run Sandbox Test
  const handleRunSandboxTest = async () => {
    if (!config) {
      setTestError(configError || 'The live Math Engine configuration is unavailable.');
      return;
    }
    if (selectedOp !== 'matrix_operations' && (!expression.trim() || !variable.trim())) {
      setTestError('Enter the actual mathematical expression and independent variable before running a test.');
      return;
    }
    if (selectedOp === 'matrix_operations' && !matrixAStr.trim()) {
      setTestError('Enter the actual matrix before running a test.');
      return;
    }
    setIsRunningTest(true);
    setTestError(null);
    setTestResult(null);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      let matrixPayload: number[][] | undefined = undefined;

      if (selectedOp === 'matrix_operations') {
        try {
          matrixPayload = JSON.parse(matrixAStr);
          if (!Array.isArray(matrixPayload) || !Array.isArray(matrixPayload[0])) {
            throw new Error('Matrix format must be a 2D JSON array, e.g. [[1, 2], [3, 4]]');
          }
        } catch (e: any) {
          throw new Error(`Invalid Matrix Syntax: ${e.message}`);
        }
      }

      const payload: any = {
        operation: selectedOp,
        expression,
        variable,
        rigorLevel: config.defaultRigor,
        matrixOp
      };

      if (selectedOp === 'integral' && lowerBound !== '' && upperBound !== '') {
        payload.bounds = { lower: lowerBound, upper: upperBound };
      }

      if (selectedOp === 'matrix_operations' && matrixPayload) {
        payload.matrixA = matrixPayload;
      }

      const res = await fetch('/api/math/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setTestError(data.error || 'Symbolic calculation test failed.');
      } else {
        setTestResult(data);
      }

      // Refresh telemetry stats after calculation
      fetchMathData();
    } catch (err: any) {
      setTestError(err.message || 'Failed to execute calculation sandbox.');
    } finally {
      setIsRunningTest(false);
    }
  };



  const handleCopyLatex = (latex: string) => {
    navigator.clipboard.writeText(latex);
    setCopiedLatex(true);
    setTimeout(() => setCopiedLatex(false), 2000);
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-indigo-900/90 via-slate-900 to-slate-900 p-8 rounded-3xl border border-indigo-500/20 text-white shadow-xl">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-500/20 rounded-2xl border border-indigo-400/30 text-indigo-400">
              <Calculator size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
                Math & Scientific MCP Engine
                <span className="text-xs px-2.5 py-1 rounded-full bg-slate-500/20 text-slate-200 font-bold border border-slate-500/30">
                  {config ? 'Live Configuration Loaded' : 'Configuration Not Verified'}
                </span>
              </h2>
              <p className="text-sm text-indigo-200/80">
                Symbolic mathematics execution, KaTeX rendering, and recorded calculation telemetry.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchMathData}
            disabled={isLoadingStats}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs transition-all border border-white/10 disabled:opacity-50"
          >
            <RefreshCw size={14} className={isLoadingStats ? 'animate-spin' : ''} />
            Refresh Telemetry
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Total Computations</span>
            <Activity size={18} className="text-indigo-500" />
          </div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">
            {stats ? stats.totalComputations : '—'}
          </div>
          <p className="text-[11px] text-slate-500">Live symbolic requests audited</p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Avg Latency</span>
            <Clock size={18} className="text-emerald-500" />
          </div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">
            {stats?.avgLatencyMs ?? '—'} <span className="text-sm font-normal text-slate-500">ms</span>
          </div>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Mean latency across returned telemetry events</p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Accuracy & Success</span>
            <CheckCircle2 size={18} className="text-blue-500" />
          </div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">
            {stats?.successRate == null ? '—' : `${stats.successRate}%`}
          </div>
          <p className="text-[11px] text-slate-500">Success rate recorded by the Math Engine</p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Active Architecture</span>
            <Cpu size={18} className="text-purple-500" />
          </div>
          <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
            {stats?.activeEngine || config?.defaultEngine || 'Not verified'}
          </div>
          <p className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold">Configured computation engine</p>
        </div>
      </div>

      {/* Main Two-Column Layout: Configuration Panel & Interactive Sandbox */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Engine Settings & Parameters (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          {config ? (
          <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-4">
              <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-base">
                <Sliders size={18} className="text-indigo-500" />
                Engine Parameters
              </h3>
              {configSaveSuccess && (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg">
                  <Check size={12} /> Saved
                </span>
              )}
            </div>

            {/* Default Engine Selector */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Primary Computation Engine
              </label>
              <select
                value={config.defaultEngine}
                onChange={(e) => setConfig(current => current ? { ...current, defaultEngine: e.target.value as any } : current)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="smart_hybrid">Smart Hybrid (SymPy Local + Wolfram Fallback)</option>
                <option value="sympy_local">SymPy / MathJS Symbolic (Local Zero-Cost)</option>
                <option value="wolfram_cloud">Wolfram Alpha API (Cloud Only)</option>
              </select>
              <p className="text-[11px] text-slate-500">
                Hybrid routing solves high-speed calculus locally and routes edge physics queries to Wolfram.
              </p>
            </div>

            {/* Computation Timeout Slider */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <span>Calculation Timeout</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-mono">{(config.timeoutMs / 1000).toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min="1000"
                max="10000"
                step="500"
                value={config.timeoutMs}
                onChange={(e) => setConfig(current => current ? { ...current, timeoutMs: Number(e.target.value) } : current)}
                className="w-full accent-indigo-600 h-2 bg-slate-100 dark:bg-slate-700 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>1.0s (Fast)</span>
                <span>5.0s (Balanced)</span>
                <span>10.0s (Deep Proofs)</span>
              </div>
            </div>

            {/* Pedagogical Step Rigor */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Default Derivation Rigor
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfig(current => current ? { ...current, defaultRigor: 'granular' } : current)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                    config.defaultRigor === 'granular'
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-500 text-indigo-700 dark:text-indigo-300 shadow-sm'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  🎓 Multi-Step (Pedagogical)
                </button>
                <button
                  type="button"
                  onClick={() => setConfig(current => current ? { ...current, defaultRigor: 'concise' } : current)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                    config.defaultRigor === 'concise'
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-500 text-indigo-700 dark:text-indigo-300 shadow-sm'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  ⚡ Concise Final
                </button>
              </div>
            </div>

            {/* Wolfram Alpha Key Config */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Wolfram Alpha App ID (Optional)
              </label>
              <input
                type="password"
                placeholder="e.g. 26X9-XXXX-XXXX"
                value={config.wolframAppId || ''}
                onChange={(e) => setConfig(current => current ? { ...current, wolframAppId: e.target.value } : current)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
              />
              <p className="text-[11px] text-slate-500">
                Used when the configured computation engine invokes Wolfram Alpha.
              </p>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveConfig}
              disabled={isSavingConfig}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSavingConfig ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <Save size={16} />
              )}
              {isSavingConfig ? 'Saving Parameters...' : 'Save Configuration'}
            </button>
          </div>

          ) : (
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-amber-200 dark:border-amber-900 shadow-sm space-y-4">
              <div className="space-y-2">
                <h3 className="font-bold text-slate-900 dark:text-white">Math Engine configuration unavailable</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">{configError || (isLoadingConfig ? 'Loading stored Math Engine configuration…' : 'No persisted Math Engine configuration was returned.')}</p>
                <p className="text-xs text-slate-500">Enter the settings that your institution has selected. No engine, timeout, rigor level, heuristic policy or matrix limit is preselected.</p>
              </div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Computation engine
                <select
                  value={configDraft.defaultEngine || ''}
                  onChange={e => setConfigDraft(current => ({ ...current, defaultEngine: (e.target.value || undefined) as MathConfig['defaultEngine'] | undefined }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                >
                  <option value="">Select configured engine…</option>
                  <option value="sympy_local">SymPy local</option>
                  <option value="wolfram_cloud">Wolfram Cloud</option>
                  <option value="smart_hybrid">Smart Hybrid</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Timeout (milliseconds)
                <input type="number" min="1" step="1" value={configDraft.timeoutMs ?? ''} onChange={e => setConfigDraft(current => ({ ...current, timeoutMs: e.target.value === '' ? undefined : Number(e.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2" placeholder="Enter timeout" />
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Derivation rigor
                <select value={configDraft.defaultRigor || ''} onChange={e => setConfigDraft(current => ({ ...current, defaultRigor: (e.target.value || undefined) as MathConfig['defaultRigor'] | undefined }))} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2">
                  <option value="">Select derivation rigor…</option>
                  <option value="granular">Granular</option>
                  <option value="concise">Concise</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Automatic heuristic policy
                <select value={configDraft.enableAutoHeuristic === undefined ? '' : String(configDraft.enableAutoHeuristic)} onChange={e => setConfigDraft(current => ({ ...current, enableAutoHeuristic: e.target.value === '' ? undefined : e.target.value === 'true' }))} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2">
                  <option value="">Select policy…</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Maximum matrix dimension
                <input type="number" min="1" step="1" value={configDraft.maxMatrixDimension ?? ''} onChange={e => setConfigDraft(current => ({ ...current, maxMatrixDimension: e.target.value === '' ? undefined : Number(e.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2" placeholder="Enter matrix limit" />
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Wolfram App ID (only when configured for use)
                <input type="password" autoComplete="off" value={configDraft.wolframAppId || ''} onChange={e => setConfigDraft(current => ({ ...current, wolframAppId: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2" placeholder="Optional credential" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button onClick={handleSaveConfig} disabled={isSavingConfig || isLoadingConfig} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">
                  {isSavingConfig ? 'Saving…' : 'Save explicitly entered configuration'}
                </button>
                <button onClick={fetchMathData} disabled={isLoadingConfig} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-semibold disabled:opacity-50">
                  Refresh from database
                </button>
              </div>
            </div>

          )}
        </div>

        {/* Right Column: Live Diagnostic Sandbox & KaTeX Viewer (8 Cols) */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700 pb-4">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-lg">
                  <Play size={20} className="text-indigo-500 fill-indigo-500" />
                  Deterministic Math Sandbox
                </h3>
                <p className="text-xs text-slate-500">
                  Test and verify symbolic expressions with immediate KaTeX rendering and telemetry.
                </p>
              </div>

              {/* Operation Selector Tabs */}
              <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
                {[
                  { id: 'derivative', label: 'd/dx' },
                  { id: 'integral', label: '∫ dx' },
                  { id: 'solve_equation', label: 'Roots f(x)=0' },
                  { id: 'ode', label: 'ODE y(x)' },
                  { id: 'matrix_operations', label: 'Matrix' },
                  { id: 'simplify', label: 'Simplify' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setSelectedOp(tab.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      selectedOp === tab.id
                        ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sandbox Inputs */}
            {selectedOp !== 'matrix_operations' ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
                    Mathematical Expression / Equation
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={expression}
                      onChange={(e) => setExpression(e.target.value)}
                      placeholder="Enter an actual mathematical expression"
                      className="flex-1 px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <div className="w-24">
                      <input
                        type="text"
                        value={variable}
                        onChange={(e) => setVariable(e.target.value)}
                        placeholder="Independent variable"
                        className="w-full px-3 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-center"
                        title="Independent Variable"
                      />
                    </div>
                  </div>
                </div>

                {/* Optional Bounds for Definite Integral */}
                {selectedOp === 'integral' && (
                  <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 flex flex-wrap items-center gap-4">
                    <span className="text-xs font-bold text-indigo-900 dark:text-indigo-300">
                      Definite Integral Bounds (Optional):
                    </span>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500 font-mono">Lower a:</span>
                      <input
                        type="text"
                        value={lowerBound}
                        onChange={(e) => setLowerBound(e.target.value)}
                        placeholder="Lower bound"
                        className="w-16 px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-center font-mono text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500 font-mono">Upper b:</span>
                      <input
                        type="text"
                        value={upperBound}
                        onChange={(e) => setUpperBound(e.target.value)}
                        placeholder="Upper bound"
                        className="w-16 px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-center font-mono text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Matrix Operations Input */
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
                      Input Matrix A (JSON 2D Array)
                    </label>
                    <input
                      type="text"
                      value={matrixAStr}
                      onChange={(e) => setMatrixAStr(e.target.value)}
                      placeholder="Enter a matrix as JSON"
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div className="w-48">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
                      Operation
                    </label>
                    <select
                      value={matrixOp}
                      onChange={(e) => setMatrixOp(e.target.value as any)}
                      className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 outline-none"
                    >
                      <option value="determinant">Determinant det(A)</option>
                      <option value="inverse">Inverse A⁻¹</option>
                      <option value="transpose">Transpose Aᵀ</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Run Button */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleRunSandboxTest}
                disabled={isRunningTest || !config || (!expression.trim() && selectedOp !== 'matrix_operations') || (!variable.trim() && selectedOp !== 'matrix_operations') || (selectedOp === 'matrix_operations' && !matrixAStr.trim())}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isRunningTest ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Zap size={16} />
                )}
                {isRunningTest ? 'Evaluating Symbolic AST...' : 'Run Symbolic Test'}
              </button>
            </div>

            {/* Error Message */}
            {testError && (
              <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-sm flex items-start gap-3">
                <AlertCircle size={20} className="shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Computation Error</div>
                  <div className="text-xs font-mono mt-1">{testError}</div>
                </div>
              </div>
            )}

            {/* Calculation Result Display */}
            {testResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6 pt-4 border-t border-slate-100 dark:border-slate-700"
              >
                {/* Status & Latency Badge */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 bg-slate-50 dark:bg-slate-900/80 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                      <CheckCircle2 size={16} />
                      Deterministic Result Verified
                    </span>
                    <span className="text-slate-400 font-mono">|</span>
                    <span className="text-slate-600 dark:text-slate-300 font-mono font-bold">
                      ⚡ {testResult.latencyMs}ms
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-bold border border-indigo-200 dark:border-indigo-800 text-[11px]">
                      {testResult.engineUsed}
                    </span>
                    <button
                      onClick={() => handleCopyLatex(testResult.resultLatex)}
                      className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors text-slate-500"
                      title="Copy LaTeX"
                    >
                      {copiedLatex ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                {/* Final KaTeX Solution Display */}
                <div className="p-6 bg-indigo-50/40 dark:bg-slate-900/60 rounded-3xl border border-indigo-100 dark:border-indigo-900/40 space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Final Mathematical Solution
                  </div>
                  <div className="text-lg overflow-x-auto py-2">
                    <MarkdownRenderer content={`$$${testResult.resultLatex}$$`} />
                  </div>
                </div>

                {/* Step-by-Step Derivation Breakdown */}
                {testResult.steps && testResult.steps.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Layers size={16} className="text-indigo-500" />
                      Pedagogical Step Derivations ({testResult.steps.length} Steps)
                    </h4>
                    <div className="space-y-3">
                      {testResult.steps.map((step, idx) => (
                        <div
                          key={idx}
                          className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2"
                        >
                          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                            <span className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-[10px]">
                                {idx + 1}
                              </span>
                              {step.title}
                            </span>
                          </div>
                          <div className="overflow-x-auto py-1">
                            <MarkdownRenderer content={`$$${step.latex}$$`} />
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {step.explanation}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </div>

          {/* Real-Time Audit Log Table */}
          <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-base">
                <BarChart3 size={18} className="text-indigo-500" />
                Live Calculation Audit Stream
              </h3>
              <span className="text-xs text-slate-400">
                {stats?.recentEvents.length || 0} Recent Events
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700 text-slate-400 font-bold uppercase tracking-wider">
                    <th className="pb-3">Timestamp</th>
                    <th className="pb-3">Operation</th>
                    <th className="pb-3">Query</th>
                    <th className="pb-3">Latency</th>
                    <th className="pb-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 font-mono">
                  {stats?.recentEvents && stats.recentEvents.length > 0 ? (
                    stats.recentEvents.slice(0, 10).map((evt) => (
                      <tr key={evt.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                        <td className="py-2.5 text-slate-500 text-[11px]">
                          {new Date(evt.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2.5">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[10px] uppercase">
                            {evt.operation}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                          {evt.query}
                        </td>
                        <td className="py-2.5 text-indigo-600 dark:text-indigo-400">
                          {evt.latencyMs}ms
                        </td>
                        <td className="py-2.5">
                          {evt.success ? (
                            <span className="text-emerald-500 font-bold">● OK</span>
                          ) : (
                            <span className="text-rose-500 font-bold">● ERR</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400 font-sans">
                        No recent calculation events recorded yet. Run a sandbox test above!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
