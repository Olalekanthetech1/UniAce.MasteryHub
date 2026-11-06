import React, { lazy, Suspense } from 'react';
import {
  resolveBlockAcademicLabel,
  type AcademicContentBlock,
  type AcademicContentBlockCollection,
  type DynamicStructuredBlock
} from '../shared/academicContentBlocks';
import type { StudentInstructionalContent } from '../shared/courseSchemas';
import { serializeStructuredDiagramToMermaid } from '../services/mermaidRepairService';
import MarkdownRenderer from './MarkdownRenderer';
const MermaidViewer = lazy(() => import('./renderers/MermaidViewer'));
import ParameterizedSimulation from './renderers/ParameterizedSimulation';
import { KnowledgeCheckCard } from './MasteryLessonPanel';

interface AcademicContentBlocksRendererProps {
  collection: AcademicContentBlockCollection;
  instructionalContent?: StudentInstructionalContent;
  courseId: string;
  moduleId: string;
  lessonId: string;
}

function BlockHeading({ title, label }: { title: string; label: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      <span className="text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
    </div>
  );
}

function UnavailableBlock({ title, reason }: { title: string; reason: string }) {
  return (
    <section className="rounded-xl border border-amber-200 dark:border-amber-900 p-4 space-y-1" role="status">
      <h4 className="font-semibold text-amber-800 dark:text-amber-200">{title}</h4>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{reason}</p>
    </section>
  );
}

function renderStructuredExtensions(block: {
  sections?: { heading: string; content: string }[];
  items?: { label: string; detail: string; tag?: string }[];
  table?: { caption?: string; headers: string[]; rows: string[][] };
  codeSnippet?: string;
  language?: string;
  equationsLatex?: string[];
  citations?: string[];
  callout?: string;
}) {
  return (
    <>
      {block.sections && block.sections.length > 0 && (
        <div className="space-y-3">
          {block.sections.map((section, idx) => (
            <div key={idx} className="rounded-lg bg-zinc-50/80 dark:bg-zinc-900/50 p-3 space-y-1.5">
              <h4 className="text-xs font-bold uppercase tracking-wide text-sky-800 dark:text-sky-300">
                {section.heading}
              </h4>
              <MarkdownRenderer content={section.content} />
            </div>
          ))}
        </div>
      )}

      {block.items && block.items.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {block.items.map((item, idx) => (
            <div key={idx} className="rounded-lg border border-zinc-200/80 dark:border-zinc-800 p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-xs font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
                  {item.label}
                </dt>
                {item.tag && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200">
                    {item.tag}
                  </span>
                )}
              </div>
              <dd className="text-sm text-zinc-600 dark:text-zinc-300">
                <MarkdownRenderer content={item.detail} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {block.table && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          {block.table.caption && (
            <div className="px-3 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
              {block.table.caption}
            </div>
          )}
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-zinc-100/80 dark:bg-zinc-800/70">
                {block.table.headers.map((header, hIdx) => (
                  <th key={hIdx} className="px-3 py-2 font-semibold text-zinc-800 dark:text-zinc-200 border-b border-zinc-200 dark:border-zinc-700">
                    <MarkdownRenderer content={header} inline />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {block.table.rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-zinc-700 dark:text-zinc-300 align-top">
                      <MarkdownRenderer content={cell} inline />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {block.equationsLatex && block.equationsLatex.length > 0 && (
        <div className="space-y-2">
          {block.equationsLatex.map((eq, idx) => (
            <MarkdownRenderer key={idx} content={`$$${eq}$$`} />
          ))}
        </div>
      )}

      {block.codeSnippet && (
        <MarkdownRenderer content={`\`\`\`${block.language || ''}\n${block.codeSnippet}\n\`\`\``} />
      )}

      {block.callout && (
        <div className="rounded-lg border-l-4 border-sky-500 bg-sky-50/60 dark:bg-sky-950/20 p-3 text-sm text-zinc-700 dark:text-zinc-300">
          <MarkdownRenderer content={block.callout} />
        </div>
      )}

      {block.citations && block.citations.length > 0 && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-2">
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1">References & Authorities</h4>
          <ul className="list-disc pl-5 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {block.citations.map((citation, idx) => (
              <li key={idx}><MarkdownRenderer content={citation} inline /></li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function renderDynamicStructuredBlock(block: DynamicStructuredBlock, label: string): React.ReactNode {
  return (
    <section key={block.id} className="rounded-xl border border-sky-200 dark:border-sky-900/70 p-4 sm:p-5 space-y-4">
      <BlockHeading title={block.title} label={label} />
      {block.summary && (
        <div className="text-sm text-zinc-700 dark:text-zinc-300">
          <MarkdownRenderer content={block.summary} />
        </div>
      )}
      {block.body && <MarkdownRenderer content={block.body} />}
      {renderStructuredExtensions(block)}
    </section>
  );
}

function renderBlock(
  block: AcademicContentBlock,
  props: AcademicContentBlocksRendererProps
): React.ReactNode {
  const label = resolveBlockAcademicLabel(block);

  switch (block.type) {
    case 'explanation':
      return (
        <section key={block.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 space-y-3">
          <BlockHeading title={block.title} label={label} />
          <MarkdownRenderer content={block.body} />
          {block.keyTakeaways && block.keyTakeaways.length > 0 && (
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 p-3 space-y-1.5">
              <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Key Takeaways</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {block.keyTakeaways.map((item, idx) => (
                  <li key={idx}><MarkdownRenderer content={item} inline /></li>
                ))}
              </ul>
            </div>
          )}
          {renderStructuredExtensions(block)}
        </section>
      );

    case 'mathematical_derivation':
      return (
        <section key={block.id} className="rounded-xl border border-violet-200 dark:border-violet-900/70 p-4 sm:p-5 space-y-4">
          <BlockHeading title={block.title} label={label} />
          <MarkdownRenderer content={block.introduction} />
          {block.assumptions.length > 0 && (
            <div className="rounded-lg bg-violet-50/70 dark:bg-violet-950/20 p-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-violet-800 dark:text-violet-200 mb-2">Assumptions & Premises</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {block.assumptions.map((assumption, index) => <li key={index}><MarkdownRenderer content={assumption} inline /></li>)}
              </ul>
            </div>
          )}
          <ol className="space-y-3">
            {block.steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-200 text-xs font-bold flex items-center justify-center shrink-0">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <MarkdownRenderer content={step.explanation} />
                  {step.equationLatex && <MarkdownRenderer content={`$$${step.equationLatex}$$`} />}
                  {step.codeSnippet && (
                    <MarkdownRenderer content={`\`\`\`${step.language || ''}\n${step.codeSnippet}\n\`\`\``} />
                  )}
                  {step.evidenceOrCitation && (
                    <div className="text-xs italic text-violet-700 dark:text-violet-300">
                      Authority / Evidence: <MarkdownRenderer content={step.evidenceOrCitation} inline />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="border-t border-violet-200 dark:border-violet-900 pt-3">
            <h4 className="text-xs font-bold uppercase tracking-wide text-violet-800 dark:text-violet-200 mb-1">Conclusion</h4>
            <MarkdownRenderer content={block.conclusion} />
          </div>
        </section>
      );

    case 'engineering_diagram':
      try {
        return (
          <section key={block.id} className="rounded-xl border border-emerald-200 dark:border-emerald-900/70 p-4 sm:p-5 space-y-3">
            <BlockHeading title={block.title} label={label} />
            <MarkdownRenderer content={block.description} />
            <Suspense fallback={<div className="p-4 text-xs text-slate-400">Loading engineering diagram...</div>}>
              <MermaidViewer chart={serializeStructuredDiagramToMermaid(block.diagram)} />
            </Suspense>
          </section>
        );
      } catch {
        return <UnavailableBlock key={block.id} title={block.title} reason="This diagram specification failed validation. The surrounding lesson content remains available." />;
      }

    case 'worked_example':
      return (
        <section key={block.id} className="rounded-xl border border-amber-200 dark:border-amber-900/70 p-4 sm:p-5 space-y-4">
          <BlockHeading title={block.title} label={label} />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-1">Problem / Scenario</h4>
            <MarkdownRenderer content={block.problem} />
          </div>
          {block.givens.length > 0 && (
            <div className="rounded-lg bg-amber-50/70 dark:bg-amber-950/20 p-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-2">Given information</h4>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {block.givens.map((given, index) => (
                  <div key={index} className="flex justify-between gap-3 text-sm">
                    <dt className="font-mono text-zinc-600 dark:text-zinc-300">{given.symbol}</dt>
                    <dd className="font-mono text-zinc-900 dark:text-zinc-100">{given.value}{given.unit ? ` ${given.unit}` : ''}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {block.contextFactors && block.contextFactors.length > 0 && (
            <div className="rounded-lg bg-amber-50/70 dark:bg-amber-950/20 p-3 space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">Context & Material Facts</h4>
              <dl className="space-y-1.5">
                {block.contextFactors.map((factor, index) => (
                  <div key={index} className="text-sm">
                    <dt className="font-semibold text-zinc-800 dark:text-zinc-200 inline">{factor.label}: </dt>
                    <dd className="text-zinc-700 dark:text-zinc-300 inline"><MarkdownRenderer content={factor.detail} inline /></dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-1">Find / Objective</h4>
            <MarkdownRenderer content={block.target} />
          </div>
          {block.assumptions.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-1">Assumptions & Scope</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {block.assumptions.map((assumption, index) => <li key={index}><MarkdownRenderer content={assumption} inline /></li>)}
              </ul>
            </div>
          )}
          <ol className="space-y-3">
            {block.steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-xs font-bold flex items-center justify-center shrink-0">{index + 1}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <MarkdownRenderer content={step.explanation} />
                  {step.equationLatex && <MarkdownRenderer content={`$$${step.equationLatex}$$`} />}
                  {step.codeSnippet && (
                    <MarkdownRenderer content={`\`\`\`${step.language || ''}\n${step.codeSnippet}\n\`\`\``} />
                  )}
                  {step.evidenceOrCitation && (
                    <div className="text-xs italic text-amber-800 dark:text-amber-300">
                      Authority / Evidence: <MarkdownRenderer content={step.evidenceOrCitation} inline />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/50 dark:bg-emerald-950/10 p-3 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">Final answer / Resolution</h4>
            <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{block.finalAnswer.value}{block.finalAnswer.unit ? ` ${block.finalAnswer.unit}` : ''}</p>
            <div className="text-sm text-zinc-700 dark:text-zinc-300"><strong>Verification:</strong> <MarkdownRenderer content={block.verification} inline /></div>
          </div>
        </section>
      );

    case 'interactive_simulation':
      return <ParameterizedSimulation key={block.id} block={block} />;

    case 'knowledge_check': {
      const check = props.instructionalContent?.knowledgeChecks?.[block.activityIndex];
      if (!check) {
        return <UnavailableBlock key={block.id} title={block.title} reason="The referenced knowledge check is not present in the student-safe instructional payload." />;
      }
      return (
        <div key={block.id} className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-pink-700 dark:text-pink-300">{block.title}</div>
          <KnowledgeCheckCard
            check={check}
            index={block.activityIndex}
            courseId={props.courseId}
            moduleId={props.moduleId}
            lessonId={props.lessonId}
          />
        </div>
      );
    }

    case 'structured_block':
      return renderDynamicStructuredBlock(block, label);
  }
}

export default function AcademicContentBlocksRenderer(props: AcademicContentBlocksRendererProps) {
  return (
    <div className="space-y-5" aria-label="Structured academic lesson content">
      {props.collection.blocks.map(block => renderBlock(block, props))}
    </div>
  );
}


