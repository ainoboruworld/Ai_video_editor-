import type { EditorCommand } from './commands';
import type { Sequence } from './types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const COMMAND_TYPES = new Set<EditorCommand['type']>([
  'ADD_CLIP',
  'DELETE_CLIP',
  'MOVE_CLIP',
  'TRIM_CLIP',
  'SPLIT_CLIP',
  'REMOVE_RANGE',
  'DUPLICATE_CLIP',
  'CHANGE_SPEED',
  'CHANGE_VOLUME',
  'SET_FADE',
  'CHANGE_TRANSFORM',
  'SET_FILTERS',
  'SET_CROP',
  'SET_TEXT',
  'ADD_TEXT',
  'ADD_CAPTION',
  'SET_CAPTION_STYLE',
  'SET_CAPTION_COLORS',
  'ADD_GRAPHIC',
  'SET_GRAPHIC',
  'ADD_BROLL',
  'ADD_TRANSITION',
  'SET_BROLL_MODE',
  'RENAME_CLIP',
  'CHANGE_ASPECT_RATIO',
  'SET_KEYFRAMES',
  'SET_TRACK_STATE',
  'ADD_MARKER',
  'DELETE_MARKER',
  'RENAME_SEQUENCE',
]);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate untrusted commands (e.g. produced by an AI provider) against a
 * sequence before they reach the command engine. LLM output is never
 * executed directly — it must pass through here first.
 */
export function validateCommand(seq: Sequence, cmd: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof cmd !== 'object' || cmd === null) return { ok: false, errors: ['Command must be an object'] };
  const c = cmd as Record<string, unknown>;
  if (typeof c.type !== 'string' || !COMMAND_TYPES.has(c.type as EditorCommand['type'])) {
    return { ok: false, errors: [`Unknown command type: ${String(c.type)}`] };
  }

  const clipIds = new Set<string>();
  const trackIds = new Set<string>();
  for (const t of seq.tracks) {
    trackIds.add(t.id);
    for (const cl of t.clips) clipIds.add(cl.id);
  }

  const needClip = ['DELETE_CLIP', 'MOVE_CLIP', 'TRIM_CLIP', 'SPLIT_CLIP', 'DUPLICATE_CLIP', 'CHANGE_SPEED', 'CHANGE_VOLUME', 'SET_FADE', 'CHANGE_TRANSFORM', 'SET_FILTERS', 'SET_CROP', 'SET_TEXT', 'SET_CAPTION_STYLE', 'SET_CAPTION_COLORS', 'SET_GRAPHIC', 'ADD_TRANSITION', 'SET_KEYFRAMES', 'SET_BROLL_MODE', 'RENAME_CLIP'];
  if (needClip.includes(c.type as string)) {
    if (typeof c.clipId !== 'string' || !clipIds.has(c.clipId)) errors.push(`clipId does not exist: ${String(c.clipId)}`);
  }
  const needTrack = ['ADD_CLIP', 'ADD_TEXT', 'ADD_CAPTION', 'ADD_BROLL', 'ADD_GRAPHIC', 'SET_TRACK_STATE'];
  if (needTrack.includes(c.type as string)) {
    if (typeof c.trackId !== 'string' || !trackIds.has(c.trackId)) errors.push(`trackId does not exist: ${String(c.trackId)}`);
  }
  for (const key of ['start', 'end', 'duration', 'time', 'speed', 'volume'] as const) {
    if (key in c && c[key] !== undefined && !isFiniteNumber(c[key])) errors.push(`${key} must be a finite number`);
  }
  if (c.type === 'REMOVE_RANGE' && isFiniteNumber(c.start) && isFiniteNumber(c.end) && c.end <= c.start) {
    errors.push('REMOVE_RANGE: end must be after start');
  }
  if (c.type === 'CHANGE_SPEED' && isFiniteNumber(c.speed) && (c.speed <= 0 || c.speed > 16)) {
    errors.push('speed must be in (0, 16]');
  }
  return { ok: errors.length === 0, errors };
}

export function validateCommands(seq: Sequence, cmds: unknown[]): ValidationResult {
  const errors: string[] = [];
  for (let i = 0; i < cmds.length; i++) {
    const r = validateCommand(seq, cmds[i]);
    if (!r.ok) errors.push(...r.errors.map((e) => `[${i}] ${e}`));
  }
  return { ok: errors.length === 0, errors };
}
