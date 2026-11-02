import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { KnowledgeCheckCard } from './MasteryLessonPanel';
import InteractiveSimulationViewer from './renderers/InteractiveSimulationViewer';
import type { LessonContentBlock, StudentKnowledgeCheckPrompt } from '../shared/courseSchemas';

interface Props {
  blocks: LessonContentBlock[];
  knowledgeChecks: StudentKnowledgeCheckPrompt[];
  courseId: string;
  moduleId: string;
  lessonId: string;
}

function mathBlock(expression: string): string {
  const value = expression.trim();
  if (!value) return '';
  if (/^\$\$[\s\S]*\$\$$/.test(value) || /^\$(?!\$)[\s\S]+\$(?!\$)$/.test(value) || /^\\\([\s\S]*\\\)$/.test(value) || /^\\\[[\s\S]*\\\]$/.test(value)) return value;
  return '$$\n' + value + '\n$$';
}

function Diagram({ block }: { block: Extract<LessonContentBlock, { type: 'engineering_diagram' }> }) {
  const fence = String.fromCharCode(96).repeat(3);
  const source = fence + block.format + '\n' + block.source + '\n' + fence;
  return (
    <section className="space-y-3" aria-label={block.title}>
      <h3 className="text-lg font-semibold">{block.title}</h3>
      <div role="img" aria-label={block.altText}><MarkdownRenderer content={source} /></div>
      {block.caption && <p className="text-sm text-zinc-500">{block.caption}</p>}
    </section>
  );
}

export default function LessonContentBlocksRenderer({
  blocks, knowledgeChecks, courseId, moduleId, lessonId
}: Props) {
  return (
    <div className="space-y-7" aria-label="Structured lesson content">
      {blocks.map((block) => {
        switch (block.type) {
          case 'explanation':
            return <section key={block.id} className="space-y-3">
              {block.title && <h3 className="text-lg font-semibold">{block.title}</h3>}
              <MarkdownRenderer content={block.markdown} />
            </section>;

          case 'mathematical_derivation':
            return <section key={block.id} className="space-y-4">
              <h3 className="text-lg font-semibold">{block.title}</h3>
              {block.assumptions.length > 0 && <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-4">
                <h4 className="text-xs font-bold uppercase mb-2">Assumptions</h4>
                <ul className="list-disc pl-5 space-y-1">{block.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul>
              </div>}
              {block.steps.map((step, index) => <div key={index} className="space-y-2">
                <h4 className="font-semibold">Step {index + 1}</h4>
                <MarkdownRenderer content={step.explanation} />
                {step.equation && <MarkdownRenderer content={mathBlock(step.equation)} />}
              </div>)}
              {block.conclusion && <div className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20 p-4">
                <h4 className="font-semibold mb-1">Conclusion</h4>
                <MarkdownRenderer content={block.conclusion} />
              </div>}
            </section>;

          case 'engineering_diagram':
            return <Diagram key={block.id} block={block} />;

          case 'worked_example':
            return <section key={block.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Worked example · {block.exampleType}</div>
                <h3 className="text-lg font-semibold mt-1">{block.title}</h3>
              </div>
              <div><h4 className="font-semibold mb-2">Problem</h4><MarkdownRenderer content={block.problem} /></div>
              {block.givens.length > 0 && <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3">
                <h4 className="text-xs font-bold uppercase mb-2">Given information</h4>
                <dl className="space-y-2">{block.givens.map((given, index) => <div key={index} className="flex justify-between gap-3 text-sm">
                  <dt>{given.name}</dt><dd className="font-mono text-right">{given.value}{given.unit ? ' ' + given.unit : ''}</dd>
                </div>)}</dl>
              </div>}
              {block.assumptions.length > 0 && <div><h4 className="font-semibold mb-1">Assumptions</h4>
                <ul className="list-disc pl-5">{block.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul>
              </div>}
              {block.steps.map((step, index) => <div key={index} className="space-y-2">
                <h4 className="font-semibold">Step {index + 1}</h4>
                <MarkdownRenderer content={step.explanation} />
                {step.equation && <MarkdownRenderer content={mathBlock(step.equation)} />}
              </div>)}
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 p-4 space-y-2">
                <h4 className="font-semibold">Final answer</h4><MarkdownRenderer content={block.finalAnswer} />
                <h4 className="font-semibold pt-1">Verification</h4><MarkdownRenderer content={block.verification} />
              </div>
            </section>;

          case 'interactive_simulation':
            return <InteractiveSimulationViewer key={block.id} block={block} />;

          case 'knowledge_check': {
            const check = knowledgeChecks[block.activityIndex];
            if (!check) return <section key={block.id} role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
              Knowledge check unavailable: the referenced assessment activity is missing.
            </section>;
            return <section key={block.id} className="space-y-2">
              {block.title && <h3 className="text-lg font-semibold">{block.title}</h3>}
              <KnowledgeCheckCard check={check} index={block.activityIndex} courseId={courseId} moduleId={moduleId} lessonId={lessonId} />
            </section>;
          }

          default:
            return null;
        }
      })}
    </div>
  );
}
