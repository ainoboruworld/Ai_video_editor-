/**
 * Storyboard → timeline.
 *
 * Turns approved scenes into real editor commands: B-roll on the b-roll track,
 * on-screen text on the text track, narration captions on the caption track and
 * transitions between scenes. Everything goes through the command engine, so an
 * AI-driven assembly is a single undoable step and every clip stays editable
 * afterwards.
 */
import {
  makeClip,
  trackByRole,
  type Clip,
  type EditorCommand,
  type Sequence,
  type TransitionKind,
} from '@/lib/engine';
import type { Asset, StoryboardScene } from '@/types';

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Minimum speed we will slow footage to when it is shorter than the scene. */
const MIN_FIT_SPEED = 0.6;

export interface ScenePlacement {
  sceneId: string;
  start: number;
  duration: number;
  clipIds: string[];
}

export interface AssembleResult {
  commands: EditorCommand[];
  placements: ScenePlacement[];
}

export interface AssembleOptions {
  sequence: Sequence;
  scenes: StoryboardScene[];
  assets: Asset[];
  /** Burn the narration in as captions. */
  withCaptions?: boolean;
  /** Add the scene's on-screen text. */
  withText?: boolean;
  /** Start time on the timeline. */
  startAt?: number;
  captionStyle?: Clip['captionStyle'];
}

/**
 * Fits one asset to a scene without ever stretching the picture: long footage
 * is trimmed, slightly short footage is slowed a little, and very short footage
 * is repeated to cover the scene.
 */
export function fitAssetToScene(
  asset: Asset,
  sceneStart: number,
  sceneDuration: number,
  options: { trackId: string; transition?: TransitionKind | 'cut'; name?: string },
): { commands: EditorCommand[]; clipIds: string[] } {
  const commands: EditorCommand[] = [];
  const clipIds: string[] = [];
  const assetDuration = asset.kind === 'image' ? sceneDuration : asset.duration ?? sceneDuration;

  const makeSegment = (start: number, duration: number, sourceIn: number, speed: number) => {
    const id = newId('c');
    clipIds.push(id);
    const clip = makeClip({
      id,
      kind: asset.kind === 'audio' ? 'audio' : asset.kind === 'image' ? 'image' : 'video',
      name: options.name ?? asset.name,
      assetId: asset.id,
      start,
      duration,
      sourceIn,
      speed,
      brollMode: 'fullscreen',
    });
    commands.push({ type: 'ADD_CLIP', trackId: options.trackId, clip });
    return id;
  };

  if (asset.kind === 'image' || assetDuration >= sceneDuration - 0.01) {
    // Trim from the start of the source; images simply hold for the scene.
    makeSegment(sceneStart, sceneDuration, 0, 1);
  } else if (assetDuration / sceneDuration >= MIN_FIT_SPEED) {
    // Slightly short: slow it down rather than leaving a gap.
    makeSegment(sceneStart, sceneDuration, 0, assetDuration / sceneDuration);
  } else {
    // Much shorter: repeat the clip until the scene is covered.
    let cursor = 0;
    while (cursor < sceneDuration - 0.05) {
      const duration = Math.min(assetDuration, sceneDuration - cursor);
      makeSegment(sceneStart + cursor, duration, 0, 1);
      cursor += duration;
    }
  }

  const transition = options.transition;
  if (transition && transition !== 'cut' && clipIds.length > 0) {
    commands.push({
      type: 'ADD_TRANSITION',
      clipId: clipIds[0]!,
      position: 'in',
      transition: { kind: transition, duration: Math.min(0.6, sceneDuration / 3), position: 'in' },
    });
  }

  return { commands, clipIds };
}

/** Builds the full command list that lays a storyboard onto the timeline. */
export function assembleStoryboard(options: AssembleOptions): AssembleResult {
  const { sequence, scenes, assets } = options;
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

  const brollTrack = trackByRole(sequence, 'broll') ?? trackByRole(sequence, 'video');
  const textTrack = trackByRole(sequence, 'text');
  const captionTrack = trackByRole(sequence, 'caption');

  const commands: EditorCommand[] = [];
  const placements: ScenePlacement[] = [];

  // Replace whatever the previous assembly produced on these tracks.
  for (const track of [brollTrack, textTrack, captionTrack]) {
    if (!track) continue;
    for (const clip of track.clips) {
      commands.push({ type: 'DELETE_CLIP', clipId: clip.id });
    }
  }

  let cursor = options.startAt ?? 0;
  for (const scene of scenes) {
    const duration = Math.max(0.5, scene.duration);
    const clipIds: string[] = [];

    const asset = scene.assetId ? assetMap.get(scene.assetId) : undefined;
    if (asset && brollTrack) {
      const fitted = fitAssetToScene(asset, cursor, duration, {
        trackId: brollTrack.id,
        transition: scene.transition,
        name: scene.title,
      });
      commands.push(...fitted.commands);
      clipIds.push(...fitted.clipIds);
    }

    if (options.withText !== false && textTrack && scene.onScreenText.trim()) {
      const id = newId('t');
      clipIds.push(id);
      commands.push({
        type: 'ADD_TEXT',
        trackId: textTrack.id,
        clipId: id,
        text: scene.onScreenText.trim(),
        start: cursor + 0.15,
        duration: Math.max(1, duration - 0.3),
        style: { fontSize: sequence.height >= 1600 ? 78 : 56, align: 'center' },
      });
      commands.push({ type: 'SET_TEXT', clipId: id, animation: 'pop' });
    }

    if (options.withCaptions && captionTrack && scene.script.trim()) {
      for (const cue of splitScript(scene.script.trim(), cursor, duration)) {
        const id = newId('cap');
        clipIds.push(id);
        commands.push({
          type: 'ADD_CAPTION',
          trackId: captionTrack.id,
          clipId: id,
          text: cue.text,
          start: cue.start,
          duration: Math.max(0.4, cue.end - cue.start),
          style: options.captionStyle ?? 'bold',
        });
      }
    }

    placements.push({ sceneId: scene.id, start: cursor, duration, clipIds });
    cursor += duration;
  }

  return { commands, placements };
}

/** Splits narration into caption-sized cues spread across the scene. */
export function splitScript(
  script: string,
  start: number,
  duration: number,
  maxWords = 5,
): { text: string; start: number; end: number }[] {
  const words = script.split(/\s+/).filter(Boolean);
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Estimated read time so AI scene durations can be sanity-checked. */
export function estimateNarrationSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, words / 2.6);
}
