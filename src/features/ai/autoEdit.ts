'use client';

/**
 * Auto-editing an existing recording.
 *
 * The three capabilities here are deliberately independent, because they have
 * different requirements:
 *   - cutting silence needs nothing but the audio (works offline, always);
 *   - cutting filler words needs a transcript;
 *   - restructuring to a target length needs an AI provider.
 *
 * All of them end the same way: a list of engine commands applied in one
 * undoable step, so nothing is destructive and everything stays editable.
 */
import {
  detectFillers,
  detectSilences,
  invertRanges,
  mergeRanges,
  speechRanges,
  totalDuration,
  type AudioAnalysis,
  type Range,
  type TranscriptWord,
} from '@/features/analysis/audioAnalysis';
import { countSeams, cutTransitionCommands, type CutTransitionChoice } from '@/features/ai/cutTransitions';
import { newId } from '@/features/broll/assemble';
import { api } from '@/lib/api-client';
import { trackByRole, type CaptionStyleName, type Clip, type EditorCommand, type Sequence } from '@/lib/engine';
import { useEditorStore } from '@/state/editorStore';
import type { AspectRatio } from '@/lib/engine';
import type { CaptionCue, StockMediaItem } from '@/types';

/** Kept as the name the editor UI already uses. */
export type AnalysisResult = AudioAnalysis;

/** Cuts, expressed in timeline seconds, ready to be applied. */
export interface CutPlan {
  cuts: Range[];
  removedSeconds: number;
  label: string;
  /** What to put on the joins the cuts leave behind. Omitted means hard cuts. */
  transition?: CutTransitionChoice;
}

/**
 * Maps a range in *source* time to timeline time for a clip.
 * A clip may be trimmed or sped up, so this is not the identity function.
 */
export function sourceToTimeline(clip: Clip, range: Range): Range | null {
  const sourceStart = clip.sourceIn;
  const sourceEnd = clip.sourceIn + clip.duration * clip.speed;
  const start = Math.max(range.start, sourceStart);
  const end = Math.min(range.end, sourceEnd);
  if (end - start <= 0.01) return null;
  return {
    start: clip.start + (start - sourceStart) / clip.speed,
    end: clip.start + (end - sourceStart) / clip.speed,
  };
}

/** The clip the auto-editor operates on: the first video clip on the timeline. */
export function primaryClip(sequence: Sequence): { clip: Clip; trackId: string } | null {
  for (const track of sequence.tracks) {
    if (track.kind !== 'video') continue;
    const clip = track.clips.find((c) => c.assetId && c.kind === 'video');
    if (clip) return { clip, trackId: track.id };
  }
  return null;
}

/** Builds the ripple-delete commands for a set of timeline ranges. */
export function cutsToCommands(cuts: Range[], trackIds?: string[]): EditorCommand[] {
  // Apply from the end backwards: a ripple delete shifts everything after it,
  // so cutting late-to-early keeps the earlier timestamps valid.
  return mergeRanges(cuts)
    .sort((a, b) => b.start - a.start)
    .map((cut) => ({ type: 'REMOVE_RANGE', start: cut.start, end: cut.end, ripple: true, trackIds }));
}

/** Silence analysis for the primary clip, in source time. */
export function planSilenceCuts(
  analysis: AnalysisResult,
  clip: Clip,
  options?: { keepPauses?: boolean },
): CutPlan {
  const source = options?.keepPauses
    ? analysis.silences.filter((silence) => silence.end - silence.start > 1.2)
    : analysis.silences;

  const cuts = source
    .map((range) => sourceToTimeline(clip, range))
    .filter((range): range is Range => range !== null);

  return {
    cuts,
    removedSeconds: totalDuration(cuts),
    label: 'Remove silence',
  };
}

/**
 * Tightens a recording toward a target length using nothing but the silence
 * map: the longest pauses go first, so the result still breathes where it
 * matters. This is the keyless path — it needs no AI provider at all.
 */
export function planTightenToTarget(
  analysis: AnalysisResult,
  clip: Clip,
  currentDuration: number,
  targetSeconds: number,
): CutPlan {
  const needed = currentDuration - targetSeconds;
  if (needed <= 0) {
    return { cuts: [], removedSeconds: 0, label: 'Tighten' };
  }

  const ranked = [...analysis.silences].sort((a, b) => b.end - b.start - (a.end - a.start));
  const chosen: Range[] = [];
  let removed = 0;
  for (const silence of ranked) {
    if (removed >= needed) break;
    chosen.push(silence);
    removed += silence.end - silence.start;
  }

  const cuts = chosen
    .map((range) => sourceToTimeline(clip, range))
    .filter((range): range is Range => range !== null);

  return { cuts, removedSeconds: totalDuration(cuts), label: 'Tighten to target' };
}

/** Filler-word cuts from transcript word timings. */
export function planFillerCuts(words: TranscriptWord[], clip: Clip): CutPlan {
  const cuts = detectFillers(words)
    .map((range) => sourceToTimeline(clip, range))
    .filter((range): range is Range => range !== null);
  return { cuts, removedSeconds: totalDuration(cuts), label: 'Remove filler words' };
}

/** Converts an AI keep-list into the cuts that produce it. */
export function planFromKeepRanges(keep: Range[], clip: Clip, sourceDuration: number): CutPlan {
  const cuts = invertRanges(keep, sourceDuration)
    .map((range) => sourceToTimeline(clip, range))
    .filter((range): range is Range => range !== null);
  return { cuts, removedSeconds: totalDuration(cuts), label: 'Apply AI edit' };
}

// ------------------------------------------------------------- execution ---

/** Runs the browser-side analysis for the primary clip's asset. */
export async function analysePrimaryClip(signal?: AbortSignal): Promise<AnalysisResult> {
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence) throw new Error('No project loaded.');
  const primary = primaryClip(sequence);
  if (!primary) throw new Error('Add your video to the timeline first.');

  const asset = state.assets.find((a) => a.id === primary.clip.assetId);
  if (!asset) throw new Error('The clip on the timeline has no media attached.');

  const { analyseLoudness } = await import('@/features/analysis/audioAnalysis');
  const envelope = await analyseLoudness(asset.url, 0.02, signal);
  const silences = detectSilences(envelope);
  const speech = speechRanges(envelope, silences);

  return { envelope, silences, speech, removableSeconds: totalDuration(silences) };
}

/**
 * Analyses every clip on the video track and stitches the result into one
 * timeline-time envelope.
 *
 * With several recordings in a project, "the primary clip" stops being a
 * useful idea: a pause between two sentences in clip three is as worth cutting
 * as one in clip one. Each clip's own audio is measured over exactly the span
 * that clip uses — its trim and its speed — and written into the envelope at
 * the position it occupies on the timeline. Everything downstream then works in
 * timeline seconds and never has to know which file a moment came from.
 *
 * Gaps between clips are left as silence, which is what they are.
 */
export async function analyseTimeline(signal?: AbortSignal): Promise<AnalysisResult> {
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence) throw new Error('No project loaded.');

  const { orderedClips } = await import('@/features/edit/clips');
  const entries = orderedClips(sequence).filter((entry) => entry.clip.kind === 'video');
  if (entries.length === 0) throw new Error('Add your video to the timeline first.');

  const { analyseLoudness } = await import('@/features/analysis/audioAnalysis');

  const WINDOW = 0.02;
  const timelineEnd = Math.max(...entries.map((entry) => entry.start + entry.duration));
  const values = new Float32Array(Math.ceil(timelineEnd / WINDOW) + 1);
  let peak = 0;

  for (const entry of entries) {
    const asset = state.assets.find((a) => a.id === entry.clip.assetId);
    if (!asset) continue;
    signal?.throwIfAborted();

    const envelope = await analyseLoudness(asset.url, WINDOW, signal);
    const clip = entry.clip;

    // Walk this clip's span of the timeline and read the source window that
    // plays at each point, which is what makes a trimmed or sped-up clip line
    // up with the picture instead of drifting against it.
    const windows = Math.ceil(clip.duration / WINDOW);
    for (let i = 0; i < windows; i += 1) {
      const timelineTime = clip.start + i * WINDOW;
      const sourceTime = clip.sourceIn + i * WINDOW * clip.speed;
      const sourceIndex = Math.floor(sourceTime / envelope.windowSeconds);
      const value = envelope.values[sourceIndex] ?? 0;
      const target = Math.floor(timelineTime / WINDOW);
      if (target >= 0 && target < values.length) {
        values[target] = value;
        if (value > peak) peak = value;
      }
    }
  }

  const envelope = { values, windowSeconds: WINDOW, duration: timelineEnd, peak };
  const silences = detectSilences(envelope);
  const speech = speechRanges(envelope, silences);
  return { envelope, silences, speech, removableSeconds: totalDuration(silences) };
}

/**
 * Applies a cut plan as one undoable edit.
 *
 * When the plan carries a transition, the seams it creates are decorated in the
 * same batch, so a single undo takes the cuts and the transitions back together
 * rather than leaving half the edit behind.
 */
export function applyCutPlan(plan: CutPlan): boolean {
  if (plan.cuts.length === 0) return false;
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence) return false;

  const cutCommands = cutsToCommands(plan.cuts);
  const transitions = plan.transition
    ? cutTransitionCommands({ sequence, cutCommands, cuts: plan.cuts, choice: plan.transition })
    : [];

  return state.apply([...cutCommands, ...transitions], plan.label);
}

/** How many seams a plan's transition would land on, for messaging before the edit. */
export function countPlanTransitions(plan: CutPlan): number {
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence || !plan.transition || plan.cuts.length === 0) return 0;
  return countSeams(
    cutTransitionCommands({
      sequence,
      cutCommands: cutsToCommands(plan.cuts),
      cuts: plan.cuts,
      choice: plan.transition,
    }),
  );
}

/** Where transcription runs: on this device, or on a hosted provider. */
export type TranscriptionMode = 'local' | 'hosted';

/**
 * Transcribes the whole timeline.
 *
 * `local` runs Whisper in this browser — no key, no quota, and the audio never
 * leaves the machine. `hosted` posts the mixdown to whichever provider is
 * configured, which is faster and gives word-level timings on Whisper backends.
 */
export async function transcribeTimeline(
  onProgress?: (message: string) => void,
  options: { mode?: TranscriptionMode; model?: 'tiny' | 'base' | 'small' } = {},
): Promise<CaptionCue[]> {
  const state = useEditorStore.getState();
  if (!state.sequence) throw new Error('No project loaded.');

  const { renderTimelineAudio } = await import('@/features/captions/extractAudio');
  const audio = await renderTimelineAudio({
    sequence: state.sequence,
    assets: state.assets,
    onProgress,
  });

  if (options.mode === 'local') {
    const { transcribeLocally } = await import('@/features/captions/localWhisper');
    return transcribeLocally(audio, { model: options.model, onProgress });
  }

  onProgress?.('Transcribing…');
  const { cues } = await api.transcribe(audio);
  return cues;
}

/** Limits the plan request has to respect — mirrors the API schema. */
export const PLAN_MAX_CUES = 1000;
export const PLAN_MAX_CUE_CHARS = 500;

/**
 * Shapes a transcript into a request the edit API will accept.
 *
 * A few minutes of speech transcribes into hundreds of short cues, and an hour
 * runs into thousands — past what the endpoint accepts and past what is useful
 * to a model anyway. Adjacent cues are merged into larger, still-timed lines,
 * which keeps the transcript readable, keeps the timings honest (the merged
 * span covers its parts) and keeps the request inside the schema.
 */
export function condenseCues(
  cues: { start: number; end: number; text: string }[],
  maxCues = PLAN_MAX_CUES,
  maxChars = PLAN_MAX_CUE_CHARS,
): { start: number; end: number; text: string }[] {
  const usable = cues
    .filter((cue) => cue.text.trim().length > 0 && Number.isFinite(cue.start) && Number.isFinite(cue.end))
    .map((cue) => ({ start: Math.max(0, cue.start), end: Math.max(0, cue.end), text: cue.text.trim() }));

  if (usable.length === 0) return [];

  const groupSize = Math.ceil(usable.length / maxCues);
  if (groupSize <= 1) {
    return usable.map((cue) => ({ ...cue, text: cue.text.slice(0, maxChars) }));
  }

  const merged: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < usable.length; i += groupSize) {
    const group = usable.slice(i, i + groupSize);
    merged.push({
      start: group[0]!.start,
      end: group[group.length - 1]!.end,
      text: group
        .map((cue) => cue.text)
        .join(' ')
        .slice(0, maxChars),
    });
  }
  return merged;
}

/** Flattens caption cues into the word list the filler detector needs. */
export function wordsFromCues(cues: CaptionCue[]): TranscriptWord[] {
  return cues.flatMap((cue) =>
    cue.words.length > 0 ? cue.words : [{ text: cue.text, start: cue.start, end: cue.end }],
  );
}

/** Adds caption clips for a transcript. */
export function applyCaptions(cues: CaptionCue[], style: CaptionStyleName = 'karaoke'): boolean {
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence) return false;
  const track = trackByRole(sequence, 'caption');
  if (!track) return false;

  const commands: EditorCommand[] = [
    ...track.clips.map((clip) => ({ type: 'DELETE_CLIP' as const, clipId: clip.id })),
    ...cues.map((cue, index) => ({
      type: 'ADD_CAPTION' as const,
      trackId: track.id,
      clipId: `cap_auto_${index}_${newId('x')}`,
      text: cue.text,
      start: cue.start,
      duration: Math.max(0.3, cue.end - cue.start),
      words: cue.words.map((word) => ({ text: word.text, start: word.start - cue.start, end: word.end - cue.start })),
      style,
    })),
  ];
  return state.apply(commands, 'Add captions');
}

/** On-screen callouts from an AI plan. */
export function applyCallouts(callouts: { start: number; duration: number; text: string }[]): boolean {
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence || callouts.length === 0) return false;
  const track = trackByRole(sequence, 'text');
  if (!track) return false;

  const commands: EditorCommand[] = callouts.map((callout) => ({
    type: 'ADD_TEXT',
    trackId: track.id,
    clipId: newId('t'),
    text: callout.text,
    start: callout.start,
    duration: callout.duration,
    style: { fontSize: sequence.height >= 1600 ? 70 : 52, align: 'center' },
  }));
  return state.apply(commands, 'Add callouts');
}

export interface BrollSuggestion {
  cue: { start: number; duration: number; query: string; reason: string };
  items: StockMediaItem[];
}

/** Places an approved cutaway over the speaker on the B-roll track. */
export async function insertCutaway(
  projectId: string,
  item: StockMediaItem,
  start: number,
  duration: number,
): Promise<boolean> {
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence) return false;

  const { asset } = await api.importStockAsset({ projectId, item });
  state.addAsset(asset);

  const track = trackByRole(sequence, 'broll');
  if (!track) return false;

  const { fitAssetToScene } = await import('@/features/broll/assemble');
  const fitted = fitAssetToScene(asset, start, duration, {
    trackId: track.id,
    transition: 'fade',
    name: item.title.slice(0, 40),
  });
  return useEditorStore.getState().apply(fitted.commands, 'Add cutaway');
}
