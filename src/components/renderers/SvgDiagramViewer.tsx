import React, { useMemo, useState } from 'react';
import { Compass, ZoomIn, ZoomOut, RotateCcw, Copy, Check, Download, Code2, Eye, AlertCircle } from 'lucide-react';

interface SvgDiagramViewerProps {
  code: string;
}

/**
 * Sanitizes and extracts raw SVG from incoming code blocks.
 * Enforces security by stripping executable scripts and event handlers.
 */
function sanitizeSvg(rawSvg: string): { cleanSvg: string; error?: string } {
  if (!rawSvg || typeof rawSvg !== 'string') {
    return { cleanSvg: '', error: 'Empty diagram content' };
  }

  // 1. Extract SVG block if wrapped in markdown or extraneous text
  let svgContent = rawSvg.trim();
  const svgMatch = svgContent.match(/<svg[\s\S]*?<\/svg>/i);
  if (svgMatch) {
    svgContent = svgMatch[0];
  } else if (!svgContent.startsWith('<svg')) {
    return { cleanSvg: '', error: 'Valid <svg> element not found in diagram block' };
  }

  // 2. Strip dangerous script elements and malicious event handlers
  svgContent = svgContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\shref\s*=\s*["']javascript:[^"']*["']/gi, '')
    .replace(/\sxlink:href\s*=\s*["']javascript:[^"']*["']/gi, '');

  // 3. Ensure responsive viewBox if missing
  if (!/viewBox\s*=/i.test(svgContent)) {
    const widthMatch = svgContent.match(/width\s*=\s*["']?(\d+)/i);
    const heightMatch = svgContent.match(/height\s*=\s*["']?(\d+)/i);
    const w = widthMatch ? parseInt(widthMatch[1], 10) : 600;
    const h = heightMatch ? parseInt(heightMatch[1], 10) : 400;
    svgContent = svgContent.replace(/<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }

  // 4. Ensure width="100%" and height="auto" for crisp responsive rendering
  if (!/style\s*=/i.test(svgContent)) {
    svgContent = svgContent.replace(/<svg/i, '<svg style="width: 100%; height: auto; max-height: 480px; display: block; margin: 0 auto;"');
  }

  return { cleanSvg: svgContent };
}

export default function SvgDiagramViewer({ code }: SvgDiagramViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);

  const { cleanSvg, error } = useMemo(() => sanitizeSvg(code), [code]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(cleanSvg || code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleDownload = () => {
    if (!cleanSvg) return;
    const blob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `geometry-diagram-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="my-4 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-mono">
        <div className="flex items-center gap-2 font-bold mb-1">
          <AlertCircle size={15} />
          <span>Diagram Render Error</span>
        </div>
        <p className="mb-2">{error}</p>
        <pre className="p-3 bg-white/70 dark:bg-black/40 rounded-xl overflow-x-auto text-[11px]">{code}</pre>
      </div>
    );
  }

  return (
    <div className="my-6 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden transition-all">
      {/* Header Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-zinc-800/80 border-b border-slate-200 dark:border-zinc-800 text-xs">
        <div className="flex items-center gap-2">
          <Compass size={15} className="text-indigo-600 dark:text-indigo-400" />
          <span className="font-bold uppercase tracking-wider text-[11px] text-slate-800 dark:text-zinc-200">
            Geometric & Analytical Diagram
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(z => Math.min(z + 0.15, 2.2))}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() => setZoom(z => Math.max(z - 0.15, 0.6))}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
            title="Reset Zoom"
          >
            <RotateCcw size={14} />
          </button>

          <div className="w-[1px] h-4 bg-slate-200 dark:bg-zinc-700 mx-1" />

          <button
            onClick={() => setShowSource(!showSource)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors text-[11px] font-medium ${
              showSource 
                ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' 
                : 'hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300'
            }`}
            title="Toggle Source Code"
          >
            {showSource ? <Eye size={13} /> : <Code2 size={13} />}
            <span>{showSource ? 'Preview' : 'Source'}</span>
          </button>

          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
            title="Copy SVG Code"
          >
            {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
          </button>

          <button
            onClick={handleDownload}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
            title="Download SVG"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* Main Canvas / Code View */}
      {showSource ? (
        <div className="p-4 bg-slate-900 text-slate-100 font-mono text-xs overflow-x-auto max-h-96">
          <pre className="whitespace-pre-wrap">{cleanSvg}</pre>
        </div>
      ) : (
        <div className="p-6 flex items-center justify-center overflow-auto bg-slate-50/50 dark:bg-zinc-950/60 min-h-[260px]">
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.15s ease-out' }}
            className="w-full max-w-xl transition-transform flex items-center justify-center select-none"
            dangerouslySetInnerHTML={{ __html: cleanSvg }}
          />
        </div>
      )}
    </div>
  );
}
