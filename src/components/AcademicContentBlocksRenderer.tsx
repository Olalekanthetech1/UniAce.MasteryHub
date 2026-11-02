import React from 'react';
import type {
  AcademicContentBlock,
  AcademicContentBlockCollection
} from '../shared/academicContentBlocks';
import type { StudentInstructionalContent } from '../shared/courseSchemas';
import { serializeStructuredDiagramToMermaid } from '../services/mermaidRepairService';
import MarkdownRenderer from './MarkdownRenderer';
import MermaidViewer from './renderers/MermaidViewer';
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
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
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

function renderBlock(
  block: AcademicContentBlock,
  props: AcademicContentBlocksRendererProps
): React.ReactNode {
  switch (block.type) {
    case 'explanation':
      return (
        <section key={block.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 space-y-3">
          <BlockHeading title={block.title} label="Explanation" />
          <MarkdownRenderer content={block.body} />
        </section>
      );

    case 'mathematical_derivation':
      return (
        <section key={block.id} className="rounded-xl border border-violet-200 dark:border-violet-900/70 p-4 sm:p-5 space-y-4">
          <BlockHeading title={block.title} label="Mathematical derivation" />
          <MarkdownRenderer content={block.introduction} />
          {block.assumptions.length > 0 && (
            <div className="rounded-lg bg-violet-50/70 dark:bg-violet-950/20 p-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-violet-800 dark:text-violet-200 mb-2">Assumptions</h4>
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
            <BlockHeading title={block.title} label="Engineering diagram" />
            <MarkdownRenderer content={block.description} />
            <MermaidViewer chart={serializeStructuredDiagramToMermaid(block.diagram)} />
          </section>
        );
      } catch {
        return <UnavailableBlock key={block.id} title={block.title} reason="This diagram specification failed validation. The surrounding lesson content remains available." />;
      }

    case 'worked_example':
      return (
        <section key={block.id} className="rounded-xl border border-amber-200 dark:border-amber-900/70 p-4 sm:p-5 space-y-4">
          <BlockHeading title={block.title} label="Worked example" />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-1">Problem</h4>
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
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-1">Find</h4>
            <MarkdownRenderer content={block.target} />
          </div>
          {block.assumptions.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-1">Assumptions</h4>
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
                </div>
              </li>
            ))}
          </ol>
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/50 dark:bg-emerald-950/10 p-3 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">Final answer</h4>
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
  }
}

export default function AcademicContentBlocksRenderer(props: AcademicContentBlocksRendererProps) {
  return (
    <div className="space-y-5" aria-label="Structured academic lesson content">
      {props.collection.blocks.map(block => renderBlock(block, props))}
    </div>
  );
}
