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
  type LoudnessEnvelope,
  type Range,
  type TranscriptWord,
} from '@/features/analysis/audioAnalysis';
import { newId } from '@/features/broll/assemble';
import { api } from '@/lib/api-client';
import { trackByRole, type CaptionStyleName, type Clip, type EditorCommand, type Sequence } from '@/lib/engine';
import { useEditorStore } from '@/state/editorStore';
import type { AspectRatio } from '@/lib/engine';
import type { CaptionCue, StockMediaItem } from '@/types';

export interface AnalysisResult {
  envelope: LoudnessEnvelope;
  silences: Range[];
  speech: Range[];
  /** Seconds that would be removed by cutting the detected silence. */
  removableSeconds: number;
}

/** Cuts, expressed in timeline seconds, ready to be applied. */
export interface CutPlan {
  cuts: Range[];
  removedSeconds: number;
  label: string;
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

/** Applies a cut plan as one undoable edit. */
export function applyCutPlan(plan: CutPlan): boolean {
  if (plan.cuts.length === 0) return false;
  const state = useEditorStore.getState();
  return state.apply(cutsToCommands(plan.cuts), plan.label);
}

/** Transcribes the whole timeline and returns word-level cues. */
export async function transcribeTimeline(onProgress?: (message: string) => void): Promise<CaptionCue[]> {
  const state = useEditorStore.getState();
  if (!state.sequence) throw new Error('No project loaded.');
  const { renderTimelineAudio } = await import('@/features/captions/extractAudio');
  const audio = await renderTimelineAudio({
    sequence: state.sequence,
    assets: state.assets,
    onProgress,
  });
  onProgress?.('Transcribing…');
  const { cues } = await api.transcribe(audio);
  return cues;
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

/** Searches stock footage for each B-roll cue the AI proposed. */
export async function findCutawayBroll(
  cues: { start: number; duration: number; query: string; reason: string }[],
  aspect: AspectRatio,
): Promise<BrollSuggestion[]> {
  if (cues.length === 0) return [];
  const { recommendations } = await api.findBroll({
    aspect,
    perScene: 4,
    scenes: cues.map((cue, index) => ({
      id: String(index),
      visual: cue.query,
      duration: cue.duration,
      queries: [cue.query],
    })),
  });

  return cues.map((cue, index) => ({
    cue,
    items: recommendations.find((r) => r.sceneId === String(index))?.items ?? [],
  }));
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
