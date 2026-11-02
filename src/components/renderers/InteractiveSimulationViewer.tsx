import React, { useEffect, useMemo, useState } from 'react';
import { compileSimulationExpression } from '../../shared/simulationExpression';
import type { LessonContentBlock } from '../../shared/courseSchemas';

type InteractiveSimulationBlock = Extract<LessonContentBlock, { type: 'interactive_simulation' }>;

interface PlotPoint {
  x: number;
  y: number | null;
}

const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 340;
const MARGIN = { top: 18, right: 18, bottom: 48, left: 58 };
const SAMPLE_INTERVALS = 200;

function formatNumber(value: number): string {
  if (Object.is(value, -0)) return '0';
  return Number(value.toPrecision(5)).toString();
}

function validateAndCompileExpression(expression: string, parameterIds: string[]): (variables: Record<string, number>) => number {
  return compileSimulationExpression(expression, parameterIds);
}

export default function InteractiveSimulationViewer({ block }: { block: InteractiveSimulationBlock }) {
  const initialValues = useMemo(
    () => Object.fromEntries(block.parameters.map((parameter) => [parameter.id, parameter.initial])),
    [block.id, block.parameters]
  );
  const [values, setValues] = useState<Record<string, number>>(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const compiledModel = useMemo(() => {
    try {
      return {
        evaluate: validateAndCompileExpression(block.expression, block.parameters.map((parameter) => parameter.id)),
        error: ''
      };
    } catch (error) {
      return {
        evaluate: null,
        error: error instanceof Error ? error.message : 'The mathematical model could not be compiled.'
      };
    }
  }, [block.expression, block.parameters]);

  const plot = useMemo(() => {
    if (!compiledModel.evaluate) {
      return { points: [] as PlotPoint[], error: compiledModel.error, yMin: 0, yMax: 0 };
    }

    const [xMin, xMax] = block.xRange;
    const points: PlotPoint[] = [];
    let evaluationError = '';

    for (let index = 0; index <= SAMPLE_INTERVALS; index += 1) {
      const x = xMin + ((xMax - xMin) * index) / SAMPLE_INTERVALS;
      try {
        const result = compiledModel.evaluate({ x, ...values });
        const y = typeof result === 'number' ? result : Number.NaN;
        points.push({ x, y: Number.isFinite(y) && Math.abs(y) < 1e15 ? y : null });
      } catch (error) {
        points.push({ x, y: null });
        if (!evaluationError) {
          evaluationError = error instanceof Error ? error.message : 'A model evaluation failed.';
        }
      }
    }

    const finiteValues = points
      .map((point) => point.y)
      .filter((value): value is number => value !== null && Number.isFinite(value));

    if (finiteValues.length === 0) {
      return {
        points,
        error: evaluationError || 'The model produced no finite values in the configured domain.',
        yMin: 0,
        yMax: 0
      };
    }

    let yMin = Math.min(...finiteValues);
    let yMax = Math.max(...finiteValues);
    if (yMin === yMax) {
      const padding = Math.max(1, Math.abs(yMin) * 0.1);
      yMin -= padding;
      yMax += padding;
    } else {
      const padding = (yMax - yMin) * 0.06;
      yMin -= padding;
      yMax += padding;
    }

    return { points, error: '', yMin, yMax };
  }, [compiledModel, block.xRange, values]);

  const plotWidth = VIEW_WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = VIEW_HEIGHT - MARGIN.top - MARGIN.bottom;
  const [xMin, xMax] = block.xRange;

  const projectX = (x: number) => MARGIN.left + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const projectY = (y: number) => MARGIN.top + ((plot.yMax - y) / (plot.yMax - plot.yMin)) * plotHeight;

  const pathData = useMemo(() => {
    if (plot.error) return '';
    const segments: string[] = [];
    let currentSegment = '';

    for (const point of plot.points) {
      if (point.y === null) {
        if (currentSegment) segments.push(currentSegment);
        currentSegment = '';
        continue;
      }
      const x = projectX(point.x).toFixed(2);
      const y = projectY(point.y).toFixed(2);
      currentSegment += `${currentSegment ? ' L' : 'M'} ${x} ${y}`;
    }

    if (currentSegment) segments.push(currentSegment);
    return segments.join(' ');
  }, [plot, xMin, xMax]);

  const horizontalAxisY = plot.error
    ? VIEW_HEIGHT - MARGIN.bottom
    : projectY(Math.max(plot.yMin, Math.min(plot.yMax, 0)));
  const verticalAxisX = projectX(Math.max(xMin, Math.min(xMax, 0)));

  return (
    <section className="my-6 rounded-2xl border border-indigo-200 dark:border-indigo-900 bg-white dark:bg-zinc-950 overflow-hidden" aria-label={block.title}>
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Interactive simulation</div>
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{block.title}</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{block.description}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Model: <code className="font-mono">{block.expression}</code></p>
      </div>

      <div className="p-3 sm:p-4">
        {plot.error ? (
          <div role="status" className="rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-200">
            Simulation unavailable: {plot.error}
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              role="img"
              aria-label={`${block.yLabel} plotted against ${block.xLabel}; adjust the parameters to change the model.`}
              className="w-full min-w-[320px] h-auto"
            >
              {Array.from({ length: 6 }, (_, index) => {
                const y = MARGIN.top + (plotHeight * index) / 5;
                const value = plot.yMax - ((plot.yMax - plot.yMin) * index) / 5;
                return (
                  <g key={index}>
                    <line x1={MARGIN.left} x2={VIEW_WIDTH - MARGIN.right} y1={y} y2={y} stroke="currentColor" opacity="0.12" strokeDasharray="3 4" />
                    <text x={MARGIN.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.7">{formatNumber(value)}</text>
                  </g>
                );
              })}
              <line x1={MARGIN.left} x2={VIEW_WIDTH - MARGIN.right} y1={horizontalAxisY} y2={horizontalAxisY} stroke="currentColor" opacity="0.65" />
              <line x1={verticalAxisX} x2={verticalAxisX} y1={MARGIN.top} y2={VIEW_HEIGHT - MARGIN.bottom} stroke="currentColor" opacity="0.65" />
              <path d={pathData} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT - 9} textAnchor="middle" fontSize="12" fill="currentColor">{block.xLabel}</text>
              <text x="15" y={VIEW_HEIGHT / 2} textAnchor="middle" fontSize="12" fill="currentColor" transform={`rotate(-90 15 ${VIEW_HEIGHT / 2})`}>{block.yLabel}</text>
              <text x={MARGIN.left} y={VIEW_HEIGHT - MARGIN.bottom + 17} fontSize="10" fill="currentColor" opacity="0.65">{formatNumber(xMin)}</text>
              <text x={VIEW_WIDTH - MARGIN.right} y={VIEW_HEIGHT - MARGIN.bottom + 17} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.65">{formatNumber(xMax)}</text>
            </svg>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {block.parameters.map((parameter) => (
            <label key={parameter.id} className="block space-y-2">
              <span className="flex items-center justify-between gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <span>{parameter.label}{parameter.unit ? ` (${parameter.unit})` : ''}</span>
                <output className="font-mono text-indigo-600 dark:text-indigo-400">{formatNumber(values[parameter.id] ?? parameter.initial)}</output>
              </span>
              <input
                type="range"
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                value={values[parameter.id] ?? parameter.initial}
                onChange={(event) => setValues((current) => ({
                  ...current,
                  [parameter.id]: Number(event.target.value)
                }))}
                aria-label={parameter.label}
                className="w-full accent-indigo-600"
              />
              <span className="flex justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                <span>{formatNumber(parameter.min)}</span>
                <span>{formatNumber(parameter.max)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
