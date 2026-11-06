import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSrtFromAlignment,
  formatSubtitleTimestamp,
  sanitizeDemoVideoFileName
} from '../server/services/demoNarration';

test('formats subtitle timestamps with milliseconds', () => {
  assert.equal(formatSubtitleTimestamp(0), '00:00:00,000');
  assert.equal(formatSubtitleTimestamp(61.234), '00:01:01,234');
  assert.equal(formatSubtitleTimestamp(3661.9), '01:01:01,900');
});

test('rejects negative or non-finite subtitle timestamps', () => {
  assert.throws(() => formatSubtitleTimestamp(-0.1), /invalid timestamp/i);
  assert.throws(() => formatSubtitleTimestamp(Number.NaN), /invalid timestamp/i);
});

test('builds subtitle cues from verified character-level alignment', () => {
  const text = 'Hello UniAce.';
  const characters = Array.from(text);
  const starts = characters.map((_character, index) => index * 0.2);
  const ends = characters.map((_character, index) => index * 0.2 + 0.15);

  const srt = buildSrtFromAlignment({
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends
  });

  assert.equal(
    srt,
    '1\n00:00:00,000 --> 00:00:02,550\nHello UniAce.\n'
  );
});

test('fails closed when ElevenLabs alignment is missing or inconsistent', () => {
  assert.throws(() => buildSrtFromAlignment({
    characters: [],
    character_start_times_seconds: [],
    character_end_times_seconds: []
  }), /complete character-level timing/i);

  assert.throws(() => buildSrtFromAlignment({
    characters: ['A'],
    character_start_times_seconds: [],
    character_end_times_seconds: [0.2]
  }), /complete character-level timing/i);

  assert.throws(() => buildSrtFromAlignment({
    characters: ['A'],
    character_start_times_seconds: [0.3],
    character_end_times_seconds: [0.2]
  }), /malformed character alignment/i);
});

test('sanitizes output names without retaining path components', () => {
  assert.equal(sanitizeDemoVideoFileName('../../My Demo Clip.mov'), 'My-Demo-Clip');
  assert.equal(sanitizeDemoVideoFileName(''), 'uniace-demo');
});
