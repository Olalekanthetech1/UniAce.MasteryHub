import React, { useMemo, useState, useRef } from 'react';
import { Copy, Check, Download, Layers, ZoomIn, ZoomOut, RotateCcw, AlertCircle } from 'lucide-react';

export interface VennSet {
  name: string;
  label?: string;
  size?: number;
  elements?: (string | number)[];
  color?: string;
}

export interface VennIntersection {
  sets: string[]; // e.g. ['A', 'B'] or ['A', 'B', 'C']
  size?: number;
  elements?: (string | number)[];
  label?: string;
}

export interface VennDiagramData {
  title?: string;
  description?: string;
  sets: VennSet[];
  intersections?: VennIntersection[];
  universeSize?: number;
  universeLabel?: string;
}

interface VennDiagramViewerProps {
  code?: string;
  data?: VennDiagramData;
}

const DEFAULT_COLORS = [
  { fill: 'rgba(99, 102, 241, 0.35)', stroke: '#4f46e5', text: '#312e81', darkText: '#e0e7ff' }, // Indigo
  { fill: 'rgba(16, 185, 129, 0.35)', stroke: '#059669', text: '#064e3b', darkText: '#d1fae5' }, // Emerald
  { fill: 'rgba(245, 158, 11, 0.35)', stroke: '#d97706', text: '#78350f', darkText: '#fef3c7' }, // Amber
  { fill: 'rgba(236, 72, 153, 0.35)', stroke: '#db2777', text: '#831843', darkText: '#fce7f3' }, // Pink
];

export default function VennDiagramViewer({ code, data }: VennDiagramViewerProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Parse code strictly without static or fabricated fallback sets
  const { parsedData, parseError } = useMemo((): { parsedData: VennDiagramData | null; parseError: string | null } => {
    if (data) {
      if (!Array.isArray(data.sets) || data.sets.length < 2) {
        return { parsedData: null, parseError: 'Venn diagram data requires at least 2 sets.' };
      }
      return { parsedData: data, parseError: null };
    }
    if (!code || !code.trim()) {
      return { parsedData: null, parseError: 'Empty Venn diagram specification.' };
    }

    try {
      const trimmed = code.trim();
      if (trimmed.startsWith('{')) {
        const parsedJson = JSON.parse(trimmed);
        if (!Array.isArray(parsedJson?.sets) || parsedJson.sets.length < 2) {
          return { parsedData: null, parseError: 'JSON Venn diagram specification must define at least 2 sets.' };
        }
        return { parsedData: parsedJson, parseError: null };
      }

      const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
      let title = 'Venn Diagram';
      const sets: VennSet[] = [];
      const intersections: VennIntersection[] = [];

      for (const line of lines) {
        if (line.toLowerCase().startsWith('title:')) {
          title = line.replace(/title:/i, '').trim();
          continue;
        }

        if (line.includes('&') || line.toLowerCase().includes(' and ') || line.includes('∩')) {
          const parts = line.split(/[:=]/);
          const left = parts[0] || '';
          const right = parts[1] || '';
          const setNames = left.split(/&|\band\b|∩/i).map(s => s.trim().replace(/^Set\s+/i, ''));
          const sizeMatch = right.match(/(\d+)/);
          const elementsMatch = right.match(/\((.*?)\)/);
          const elements = elementsMatch ? elementsMatch[1].split(',').map(e => e.trim()) : undefined;

          intersections.push({
            sets: setNames,
            size: sizeMatch ? parseInt(sizeMatch[1], 10) : undefined,
            elements,
            label: setNames.join(' ∩ ')
          });
          continue;
        }

        const setMatch = line.match(/^(?:Set\s+)?([A-Za-z0-9_]+)\s*(?::|=)\s*(.+)$/i);
        if (setMatch) {
          const name = setMatch[1].trim();
          const rest = setMatch[2].trim();
          const sizeMatch = rest.match(/(\d+)/);
          const elementsMatch = rest.match(/\((.*?)\)/);
          const elements = elementsMatch ? elementsMatch[1].split(',').map(e => e.trim()) : undefined;
          let label = rest.replace(/\(.*?\)/, '').replace(/=\s*\d+/, '').trim();
          if (!label) label = `Set ${name}`;

          sets.push({
            name,
            label,
            size: sizeMatch ? parseInt(sizeMatch[1], 10) : undefined,
            elements
          });
        }
      }

      if (sets.length < 2) {
        return {
          parsedData: null,
          parseError: 'Unable to resolve at least 2 valid sets from the Venn diagram specification.'
        };
      }

      return { parsedData: { title, sets, intersections }, parseError: null };
    } catch (err: any) {
      return {
        parsedData: null,
        parseError: `Failed to parse Venn diagram syntax: ${err?.message || String(err)}`
      };
    }
  }, [code, data]);

  const activeSets = parsedData?.sets || [];
  const numSets = Math.min(Math.max(activeSets.length, 2), 3);

  // SVG Geometry Calculations
  const width = 540;
  const height = numSets === 3 ? 420 : 320;
  const radius = numSets === 3 ? 115 : 120;

  // Center coordinates for sets
  const setGeometry = useMemo(() => {
    if (numSets === 2) {
      return [
        { cx: 210, cy: 160, r: radius, name: activeSets[0]?.name || 'A' },
        { cx: 330, cy: 160, r: radius, name: activeSets[1]?.name || 'B' }
      ];
    } else {
      return [
        { cx: 210, cy: 165, r: radius, name: activeSets[0]?.name || 'A' },
        { cx: 330, cy: 165, r: radius, name: activeSets[1]?.name || 'B' },
        { cx: 270, cy: 265, r: radius, name: activeSets[2]?.name || 'C' }
      ];
    }
  }, [numSets, radius, activeSets]);

  // Label and Value Positions
  const labelPositions = useMemo(() => {
    if (!parsedData) return {};
    if (numSets === 2) {
      const setA = parsedData.sets[0];
      const setB = parsedData.sets[1];
      const interAB = parsedData.intersections?.find(i => 
        i.sets.includes(setA?.name) && i.sets.includes(setB?.name)
      );

      return {
        onlyA: { x: 155, y: 160, label: setA?.label || setA?.name, size: setA?.size, elements: setA?.elements },
        onlyB: { x: 385, y: 160, label: setB?.label || setB?.name, size: setB?.size, elements: setB?.elements },
        bothAB: { x: 270, y: 160, label: interAB?.label || `${setA?.name} ∩ ${setB?.name}`, size: interAB?.size, elements: interAB?.elements }
      };
    } else {
      const setA = parsedData.sets[0];
      const setB = parsedData.sets[1];
      const setC = parsedData.sets[2];

      const interAB = parsedData.intersections?.find(i => i.sets.length === 2 && i.sets.includes(setA?.name) && i.sets.includes(setB?.name));
      const interAC = parsedData.intersections?.find(i => i.sets.length === 2 && i.sets.includes(setA?.name) && i.sets.includes(setC?.name));
      const interBC = parsedData.intersections?.find(i => i.sets.length === 2 && i.sets.includes(setB?.name) && i.sets.includes(setC?.name));
      const interABC = parsedData.intersections?.find(i => i.sets.length === 3 || (i.sets.includes(setA?.name) && i.sets.includes(setB?.name) && i.sets.includes(setC?.name)));

      return {
        onlyA: { x: 160, y: 135, label: setA?.label || setA?.name, size: setA?.size, elements: setA?.elements },
        onlyB: { x: 380, y: 135, label: setB?.label || setB?.name, size: setB?.size, elements: setB?.elements },
        onlyC: { x: 270, y: 345, label: setC?.label || setC?.name, size: setC?.size, elements: setC?.elements },
        interAB: { x: 270, y: 135, label: interAB?.label || `${setA?.name} ∩ ${setB?.name}`, size: interAB?.size, elements: interAB?.elements },
        interAC: { x: 210, y: 235, label: interAC?.label || `${setA?.name} ∩ ${setC?.name}`, size: interAC?.size, elements: interAC?.elements },
        interBC: { x: 330, y: 235, label: interBC?.label || `${setB?.name} ∩ ${setC?.name}`, size: interBC?.size, elements: interBC?.elements },
        interABC: { x: 270, y: 205, label: interABC?.label || `${setA?.name} ∩ ${setB?.name} ∩ ${setC?.name}`, size: interABC?.size, elements: interABC?.elements }
      };
    }
  }, [numSets, parsedData]);

  if (parseError || !parsedData) {
    return (
      <div className="my-4 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-mono">
        <div className="flex items-center gap-2 font-bold mb-1">
          <AlertCircle size={15} />
          <span>Venn Diagram Specification Error</span>
        </div>
        <p className="mb-2">{parseError || 'Invalid Venn diagram data'}</p>
        {code && <pre className="p-3 bg-white/70 dark:bg-black/40 rounded-xl overflow-x-auto text-[11px]">{code}</pre>}
      </div>
    );
  }

  const handleCopyCode = async () => {
    const exportText = code || JSON.stringify(parsedData, null, 2);
    await navigator.clipboard.writeText(exportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSvg = () => {
    const svgEl = document.getElementById(`venn-svg-${parsedData.title?.replace(/\s+/g, '-') || 'diagram'}`);
    if (!svgEl) return;

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `venn-diagram-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-6 rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/90 shadow-sm overflow-hidden">
      {/* Header Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-zinc-800 border-b border-slate-200 dark:border-zinc-700 text-xs font-semibold text-slate-600 dark:text-zinc-300">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-indigo-600 dark:text-indigo-400" />
          <span className="font-bold text-slate-900 dark:text-zinc-100 text-[12px]">
            {parsedData.title || 'Venn Diagram'}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-medium border border-indigo-200 dark:border-indigo-800">
            {numSets}-Set Overlap
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(z => Math.min(z + 0.15, 1.8))}
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
            <RotateCcw size={13} />
          </button>
          <button
            onClick={handleDownloadSvg}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
            title="Download SVG"
          >
            <Download size={14} />
          </button>
          <button
            onClick={handleCopyCode}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors text-[11px]"
            title="Copy Diagram Source"
          >
            {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Source'}</span>
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="p-4 sm:p-6 flex items-center justify-center overflow-x-auto bg-slate-50/40 dark:bg-zinc-900/50">
        <div 
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.15s ease-out' }}
          className="w-full max-w-[540px] flex justify-center"
        >
          <div ref={chartRef} className="venn-diagram-container w-full flex justify-center">
            <svg
              id={`venn-svg-${parsedData.title?.replace(/\s+/g, '-') || 'diagram'}`}
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto max-h-[420px] select-none"
            >
              {/* Overlapping Circles */}
              {setGeometry.map((geom, idx) => {
                const col = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
                return (
                  <circle
                    key={geom.name}
                    cx={geom.cx}
                    cy={geom.cy}
                    r={geom.r}
                    fill={col.fill}
                    stroke={col.stroke}
                    strokeWidth="2.5"
                    className="transition-all duration-200"
                  />
                );
              })}

              {/* Set Labels and Cardinality */}
              {Object.entries(labelPositions).map(([key, pos]: [string, any]) => (
                <g key={key} className="transition-all duration-150 pointer-events-none">
                  <text
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    className="font-bold text-xs fill-slate-900 dark:fill-zinc-100"
                  >
                    {pos.label}
                  </text>
                  {pos.size !== undefined && (
                    <text
                      x={pos.x}
                      y={pos.y + 16}
                      textAnchor="middle"
                      className="font-mono text-[11px] fill-slate-600 dark:fill-zinc-400"
                    >
                      ({pos.size})
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        </div>
      </div>

      {/* Legend & Elements Breakdown */}
      {parsedData.sets.some(s => s.elements && s.elements.length > 0) && (
        <div className="px-4 py-3 bg-slate-50/70 dark:bg-zinc-800/80 border-t border-slate-200 dark:border-zinc-700 flex flex-wrap gap-4 text-xs">
          {parsedData.sets.map((s, idx) => (
            <div key={s.name} className="flex items-start gap-2">
              <span 
                className="w-3 h-3 rounded-full mt-0.5 shrink-0" 
                style={{ backgroundColor: DEFAULT_COLORS[idx % DEFAULT_COLORS.length].stroke }}
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-zinc-200">{s.label || s.name}:</span>{' '}
                <span className="text-slate-600 dark:text-zinc-400 font-mono text-[11px]">
                  {s.elements?.join(', ') || 'No listed elements'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
