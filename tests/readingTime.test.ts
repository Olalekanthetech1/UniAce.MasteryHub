import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateReadingTime,
  calculateSubTopicReadingTime,
  calculateModuleReadingTime,
  formatReadingTime
} from '../src/utils/readingTime.js';

test('returns hasContent: false for empty or ungenerated placeholder content', () => {
  const emptyEstimate = calculateReadingTime('');
  assert.equal(emptyEstimate.hasContent, false);
  assert.equal(emptyEstimate.wordCount, 0);
  assert.equal(emptyEstimate.minutes, 0);
  assert.equal(emptyEstimate.formatted, '');

  const placeholderEstimate = calculateReadingTime(
    "### Content Not Available\n\nThis lesson content hasn't been generated yet."
  );
  assert.equal(placeholderEstimate.hasContent, false);
  assert.equal(placeholderEstimate.formatted, '');
});

test('calculates reading time from prose word count, equations, and figures', () => {
  const twoHundredWords = Array.from({ length: 200 }, (_, i) => `term${i + 1}`).join(' ');
  const content = [
    '## Section 1',
    twoHundredWords,
    '$$E = mc^2$$',
    'Inline formula $F = ma$ and $p = mv$.',
    '```function-plot\ny = x^2\n```'
  ].join('\n\n');

  const estimate = calculateReadingTime(content);
  assert.equal(estimate.hasContent, true);
  assert.ok(estimate.wordCount >= 200);
  assert.equal(estimate.equationCount, 3); // 1 display + 2 inline
  assert.equal(estimate.figureCount, 1); // 1 function-plot block
  assert.ok(estimate.totalSeconds > 60);
  assert.equal(estimate.minutes, 2);
  assert.equal(estimate.formatted, '2 min read');
});

test('aggregates module reading time across subtopics with content', () => {
  const firstTopicWords = Array.from({ length: 200 }, () => 'concept').join(' ');
  const secondTopicWords = Array.from({ length: 400 }, () => 'derivation').join(' ');

  const moduleEstimate = calculateModuleReadingTime([
    { content: firstTopicWords },
    { content: secondTopicWords },
    { content: '' }
  ]);

  assert.equal(moduleEstimate.hasContent, true);
  assert.equal(moduleEstimate.wordCount, 600);
  assert.equal(moduleEstimate.minutes, 3);
  assert.equal(moduleEstimate.formatted, '3 min read');
});

test('formatReadingTime handles short and multi-minute durations', () => {
  assert.equal(formatReadingTime(0, 0), '');
  assert.equal(formatReadingTime(1, 25), '< 1 min read');
  assert.equal(formatReadingTime(4, 240), '4 min read');
});
