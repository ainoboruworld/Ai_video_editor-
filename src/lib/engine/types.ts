/**
 * Core editing model. Pure data — no React, no DOM, no Node APIs.
 * Times are in seconds unless suffixed otherwise.
 */

export type TrackKind = 'video' | 'audio' | 'text' | 'caption';

/**
 * Editorial role of a track. `kind` drives engine behaviour (how a clip is
 * played and composited); `role` drives the timeline UI, AI placement and
 * default routing (e.g. "put this B-roll on the b-roll track").
 */
export type TrackRole =
  | 'video'
  | 'broll'
  | 'overlay'
  | 'text'
  | 'caption'
  | 'audio'
  | 'music'
  | 'voiceover';

export type ClipKind = 'video' | 'audio' | 'image' | 'text' | 'caption' | 'graphic';

export interface Transform {
  x: number; // px offset from center, in sequence coordinate space
  y: number;
  scale: number; // 1 = 100%
  rotation: number; // degrees
  opacity: number; // 0..1
}

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

export interface Crop {
  left: number; // 0..1 fraction cropped from each side
  right: number;
  top: number;
  bottom: number;
}

export interface Keyframe {
  time: number; // seconds relative to clip start (timeline-space)
  value: number;
}

/** Keyframable properties. Static value used when no keyframes present. */
export type KeyframableProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor: string | null;
  align: 'left' | 'center' | 'right';
  strokeColor: string | null;
  strokeWidth: number;
  shadow: boolean;
}

export type TextAnimation =
  | 'none'
  | 'fade'
  | 'slide'
  | 'pop'
  | 'scale'
  | 'typewriter'
  | 'word-reveal';

export type CaptionStyleName = 'minimal' | 'bold' | 'creator' | 'karaoke' | 'dynamic';

export interface CaptionWord {
  text: string;
  start: number; // seconds, timeline-space relative to clip start
  end: number;
}

export type TransitionKind =
  | 'fade'
  | 'cross-dissolve'
  | 'dip-to-black'
  | 'dip-to-white'
  | 'slide'
  | 'zoom'
  | 'blur';

export interface Transition {
  kind: TransitionKind;
  duration: number; // seconds
  position: 'in' | 'out';
}

export interface Filters {
  brightness: number; // -1..1, 0 neutral
  contrast: number; // 0..2, 1 neutral
  saturation: number; // 0..2, 1 neutral
  temperature: number; // -1..1, 0 neutral
  blur: number; // px
  grayscale: boolean;
  vignette: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  blur: 0,
  grayscale: false,
  vignette: false,
};

/**
 * Colour overrides for a caption clip.
 *
 * The preset decides the shape of the caption — size, weight, position,
 * whether it shouts — and these decide its colours. Kept separate so changing
 * the palette never quietly changes the layout, and so a caption that has been
 * recoloured keeps its new colours when the preset is swapped.
 */
export interface CaptionColors {
  text?: string;
  /** The word currently being spoken. Null turns karaoke highlighting off. */
  highlight?: string | null;
  /** Box behind the text. Null for no box. */
  background?: string | null;
  /** Outline, which is what keeps white text readable over bright footage. */
  stroke?: string | null;
}

export type GraphicKind = 'stat' | 'list' | 'quote' | 'citation';

/**
 * An on-screen graphic: the number, the list or the pull-quote a talking head
 * is describing. Drawn by the compositor rather than composited from an image,
 * so it stays sharp at any export size and stays editable as text.
 */
export interface Graphic {
  kind: GraphicKind;
  /** Small label above the headline. */
  title: string;
  /** The headline itself — the number, or the quote. */
  value: string;
  /** Small line underneath. */
  caption: string;
  /** Bullets, for the list kind. */
  items: string[];
  accent: string;
  position: 'left' | 'right' | 'centre';
}

export interface Clip {
  id: string;
  kind: ClipKind;
  name: string;
  /** Asset id in the media library. Null for text/caption clips. */
  assetId: string | null;
  /** Timeline position (seconds). */
  start: number;
  /** Timeline duration (seconds). */
  duration: number;
  /** Offset into source media where this clip begins (seconds). */
  sourceIn: number;
  /** Playback speed multiplier. Source consumed = duration * speed. */
  speed: number;
  volume: number; // 0..2
  muted: boolean;
  fadeIn: number; // audio fade seconds
  fadeOut: number;
  transform: Transform;
  crop: Crop | null;
  filters: Filters;
  keyframes: Partial<Record<KeyframableProp, Keyframe[]>>;
  transitionIn: Transition | null;
  transitionOut: Transition | null;
  /** For text / caption clips. */
  text: string | null;
  textStyle: TextStyle | null;
  textAnimation: TextAnimation;
  captionStyle: CaptionStyleName | null;
  /** Per-clip colour overrides on top of the caption preset. */
  captionColors: CaptionColors | null;
  captionWords: CaptionWord[] | null;
  /** For graphic clips. */
  graphic: Graphic | null;
  /** B-roll display mode when on an overlay track. */
  brollMode: 'fullscreen' | 'cutaway' | 'overlay' | 'pip' | null;
}

export interface Track {
  id: string;
  kind: TrackKind;
  role: TrackRole;
  name: string;
  clips: Clip[]; // kept sorted by start
  locked: boolean;
  visible: boolean;
  muted: boolean;
  solo: boolean;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
}

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '4:3';

export interface Sequence {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  aspect: AspectRatio;
  tracks: Track[];
  markers: Marker[];
}

export interface AssetRef {
  id: string;
  kind: 'video' | 'audio' | 'image';
  name: string;
  duration: number | null;
  width: number | null;
  height: number | null;
}

export function sequenceDuration(seq: Sequence): number {
  let end = 0;
  for (const track of seq.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.duration);
    }
  }
  return end;
}

export function makeDefaultTextStyle(): TextStyle {
  return {
    fontFamily: 'Inter',
    fontSize: 64,
    fontWeight: 700,
    color: '#ffffff',
    backgroundColor: null,
    align: 'center',
    strokeColor: null,
    strokeWidth: 0,
    shadow: true,
  };
}

export function makeClip(partial: Partial<Clip> & Pick<Clip, 'id' | 'kind' | 'start' | 'duration'>): Clip {
  return {
    name: '',
    assetId: null,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
    crop: null,
    filters: { ...DEFAULT_FILTERS },
    keyframes: {},
    transitionIn: null,
    transitionOut: null,
    text: null,
    textStyle: null,
    textAnimation: 'none',
    captionStyle: null,
    captionColors: null,
    captionWords: null,
    graphic: null,
    brollMode: null,
    ...partial,
  };
}

export function makeTrack(partial: Partial<Track> & Pick<Track, 'id' | 'kind' | 'name'>): Track {
  return {
    clips: [],
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    role: defaultRoleForKind(partial.kind),
    ...partial,
  };
}

function defaultRoleForKind(kind: TrackKind): TrackRole {
  switch (kind) {
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'text':
      return 'text';
    case 'caption':
      return 'caption';
  }
}

export const ASPECT_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '4:3': { width: 1440, height: 1080 },
};

export function makeSequence(id: string, name: string, aspect: AspectRatio = '16:9'): Sequence {
  const { width, height } = ASPECT_DIMENSIONS[aspect];
  return {
    id,
    name,
    width,
    height,
    fps: 30,
    aspect,
    markers: [],
    tracks: [
      makeTrack({ id: `${id}-v1`, kind: 'video', role: 'video', name: 'Video' }),
      makeTrack({ id: `${id}-v2`, kind: 'video', role: 'broll', name: 'B-roll' }),
      makeTrack({ id: `${id}-v3`, kind: 'video', role: 'overlay', name: 'Overlay' }),
      makeTrack({ id: `${id}-t1`, kind: 'text', role: 'text', name: 'Text' }),
      makeTrack({ id: `${id}-c1`, kind: 'caption', role: 'caption', name: 'Captions' }),
      makeTrack({ id: `${id}-a1`, kind: 'audio', role: 'audio', name: 'Audio' }),
      makeTrack({ id: `${id}-a2`, kind: 'audio', role: 'music', name: 'Music' }),
      makeTrack({ id: `${id}-a3`, kind: 'audio', role: 'voiceover', name: 'Voiceover' }),
    ],
  };
}


/** First track matching a role, falling back to the first track of a kind. */
export function trackByRole(seq: Sequence, role: TrackRole): Track | null {
  return (
    seq.tracks.find((t) => t.role === role) ??
    seq.tracks.find((t) => t.kind === roleKind(role)) ??
    null
  );
}

export function roleKind(role: TrackRole): TrackKind {
  switch (role) {
    case 'video':
    case 'broll':
    case 'overlay':
      return 'video';
    case 'text':
      return 'text';
    case 'caption':
      return 'caption';
    default:
      return 'audio';
  }
}
