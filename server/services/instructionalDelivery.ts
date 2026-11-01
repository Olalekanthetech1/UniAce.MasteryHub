export type InstructionalActivityType =
  | 'guidedPractice'
  | 'independentPractice'
  | 'knowledgeChecks';

/**
 * Public lesson delivery contract. Assessment answers and diagnostic rubrics
 * stay in Neon and are returned only by the persisted-attempt endpoint.
 */
export function redactInstructionalAnswersForStudent(value: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const stripKeys = (item: any, keys: string[]) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const copy = { ...item };
    for (const key of keys) delete copy[key];
    return copy;
  };

  return {
    ...value,
    guidedPractice: Array.isArray(value.guidedPractice)
      ? value.guidedPractice.map((item: any) =>
          stripKeys(item, ['expectedApproach', 'expectedAnswer', 'explanation', 'diagnosticSignals'])
        )
      : [],
    independentPractice: Array.isArray(value.independentPractice)
      ? value.independentPractice.map((item: any) =>
          stripKeys(item, ['expectedApproach', 'expectedAnswer', 'explanation', 'diagnosticSignals'])
        )
      : [],
    knowledgeChecks: Array.isArray(value.knowledgeChecks)
      ? value.knowledgeChecks.map((item: any) =>
          stripKeys(item, ['expectedReasoning', 'answerOrRubric', 'misconceptionSignals'])
        )
      : []
  };
}

/** Select the reveal payload for one activity without modifying stored content. */
export function getInstructionalActivityReveal(
  instructionalContent: any,
  activityType: InstructionalActivityType,
  activityIndex: number
): Record<string, string> {
  if (!Number.isInteger(activityIndex) || activityIndex < 0) {
    throw new Error('A valid activity index is required');
  }

  const list = instructionalContent?.[activityType];
  const activity = Array.isArray(list) ? list[activityIndex] : null;
  if (!activity) throw new Error('Lesson activity not found');

  if (activityType === 'knowledgeChecks') {
    if (typeof activity.expectedReasoning !== 'string' || typeof activity.answerOrRubric !== 'string') {
      throw new Error('This knowledge check has no stored comparison guide');
    }
    return {
      expectedReasoning: activity.expectedReasoning,
      answerOrRubric: activity.answerOrRubric
    };
  }

  if (
    typeof activity.expectedApproach !== 'string' ||
    typeof activity.expectedAnswer !== 'string' ||
    typeof activity.explanation !== 'string'
  ) {
    throw new Error('This practice item has no stored explanation');
  }

  return {
    expectedApproach: activity.expectedApproach,
    expectedAnswer: activity.expectedAnswer,
    explanation: activity.explanation
  };
}
