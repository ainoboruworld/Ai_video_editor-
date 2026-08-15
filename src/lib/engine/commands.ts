import type {
  AspectRatio,
  CaptionStyleName,
  CaptionWord,
  Clip,
  Keyframe,
  KeyframableProp,
  Sequence,
  TextStyle,
  Track,
  Transform,
  Transition,
  Filters,
} from './types';
import { ASPECT_DIMENSIONS, makeClip } from './types';

/**
 * Every mutation of a sequence — manual UI editing and AI editing alike —
 * goes through these commands. Commands are plain serializable data so an
 * AI provider can emit them, they can be validated, logged and replayed.
 */
export type EditorCommand =
  | { type: 'ADD_CLIP'; trackId: string; clip: Clip }
  | { type: 'DELETE_CLIP'; clipId: string }
  | { type: 'MOVE_CLIP'; clipId: string; trackId?: string; start: number }
  | {
      type: 'TRIM_CLIP';
      clipId: string;
      /** New timeline start/duration. sourceIn is adjusted when the left edge moves. */
      start: number;
      duration: number;
    }
  | { type: 'SPLIT_CLIP'; clipId: string; time: number; newClipId: string }
  | { type: 'REMOVE_RANGE'; start: number; end: number; trackIds?: string[]; ripple: boolean }
  | { type: 'DUPLICATE_CLIP'; clipId: string; newClipId: string }
  | { type: 'CHANGE_SPEED'; clipId: string; speed: number }
  | { type: 'CHANGE_VOLUME'; clipId: string; volume: number; muted?: boolean }
  | { type: 'SET_FADE'; clipId: string; fadeIn?: number; fadeOut?: number }
  | { type: 'CHANGE_TRANSFORM'; clipId: string; transform: Partial<Transform> }
  | { type: 'SET_FILTERS'; clipId: string; filters: Partial<Filters> }
  | { type: 'SET_CROP'; clipId: string; crop: Clip['crop'] }
  | { type: 'SET_TEXT'; clipId: string; text?: string; style?: Partial<TextStyle>; animation?: Clip['textAnimation'] }
  | {
      type: 'ADD_TEXT';
      trackId: string;
      clipId: string;
      text: string;
      start: number;
      duration: number;
      style?: Partial<TextStyle>;
    }
  | {
      type: 'ADD_CAPTION';
      trackId: string;
      clipId: string;
      text: string;
      start: number;
      duration: number;
      words?: CaptionWord[];
      style?: CaptionStyleName;
    }
  | { type: 'SET_CAPTION_STYLE'; clipId: string; style: CaptionStyleName }
  | {
      type: 'ADD_BROLL';
      trackId: string;
      clipId: string;
      assetId: string;
      start: number;
      duration: number;
      sourceIn?: number;
      mode?: Clip['brollMode'];
      name?: string;
    }
  | { type: 'ADD_TRANSITION'; clipId: string; position: 'in' | 'out'; transition: Transition | null }
  | { type: 'SET_BROLL_MODE'; clipId: string; mode: Clip['brollMode'] }
  | { type: 'RENAME_CLIP'; clipId: string; name: string }
  | { type: 'CHANGE_ASPECT_RATIO'; aspect: AspectRatio }
  | { type: 'SET_KEYFRAMES'; clipId: string; prop: KeyframableProp; keyframes: Keyframe[] }
  | { type: 'SET_TRACK_STATE'; trackId: string; locked?: boolean; visible?: boolean; muted?: boolean; solo?: boolean; name?: string }
  | { type: 'ADD_MARKER'; id: string; time: number; label: string; color?: string }
  | { type: 'DELETE_MARKER'; id: string }
  | { type: 'RENAME_SEQUENCE'; name: string };

export class CommandError extends Error {}

function findTrackByClip(seq: Sequence, clipId: string): Track {
  const t = seq.tracks.find((tr) => tr.clips.some((c) => c.id === clipId));
  if (!t) throw new CommandError(`Clip not found: ${clipId}`);
  return t;
}

function getClip(seq: Sequence, clipId: string): Clip {
  const t = findTrackByClip(seq, clipId);
  return t.clips.find((c) => c.id === clipId)!;
}

function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

/** Returns a new sequence with one track replaced. */
function withTrack(seq: Sequence, trackId: string, fn: (t: Track) => Track): Sequence {
  const idx = seq.tracks.findIndex((t) => t.id === trackId);
  if (idx === -1) throw new CommandError(`Track not found: ${trackId}`);
  const tracks = [...seq.tracks];
  tracks[idx] = fn(tracks[idx]!);
  return { ...seq, tracks };
}

function withClip(seq: Sequence, clipId: string, fn: (c: Clip) => Clip): Sequence {
  const track = findTrackByClip(seq, clipId);
  return withTrack(seq, track.id, (t) => ({
    ...t,
    clips: sortClips(t.clips.map((c) => (c.id === clipId ? fn(c) : c))),
  }));
}

/** Split a clip at absolute timeline time, preserving source mapping, keyframes and styling. */
export function splitClipAt(clip: Clip, time: number, newClipId: string): [Clip, Clip] {
  if (time <= clip.start || time >= clip.start + clip.duration) {
    throw new CommandError('Split point must be inside the clip');
  }
  const offset = time - clip.start; // timeline seconds into the clip
  const left: Clip = { ...clip, duration: offset, transitionOut: null };
  const right: Clip = {
    ...clip,
    id: newClipId,
    start: time,
    duration: clip.duration - offset,
    sourceIn: clip.sourceIn + offset * clip.speed,
    transitionIn: null,
    fadeIn: 0,
    keyframes: shiftKeyframes(clip.keyframes, -offset),
    captionWords: clip.captionWords
      ? clip.captionWords
          .filter((w) => w.start >= offset)
          .map((w) => ({ ...w, start: w.start - offset, end: w.end - offset }))
      : null,
  };
  left.keyframes = clampKeyframes(clip.keyframes, 0, offset);
  if (left.captionWords) left.captionWords = left.captionWords.filter((w) => w.start < offset);
  return [left, right];
}

function shiftKeyframes(kfs: Clip['keyframes'], delta: number): Clip['keyframes'] {
  const out: Clip['keyframes'] = {};
  for (const [prop, arr] of Object.entries(kfs)) {
    out[prop as KeyframableProp] = (arr ?? [])
      .map((k) => ({ ...k, time: k.time + delta }))
      .filter((k) => k.time >= 0);
  }
  return out;
}

function clampKeyframes(kfs: Clip['keyframes'], min: number, max: number): Clip['keyframes'] {
  const out: Clip['keyframes'] = {};
  for (const [prop, arr] of Object.entries(kfs)) {
    out[prop as KeyframableProp] = (arr ?? []).filter((k) => k.time >= min && k.time <= max);
  }
  return out;
}

export function applyCommand(seq: Sequence, cmd: EditorCommand): Sequence {
  switch (cmd.type) {
    case 'ADD_CLIP':
      return withTrack(seq, cmd.trackId, (t) => ({ ...t, clips: sortClips([...t.clips, cmd.clip]) }));

    case 'DELETE_CLIP': {
      const track = findTrackByClip(seq, cmd.clipId);
      return withTrack(seq, track.id, (t) => ({ ...t, clips: t.clips.filter((c) => c.id !== cmd.clipId) }));
    }

    case 'MOVE_CLIP': {
      const fromTrack = findTrackByClip(seq, cmd.clipId);
      const clip = getClip(seq, cmd.clipId);
      const start = Math.max(0, cmd.start);
      const targetTrackId = cmd.trackId ?? fromTrack.id;
      let next = withTrack(seq, fromTrack.id, (t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== cmd.clipId),
      }));
      next = withTrack(next, targetTrackId, (t) => ({
        ...t,
        clips: sortClips([...t.clips, { ...clip, start }]),
      }));
      return next;
    }

    case 'TRIM_CLIP':
      return withClip(seq, cmd.clipId, (c) => {
        const start = Math.max(0, cmd.start);
        const duration = Math.max(0.05, cmd.duration);
        const leftDelta = start - c.start;
        return {
          ...c,
          start,
          duration,
          sourceIn: Math.max(0, c.sourceIn + leftDelta * c.speed),
        };
      });

    case 'SPLIT_CLIP': {
      const track = findTrackByClip(seq, cmd.clipId);
      const clip = getClip(seq, cmd.clipId);
      const [left, right] = splitClipAt(clip, cmd.time, cmd.newClipId);
      return withTrack(seq, track.id, (t) => ({
        ...t,
        clips: sortClips([...t.clips.filter((c) => c.id !== clip.id), left, right]),
      }));
    }

    case 'DUPLICATE_CLIP': {
      const track = findTrackByClip(seq, cmd.clipId);
      const clip = getClip(seq, cmd.clipId);
      const copy: Clip = { ...clip, id: cmd.newClipId, start: clip.start + clip.duration };
      return withTrack(seq, track.id, (t) => ({ ...t, clips: sortClips([...t.clips, copy]) }));
    }

    case 'REMOVE_RANGE': {
      const { start, end, ripple } = cmd;
      if (end <= start) throw new CommandError('REMOVE_RANGE: end must be after start');
      const len = end - start;
      const affected = cmd.trackIds ? new Set(cmd.trackIds) : null;
      const tracks = seq.tracks.map((track) => {
        if (affected && !affected.has(track.id)) return track;
        const out: Clip[] = [];
        for (const clip of track.clips) {
          const cEnd = clip.start + clip.duration;
          if (cEnd <= start) {
            out.push(clip);
          } else if (clip.start >= end) {
            out.push(ripple ? { ...clip, start: clip.start - len } : clip);
          } else if (clip.start >= start && cEnd <= end) {
            // fully removed
          } else if (clip.start < start && cEnd > end) {
            // clip spans the range → split into two
            const [left, rightRaw] = splitClipAt(clip, start, `${clip.id}-r`);
            const cut = end - start;
            const right: Clip = {
              ...rightRaw,
              start: ripple ? start : end,
              duration: rightRaw.duration - cut,
              sourceIn: rightRaw.sourceIn + cut * rightRaw.speed,
            };
            out.push(left);
            if (right.duration > 0.01) out.push(right);
          } else if (clip.start < start) {
            // overlaps the left edge → trim tail
            out.push({ ...clip, duration: start - clip.start });
          } else {
            // overlaps the right edge → trim head
            const cut = end - clip.start;
            out.push({
              ...clip,
              start: ripple ? start : end,
              duration: clip.duration - cut,
              sourceIn: clip.sourceIn + cut * clip.speed,
            });
          }
        }
        return { ...track, clips: sortClips(out) };
      });
      return { ...seq, tracks };
    }

    case 'CHANGE_SPEED':
      if (cmd.speed <= 0) throw new CommandError('Speed must be positive');
      return withClip(seq, cmd.clipId, (c) => ({
        ...c,
        // keep the same source range: adjust timeline duration
        duration: (c.duration * c.speed) / cmd.speed,
        speed: cmd.speed,
      }));

    case 'CHANGE_VOLUME':
      return withClip(seq, cmd.clipId, (c) => ({
        ...c,
        volume: Math.max(0, Math.min(2, cmd.volume)),
        muted: cmd.muted ?? c.muted,
      }));

    case 'SET_FADE':
      return withClip(seq, cmd.clipId, (c) => ({
        ...c,
        fadeIn: cmd.fadeIn ?? c.fadeIn,
        fadeOut: cmd.fadeOut ?? c.fadeOut,
      }));

    case 'CHANGE_TRANSFORM':
      return withClip(seq, cmd.clipId, (c) => ({ ...c, transform: { ...c.transform, ...cmd.transform } }));

    case 'SET_FILTERS':
      return withClip(seq, cmd.clipId, (c) => ({ ...c, filters: { ...c.filters, ...cmd.filters } }));

    case 'SET_CROP':
      return withClip(seq, cmd.clipId, (c) => ({ ...c, crop: cmd.crop }));

    case 'SET_TEXT':
      return withClip(seq, cmd.clipId, (c) => ({
        ...c,
        text: cmd.text ?? c.text,
        textStyle: cmd.style ? { ...(c.textStyle ?? defaultStyle()), ...cmd.style } : c.textStyle,
        textAnimation: cmd.animation ?? c.textAnimation,
      }));

    case 'ADD_TEXT':
      return withTrack(seq, cmd.trackId, (t) => ({
        ...t,
        clips: sortClips([
          ...t.clips,
          makeClip({
            id: cmd.clipId,
            kind: 'text',
            name: cmd.text.slice(0, 24),
            start: cmd.start,
            duration: cmd.duration,
            text: cmd.text,
            textStyle: { ...defaultStyle(), ...cmd.style },
          }),
        ]),
      }));

    case 'ADD_CAPTION':
      return withTrack(seq, cmd.trackId, (t) => ({
        ...t,
        clips: sortClips([
          ...t.clips,
          makeClip({
            id: cmd.clipId,
            kind: 'caption',
            name: cmd.text.slice(0, 24),
            start: cmd.start,
            duration: cmd.duration,
            text: cmd.text,
            captionWords: cmd.words ?? null,
            captionStyle: cmd.style ?? 'bold',
          }),
        ]),
      }));

    case 'SET_CAPTION_STYLE':
      return withClip(seq, cmd.clipId, (c) => ({ ...c, captionStyle: cmd.style }));

    case 'ADD_BROLL':
      return withTrack(seq, cmd.trackId, (t) => ({
        ...t,
        clips: sortClips([
          ...t.clips,
          makeClip({
            id: cmd.clipId,
            kind: 'video',
            name: cmd.name ?? 'B-roll',
            assetId: cmd.assetId,
            start: cmd.start,
            duration: cmd.duration,
            sourceIn: cmd.sourceIn ?? 0,
            brollMode: cmd.mode ?? 'fullscreen',
          }),
        ]),
      }));

    case 'ADD_TRANSITION':
      return withClip(seq, cmd.clipId, (c) =>
        cmd.position === 'in' ? { ...c, transitionIn: cmd.transition } : { ...c, transitionOut: cmd.transition },
      );

    case 'SET_BROLL_MODE':
      return withClip(seq, cmd.clipId, (c) => ({ ...c, brollMode: cmd.mode }));

    case 'RENAME_CLIP':
      return withClip(seq, cmd.clipId, (c) => ({ ...c, name: cmd.name }));

    case 'CHANGE_ASPECT_RATIO': {
      const { width, height } = ASPECT_DIMENSIONS[cmd.aspect];
      return { ...seq, aspect: cmd.aspect, width, height };
    }

    case 'SET_KEYFRAMES':
      return withClip(seq, cmd.clipId, (c) => ({
        ...c,
        keyframes: { ...c.keyframes, [cmd.prop]: [...cmd.keyframes].sort((a, b) => a.time - b.time) },
      }));

    case 'SET_TRACK_STATE':
      return withTrack(seq, cmd.trackId, (t) => ({
        ...t,
        locked: cmd.locked ?? t.locked,
        visible: cmd.visible ?? t.visible,
        muted: cmd.muted ?? t.muted,
        solo: cmd.solo ?? t.solo,
        name: cmd.name ?? t.name,
      }));

    case 'ADD_MARKER':
      return {
        ...seq,
        markers: [...seq.markers, { id: cmd.id, time: cmd.time, label: cmd.label, color: cmd.color ?? '#f59e0b' }],
      };

    case 'DELETE_MARKER':
      return { ...seq, markers: seq.markers.filter((m) => m.id !== cmd.id) };

    case 'RENAME_SEQUENCE':
      return { ...seq, name: cmd.name };
  }
}

function defaultStyle(): TextStyle {
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

/** Linear keyframe interpolation; falls back to a static value. */
export function interpolate(keyframes: Keyframe[] | undefined, time: number, fallback: number): number {
  if (!keyframes || keyframes.length === 0) return fallback;
  const first = keyframes[0]!;
  const last = keyframes[keyframes.length - 1]!;
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]!;
    const b = keyframes[i + 1]!;
    if (time >= a.time && time <= b.time) {
      const t = (time - a.time) / (b.time - a.time || 1);
      return a.value + (b.value - a.value) * t;
    }
  }
  return fallback;
}
