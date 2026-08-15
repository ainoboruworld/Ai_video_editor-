import type { AspectRatio } from '@/lib/engine';
import { deriveQueries, tokenize } from '@/lib/media/rank';
import type { StoryboardPayload } from './schemas';

/**
 * Deterministic draft generator used when no AI provider is configured.
 *
 * This is NOT pretending to be a language model: responses are labelled
 * `provider: "offline"` everywhere in the UI and API so the user always knows
 * they are looking at a structural draft. It exists because the editor must
 * stay usable with an empty environment — it lays out a real, editable
 * storyboard (beats, durations, on-screen text and stock queries) that the
 * user can then rewrite by hand or regenerate once a key is added.
 */

interface Beat {
  title: string;
  visualTemplate: string;
  textTemplate: string;
  scriptTemplate: string;
  weight: number;
}

const BEATS: Beat[] = [
  {
    title: 'Hook',
    visualTemplate: 'wide establishing shot of {subject}',
    textTemplate: '{subject}',
    scriptTemplate: 'Here is what nobody tells you about {subject}.',
    weight: 0.9,
  },
  {
    title: 'Context',
    visualTemplate: 'close-up detail of {subject}',
    textTemplate: 'Why it matters',
    scriptTemplate: '{subject} is easy to get wrong, and the difference shows.',
    weight: 1.1,
  },
  {
    title: 'Proof',
    visualTemplate: 'person working with {subject}',
    textTemplate: 'The difference',
    scriptTemplate: 'The people who get it right all do the same few things.',
    weight: 1.15,
  },
  {
    title: 'Detail',
    visualTemplate: 'slow motion macro shot of {subject}',
    textTemplate: 'Look closer',
    scriptTemplate: 'Look closely and you can see it immediately.',
    weight: 1.05,
  },
  {
    title: 'Payoff',
    visualTemplate: 'happy people enjoying {subject}',
    textTemplate: 'The result',
    scriptTemplate: 'That is what makes the result worth it.',
    weight: 1.0,
  },
  {
    title: 'Call to action',
    visualTemplate: 'bright hero shot of {subject}',
    textTemplate: 'Follow for more',
    scriptTemplate: 'Follow for more on {subject}.',
    weight: 0.8,
  },
];

/** Pulls the subject phrase out of a brief like "Create a 30s reel about X". */
export function extractSubject(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  const about = cleaned.match(/\babout\s+(.+)$/i)?.[1];
  const forMatch = cleaned.match(/\bfor\s+(.+)$/i)?.[1];
  const candidate = about ?? forMatch ?? cleaned;
  const trimmed = candidate
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return cleaned.slice(0, 60) || 'the topic';
  return tokens.slice(0, 4).join(' ');
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function offlineStoryboard(input: {
  prompt: string;
  durationSeconds: number;
  aspect: AspectRatio;
  sceneCount?: number;
  tone?: string;
}): StoryboardPayload {
  const subject = extractSubject(input.prompt);
  const total = Math.max(5, input.durationSeconds);
  const count = Math.max(2, Math.min(BEATS.length, input.sceneCount ?? Math.max(3, Math.min(6, Math.round(total / 5)))));

  // Distribute the total duration across the chosen beats using their weights.
  const beats = pickBeats(count);
  const weightSum = beats.reduce((sum, b) => sum + b.weight, 0);
  const durations = beats.map((b) => Math.max(1.5, Math.round(((b.weight / weightSum) * total) * 10) / 10));
  const drift = Math.round((total - durations.reduce((a, b) => a + b, 0)) * 10) / 10;
  if (durations.length > 0) durations[durations.length - 1] = Math.max(1.5, durations[durations.length - 1]! + drift);

  const scenes = beats.map((beat, index) => {
    const visual = beat.visualTemplate.replace('{subject}', subject);
    return {
      title: beat.title,
      duration: durations[index]!,
      script: beat.scriptTemplate.replace(/\{subject\}/g, subject),
      onScreenText: titleCase(beat.textTemplate.replace('{subject}', subject)),
      visual,
      brollQueries: deriveQueries(visual, 3),
      transition: (index === 0 ? 'fade' : 'cut') as StoryboardPayload['scenes'][number]['transition'],
    };
  });

  return {
    title: titleCase(subject),
    hook: `Here is what nobody tells you about ${subject}.`,
    cta: 'Follow for more.',
    tone: input.tone ?? 'draft',
    scenes,
  };
}

function pickBeats(count: number): Beat[] {
  if (count >= BEATS.length) return BEATS;
  // Always keep the hook and the CTA, fill the middle evenly.
  const first = BEATS[0]!;
  const last = BEATS[BEATS.length - 1]!;
  const middlePool = BEATS.slice(1, -1);
  const middleCount = Math.max(0, count - 2);
  const step = middlePool.length / Math.max(1, middleCount);
  const middle: Beat[] = [];
  for (let i = 0; i < middleCount; i++) {
    middle.push(middlePool[Math.min(middlePool.length - 1, Math.floor(i * step))]!);
  }
  return count === 1 ? [first] : [first, ...middle, last];
}

/** Splits narration into short caption cues without any model call. */
export function offlineCaptionCues(
  text: string,
  start: number,
  duration: number,
  maxWords = 5,
): { text: string; start: number; end: number }[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const groups: string[][] = [];
  for (let i = 0; i < words.length; i += maxWords) groups.push(words.slice(i, i + maxWords));
  const per = duration / groups.length;
  return groups.map((group, index) => ({
    text: group.join(' '),
    start: round(start + index * per),
    end: round(start + (index + 1) * per),
  }));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
