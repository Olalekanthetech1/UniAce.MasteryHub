export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export function formatSubtitleTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error('Subtitle timing contains an invalid timestamp.');
  }
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(wholeSeconds).padStart(2, '0')
  ].join(':') + ',' + String(remainder).padStart(3, '0');
}

/**
 * Builds real SRT cues from ElevenLabs character-level alignment.
 * It deliberately fails when alignment is missing or inconsistent; it never
 * estimates subtitle timing from text length or video duration.
 */
export function buildSrtFromAlignment(alignment: ElevenLabsAlignment): string {
  const characters = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;

  if (
    !Array.isArray(characters) ||
    characters.length === 0 ||
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    starts.length !== characters.length ||
    ends.length !== characters.length
  ) {
    throw new Error('ElevenLabs did not return complete character-level timing. Subtitles cannot be generated accurately.');
  }

  const words: TimedWord[] = [];
  let currentText = '';
  let currentStart = Number.POSITIVE_INFINITY;
  let currentEnd = 0;

  const flushWord = () => {
    const text = currentText.trim();
    if (text) {
      if (!Number.isFinite(currentStart) || currentEnd <= currentStart) {
        throw new Error('ElevenLabs returned invalid timing for a narration word.');
      }
      words.push({ text, start: currentStart, end: currentEnd });
    }
    currentText = '';
    currentStart = Number.POSITIVE_INFINITY;
    currentEnd = 0;
  };

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const start = starts[index];
    const end = ends[index];

    if (typeof character !== 'string' || typeof start !== 'number' || typeof end !== 'number' ||
        !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new Error('ElevenLabs returned malformed character alignment. Subtitles cannot be generated.');
    }

    if (/^\s$/u.test(character)) {
      flushWord();
      continue;
    }

    currentText += character;
    currentStart = Math.min(currentStart, start);
    currentEnd = Math.max(currentEnd, end);
  }
  flushWord();

  if (words.length === 0) {
    throw new Error('ElevenLabs returned no timed words for the approved narration.');
  }

  const cues: Array<{ start: number; end: number; text: string }> = [];
  let group: TimedWord[] = [];

  const flushCue = () => {
    if (group.length === 0) return;
    cues.push({
      start: group[0].start,
      end: group[group.length - 1].end,
      text: group.map((word) => word.text).join(' ')
    });
    group = [];
  };

  for (const word of words) {
    const proposed = [...group, word];
    const proposedText = proposed.map((entry) => entry.text).join(' ');
    const proposedDuration = proposed[proposed.length - 1].end - proposed[0].start;
    const sentenceEnd = /[.!?]["'”’)]?$/u.test(word.text);
    if (
      group.length > 0 &&
      (proposed.length > 7 || proposedText.length > 48 || proposedDuration > 4.5)
    ) {
      flushCue();
    }
    group.push(word);
    if (sentenceEnd || group.length >= 7) flushCue();
  }
  flushCue();

  return cues.map((cue, index) => {
    if (cue.end <= cue.start) {
      throw new Error('Subtitle cue has a non-positive duration.');
    }
    return String(index + 1) + '\n' +
      formatSubtitleTimestamp(cue.start) + ' --> ' + formatSubtitleTimestamp(cue.end) + '\n' +
      cue.text;
  }).join('\n\n') + '\n';
}

export function sanitizeDemoVideoFileName(fileName: string): string {
  const base = String(fileName || 'uniace-demo').replace(/\.[^.]+$/, '');
  const safe = base.normalize('NFKC').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return safe || 'uniace-demo';
}
