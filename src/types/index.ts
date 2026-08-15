/**
 * Application domain types shared by the browser, the API routes and the
 * render worker. Everything here is JSON-serialisable: a project is a
 * document that can be stored, sent to an AI provider, or handed to the
 * renderer without any lossy conversion.
 */
import type { AspectRatio, Sequence, TransitionKind } from '@/lib/engine';

// ---------------------------------------------------------------- assets ---

export type AssetKind = 'video' | 'audio' | 'image';

export type AssetOrigin = 'upload' | 'stock' | 'generated' | 'link';

export type StockProvider = 'pexels' | 'pixabay' | 'unsplash';

/** Licensing/attribution metadata carried by every externally sourced asset. */
export interface AssetCredit {
  provider: StockProvider | 'user' | 'other';
  providerLabel: string;
  creator: string | null;
  creatorUrl: string | null;
  sourceUrl: string | null;
  license: string;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  /** Playable/displayable URL. Object storage URL, provider CDN URL or a blob: URL for local-only media. */
  url: string;
  /** Poster/thumbnail URL when available. */
  thumbnailUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  mimeType: string | null;
  origin: AssetOrigin;
  /** Storage key when the asset lives in object storage. */
  storageKey: string | null;
  credit: AssetCredit | null;
  createdAt: string;
  /** True when the URL is only valid in the browser tab that created it (blob:). */
  ephemeral?: boolean;
}

// ------------------------------------------------------------ storyboard ---

export interface StoryboardScene {
  id: string;
  index: number;
  title: string;
  /** Target duration in seconds. */
  duration: number;
  /** Narration / spoken script for the scene. */
  script: string;
  /** Text burned on screen. */
  onScreenText: string;
  /** Plain-language description of the required visual. */
  visual: string;
  /** Stock search queries derived from `visual`. */
  brollQueries: string[];
  /** Asset id chosen for this scene (from the media library). */
  assetId: string | null;
  transition: TransitionKind | 'cut';
  /** Ids of the clips this scene produced on the timeline. */
  clipIds: string[];
}

export interface Storyboard {
  prompt: string;
  title: string;
  hook: string;
  cta: string;
  tone: string;
  scenes: StoryboardScene[];
  /** Which provider produced this storyboard. */
  provider: AiProviderName;
  createdAt: string;
}

// --------------------------------------------------------------- project ---

export interface ProjectSettings {
  /** Preferred stock provider order for B-roll search. */
  brollProviders: StockProvider[];
  captionStyle: string;
  musicVolume: number;
  voiceoverVolume: number;
}

/** A transcript segment as stored on the project. */
export interface StoredTranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface StoredTranscript {
  segments: StoredTranscriptSegment[];
  source: 'local' | 'hosted' | 'manual';
  estimatedTimings: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  aspect: AspectRatio;
  width: number;
  height: number;
  fps: number;
  sequence: Sequence;
  assets: Asset[];
  storyboard: Storyboard | null;
  /** Whatever transcript the project has, from any source. */
  transcript: StoredTranscript | null;
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency counter, bumped on every server-side save. */
  version: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  aspect: AspectRatio;
  duration: number;
  updatedAt: string;
  createdAt: string;
  thumbnailUrl: string | null;
  sceneCount: number;
  assetCount: number;
}

// ---------------------------------------------------------- stock search ---

export type StockMediaType = 'video' | 'image';

export type Orientation = 'landscape' | 'portrait' | 'square';

export interface StockMediaItem {
  id: string;
  provider: StockProvider;
  type: StockMediaType;
  /** Human title/description from the provider. */
  title: string;
  thumbnailUrl: string;
  /** Small file used for hover preview (videos only). */
  previewUrl: string | null;
  /** Full-quality file added to the timeline. */
  downloadUrl: string;
  width: number;
  height: number;
  duration: number | null;
  orientation: Orientation;
  creator: string | null;
  creatorUrl: string | null;
  sourceUrl: string;
  license: string;
  /** 0..1 ranking score produced by our matcher. */
  score?: number;
}

export interface MediaSearchRequest {
  query: string;
  type?: StockMediaType | 'all';
  orientation?: Orientation;
  minDuration?: number;
  perPage?: number;
  page?: number;
  providers?: StockProvider[];
}

export interface MediaSearchResponse {
  items: StockMediaItem[];
  /** Providers that were queried successfully. */
  providers: StockProvider[];
  /** Providers that are not configured (missing API key). */
  missingKeys: StockProvider[];
  /** Provider errors, keyed by provider. */
  errors: Record<string, string>;
  query: string;
}

// ------------------------------------------------------------------- AI ----

export type AiProviderName =
  | 'groq'
  | 'openrouter'
  | 'cloudflare'
  | 'huggingface'
  | 'ollama'
  | 'gemini'
  | 'openai'
  | 'offline';

export interface ScriptRequest {
  prompt: string;
  durationSeconds: number;
  aspect: AspectRatio;
  tone?: string;
  language?: string;
  sceneCount?: number;
}

export interface AiCapabilities {
  ai: {
    available: boolean;
    providers: AiProviderName[];
    active: AiProviderName;
    /** Every provider the build knows about, with whether it is configured. */
    catalog: { name: AiProviderName; label: string; configured: boolean }[];
  };
  stock: { pexels: boolean; pixabay: boolean; unsplash: boolean };
  storage: { available: boolean; driver: string; directUpload: boolean };
  database: { driver: string; durable: boolean };
  transcription: { available: boolean; provider: string | null; providers: string[] };
  rendering: { browser: boolean; cloud: boolean; worker: string | null };
}

export interface CaptionCue {
  text: string;
  start: number;
  end: number;
  words: { text: string; start: number; end: number }[];
}

// -------------------------------------------------------------- rendering --

export type RenderStatus = 'queued' | 'rendering' | 'processing' | 'complete' | 'failed';

export interface RenderJob {
  id: string;
  projectId: string;
  ownerId: string;
  status: RenderStatus;
  progress: number;
  message: string;
  width: number;
  height: number;
  fps: number;
  format: 'mp4' | 'webm';
  outputUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportSettings {
  resolution: 720 | 1080 | 1440;
  fps: 24 | 30 | 60;
  format: 'mp4' | 'webm';
  quality: 'standard' | 'high';
  target: 'browser' | 'cloud';
}
