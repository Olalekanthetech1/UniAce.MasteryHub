import React, { useState } from 'react';
import type { InstructionalContent, InstructionalPracticeItem } from '../shared/courseSchemas';

interface MasteryLessonPanelProps {
  content: InstructionalContent;
}

function PracticeCard({
  item,
  title,
  index
}: {
  item: InstructionalPracticeItem;
  title: string;
  index: number;
}) {
  const [attempt, setAttempt] = useState('');
  const [revealedHints, setRevealedHints] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const canReveal = attempt.trim().length >= 3;

  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">{title} {index + 1}</h4>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {item.hints.length ? `${item.hints.length} hints` : 'Independent reasoning'}
        </span>
      </div>
      <p className="text-sm leading-6 text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{item.prompt}</p>
      {item.hints.length > 0 && revealedHints > 0 && (
        <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/30 p-3 space-y-2">
          {item.hints.slice(0, revealedHints).map((hint, hintIndex) => (
            <p key={hintIndex} className="text-sm text-indigo-900 dark:text-indigo-200">
              <strong>Hint {hintIndex + 1}:</strong> {hint}
            </p>
          ))}
        </div>
      )}
      {item.hints.length > revealedHints && (
        <button
          type="button"
          onClick={() => setRevealedHints(value => Math.min(item.hints.length, value + 1))}
          className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Reveal next hint
        </button>
      )}
      <label className="block space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Your attempt</span>
        <textarea
          value={attempt}
          onChange={event => setAttempt(event.target.value)}
          rows={3}
          placeholder="Write your reasoning or working before viewing the explanation."
          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-sm text-zinc-900 dark:text-zinc-100"
        />
      </label>
      <button
        type="button"
        disabled={!canReveal}
        onClick={() => setShowAnswer(true)}
        className="rounded-xl bg-zinc-900 dark:bg-white px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 disabled:opacity-40"
      >
        {showAnswer ? 'Explanation revealed' : 'I have attempted it — show explanation'}
      </button>
      {showAnswer && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-900 p-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Expected approach</p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{item.expectedApproach}</p>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Answer and explanation</p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{item.expectedAnswer}</p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{item.explanation}</p>
          <p className="text-xs text-emerald-800 dark:text-emerald-300">Self-check only. UniAce has not graded this free-text response.</p>
        </div>
      )}
    </section>
  );
}

export default function MasteryLessonPanel({ content }: MasteryLessonPanelProps) {
  if (!content) return null;

  return (
    <div className="mt-8 space-y-6" aria-label="Mastery learning activities">
      <section className="rounded-2xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/70 dark:bg-indigo-950/20 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-indigo-950 dark:text-indigo-100">Lesson outcomes</h3>
          <span className="rounded-full bg-white dark:bg-zinc-900 px-3 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
            Mastery target: Level {content.mastery.targetLevel} / 5
          </span>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-800 dark:text-zinc-200">
          {content.learningObjectives.map((objective, index) => <li key={index}>{objective}</li>)}
        </ul>
      </section>

      {content.prerequisites.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Check your prerequisites</h3>
          {content.prerequisites.map((item, index) => (
            <details key={index} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-800 dark:text-zinc-200">{item.concept}</summary>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{item.whyNeeded}</p>
              <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-200"><strong>Readiness check:</strong> {item.readinessCheck}</p>
            </details>
          ))}
        </section>
      )}

      {content.guidedPractice.length > 0 && (
        <section className="space-y-3">
          <div>
            <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Guided practice</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Use hints progressively. Write your own attempt before opening the explanation.</p>
          </div>
          {content.guidedPractice.map((item, index) => (
            <PracticeCard key={index} item={item} title="Guided exercise" index={index} />
          ))}
        </section>
      )}

      {content.independentPractice.length > 0 && (
        <section className="space-y-3">
          <div>
            <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Independent practice</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Attempt these without hints before comparing your reasoning with the worked answer.</p>
          </div>
          {content.independentPractice.map((item, index) => (
            <PracticeCard key={index} item={item} title="Independent exercise" index={index} />
          ))}
        </section>
      )}

      {content.knowledgeChecks.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Verify your understanding</h3>
          {content.knowledgeChecks.map((check, index) => (
            <KnowledgeCheckCard key={index} check={check} index={index} />
          ))}
        </section>
      )}

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
        <h3 className="font-bold text-zinc-900 dark:text-zinc-100">What mastery requires</h3>
        <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
          {content.mastery.criteria.map((criterion, index) => <li key={index}>{criterion}</li>)}
        </ul>
        {content.mastery.retentionPrompts.length > 0 && (
          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
            <h4 className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">Retrieval practice prompts</h4>
            <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
              {content.mastery.retentionPrompts.map((prompt, index) => <li key={index}>{prompt}</li>)}
            </ul>
            <p className="mt-2 text-xs text-zinc-500">Use these when revising this lesson later. A scheduled review is not yet recorded by this panel.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function KnowledgeCheckCard({
  check,
  index
}: {
  check: InstructionalContent['knowledgeChecks'][number];
  index: number;
}) {
  const [attempt, setAttempt] = useState('');
  const [showRubric, setShowRubric] = useState(false);
  const canReveal = attempt.trim().length >= 3;

  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">Check {index + 1}</h4>
        <span className="text-xs text-zinc-500">Difficulty {check.difficulty}/5 · {check.responseMode}</span>
      </div>
      <p className="text-sm leading-6 text-zinc-800 dark:text-zinc-200">{check.prompt}</p>
      <textarea
        value={attempt}
        onChange={event => setAttempt(event.target.value)}
        rows={3}
        placeholder="Explain your reasoning, not just the final answer."
        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-sm text-zinc-900 dark:text-zinc-100"
      />
      <button
        type="button"
        disabled={!canReveal}
        onClick={() => setShowRubric(true)}
        className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200 disabled:opacity-40"
      >
        {showRubric ? 'Comparison guide revealed' : 'I have answered — compare with the guide'}
      </button>
      {showRubric && (
        <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3 space-y-2">
          <p className="text-sm text-zinc-800 dark:text-zinc-200"><strong>Expected reasoning:</strong> {check.expectedReasoning}</p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200"><strong>Answer / rubric:</strong> {check.answerOrRubric}</p>
          <p className="text-xs text-zinc-500">Self-comparison only; this free-text response has not been automatically graded.</p>
        </div>
      )}
    </section>
  );
}
