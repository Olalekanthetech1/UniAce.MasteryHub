import React, { useEffect, useRef, useState } from 'react';
import functionPlot from 'function-plot';
import { Activity, ZoomIn, ZoomOut, RotateCcw, AlertCircle } from 'lucide-react';

interface FunctionPlotViewerProps {
  code: string;
}

interface PlotItem {
  datum: any;
  label: string;
  color: string;
}

export default function FunctionPlotViewer({ code }: FunctionPlotViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [plotLegends, setPlotLegends] = useState<{ label: string; color: string }[]>([]);
  const [xDomain, setXDomain] = useState<[number, number]>([-10, 10]);
  const [yDomain, setYDomain] = useState<[number, number]>([-10, 10]);
  const [initialDomain, setInitialDomain] = useState<[number, number]>([-10, 10]);

  useEffect(() => {
    if (!containerRef.current) return;
    setError(null);

    const cleanLines = code
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));

    if (cleanLines.length === 0) return;

    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444'];
    const items: PlotItem[] = [];
    let dynamicMaxExtent = 5;

    cleanLines.forEach((line, idx) => {
      const color = colors[idx % colors.length];

      // 1. Dynamic Check: Standard Circle with any dynamic radius R (x^2 + y^2 = R or A*x^2 + A*y^2 = C)
      const standardCircle = line.match(/^(?:(\d+(?:\.\d+)?)\s*\*?\s*)?x\^2\s*\+\s*(?:(\d+(?:\.\d+)?)\s*\*?\s*)?y\^2\s*=\s*(\d+(?:\.\d+)?)/i);
      if (standardCircle) {
        const coefA = standardCircle[1] ? parseFloat(standardCircle[1]) : 1;
        const coefB = standardCircle[2] ? parseFloat(standardCircle[2]) : coefA;
        const constC = parseFloat(standardCircle[3]);
        if (coefA > 0 && coefA === coefB && constC > 0) {
          const r = Math.sqrt(constC / coefA);
          dynamicMaxExtent = Math.max(dynamicMaxExtent, r * 1.3);
          items.push({
            datum: {
              x: `${r} * cos(t)`,
              y: `${r} * sin(t)`,
              fnType: 'parametric',
              graphType: 'polyline',
              color
            },
            label: `Circle: radius = ${r % 1 === 0 ? r : r.toFixed(2)}`,
            color
          });
          return;
        }
      }

      // 2. Dynamic Check: Shifted Circle (x - h)^2 + (y - k)^2 = R with any real h, k, R
      const shiftedCircle = line.match(/^\(x\s*([+-]\s*\d+(?:\.\d+)?)\)\^2\s*\+\s*\(y\s*([+-]\s*\d+(?:\.\d+)?)\)\^2\s*=\s*(\d+(?:\.\d+)?)/i);
      if (shiftedCircle) {
        const h = -parseFloat(shiftedCircle[1].replace(/\s+/g, ''));
        const k = -parseFloat(shiftedCircle[2].replace(/\s+/g, ''));
        const rSq = parseFloat(shiftedCircle[3]);
        if (rSq > 0) {
          const r = Math.sqrt(rSq);
          dynamicMaxExtent = Math.max(dynamicMaxExtent, Math.abs(h) + r * 1.3, Math.abs(k) + r * 1.3);
          items.push({
            datum: {
              x: `${h} + ${r} * cos(t)`,
              y: `${k} + ${r} * sin(t)`,
              fnType: 'parametric',
              graphType: 'polyline',
              color
            },
            label: `Circle at (${h}, ${k}), r = ${r % 1 === 0 ? r : r.toFixed(2)}`,
            color
          });
          return;
        }
      }

      // 3. Dynamic Check: Ellipse: (x - h)^2 / A + (y - k)^2 / B = 1
      const ellipseMatch = line.match(/^(?:(?:\(x\s*([+-]\s*\d+(?:\.\d+)?)\)\^2|x\^2)\s*\/\s*(\d+(?:\.\d+)?))\s*\+\s*(?:(?:\(y\s*([+-]\s*\d+(?:\.\d+)?)\)\^2|y\^2)\s*\/\s*(\d+(?:\.\d+)?))\s*=\s*1/i);
      if (ellipseMatch) {
        const h = ellipseMatch[1] ? -parseFloat(ellipseMatch[1].replace(/\s+/g, '')) : 0;
        const a = Math.sqrt(parseFloat(ellipseMatch[2]));
        const k = ellipseMatch[3] ? -parseFloat(ellipseMatch[3].replace(/\s+/g, '')) : 0;
        const b = Math.sqrt(parseFloat(ellipseMatch[4]));
        dynamicMaxExtent = Math.max(dynamicMaxExtent, Math.abs(h) + a * 1.3, Math.abs(k) + b * 1.3);
        items.push({
          datum: {
            x: `${h} + ${a} * cos(t)`,
            y: `${k} + ${b} * sin(t)`,
            fnType: 'parametric',
            graphType: 'polyline',
            color
          },
          label: `Ellipse: a = ${a.toFixed(2)}, b = ${b.toFixed(2)}`,
          color
        });
        return;
      }

      // 4. Dynamic Check: Coordinate Point: point(x, y) or (x, y)
      const pointMatch = line.match(/^(?:point)?\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/i);
      if (pointMatch) {
        const px = parseFloat(pointMatch[1]);
        const py = parseFloat(pointMatch[2]);
        dynamicMaxExtent = Math.max(dynamicMaxExtent, Math.abs(px) * 1.35, Math.abs(py) * 1.35);
        items.push({
          datum: {
            points: [[px, py]],
            fnType: 'points',
            graphType: 'scatter',
            color
          },
          label: `Point (${px}, ${py})`,
          color
        });
        return;
      }

      // 5. Dynamic Check: Vector or Segment: vector([x1,y1], [x2,y2]) or segment([x1,y1], [x2,y2])
      const vectorMatch = line.match(/^(?:vector|segment|line)\s*\(?\s*\[?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]?\s*,\s*\[?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]?\s*\)?$/i);
      if (vectorMatch) {
        const x1 = parseFloat(vectorMatch[1]);
        const y1 = parseFloat(vectorMatch[2]);
        const x2 = parseFloat(vectorMatch[3]);
        const y2 = parseFloat(vectorMatch[4]);
        dynamicMaxExtent = Math.max(dynamicMaxExtent, Math.abs(x1) * 1.3, Math.abs(y1) * 1.3, Math.abs(x2) * 1.3, Math.abs(y2) * 1.3);
        items.push({
          datum: {
            points: [[x1, y1], [x2, y2]],
            fnType: 'points',
            graphType: 'polyline',
            color
          },
          label: `Segment (${x1},${y1}) → (${x2},${y2})`,
          color
        });
        return;
      }

      // 6. Dynamic Check: General Equation with '='
      if (line.includes('=')) {
        const [lhsRaw, rhsRaw] = line.split('=');
        const lhs = lhsRaw.trim();
        const rhs = rhsRaw.trim();

        // If isolated 'y =' or 'f(x) =' on the left: standard explicit polyline
        if (/^(?:y|f\(x\))$/i.test(lhs)) {
          items.push({
            datum: {
              fn: rhs,
              color,
              sampler: 'builtIn',
              graphType: 'polyline'
            },
            label: `y = ${rhs}`,
            color
          });
          return;
        }

        // If point-slope format: y - y0 = m*(x - x0)
        const pointSlope = line.match(/^y\s*([+-]\s*\d+(?:\.\d+)?)\s*=\s*(.+)$/i);
        if (pointSlope) {
          const yOffset = -parseFloat(pointSlope[1].replace(/\s+/g, ''));
          const fnExpression = `(${pointSlope[2]}) + (${yOffset})`;
          items.push({
            datum: {
              fn: fnExpression,
              color,
              sampler: 'builtIn',
              graphType: 'polyline'
            },
            label: line,
            color
          });
          return;
        }

        // General dynamic implicit equation: (LHS) - (RHS) = 0
        const implicitForm = `(${lhs}) - (${rhs})`;
        items.push({
          datum: {
            fn: implicitForm,
            fnType: 'implicit',
            color
          },
          label: line,
          color
        });
        return;
      }

      // 7. Fallback: Raw single-variable expression f(x)
      items.push({
        datum: {
          fn: line,
          color,
          sampler: 'builtIn',
          graphType: 'polyline'
        },
        label: `f(x) = ${line}`,
        color
      });
    });

    setPlotLegends(items.map(item => ({ label: item.label, color: item.color })));

    // Dynamic bounded extent computed strictly from the active mathematical items
    const dynamicBound = Math.max(5, Math.min(200, Math.ceil(dynamicMaxExtent * 1.25)));
    const computedDomain: [number, number] = [-dynamicBound, dynamicBound];
    setXDomain(computedDomain);
    setYDomain(computedDomain);
    setInitialDomain(computedDomain);

    try {
      const width = Math.min(containerRef.current.clientWidth || 520, 720);
      const height = Math.min(Math.round(width * 0.7), 440);

      containerRef.current.innerHTML = '';
      functionPlot({
        target: containerRef.current,
        width,
        height,
        grid: true,
        xAxis: { domain: computedDomain },
        yAxis: { domain: computedDomain },
        data: items.map(i => i.datum)
      });
    } catch (err: any) {
      console.warn('FunctionPlot dynamic rendering notice:', err);
      setError(err?.message || 'Unable to plot curve expression dynamically');
    }
  }, [code]);

  const handleZoom = (factor: number) => {
    if (!containerRef.current) return;
    const nextX: [number, number] = [xDomain[0] * factor, xDomain[1] * factor];
    const nextY: [number, number] = [yDomain[0] * factor, yDomain[1] * factor];
    setXDomain(nextX);
    setYDomain(nextY);

    try {
      const width = Math.min(containerRef.current.clientWidth || 520, 720);
      const height = Math.min(Math.round(width * 0.7), 440);
      containerRef.current.innerHTML = '';
      functionPlot({
        target: containerRef.current,
        width,
        height,
        grid: true,
        xAxis: { domain: nextX },
        yAxis: { domain: nextY },
        data: (window as any).__lastFunctionPlotData || []
      });
    } catch (_) {}
  };

  const handleResetZoom = () => {
    setXDomain(initialDomain);
    setYDomain(initialDomain);
    if (!containerRef.current) return;
    try {
      const width = Math.min(containerRef.current.clientWidth || 520, 720);
      const height = Math.min(Math.round(width * 0.7), 440);
      containerRef.current.innerHTML = '';
      functionPlot({
        target: containerRef.current,
        width,
        height,
        grid: true,
        xAxis: { domain: initialDomain },
        yAxis: { domain: initialDomain },
        data: (window as any).__lastFunctionPlotData || []
      });
    } catch (_) {}
  };

  return (
    <div className="my-6 rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/90 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-zinc-800 border-b border-slate-200 dark:border-zinc-700 text-xs font-semibold text-slate-600 dark:text-zinc-300">
        <div className="flex items-center gap-2">
          <Activity size={15} className="text-indigo-600 dark:text-indigo-400" />
          <span className="font-bold uppercase tracking-wider text-[11px] text-slate-800 dark:text-zinc-200">
            Cartesian Coordinate & Function Graph
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleZoom(0.75)}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() => handleZoom(1.35)}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={handleResetZoom}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors text-[11px]"
            title="Reset View"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        </div>
      </div>

      {/* Equations Legend */}
      {plotLegends.length > 0 && (
        <div className="px-4 py-2 bg-slate-50/50 dark:bg-zinc-900/40 border-b border-slate-100 dark:border-zinc-800 flex flex-wrap items-center gap-2 text-xs">
          {plotLegends.map((legend, idx) => (
            <div key={idx} className="flex items-center gap-1.5 bg-white dark:bg-zinc-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 shadow-2xs">
              <div 
                className="w-2.5 h-2.5 rounded-full" 
                style={{ backgroundColor: legend.color }}
              />
              <span className="font-mono text-[11px] text-slate-700 dark:text-zinc-200">
                {legend.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {error ? (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-mono">
          <div className="flex items-center gap-2 font-bold mb-1">
            <AlertCircle size={14} />
            Graph Plotting Error
          </div>
          <p>{error}</p>
        </div>
      ) : (
        <div className="p-4 flex items-center justify-center overflow-x-auto bg-white dark:bg-zinc-900/60">
          <div ref={containerRef} className="function-plot-canvas select-none" />
        </div>
      )}
    </div>
  );
}
