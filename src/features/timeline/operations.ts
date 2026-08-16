'use client';

/**
 * Editing operations shared by the toolbar, the context menus and the keyboard
 * shortcuts. Each one is expressed as engine commands so it is undoable.
 */
import {
  makeClip,
  snapTargets,
  snapTime,
  trackByRole,
  type Clip,
  type EditorCommand,
  type Graphic,
  type Sequence,
} from '@/lib/engine';
import { useEditorStore, findClip } from '@/state/editorStore';
import { toast } from '@/state/toastStore';
import type { Asset } from '@/types';
import { newId } from '@/features/broll/assemble';
import { appendPoint } from '@/features/edit/clips';

export function splitAtPlayhead(): void {
  const state = useEditorStore.getState();
  const { sequence, playhead, selection } = state;
  if (!sequence) return;

  const targets = selection.length > 0 ? selection : clipsUnderPlayhead(sequence, playhead).map((c) => c.clip.id);
  const commands: EditorCommand[] = [];
  for (const clipId of targets) {
    const found = findClip(sequence, clipId);
    if (!found) continue;
    const { clip } = found;
    if (playhead <= clip.start + 0.02 || playhead >= clip.start + clip.duration - 0.02) continue;
    commands.push({ type: 'SPLIT_CLIP', clipId, time: playhead, newClipId: newId('c') });
  }
  if (commands.length === 0) {
    toast.info('Nothing to split at the playhead');
    return;
  }
  state.apply(commands, 'Split');
}

export function clipsUnderPlayhead(sequence: Sequence, time: number): { clip: Clip; trackId: string }[] {
  const out: { clip: Clip; trackId: string }[] = [];
  for (const track of sequence.tracks) {
    if (track.locked) continue;
    for (const clip of track.clips) {
      if (time > clip.start && time < clip.start + clip.duration) out.push({ clip, trackId: track.id });
    }
  }
  return out;
}

export function deleteSelection(): void {
  const state = useEditorStore.getState();
  if (state.selection.length === 0) return;
  const commands: EditorCommand[] = state.selection.map((clipId) => ({ type: 'DELETE_CLIP', clipId }));
  if (state.apply(commands, 'Delete clip')) {
    useEditorStore.getState().select([]);
  }
}

export function duplicateSelection(): void {
  const state = useEditorStore.getState();
  if (state.selection.length === 0) return;
  const commands: EditorCommand[] = state.selection.map((clipId) => ({
    type: 'DUPLICATE_CLIP',
    clipId,
    newClipId: newId('c'),
  }));
  state.apply(commands, 'Duplicate clip');
}

/** Appends media to the most appropriate track at the playhead. */
export function addAssetToTimeline(asset: Asset, options?: { at?: number; role?: 'video' | 'broll' | 'music' | 'voiceover' }): void {
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence) return;

  // A second video is another take, not B-roll. Several recordings edited as
  // one piece is the normal case for this product, so video appends to the main
  // track in running order; cutaways come from the B-roll panel, which asks for
  // that role by name.
  const role = options?.role ?? (asset.kind === 'audio' ? 'music' : asset.kind === 'image' ? 'broll' : 'video');
  const track = trackByRole(sequence, role) ?? sequence.tracks[0];
  if (!track) return;

  const start =
    options?.at ??
    (role === 'video' ? appendPoint(sequence) : nextFreeSlot(sequence, track.id, state.playhead));
  const duration = asset.kind === 'image' ? 4 : Math.max(0.5, asset.duration ?? 5);

  const clip = makeClip({
    id: newId('c'),
    kind: asset.kind === 'audio' ? 'audio' : asset.kind === 'image' ? 'image' : 'video',
    name: asset.name,
    assetId: asset.id,
    start,
    duration,
    brollMode: role === 'broll' ? 'fullscreen' : null,
  });

  if (state.apply({ type: 'ADD_CLIP', trackId: track.id, clip }, `Add ${asset.kind}`)) {
    useEditorStore.getState().select([clip.id]);
  }
}

/** First position at or after `from` where a new clip will not overlap. */
export function nextFreeSlot(sequence: Sequence, trackId: string, from: number): number {
  const track = sequence.tracks.find((t) => t.id === trackId);
  if (!track) return from;
  let cursor = Math.max(0, from);
  let moved = true;
  while (moved) {
    moved = false;
    for (const clip of track.clips) {
      if (cursor >= clip.start && cursor < clip.start + clip.duration) {
        cursor = clip.start + clip.duration;
        moved = true;
      }
    }
  }
  return Math.round(cursor * 1000) / 1000;
}

export function addTextClip(text: string, options?: { style?: Partial<Clip['textStyle'] & object>; duration?: number }): void {
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence) return;
  const track = trackByRole(sequence, 'text');
  if (!track) return;
  const id = newId('t');
  const start = nextFreeSlot(sequence, track.id, state.playhead);
  const applied = state.apply(
    {
      type: 'ADD_TEXT',
      trackId: track.id,
      clipId: id,
      text,
      start,
      duration: options?.duration ?? 3,
      style: options?.style as never,
    },
    'Add text',
  );
  if (applied) useEditorStore.getState().select([id]);
}

/** Drops a graphic on the text track, at the playhead or at a given time. */
export function addGraphicClip(graphic: Graphic, options?: { start?: number; duration?: number }): string | null {
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence) return null;
  const track = trackByRole(sequence, 'text');
  if (!track) return null;

  const id = newId('g');
  const start = options?.start ?? nextFreeSlot(sequence, track.id, state.playhead);

  // A graphic is tied to the moment that motivates it, so it cannot just be
  // nudged along like a text clip. Two stacked at the same time look like one
  // and only one of them can be selected, so say so rather than pile them up.
  const occupied = track.clips.find(
    (clip) => clip.kind === 'graphic' && start < clip.start + clip.duration && clip.start < start + (options?.duration ?? 4),
  );
  if (occupied) {
    toast.info('There is already a graphic here', 'Move or delete that one first, or drop this at a different point.');
    return null;
  }
  const applied = state.apply(
    { type: 'ADD_GRAPHIC', trackId: track.id, clipId: id, start, duration: options?.duration ?? 4, graphic },
    'Add graphic',
  );
  if (!applied) return null;
  useEditorStore.getState().select([id]);
  return id;
}

/** Snaps a candidate time to nearby clip edges, markers and the playhead. */
export function snapCandidate(sequence: Sequence, time: number, exclude: Set<string>, pixelsPerSecond: number): number {
  const state = useEditorStore.getState();
  if (!state.snapEnabled) return Math.max(0, time);
  const targets = snapTargets(sequence, state.playhead, exclude);
  const threshold = 8 / Math.max(1, pixelsPerSecond);
  return Math.max(0, snapTime(time, targets, threshold).time);
}
