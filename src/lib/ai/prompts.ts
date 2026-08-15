import type { AspectRatio } from '@/lib/engine';

const FORMAT_NOTES: Record<AspectRatio, string> = {
  '9:16': 'vertical full-screen (Reels/TikTok/Shorts): hook in the first 1.5 seconds, fast cuts, large on-screen text',
  '16:9': 'landscape (YouTube): room for a slower open, wider establishing shots, lower-third text',
  '1:1': 'square feed video: centred framing, text kept inside the middle third',
  '4:5': 'vertical feed video: centred framing, text kept away from the top and bottom 12%',
  '4:3': 'classic 4:3: centred framing, moderate pacing',
};

export const BROLL_SYSTEM = `You turn a scene description into stock-footage search queries for Pexels/Pixabay/Unsplash.
Queries must be 2-5 words, visually concrete, and free of brand names, proper nouns and abstract concepts.
Order them from most specific to most generic so the last query is a safe fallback.`;

export const BROLL_SCHEMA_HINT = `{ "queries": string[] }`;

export const EDIT_PLAN_SYSTEM = `You are an experienced video editor working from a transcript of footage the user has already recorded.
You decide what to keep, not what to invent. Rules:
- Every timestamp you emit must come from the transcript's own time range. Never invent time beyond it.
- "keep" segments are the parts worth watching, in chronological order and non-overlapping. Cut rambling, false starts, repetitions and tangents.
- Respect the requested target length. If no target is given, keep everything that earns its place.
- Cut on natural sentence boundaries so the result does not sound clipped.
- "brollCues" mark moments where the speaker describes something visual; the query must be a concrete stock-footage phrase, not an abstract idea.
- "callouts" are short on-screen text (max 6 words) for the strongest points.
- "remove" lists what you are cutting and why, in plain language the user can check ("filler", "false start", "repeats the previous point"). Every second of the footage should be in exactly one of keep or remove.`;

export const EDIT_PLAN_SCHEMA_HINT = `{
  "summary": string,
  "title": string,
  "keep": [{ "start": number, "end": number, "reason": string }],
  "remove": [{ "start": number, "end": number, "reason": string }],
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
