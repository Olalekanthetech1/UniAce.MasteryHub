import React, { useState } from 'react';
import type {
  StudentInstructionalContent,
  StudentPracticePrompt,
  StudentKnowledgeCheckPrompt
} from '../shared/courseSchemas';
import { useAuth } from '../context/AuthContext';

type PracticeActivityType = 'guidedPractice' | 'independentPractice';
type ActivityType = PracticeActivityType | 'knowledgeChecks';

interface MasteryLessonPanelProps {
  content: StudentInstructionalContent;
  courseId: string;
  moduleId: string;
  lessonId: string;
}

interface PracticeReveal {
  expectedApproach: string;
  expectedAnswer: string;
  explanation: string;
}

interface KnowledgeCheckReveal {
  expectedReasoning: string;
  answerOrRubric: string;
}

interface AttemptRequest {
  courseId: string;
  moduleId: string;
  lessonId: string;
  activityType: ActivityType;
  activityIndex: number;
  response: string;
}

async function saveAttemptAndGetReveal<T>(
  getIdToken: () => Promise<string | undefined>,
  request: AttemptRequest
): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new Error('Please sign in again before submitting your attempt.');

  const url = `/api/courses/${encodeURIComponent(request.courseId)}/modules/${encodeURIComponent(request.moduleId)}/lessons/${encodeURIComponent(request.lessonId)}/attempts`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      activityType: request.activityType,
      activityIndex: request.activityIndex,
      response: request.response
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'Your attempt could not be saved.');
  }
  return payload?.reveal as T;
}

function PracticeCard({
  item,
  title,
  index,
  activityType,
  courseId,
  moduleId,
  lessonId
}: {
  item: StudentPracticePrompt;
  title: string;
  index: number;
  activityType: PracticeActivityType;
  courseId: string;
  moduleId: string;
  lessonId: string;
}) {
  const [attempt, setAttempt] = useState('');
  const [revealedHints, setRevealedHints] = useState(0);
  const [reveal, setReveal] = useState<PracticeReveal | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const canReveal = attempt.trim().length >= 3;

  const handleSubmitAttempt = async () => {
    if (!canReveal || isSubmitting || reveal) return;
    setIsSubmitting(true);
    setError('');
    try {
      const result = await saveAttemptAndGetReveal<PracticeReveal>(
        async () => await user?.getIdToken(),
        {
          courseId,
          moduleId,
          lessonId,
          activityType,
          activityIndex: index,
          response: attempt
        }
      );
      setReveal(result);
    } catch (submitError: any) {
      setError(submitError?.message || 'Could not save your attempt.');
    } finally {
      setIsSubmitting(false);
    }
  };

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
          maxLength={10000}
          placeholder="Write your reasoning or working before viewing the explanation."
          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-sm text-zinc-900 dark:text-zinc-100"
        />
      </label>
      <button
        type="button"
        disabled={!canReveal || isSubmitting || Boolean(reveal)}
        onClick={handleSubmitAttempt}
        className="rounded-xl bg-zinc-900 dark:bg-white px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 disabled:opacity-40"
      >
        {isSubmitting ? 'Saving attempt…' : reveal ? 'Attempt saved · guide revealed' : 'Save my attempt and reveal guide'}
      </button>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {reveal && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-900 p-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Expected approach</p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{reveal.expectedApproach}</p>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Answer and explanation</p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{reveal.expectedAnswer}</p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{reveal.explanation}</p>
          <p className="text-xs text-emerald-800 dark:text-emerald-300">Your attempt was saved. This is a self-check; UniAce has not automatically graded the free-text response.</p>
        </div>
      )}
    </section>
  );
}

function KnowledgeCheckCard({
  check,
  index,
  courseId,
  moduleId,
  lessonId
}: {
  check: StudentKnowledgeCheckPrompt;
  index: number;
  courseId: string;
  moduleId: string;
  lessonId: string;
}) {
  const [attempt, setAttempt] = useState('');
  const [reveal, setReveal] = useState<KnowledgeCheckReveal | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const canReveal = attempt.trim().length >= 3;

  const handleSubmitAttempt = async () => {
    if (!canReveal || isSubmitting || reveal) return;
    setIsSubmitting(true);
    setError('');
    try {
      const result = await saveAttemptAndGetReveal<KnowledgeCheckReveal>(
        async () => await user?.getIdToken(),
        {
          courseId,
          moduleId,
          lessonId,
          activityType: 'knowledgeChecks',
          activityIndex: index,
          response: attempt
        }
      );
      setReveal(result);
    } catch (submitError: any) {
      setError(submitError?.message || 'Could not save your attempt.');
    } finally {
      setIsSubmitting(false);
    }
  };

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
        maxLength={10000}
        placeholder="Explain your reasoning, not just the final answer."
        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-sm text-zinc-900 dark:text-zinc-100"
      />
      <button
        type="button"
        disabled={!canReveal || isSubmitting || Boolean(reveal)}
        onClick={handleSubmitAttempt}
        className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200 disabled:opacity-40"
      >
        {isSubmitting ? 'Saving attempt…' : reveal ? 'Attempt saved · guide revealed' : 'Save my answer and compare'}
      </button>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {reveal && (
        <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3 space-y-2">
          <p className="text-sm text-zinc-800 dark:text-zinc-200"><strong>Expected reasoning:</strong> {reveal.expectedReasoning}</p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200"><strong>Answer / rubric:</strong> {reveal.answerOrRubric}</p>
          <p className="text-xs text-zinc-500">Attempt saved for revision history. This free-text response has not been automatically graded.</p>
        </div>
      )}
    </section>
  );
}

export default function MasteryLessonPanel({
  content,
  courseId,
  moduleId,
  lessonId
}: MasteryLessonPanelProps) {
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
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Use hints progressively. Submit your attempt before the server releases the comparison guide.</p>
          </div>
          {content.guidedPractice.map((item, index) => (
            <PracticeCard
              key={index}
              item={item}
              title="Guided exercise"
              index={index}
              activityType="guidedPractice"
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
            />
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
            <PracticeCard
              key={index}
              item={item}
              title="Independent exercise"
              index={index}
              activityType="independentPractice"
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
            />
          ))}
        </section>
      )}

      {content.knowledgeChecks.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Verify your understanding</h3>
          {content.knowledgeChecks.map((check, index) => (
            <KnowledgeCheckCard
              key={index}
              check={check}
              index={index}
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
            />
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
