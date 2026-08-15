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
import type { Asset } from '@/types';

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
