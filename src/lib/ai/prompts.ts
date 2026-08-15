import type { AspectRatio } from '@/lib/engine';

const FORMAT_NOTES: Record<AspectRatio, string> = {
  '9:16': 'vertical full-screen (Reels/TikTok/Shorts): hook in the first 1.5 seconds, fast cuts, large on-screen text',
  '16:9': 'landscape (YouTube): room for a slower open, wider establishing shots, lower-third text',
  '1:1': 'square feed video: centred framing, text kept inside the middle third',
  '4:5': 'vertical feed video: centred framing, text kept away from the top and bottom 12%',
  '4:3': 'classic 4:3: centred framing, moderate pacing',
};

export const STORYBOARD_SYSTEM = `You are a senior short-form video director and copywriter.
You plan videos that will be assembled from free stock footage (Pexels, Pixabay, Unsplash).
Rules:
- Every scene must be filmable with generic stock footage. Never require a specific person, brand or logo.
- "visual" describes what is on screen in plain language a stock library can match (e.g. "close-up of a farmer picking ripe mangoes").
- "brollQueries" are 2-4 short stock-search phrases for that visual, most specific first.
- "onScreenText" is short (max 8 words), punchy and readable on a phone.
- "script" is the spoken narration for the scene, written to be read aloud at ~2.6 words per second.
- Scene durations must add up to the requested total duration (±1 second).`;

export function storyboardPrompt(input: {
  prompt: string;
  durationSeconds: number;
  aspect: AspectRatio;
  tone?: string;
  sceneCount?: number;
  language?: string;
}): string {
  const sceneCount = input.sceneCount ?? Math.max(3, Math.min(10, Math.round(input.durationSeconds / 5)));
  return [
    `Brief: ${input.prompt}`,
    `Total duration: ${input.durationSeconds} seconds.`,
    `Scenes: exactly ${sceneCount}.`,
    `Format: ${FORMAT_NOTES[input.aspect]}.`,
    input.tone ? `Tone: ${input.tone}.` : 'Tone: pick the one that fits the brief.',
    input.language && input.language !== 'en' ? `Write all copy in: ${input.language}.` : '',
    'Open with a scroll-stopping hook and close with a clear call to action.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const STORYBOARD_SCHEMA_HINT = `{
  "title": string,
  "hook": string,
  "cta": string,
  "tone": string,
  "scenes": [
    {
      "title": string,
      "duration": number,
      "script": string,
      "onScreenText": string,
      "visual": string,
      "brollQueries": string[],
      "transition": "cut" | "fade" | "cross-dissolve" | "dip-to-black" | "dip-to-white" | "slide" | "zoom" | "blur"
    }
  ]
}`;

export const BROLL_SYSTEM = `You turn a scene description into stock-footage search queries for Pexels/Pixabay/Unsplash.
Queries must be 2-5 words, visually concrete, and free of brand names, proper nouns and abstract concepts.
Order them from most specific to most generic so the last query is a safe fallback.`;

export const BROLL_SCHEMA_HINT = `{ "queries": string[] }`;

export const CAPTION_SYSTEM = `You split narration into short caption cues for burned-in subtitles.
Each cue is at most 6 words. Cues must not overlap and must stay inside the scene time range.`;

export const CAPTION_SCHEMA_HINT = `{ "cues": [{ "text": string, "start": number, "end": number }] }`;

export const SUGGESTION_SYSTEM = `You are an experienced editor reviewing a timeline described as JSON.
Give specific, actionable notes about pacing, silence, missing captions, B-roll coverage, audio levels and hooks.
Never invent clips that are not in the data.`;

export const SUGGESTION_SCHEMA_HINT = `{ "suggestions": [{ "title": string, "detail": string, "severity": "info" | "improve" | "fix" }] }`;

export const TITLES_SYSTEM = `You write titles, descriptions and hashtags for social video.
Titles are under 60 characters. Hashtags have no spaces and no leading punctuation other than #.`;

export const TITLES_SCHEMA_HINT = `{ "titles": string[], "description": string, "hashtags": string[] }`;

export const EDIT_PLAN_SYSTEM = `You are an experienced video editor working from a transcript of footage the user has already recorded.
You decide what to keep, not what to invent. Rules:
- Every timestamp you emit must come from the transcript's own time range. Never invent time beyond it.
- "keep" segments are the parts worth watching, in chronological order and non-overlapping. Cut rambling, false starts, repetitions and tangents.
- Respect the requested target length. If no target is given, keep everything that earns its place.
- Cut on natural sentence boundaries so the result does not sound clipped.
- "brollCues" mark moments where the speaker describes something visual; the query must be a concrete stock-footage phrase, not an abstract idea.
- "callouts" are short on-screen text (max 6 words) for the strongest points.`;

export const EDIT_PLAN_SCHEMA_HINT = `{
  "summary": string,
  "title": string,
  "keep": [{ "start": number, "end": number, "reason": string }],
  "brollCues": [{ "start": number, "duration": number, "query": string, "reason": string }],
  "callouts": [{ "start": number, "duration": number, "text": string }]
}`;

export function editPlanPrompt(input: {
  transcript: string;
  durationSeconds: number;
  targetSeconds?: number;
  goal?: string;
}): string {
  return [
    `Footage duration: ${input.durationSeconds.toFixed(1)} seconds.`,
    input.targetSeconds ? `Target length after editing: about ${input.targetSeconds} seconds.` : 'No strict target length.',
    input.goal ? `Editing goal: ${input.goal}` : 'Editing goal: keep it tight and engaging, strongest moment first.',
    '',
    'Transcript with timings:',
    input.transcript,
  ].join('\n');
}
