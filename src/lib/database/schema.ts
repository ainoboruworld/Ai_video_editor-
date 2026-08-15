import { z } from 'zod';
import { MAX_THUMBNAIL_CHARS } from '@/lib/storage/limits';

/**
 * Validation for untrusted project documents arriving from the browser.
 * The engine's own types stay the source of truth; this schema guards the
 * boundary (shape, ranges and size) so a malformed or malicious payload can
 * never be persisted or rendered.
 */

const finite = z.number().finite();

const transformSchema = z
  .object({
    x: finite,
    y: finite,
    scale: finite.min(0.01).max(50),
    rotation: finite.min(-3600).max(3600),
    opacity: finite.min(0).max(1),
  })
  .passthrough();

const cropSchema = z
  .object({
    left: finite.min(0).max(1),
    right: finite.min(0).max(1),
    top: finite.min(0).max(1),
    bottom: finite.min(0).max(1),
  })
  .nullable();

const filtersSchema = z
  .object({
    brightness: finite.min(-1).max(1),
    contrast: finite.min(0).max(4),
    saturation: finite.min(0).max(4),
    temperature: finite.min(-1).max(1),
    blur: finite.min(0).max(80),
    grayscale: z.boolean(),
    vignette: z.boolean(),
  })
  .passthrough();

const clipSchema = z
  .object({
    id: z.string().min(1).max(120),
    kind: z.enum(['video', 'audio', 'image', 'text', 'caption']),
    name: z.string().max(200),
    assetId: z.string().max(120).nullable(),
    start: finite.min(0).max(60 * 60 * 6),
    duration: finite.min(0.01).max(60 * 60 * 6),
    sourceIn: finite.min(0),
    speed: finite.min(0.05).max(16),
    volume: finite.min(0).max(4),
    muted: z.boolean(),
    fadeIn: finite.min(0),
    fadeOut: finite.min(0),
    transform: transformSchema,
    crop: cropSchema,
    filters: filtersSchema,
  })
  .passthrough();

const trackSchema = z
  .object({
    id: z.string().min(1).max(120),
    kind: z.enum(['video', 'audio', 'text', 'caption']),
    role: z.string().max(40).optional(),
    name: z.string().max(120),
    clips: z.array(clipSchema).max(600),
    locked: z.boolean(),
    visible: z.boolean(),
    muted: z.boolean(),
    solo: z.boolean(),
  })
  .passthrough();

export const sequenceSchema = z
  .object({
    id: z.string().min(1).max(120),
    name: z.string().max(200),
    width: z.number().int().min(64).max(7680),
    height: z.number().int().min(64).max(7680),
    fps: z.number().min(1).max(120),
    aspect: z.enum(['16:9', '9:16', '1:1', '4:5', '4:3']),
    tracks: z.array(trackSchema).max(40),
    markers: z
      .array(z.object({ id: z.string().max(120), time: finite.min(0), label: z.string().max(200), color: z.string().max(32) }))
      .max(500),
  })
  .passthrough();

export const assetSchema = z
  .object({
    id: z.string().min(1).max(120),
    kind: z.enum(['video', 'audio', 'image']),
    name: z.string().max(300),
    url: z.string().max(2000),
    thumbnailUrl: z.string().max(MAX_THUMBNAIL_CHARS).nullable(),
    duration: finite.min(0).nullable(),
    width: z.number().int().min(0).nullable(),
    height: z.number().int().min(0).nullable(),
    sizeBytes: z.number().int().min(0).nullable(),
    mimeType: z.string().max(120).nullable(),
    origin: z.enum(['upload', 'stock', 'generated', 'link']),
    storageKey: z.string().max(400).nullable(),
    credit: z
      .object({
        provider: z.string().max(40),
        providerLabel: z.string().max(80),
        creator: z.string().max(200).nullable(),
        creatorUrl: z.string().max(1000).nullable(),
        sourceUrl: z.string().max(1000).nullable(),
        license: z.string().max(300),
      })
      .nullable(),
    createdAt: z.string().max(40),
    ephemeral: z.boolean().optional(),
  })
  .passthrough();

export const storyboardSceneSchema = z
  .object({
    id: z.string().min(1).max(120),
    index: z.number().int().min(0).max(200),
    title: z.string().max(200),
    duration: finite.min(0.1).max(3600),
    script: z.string().max(4000),
    onScreenText: z.string().max(500),
    visual: z.string().max(1000),
    brollQueries: z.array(z.string().max(200)).max(10),
    assetId: z.string().max(120).nullable(),
    transition: z.string().max(40),
    clipIds: z.array(z.string().max(120)).max(50),
  })
  .passthrough();

export const projectDocSchema = z.object({
  name: z.string().min(1).max(160),
  aspect: z.enum(['16:9', '9:16', '1:1', '4:5', '4:3']),
  fps: z.number().min(1).max(120),
  sequence: sequenceSchema,
  assets: z.array(assetSchema).max(500),
  storyboard: z
    .object({
      prompt: z.string().max(4000),
      title: z.string().max(300),
      hook: z.string().max(1000),
      cta: z.string().max(1000),
      tone: z.string().max(120),
      scenes: z.array(storyboardSceneSchema).max(60),
      provider: z.enum(['groq', 'openrouter', 'cloudflare', 'huggingface', 'ollama', 'gemini', 'openai', 'offline']),
      createdAt: z.string().max(40),
    })
    .nullable()
    .optional(),
  transcript: z
    .object({
      segments: z
        .array(
          z.object({
            id: z.string().max(120),
            start: finite.min(0),
            end: finite.min(0),
            text: z.string().max(2000),
          }),
        )
        .max(5000),
      source: z.enum(['local', 'hosted', 'manual']),
      estimatedTimings: z.boolean(),
      createdAt: z.string().max(40),
    })
    .nullable()
    .optional(),
  settings: z
    .object({
      brollProviders: z.array(z.enum(['pexels', 'pixabay', 'unsplash'])).max(3),
      captionStyle: z.string().max(40),
      musicVolume: finite.min(0).max(2),
      voiceoverVolume: finite.min(0).max(2),
    })
    .partial()
    .optional(),
  version: z.number().int().min(0).optional(),
});

export type ProjectDocInput = z.infer<typeof projectDocSchema>;
