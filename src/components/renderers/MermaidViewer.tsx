import React, { useEffect, useRef, useState, useMemo } from 'react';
import mermaid from 'mermaid';
import { Copy, Check, Download, AlertTriangle, RefreshCw, ZoomIn, ZoomOut, AlertCircle, Compass } from 'lucide-react';
import FunctionPlotViewer from './FunctionPlotViewer';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: 'inherit',
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

interface MermaidViewerProps {
  chart: string;
}

export default function MermaidViewer({ chart }: MermaidViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [hasError, setHasError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showRawMermaid, setShowRawMermaid] = useState(false);

  // Detect if an LLM inappropriately generated a Mermaid quadrantChart for Cartesian geometry
  const mathQuadrantData = useMemo(() => {
    const isQuadrant = /quadrantChart/i.test(chart);
    const hasMathTerms = /(origin|circle|tangent|radius|slope|x\^2|y\^2|arc|point)/i.test(chart);
    if (!isQuadrant || !hasMathTerms) return null;
    const extractedLines: string[] = [];

    // Look for any general circle or curve equations dynamically
    const equationMatches = chart.matchAll(/(?:[xy]\^2|f\(x\)|y\s*=)[^,\n]+/gi);
    for (const match of equationMatches) {
      extractedLines.push(match[0].trim());
    }

    // Look for point coordinates dynamically: e.g. (x, y)
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
    let isMounted = true;
    const renderDiagram = async () => {
      if (!chart.trim()) return;
      const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
      try {
        setHasError(false);
        const { svg } = await mermaid.render(id, chart.trim());
        if (isMounted) {
          setSvgContent(svg);
        }
      } catch (err) {
        console.warn('Mermaid rendering failed, falling back:', err);
        if (isMounted) {
          setHasError(true);
        }
      }
    };

    renderDiagram();
    return () => {
      isMounted = false;
    };
  }, [chart]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(chart);
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
      <div className="my-4 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs font-mono">
        <div className="flex items-center gap-2 font-bold mb-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle size={16} />
          <span>Diagram Source (Raw Format)</span>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap">{chart}</pre>
      </div>
    );
  }

  return (
    <div className="my-6 space-y-4">
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
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom(z => Math.min(z + 0.15, 2.0))}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
                title="Zoom In"
              >
                <ZoomIn size={14} />
              </button>
              <button
                onClick={() => setZoom(z => Math.max(z - 0.15, 0.5))}
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
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.15s ease-out' }}
                dangerouslySetInnerHTML={{ __html: svgContent }} 
                className="mermaid-svg-wrapper flex justify-center max-w-full"
              />
            ) : (
              <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-zinc-500 animate-pulse">
                <RefreshCw className="animate-spin" size={14} />
                Rendering visual flowchart...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
