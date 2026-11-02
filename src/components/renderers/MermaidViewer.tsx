import React, { useEffect, useRef, useState, useMemo, useId } from 'react';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import {
  Copy,
  Check,
  Download,
  AlertTriangle,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Compass,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import FunctionPlotViewer from './FunctionPlotViewer';
import {
  validateAndRecoverMermaidDiagram,
  type ConstrainedAiRepairFn
} from '../../services/mermaidRepairService';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: 'inherit',
  suppressErrorRendering: true,
  themeVariables: {
    fontSize: '14px',
    primaryColor: '#6366f1',
    primaryTextColor: '#1e293b',
    primaryBorderColor: '#cbd5e1',
    lineColor: '#64748b',
    secondaryColor: '#f8fafc',
    tertiaryColor: '#ffffff'
  }
});

export interface MermaidViewerProps {
  chart: string;
  aiRepairFn?: ConstrainedAiRepairFn | null;
}

export default function MermaidViewer({ chart, aiRepairFn }: MermaidViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<HTMLDivElement>(null);
  const renderSeqRef = useRef<number>(0);
  const reactInstanceId = useId().replace(/[^a-zA-Z0-9]/g, '');

  const [svgContent, setSvgContent] = useState<string>('');
  const [activeChartSource, setActiveChartSource] = useState<string>(chart);
  const [recoveryStage, setRecoveryStage] = useState<
    'original' | 'structured_spec' | 'deterministic_repair' | 'ai_repair' | 'failed' | null
  >(null);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [diagnosticDetails, setDiagnosticDetails] = useState<string>('');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showRawMermaid, setShowRawMermaid] = useState(false);

  // Detect if an LLM inappropriately generated a Mermaid quadrantChart for Cartesian geometry
  const mathQuadrantData = useMemo(() => {
    const isQuadrant = /quadrantChart/i.test(chart);
    const hasMathTerms = /(origin|circle|tangent|radius|slope|x\^2|y\^2|arc|point)/i.test(chart);
    if (!isQuadrant || !hasMathTerms) return null;
    const extractedLines: string[] = [];

    const equationMatches = chart.matchAll(/(?:[xy]\^2|f\(x\)|y\s*=)[^,\n]+/gi);
    for (const match of equationMatches) {
      extractedLines.push(match[0].trim());
    }

    const coordMatches = chart.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g);
    for (const match of coordMatches) {
      extractedLines.push(`point(${match[1]}, ${match[2]})`);
    }

    return {
      isMisused: true,
      recoveredPlotCode: extractedLines.length > 0 ? extractedLines.join('\n') : null
    };
  }, [chart]);

  useEffect(() => {
    let isCancelled = false;
    renderSeqRef.current += 1;
    const currentSeq = renderSeqRef.current;
    const renderId = `mermaid-${reactInstanceId}-${currentSeq}`;

    const clearSandboxContainer = () => {
      if (sandboxRef.current) {
        sandboxRef.current.innerHTML = '';
      }
    };

    const renderValidatedDiagram = async () => {
      const trimmedChart = (chart || '').trim();
      if (!trimmedChart) {
        if (!isCancelled) {
          setSvgContent('');
          setHasError(true);
          setRecoveryStage('failed');
          setErrorMessage(
            'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'
          );
          setDiagnosticDetails('Diagram source is empty.');
        }
        return;
      }

      if (!isCancelled) {
        setHasError(false);
        setErrorMessage('');
        setDiagnosticDetails('');
        setSvgContent('');
      }

      try {
        // Step 1: Validate via mermaid.parse() and run layered recovery if needed
        const validation = await validateAndRecoverMermaidDiagram(trimmedChart, {
          parseValidator: async (candidate: string) => {
            const res = await mermaid.parse(candidate, { suppressErrors: false });
            return Boolean(res);
          },
          ...(aiRepairFn !== undefined ? { aiRepairFn } : {})
        });

        if (isCancelled || currentSeq !== renderSeqRef.current) {
          clearSandboxContainer();
          return;
        }

        if (!validation.isValid) {
          clearSandboxContainer();
          setHasError(true);
          setRecoveryStage('failed');
          setErrorMessage(
            validation.errorMessage ||
              'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'
          );
          setDiagnosticDetails(validation.diagnosticDetails || 'Syntax validation failed.');
          return;
        }

        // Step 2: Render inside the component's own React-managed sandbox container
        clearSandboxContainer();
        const sandboxHost = sandboxRef.current || undefined;
        const { svg } = await mermaid.render(renderId, validation.chart, sandboxHost);
        clearSandboxContainer();

        if (isCancelled || currentSeq !== renderSeqRef.current) {
          return;
        }

        const cleanSvg = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true, html: true },
          ADD_TAGS: ['foreignObject']
        });

        // Guard against any residual error graphic output
        if (!cleanSvg || /Syntax error in text/i.test(cleanSvg)) {
          setHasError(true);
          setRecoveryStage('failed');
          setErrorMessage(
            'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'
          );
          setDiagnosticDetails('Renderer output failed post-render verification.');
          return;
        }

        setActiveChartSource(validation.chart);
        setRecoveryStage(validation.stage);
        setSvgContent(cleanSvg);
      } catch (err: any) {
        clearSandboxContainer();
        if (!isCancelled && currentSeq === renderSeqRef.current) {
          setHasError(true);
          setRecoveryStage('failed');
          setErrorMessage(
            'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'
          );
          setDiagnosticDetails(err?.message || String(err));
        }
      }
    };

    renderValidatedDiagram();

    return () => {
      isCancelled = true;
      clearSandboxContainer();
    };
  }, [chart, aiRepairFn, reactInstanceId]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeChartSource || chart);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `diagram-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (hasError) {
    return (
      <div
        role="region"
        aria-label="Diagram status"
        className="my-4 p-4 rounded-2xl bg-slate-50 dark:bg-zinc-900/70 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 text-xs"
      >
        <div ref={sandboxRef} className="hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-zinc-100">
              <AlertTriangle size={15} className="text-amber-500 shrink-0" />
              <span>Diagram temporarily unavailable</span>
            </div>
            <p className="text-slate-600 dark:text-zinc-400 leading-relaxed">
              {errorMessage ||
                'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowDiagnostics((prev) => !prev)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-500 dark:text-zinc-400 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-colors shrink-0"
          >
            <span>Diagnostics</span>
            {showDiagnostics ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        {showDiagnostics && (
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-zinc-800 space-y-2 font-mono text-[11px]">
            {diagnosticDetails && (
              <div className="text-amber-700 dark:text-amber-400">
                Validation diagnostic: {diagnosticDetails}
              </div>
            )}
            <pre className="p-2.5 rounded-xl bg-slate-100 dark:bg-zinc-950 overflow-x-auto whitespace-pre-wrap text-slate-600 dark:text-zinc-400">
              {chart}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="my-6 space-y-4">
      {/* Isolated React-managed offscreen host for Mermaid SVG measurement */}
      <div
        ref={sandboxRef}
        className="sr-only pointer-events-none overflow-hidden w-0 h-0"
        aria-hidden="true"
      />

      {/* If Mermaid quadrantChart was inappropriately used for Cartesian math, warn and show accurate plot */}
      {mathQuadrantData?.isMisused && (
        <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-950 dark:text-indigo-200">
          <div className="flex items-center gap-2 font-bold text-indigo-700 dark:text-indigo-300 mb-1">
            <Compass size={16} />
            <span>Academic Rigor Note: Cartesian Geometry Correction</span>
          </div>
          <p className="leading-relaxed mb-3 text-indigo-900/90 dark:text-indigo-300/90">
            Mermaid quadrant charts are designed for 2x2 conceptual matrices (e.g. SWOT analysis) and cannot represent continuous Cartesian curves, slopes, or true coordinate axes (which intersect at (0, 0)). Below is the mathematically accurate, dynamic Cartesian coordinate plot.
          </p>

          {mathQuadrantData.recoveredPlotCode && (
            <FunctionPlotViewer code={mathQuadrantData.recoveredPlotCode} />
          )}

          <div className="mt-2 flex justify-end">
            <button
              onClick={() => setShowRawMermaid(!showRawMermaid)}
              className="text-[11px] underline text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 transition-colors"
            >
              {showRawMermaid ? 'Hide original Mermaid quadrant matrix' : 'View original Mermaid quadrant matrix'}
            </button>
          </div>
        </div>
      )}

      {/* Standard Mermaid Diagram Viewer (or when toggled) */}
      {(!mathQuadrantData?.isMisused || showRawMermaid) && (
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/90 shadow-sm overflow-hidden">
          {/* Top Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-zinc-800 border-b border-slate-200 dark:border-zinc-700 text-xs font-semibold text-slate-600 dark:text-zinc-300">
            <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-indigo-600 dark:text-indigo-400">
              Visual Diagram
              {recoveryStage && recoveryStage !== 'original' && (
                <span className="text-[10px] font-normal normal-case text-slate-400 dark:text-zinc-500">
                  (Verified)
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom((z) => Math.min(z + 0.15, 2.0))}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
                title="Zoom In"
              >
                <ZoomIn size={14} />
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.15, 0.5))}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut size={14} />
              </button>
              <button
                onClick={handleDownloadSvg}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
                title="Download SVG"
              >
                <Download size={14} />
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
                title="Copy Diagram Code"
              >
                {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                <span className="text-[11px]">{copied ? 'Copied' : 'Source'}</span>
              </button>
            </div>
          </div>

          {/* SVG Canvas */}
          <div
            ref={containerRef}
            className="p-6 overflow-x-auto flex items-center justify-center min-h-[140px] bg-slate-50/50 dark:bg-zinc-900/40"
          >
            {svgContent ? (
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.15s ease-out'
                }}
                dangerouslySetInnerHTML={{ __html: svgContent }}
                className="mermaid-svg-wrapper flex justify-center max-w-full"
              />
            ) : (
              <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-zinc-500 animate-pulse">
                <RefreshCw className="animate-spin" size={14} />
                Validating and rendering visual diagram...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
