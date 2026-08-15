import { z } from 'zod';

/**
 * AI output is untrusted input. Every model response is parsed with these
 * schemas before it is allowed anywhere near a project document.
 */

export const sceneSchema = z.object({
  title: z.string().min(1).max(120),
  duration: z.number().min(0.5).max(120),
  script: z.string().max(1200).default(''),
  onScreenText: z.string().max(240).default(''),
  visual: z.string().min(1).max(400),
  brollQueries: z.array(z.string().min(2).max(120)).max(6).default([]),
  transition: z
    .enum(['cut', 'fade', 'cross-dissolve', 'dip-to-black', 'dip-to-white', 'slide', 'zoom', 'blur'])
    .default('cut'),
});

export const storyboardSchema = z.object({
  title: z.string().min(1).max(160),
  hook: z.string().max(300).default(''),
  cta: z.string().max(300).default(''),
  tone: z.string().max(80).default('confident'),
  scenes: z.array(sceneSchema).min(1).max(24),
});

export const brollQuerySchema = z.object({
  queries: z.array(z.string().min(2).max(120)).min(1).max(8),
});

export const captionCuesSchema = z.object({
  cues: z
    .array(
      z.object({
        text: z.string().min(1).max(300),
        start: z.number().min(0),
        end: z.number().min(0),
      }),
    )
    .max(400),
});

export const suggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        detail: z.string().max(400).default(''),
        severity: z.enum(['info', 'improve', 'fix']).default('improve'),
      }),
    )
    .max(12),
});

export const titlesSchema = z.object({
  titles: z.array(z.string().min(1).max(120)).max(10),
  description: z.string().max(600).default(''),
  hashtags: z.array(z.string().max(40)).max(15).default([]),
});

export type StoryboardPayload = z.infer<typeof storyboardSchema>;
export type BrollQueryPayload = z.infer<typeof brollQuerySchema>;
export type CaptionCuesPayload = z.infer<typeof captionCuesSchema>;
export type SuggestionsPayload = z.infer<typeof suggestionsSchema>;
export type TitlesPayload = z.infer<typeof titlesSchema>;

/** An edit plan for footage the user already has. */
export const editPlanSchema = z.object({
  summary: z.string().max(600).default(''),
  title: z.string().max(160).default(''),
  /** Segments of the source worth keeping, in source-time seconds. */
  keep: z
    .array(
      z.object({
        start: z.number().min(0),
        end: z.number().min(0),
        reason: z.string().max(200).default(''),
      }),
    )
    .max(200)
    .default([]),
  /** Segments to drop, with why — shown to the user before anything is cut. */
  remove: z
    .array(
      z.object({
        start: z.number().min(0),
        end: z.number().min(0),
        reason: z.string().max(200).default(''),
      }),
    )
    .max(200)
    .default([]),
  /** Moments where a cutaway would help, with a stock query for each. */
  brollCues: z
    .array(
      z.object({
        start: z.number().min(0),
        duration: z.number().min(0.5).max(30).default(3),
        query: z.string().min(2).max(120),
        reason: z.string().max(200).default(''),
      }),
    )
    .max(40)
    .default([]),
  /** Short on-screen titles to reinforce key points. */
  callouts: z
    .array(
      z.object({
        start: z.number().min(0),
        duration: z.number().min(0.5).max(20).default(2.5),
        text: z.string().min(1).max(80),
      }),
    )
    .max(40)
    .default([]),
});

export type EditPlanPayload = z.infer<typeof editPlanSchema>;
