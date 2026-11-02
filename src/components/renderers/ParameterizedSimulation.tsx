import React, { useEffect, useMemo, useState } from 'react';
import { parse } from 'mathjs';
import {
  validateSimulationExpression,
  type InteractiveSimulationBlock
} from '../../shared/academicContentBlocks';

interface ParameterizedSimulationProps {
  block: InteractiveSimulationBlock;
}

interface SamplePoint {
  x: number;
  y: number;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 10000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) {
    return value.toExponential(3);
  }
  return Number(value.toPrecision(5)).toString();
}

export default function ParameterizedSimulation({ block }: ParameterizedSimulationProps) {
  const [parameterValue, setParameterValue] = useState(block.parameter.initialValue);

  useEffect(() => {
    setParameterValue(block.parameter.initialValue);
  }, [block.id, block.parameter.initialValue]);

  const compiledExpression = useMemo((): { compiled: any | null; error: string } => {
    const validation = validateSimulationExpression(
      block.expression,
      block.independentVariable,
      block.parameter.symbol
    );
    if (validation.valid === false) {
      return { compiled: null, error: validation.reason };
    }
    try {
      return { compiled: parse(block.expression).compile(), error: '' };
    } catch {
      return { compiled: null, error: 'The validated expression could not be compiled.' };
    }
  }, [block.expression, block.independentVariable, block.parameter.symbol]);

  const samples = useMemo<SamplePoint[]>(() => {
    try {
      const result: SamplePoint[] = [];
      const sampleCount = 120;
      for (let index = 0; index <= sampleCount; index++) {
        const x = block.domain.min + ((block.domain.max - block.domain.min) * index) / sampleCount;
        if (!compiledExpression.compiled) return [];
        const y = compiledExpression.compiled.evaluate({
          [block.independentVariable]: x,
          [block.parameter.symbol]: parameterValue,
          pi: Math.PI,
          e: Math.E
        });
        if (typeof y === 'number' && Number.isFinite(y)) result.push({ x, y });
      }
      return result;
    } catch {
      return [];
    }
  }, [
    block.domain.min,
    block.domain.max,
    block.independentVariable,
    block.parameter.symbol,
    compiledExpression,
    parameterValue
  ]);

  const plot = useMemo(() => {
    if (samples.length < 2) return null;
    const xMin = block.domain.min;
    const xMax = block.domain.max;
    const rawYMin = Math.min(...samples.map(point => point.y));
    const rawYMax = Math.max(...samples.map(point => point.y));
    const rawRange = rawYMax - rawYMin;
    const padding = rawRange === 0 ? Math.max(1, Math.abs(rawYMax) * 0.1) : rawRange * 0.12;
    const yMin = rawYMin - padding;
    const yMax = rawYMax + padding;
    const width = 640;
    const height = 280;
    const inset = { left: 58, right: 20, top: 20, bottom: 42 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;
    const mapX = (x: number) => inset.left + ((x - xMin) / (xMax - xMin)) * plotWidth;
    const mapY = (y: number) => inset.top + ((yMax - y) / (yMax - yMin)) * plotHeight;
    const points = samples
      .map(point => `${mapX(point.x).toFixed(2)},${mapY(point.y).toFixed(2)}`)
      .join(' ');
    const zeroY = 0 >= yMin && 0 <= yMax ? mapY(0) : inset.top + plotHeight;
    const zeroX = 0 >= xMin && 0 <= xMax ? mapX(0) : inset.left;
    return { width, height, inset, plotWidth, plotHeight, points, zeroX, zeroY, yMin, yMax };
  }, [block.domain.min, block.domain.max, samples]);

  const simulationError = compiledExpression.error || (
    !plot ? 'The current expression produced fewer than two finite plot points for the declared domain.' : ''
  );

  return (
    <section className="rounded-2xl border border-cyan-200 dark:border-cyan-900/70 bg-cyan-50/40 dark:bg-cyan-950/10 p-4 space-y-3">
      <div>
        <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">{block.title}</h4>
        <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{block.description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-mono text-cyan-800 dark:text-cyan-200">{block.expression}</span>
        <span className="text-zinc-500">{block.independentVariable} ∈ [{formatNumber(block.domain.min)}, {formatNumber(block.domain.max)}]</span>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2">
        {plot ? (
          <svg
            viewBox={`0 0 ${plot.width} ${plot.height}`}
            role="img"
            aria-label={`Plot of ${block.expression} as ${block.independentVariable} varies`}
            className="w-full h-auto"
          >
            <line
              x1={plot.inset.left}
              y1={plot.zeroY}
              x2={plot.width - plot.inset.right}
              y2={plot.zeroY}
              stroke="currentColor"
              opacity="0.35"
            />
            <line
              x1={plot.zeroX}
              y1={plot.inset.top}
              x2={plot.zeroX}
              y2={plot.height - plot.inset.bottom}
              stroke="currentColor"
              opacity="0.35"
            />
            <polyline
              points={plot.points}
              fill="none"
              stroke="#0891B2"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text x={plot.inset.left} y={plot.height - 12} fontSize="12" fill="currentColor">
              {formatNumber(block.domain.min)}
            </text>
            <text x={plot.width - plot.inset.right} y={plot.height - 12} fontSize="12" textAnchor="end" fill="currentColor">
              {formatNumber(block.domain.max)}
            </text>
            <text x="8" y={plot.inset.top + 4} fontSize="12" fill="currentColor">
              {formatNumber(plot.yMax)}
            </text>
            <text x="8" y={plot.height - plot.inset.bottom} fontSize="12" fill="currentColor">
              {formatNumber(plot.yMin)}
            </text>
            <text x={plot.width - plot.inset.right} y={plot.height - 12} dx="-2" dy="-18" fontSize="12" textAnchor="end" fill="currentColor">
              {block.independentVariable}
            </text>
          </svg>
        ) : (
          <div className="p-8 text-sm text-amber-700 dark:text-amber-300" role="status">
            {simulationError || 'The simulation cannot currently produce a valid plot.'}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`simulation-${block.id}`} className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {block.parameter.label}
          </label>
          <output htmlFor={`simulation-${block.id}`} className="font-mono text-sm text-cyan-800 dark:text-cyan-200">
            {formatNumber(parameterValue)}{block.parameter.unit ? ` ${block.parameter.unit}` : ''}
          </output>
        </div>
        <input
          id={`simulation-${block.id}`}
          type="range"
          min={block.parameter.min}
          max={block.parameter.max}
          step={block.parameter.step}
          value={parameterValue}
          onChange={event => setParameterValue(Number(event.target.value))}
          className="w-full accent-cyan-600"
        />
        <div className="flex justify-between text-xs text-zinc-500">
          <span>{formatNumber(block.parameter.min)}</span>
          <span>{formatNumber(block.parameter.max)}</span>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Change the parameter to recompute the plotted relationship. The simulation evaluates only the validated mathematical expression and declared variables.
      </p>
    </section>
  );
}
