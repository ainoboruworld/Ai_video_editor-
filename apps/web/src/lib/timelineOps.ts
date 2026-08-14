import { makeClip, type Clip, type Sequence, type EditorCommand } from '@ave/editor-core';
import type { Asset } from './api';
import { uid } from './format';

/** Build an ADD_CLIP command placing an asset on the first matching unlocked track at `start`. */
export function addAssetCommand(
  seq: Sequence,
  asset: Asset,
  start: number,
  trackId?: string,
): EditorCommand | null {
  const kind: Clip['kind'] = asset.kind;
  const trackKind = asset.kind === 'audio' ? 'audio' : 'video';
  let track = trackId ? seq.tracks.find((t) => t.id === trackId) : undefined;
  if (!track) track = seq.tracks.find((t) => t.kind === trackKind && !t.locked);
  if (!track) return null;
  const duration = asset.duration ?? (asset.kind === 'image' ? 5 : 5);
  const clip = makeClip({
    id: uid('clip'),
    kind,
    name: asset.name,
    assetId: asset.id,
    start: Math.max(0, start),
    duration: Math.max(0.1, duration),
  });
  return { type: 'ADD_CLIP', trackId: track.id, clip };
}
