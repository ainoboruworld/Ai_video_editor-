'use client';

/**
 * The editing workflow, start to finish.
 *
 * This is the product's primary surface: upload, transcript, fillers, pauses,
 * cuts, smoothing, music, B-roll, captions, export. Each step does its own real
 * work against the project timeline — nothing here is a link to somewhere else
 * that does the actual editing — and every step except having a video is
 * optional and reversible.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioWaveform,
  Captions,
  Check,
  ChevronDown,
  Download,
  FileText,
  Film,
  Music,
  Scissors,
  Search,

  Upload,
  Wand2,
} from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import { uploadFile, ACCEPTED_MIME } from '@/features/media/upload';
import { addAssetToTimeline } from '@/features/timeline/operations';
import {
  analysePrimaryClip,
  applyCaptions,
  cutsToCommands,
  insertCutaway,
  primaryClip,
  sourceToTimeline,
  type BrollSuggestion,
} from '@/features/ai/autoEdit';
import {
  detectFillerCandidates,
  defaultAccepted,
  highlightRuns,
  type FillerCandidate,
} from '@/features/edit/fillers';
import { DEFAULT_AGGRESSION, describeAggression, pauseCuts, type PauseCut } from '@/features/edit/pauses';
import { SMOOTHING_STYLES, smoothingCommands, smoothSeams, type SmoothingStyle } from '@/features/edit/smoothing';
import { DUCKING_DEFAULTS, duckingKeyframes } from '@/features/edit/ducking';
import { STEPS, suggestedStep, workflowState, type StepId } from '@/features/edit/workflow';
import { segmentsToCues, type TranscriptSegment } from '@/features/transcript/model';
import { mergeRanges, type AudioAnalysis, type Range } from '@/features/analysis/audioAnalysis';
import { api } from '@/lib/api-client';
import { sequenceDuration, trackByRole } from '@/lib/engine';
import { Badge, Button, EmptyState, PanelHeader, ProgressBar } from '@/components/ui';
import { clock } from '@/lib/format';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';

export function EditFlowPanel() {
  const sequence = useEditorStore((state) => state.sequence);
  const assets = useEditorStore((state) => state.assets);
  const transcript = useEditorStore((state) => state.transcript);
  const projectId = useEditorStore((state) => state.projectId);
  const aspect = useEditorStore((state) => state.aspect);
  const setPanel = useEditorStore((state) => state.setPanel);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const apply = useEditorStore((state) => state.apply);
  // Analysis and filler decisions live in the store: this panel unmounts every
  // time the user visits another rail, and re-analysing the audio on the way
  // back would be both slow and surprising.
  const analysis = useEditorStore((state) => state.audioAnalysis);
  const setAnalysis = useEditorStore((state) => state.setAudioAnalysis);
  const decisions = useEditorStore((state) => state.fillerDecisions);
  const setFillerDecision = useEditorStore((state) => state.setFillerDecision);
  const setFillerDecisions = useEditorStore((state) => state.setFillerDecisions);

  const [open, setOpen] = useState<StepId | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [aggression, setAggression] = useState(DEFAULT_AGGRESSION);
  const [smoothing, setSmoothing] = useState<SmoothingStyle>('subtle');
  const [appliedCuts, setAppliedCuts] = useState(0);
  const [pausesTrimmed, setPausesTrimmed] = useState(false);
  const [suggestions, setSuggestions] = useState<BrollSuggestion[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const segments: TranscriptSegment[] = useMemo(() => transcript?.segments ?? [], [transcript]);
  const primary = sequence ? primaryClip(sequence) : null;
  const duration = sequence ? sequenceDuration(sequence) : 0;

  const state = useMemo(
    () =>
      workflowState({
        sequence,
        transcriptSegments: segments.length,
        appliedCuts,
        hasPauseCuts: pausesTrimmed,
      }),
    [sequence, segments.length, appliedCuts, pausesTrimmed],
  );

  // Filler candidates are recomputed from whatever the transcript currently
  // says, so editing a segment updates them without a second analysis pass.
  const candidates = useMemo(
    () =>
      segments.length === 0
        ? []
        : detectFillerCandidates({
            segments,
            envelope: analysis?.envelope ?? null,
            silences: analysis?.silences,
          }),
    [segments, analysis],
  );

  // Pre-ticked: the unambiguous ones. Anything the user has explicitly decided
  // about wins over that default, in both directions.
  const accepted = useMemo(() => {
    const auto = defaultAccepted(candidates);
    const out = new Set<string>();
    for (const candidate of candidates) {
      const decided = decisions[candidate.id];
      if (decided ?? auto.has(candidate.id)) out.add(candidate.id);
    }
    return out;
  }, [candidates, decisions]);

  const suggested = suggestedStep(state);
  useEffect(() => {
    setOpen((current) => current ?? suggested);
  }, [suggested]);

  const toggleCandidate = useCallback(
    (candidate: FillerCandidate) => setFillerDecision(candidate.id, !accepted.has(candidate.id)),
    [accepted, setFillerDecision],
  );

  const seek = useCallback(
    (time: number) => {
      setPlayhead(Math.max(0, time));
    },
    [setPlayhead],
  );

  const acceptedFillers = useMemo(
    () => candidates.filter((candidate) => accepted.has(candidate.id)),
    [candidates, accepted],
  );

  const pauses: PauseCut[] = useMemo(() => {
    if (!analysis || !primary) return [];
    return pauseCuts({ silences: analysis.silences, duration, aggression }).flatMap((cut) => {
      const mapped = sourceToTimeline(primary.clip, cut);
      return mapped ? [{ ...mapped, pauseSeconds: cut.pauseSeconds, keptSeconds: cut.keptSeconds }] : [];
    });
  }, [analysis, primary, duration, aggression]);

  const plannedCuts: Range[] = useMemo(
    () => mergeRanges([...acceptedFillers.map((f) => ({ start: f.start, end: f.end })), ...pauses]),
    [acceptedFillers, pauses],
  );
  const plannedSeconds = plannedCuts.reduce((total, cut) => total + (cut.end - cut.start), 0);

  // -------------------------------------------------------------- actions ---

  const onUpload = useCallback(
    async (file: File) => {
      if (!projectId) return;
      setBusy('upload');
      setUploadProgress(0);
      try {
        const { asset, localOnly } = await uploadFile(file, projectId, setUploadProgress);
        useEditorStore.getState().addAsset(asset);
        addAssetToTimeline(asset);
        if (localOnly) {
          toast.info('Stored in this browser only', 'Configure object storage to keep it across reloads.');
        }
        setOpen('transcript');
      } catch (error) {
        toast.error('Upload failed', error instanceof Error ? error.message : undefined);
      } finally {
        setBusy(null);
        setUploadProgress(null);
      }
    },
    [projectId],
  );

  const runAnalysis = useCallback(async () => {
    setBusy('analyse');
    try {
      const result = await analysePrimaryClip();
      setAnalysis(result);
      toast.success(
        `${result.silences.length} pauses found`,
        `${clock(result.removableSeconds)} of dead air across the recording.`,
      );
    } catch (error) {
      toast.error('Could not analyse the audio', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  }, [setAnalysis]);

  const applyPlannedCuts = useCallback(() => {
    if (!sequence || plannedCuts.length === 0) return;
    const cutCommands = cutsToCommands(plannedCuts);
    const smooth = smoothingCommands({ sequence, cutCommands, cuts: plannedCuts, style: smoothing });

    if (!apply([...cutCommands, ...smooth.commands], 'Remove fillers and pauses')) {
      toast.info('Nothing was cut', 'The suggestions did not overlap the clip on the timeline.');
      return;
    }

    setAppliedCuts(plannedCuts.length);
    setPausesTrimmed(pauses.length > 0);
    setAnalysis(null);
    toast.success(
      `Removed ${clock(plannedSeconds)}`,
      smooth.seams > 0
        ? `${smooth.seams} joins smoothed. Undo restores the original.`
        : 'Undo restores the original.',
    );
    setOpen('music');
  }, [sequence, plannedCuts, smoothing, apply, pauses.length, plannedSeconds, setAnalysis]);

  const smoothExisting = useCallback(() => {
    if (!sequence) return;
    // Every join already on the timeline, wherever it came from.
    const videoTrack = sequence.tracks.find((track) => track.kind === 'video' && track.clips.length > 1);
    if (!videoTrack) {
      toast.info('No joins to smooth', 'Smoothing applies to cuts between clips.');
      return;
    }
    const joins = videoTrack.clips.slice(0, -1).map((clip) => clip.start + clip.duration);
    const result = smoothSeams({ sequence, seams: joins, style: smoothing });
    if (result.commands.length === 0 || !apply(result.commands, 'Smooth cuts')) {
      toast.info('Nothing to smooth', 'These joins already carry the smoothing you picked.');
      return;
    }
    toast.success(`${result.seams} joins smoothed`, 'Undo restores the hard cuts.');
  }, [sequence, smoothing, apply]);

  const onMusic = useCallback(
    async (file: File) => {
      if (!projectId || !sequence) return;
      setBusy('music');
      setUploadProgress(0);
      try {
        const { asset } = await uploadFile(file, projectId, setUploadProgress);
        useEditorStore.getState().addAsset(asset);
        addAssetToTimeline(asset, { role: 'music' });

        // Drop it to a bed level straight away: music arriving at full volume
        // over a voice track is never what anyone wants.
        const after = useEditorStore.getState().sequence;
        const musicTrack = after ? trackByRole(after, 'music') : null;
        const clip = musicTrack?.clips[musicTrack.clips.length - 1];
        if (clip) {
          useEditorStore
            .getState()
            .apply({ type: 'CHANGE_VOLUME', clipId: clip.id, volume: DUCKING_DEFAULTS.bed }, 'Set music level');
        }
        toast.success('Music added', `Set to ${Math.round(DUCKING_DEFAULTS.bed * 100)}% so speech stays clear.`);
      } catch (error) {
        toast.error('Could not add music', error instanceof Error ? error.message : undefined);
      } finally {
        setBusy(null);
        setUploadProgress(null);
      }
    },
    [projectId, sequence],
  );

  const duckMusic = useCallback(async () => {
    if (!sequence) return;
    const musicTrack = trackByRole(sequence, 'music');
    const clip = musicTrack?.clips[0];
    if (!clip) {
      toast.info('No music yet', 'Add a track first.');
      return;
    }

    setBusy('duck');
    try {
      // Ducking needs to know when the speaker is talking; reuse the analysis
      // if it is still around, otherwise run it now.
      const result = analysis ?? (await analysePrimaryClip());
      setAnalysis(result);
      const speech = primary
        ? result.speech.flatMap((range) => {
            const mapped = sourceToTimeline(primary.clip, range);
            return mapped ? [mapped] : [];
          })
        : result.speech;

      const keyframes = duckingKeyframes({ clip, speech });
      if (!apply({ type: 'SET_KEYFRAMES', clipId: clip.id, prop: 'volume', keyframes }, 'Duck music under speech')) {
        toast.info('Nothing changed', 'The music clip is already ducked this way.');
        return;
      }
      toast.success(
        'Music ducks under speech',
        `${Math.round(DUCKING_DEFAULTS.bed * 100)}% in the gaps, ${Math.round(DUCKING_DEFAULTS.ducked * 100)}% while talking.`,
      );
    } catch (error) {
      toast.error('Could not set up ducking', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  }, [sequence, analysis, primary, apply, setAnalysis]);

  const findBroll = useCallback(async () => {
    if (segments.length === 0) {
      toast.info('Need a transcript first', 'B-roll suggestions are read from what was said.');
      return;
    }
    setBusy('broll');
    try {
      const cues = brollCuesFromTranscript(segments);
      if (cues.length === 0) {
        toast.info('No obvious B-roll moments', 'Nothing in the transcript reads as a concrete subject.');
        return;
      }
      const { recommendations, missingKeys } = await api.findBroll({
        aspect,
        scenes: cues.map((cue, index) => ({ id: String(index), visual: cue.sentence, duration: cue.duration })),
      });

      const found: BrollSuggestion[] = recommendations.flatMap((entry) => {
        const cue = cues[Number(entry.sceneId)];
        if (!cue || entry.items.length === 0) return [];
        return [{ cue: { ...cue, query: entry.queries[0] ?? cue.sentence }, items: entry.items }];
      });
      setSuggestions(found);

      if (found.length === 0) {
        toast.info(
          'No footage came back',
          missingKeys.length > 0
            ? `No key for ${missingKeys.join(', ')}. Add a free Pexels or Pixabay key to search.`
            : 'The stock providers returned nothing for these moments.',
        );
      }
    } catch (error) {
      toast.error('B-roll search failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  }, [segments, aspect]);

  const makeCaptions = useCallback(() => {
    if (segments.length === 0) {
      toast.info('Need a transcript first', 'Captions are built from it.');
      return;
    }
    const cues = segmentsToCues(segments);
    if (!applyCaptions(cues)) {
      toast.error('Could not add captions');
      return;
    }
    toast.success(`${cues.length} captions added`, 'Built from this transcript — no new request.');
  }, [segments]);

  // ------------------------------------------------------------------ UI ---

  if (!sequence) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="Edit" />
        <EmptyState icon={<Film size={20} />} title="Loading project" description="One moment." />
      </div>
    );
  }

  const stepBody: Record<StepId, React.ReactNode> = {
    video: (
      <>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MIME.join(',')}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void onUpload(file);
          }}
        />
        {primary ? (
          <>
            <p className="text-2xs text-ink-2">
              {assets.find((asset) => asset.id === primary.clip.assetId)?.name ?? 'Your video'} · {clock(duration)}
            </p>
            <Button
              size="sm"
              variant={analysis ? undefined : 'primary'}
              className="mt-2 w-full justify-start"
              icon={<AudioWaveform size={12} />}
              loading={busy === 'analyse'}
              onClick={() => void runAnalysis()}
            >
              {analysis ? 'Re-analyse video' : 'Analyse video'}
            </Button>
            {analysis ? <AnalysisSummary analysis={analysis} duration={duration} fillers={candidates.length} /> : null}
            <Button size="sm" className="mt-1.5 w-full justify-start" icon={<Upload size={12} />} onClick={() => inputRef.current?.click()}>
              Replace with another file
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              className="w-full justify-center"
              icon={<Upload size={12} />}
              loading={busy === 'upload'}
              onClick={() => inputRef.current?.click()}
            >
              Upload Video
            </Button>
            <p className="mt-1.5 text-center text-2xs text-ink-3">or drag and drop your video anywhere in this panel</p>
            {uploadProgress !== null ? <ProgressBar value={uploadProgress} className="mt-2" /> : null}
          </>
        )}
      </>
    ),

    transcript: (
      <>
        <p className="text-2xs leading-relaxed text-ink-2">
          Filler detection, cuts, B-roll and captions all read from the transcript. Get one from a local model, a hosted
          provider, or paste your own.
        </p>
        <Button size="sm" variant="primary" className="mt-2 w-full justify-start" icon={<FileText size={12} />} onClick={() => setPanel('transcript')}>
          {segments.length > 0 ? 'Edit the transcript' : 'Get a transcript'}
        </Button>
        {segments.length > 0 ? (
          <p className="mt-1.5 text-2xs text-ink-3">
            {segments.length} segments{transcript?.estimatedTimings ? ' · timings estimated' : ''}
          </p>
        ) : null}
      </>
    ),

    fillers: (
      <FillerReview
        segments={segments}
        candidates={candidates}
        accepted={accepted}
        onToggle={toggleCandidate}
        onSeek={seek}
        onAcceptAll={() => setFillerDecisions(Object.fromEntries(candidates.map((c) => [c.id, true])))}
        onRejectAll={() => setFillerDecisions(Object.fromEntries(candidates.map((c) => [c.id, false])))}
      />
    ),

    pauses: (
      <>
        {analysis ? (
          <>
            <p className="text-2xs text-ink-2">
              {analysis.silences.length} pauses · {pauses.length} would be trimmed
            </p>
            <label className="mt-2 block text-2xs text-ink-2">
              <span className="mb-1 flex items-center justify-between">
                <span>Natural</span>
                <span>Aggressive</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={aggression}
                onChange={(event) => setAggression(Number(event.target.value))}
                className="w-full accent-[#7c5cff]"
              />
            </label>
            <p className="mt-1 text-2xs text-ink-3">{describeAggression(aggression)}</p>
            <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
              {pauses.map((pause, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => seek(pause.start)}
                  className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-2xs hover:bg-bg-3"
                >
                  <span className="font-mono text-ink-2">{clock(pause.start)}</span>
                  <span className="text-ink-3">
                    {pause.pauseSeconds.toFixed(2)}s pause → keeps {pause.keptSeconds.toFixed(2)}s
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-2xs leading-relaxed text-ink-2">
              Pause trimming reads the audio directly, so it works with no transcript and no key.
            </p>
            <Button
              size="sm"
              variant="primary"
              className="mt-2 w-full justify-start"
              icon={<AudioWaveform size={12} />}
              loading={busy === 'analyse'}
              onClick={() => void runAnalysis()}
            >
              Analyse audio
            </Button>
          </>
        )}
      </>
    ),

    smooth: (
      <>
        <p className="text-2xs leading-relaxed text-ink-2">
          Applied to the joins your cuts create. The aim is an edit the viewer does not notice.
        </p>
        <div className="mt-2 space-y-1">
          {SMOOTHING_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              onClick={() => setSmoothing(style.id)}
              className={cn(
                'w-full rounded-md border px-2 py-1.5 text-left transition-colors',
                smoothing === style.id ? 'border-accent bg-accent-ghost' : 'border-line bg-bg-2 hover:border-line-strong',
              )}
            >
              <span className="block text-2xs font-medium text-ink-0">{style.label}</span>
              <span className="block text-2xs leading-tight text-ink-3">{style.description}</span>
            </button>
          ))}
        </div>
        <Button size="sm" className="mt-2 w-full justify-start" icon={<Wand2 size={12} />} onClick={smoothExisting}>
          Smooth the cuts already on the timeline
        </Button>
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          Both sides of a cut come from the same file, so a cross-dissolve would ghost. These are the treatments that
          read correctly on a same-source join.
        </p>
      </>
    ),

    music: (
      <>
        <input
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/ogg,audio/webm"
          className="hidden"
          id="editflow-music"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void onMusic(file);
          }}
        />
        <Button
          size="sm"
          variant="primary"
          className="w-full justify-start"
          icon={<Music size={12} />}
          loading={busy === 'music'}
          onClick={() => document.getElementById('editflow-music')?.click()}
        >
          Add a music track
        </Button>
        {uploadProgress !== null && busy === 'music' ? <ProgressBar value={uploadProgress} className="mt-2" /> : null}
        <Button
          size="sm"
          className="mt-1.5 w-full justify-start"
          icon={<AudioWaveform size={12} />}
          loading={busy === 'duck'}
          onClick={() => void duckMusic()}
        >
          Duck it under the speech
        </Button>
        <Button size="sm" className="mt-1.5 w-full justify-start" icon={<Music size={12} />} onClick={() => setPanel('audio')}>
          Free music sources and levels
        </Button>
      </>
    ),

    broll: (
      <>
        <p className="text-2xs leading-relaxed text-ink-2">
          Suggestions come from what the speaker actually says. Nothing is added until you add it.
        </p>
        <Button
          size="sm"
          variant="primary"
          className="mt-2 w-full justify-start"
          icon={<Search size={12} />}
          loading={busy === 'broll'}
          onClick={() => void findBroll()}
        >
          Suggest B-roll from the transcript
        </Button>
        {suggestions?.length ? (
          <div className="mt-2 space-y-2">
            {suggestions.map((suggestion, index) => (
              <div key={index} className="rounded-md border border-line bg-bg-2 p-1.5">
                <button
                  type="button"
                  onClick={() => seek(suggestion.cue.start)}
                  className="block w-full text-left text-2xs font-medium text-ink-0 hover:text-accent"
                >
                  {clock(suggestion.cue.start)} — {suggestion.cue.query}
                </button>
                <p className="mt-0.5 text-2xs text-ink-3">{suggestion.cue.reason}</p>
                <div className="mt-1 flex gap-1 overflow-x-auto">
                  {suggestion.items.slice(0, 4).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      title={`Add "${item.title}" over ${clock(suggestion.cue.start)}`}
                      onClick={async () => {
                        if (!projectId) return;
                        setBusy('add-broll');
                        try {
                          const ok = await insertCutaway(projectId, item, suggestion.cue.start, suggestion.cue.duration);
                          if (ok) toast.success('B-roll added', 'Your audio keeps playing underneath.');
                        } catch (error) {
                          toast.error('Could not add that clip', error instanceof Error ? error.message : undefined);
                        } finally {
                          setBusy(null);
                        }
                      }}
                      className="h-12 w-20 shrink-0 overflow-hidden rounded border border-line hover:border-accent"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.thumbnailUrl} alt={item.title} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <Button size="sm" className="mt-1.5 w-full justify-start" icon={<Search size={12} />} onClick={() => setPanel('broll')}>
          Search stock footage yourself
        </Button>
      </>
    ),

    captions: (
      <>
        <p className="text-2xs leading-relaxed text-ink-2">
          Built from the transcript as it stands now, so they match the edit rather than the original recording.
        </p>
        <Button size="sm" variant="primary" className="mt-2 w-full justify-start" icon={<Captions size={12} />} onClick={makeCaptions}>
          Generate captions
        </Button>
        <Button size="sm" className="mt-1.5 w-full justify-start" icon={<Captions size={12} />} onClick={() => setPanel('captions')}>
          Style and timing
        </Button>
      </>
    ),

    export: (
      <>
        <p className="text-2xs leading-relaxed text-ink-2">
          Play it back in the canvas above. The preview and the exported file share one renderer, so what you see is
          what you get.
        </p>
        <Button size="sm" variant="primary" className="mt-2 w-full justify-start" icon={<Download size={12} />} onClick={() => setPlayhead(0)}>
          Jump to the start and review
        </Button>
        <p className="mt-1.5 text-2xs text-ink-3">Export is in the top-right of the editor.</p>
      </>
    ),
  };

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file) void onUpload(file);
      }}
    >
      <PanelHeader title="Edit" description="Upload, cut, smooth, export." />

      <div className="flex-1 overflow-y-auto p-2.5">
        {/* The cut plan lives above the steps because it is the thing the user
            is deciding about, and it changes as they tick fillers on and off. */}
        {plannedCuts.length > 0 ? (
          <div className="mb-3 rounded-lg border border-accent/40 bg-bg-2 p-2.5">
            <p className="text-xs font-semibold text-ink-0">{plannedCuts.length} cuts ready</p>
            <p className="mt-0.5 text-2xs text-ink-3">
              {acceptedFillers.length} fillers · {pauses.length} pauses · removes {clock(plannedSeconds)} ·{' '}
              {clock(Math.max(0, duration - plannedSeconds))} after
            </p>
            <Button size="sm" variant="primary" className="mt-2 w-full justify-center" icon={<Scissors size={12} />} onClick={applyPlannedCuts}>
              Apply {plannedCuts.length} cuts
            </Button>
            <p className="mt-1.5 text-2xs text-ink-3">
              Smoothing: {SMOOTHING_STYLES.find((style) => style.id === smoothing)?.label}. Undo restores the original.
            </p>
          </div>
        ) : null}

        <div className="space-y-1">
          {STEPS.map((step, index) => {
            const status = state[step.id];
            const isOpen = open === step.id;
            return (
              <div key={step.id} className="overflow-hidden rounded-lg border border-line bg-bg-1">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : step.id)}
                  className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-bg-2"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold',
                      status.done ? 'bg-ok/20 text-ok' : 'bg-bg-3 text-ink-3',
                    )}
                  >
                    {status.done ? <Check size={9} /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-2xs font-medium text-ink-0">{step.title}</span>
                    <span className="block truncate text-2xs text-ink-3">{status.detail}</span>
                  </span>
                  {step.optional ? <span className="shrink-0 text-2xs text-ink-3">optional</span> : null}
                  <ChevronDown size={12} className={cn('shrink-0 text-ink-3 transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen ? (
                  <div className="border-t border-line px-2 py-2">
                    <p className="mb-2 text-2xs leading-relaxed text-ink-3">{step.blurb}</p>
                    {stepBody[step.id]}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ sub-views ---

function AnalysisSummary({
  analysis,
  duration,
  fillers,
}: {
  analysis: AudioAnalysis;
  duration: number;
  fillers: number;
}) {
  const speech = analysis.speech.reduce((total, range) => total + (range.end - range.start), 0);
  const long = analysis.silences.filter((range) => range.end - range.start >= 0.8).length;
  const rows: [string, string][] = [
    ['Duration', clock(duration)],
    ['Speech detected', clock(speech)],
    ['Potential filler words', fillers > 0 ? String(fillers) : 'needs a transcript'],
    ['Long pauses', String(long)],
  ];
  return (
    <div className="mt-2 rounded-md border border-line bg-bg-2 p-2">
      <p className="mb-1 text-2xs uppercase tracking-wide text-ink-3">Video analysis</p>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between text-2xs">
          <span className="text-ink-2">{label}</span>
          <span className="font-mono text-ink-0">{value}</span>
        </div>
      ))}
    </div>
  );
}

function FillerReview({
  segments,
  candidates,
  accepted,
  onToggle,
  onSeek,
  onAcceptAll,
  onRejectAll,
}: {
  segments: TranscriptSegment[];
  candidates: FillerCandidate[];
  accepted: Set<string>;
  onToggle: (candidate: FillerCandidate) => void;
  onSeek: (time: number) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  if (segments.length === 0) {
    return (
      <p className="text-2xs leading-relaxed text-ink-2">
        Filler detection reads the transcript. Get one first and the candidates appear here, highlighted in place.
      </p>
    );
  }

  if (candidates.length === 0) {
    return <p className="text-2xs text-ink-2">No filler words found in this transcript.</p>;
  }

  const estimated = candidates.filter((candidate) => candidate.estimatedTiming).length;
  const selectedCount = candidates.filter((candidate) => accepted.has(candidate.id)).length;

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Badge>{candidates.length} potential filler words</Badge>
        <span className="text-2xs text-ink-3">{selectedCount} selected</span>
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <Button size="sm" className="flex-1" onClick={onAcceptAll}>
          Accept all
        </Button>
        <Button size="sm" className="flex-1" onClick={onRejectAll}>
          Reject all
        </Button>
      </div>

      {estimated > 0 ? (
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          {estimated} of these have timings worked out from their position in the text rather than measured — this
          transcript carries no word timings. Preview before applying.
        </p>
      ) : null}

      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        {segments.map((segment) => {
          const runs = highlightRuns(segment, candidates);
          if (runs.every((run) => run.candidate === null)) return null;
          return (
            <div key={segment.id}>
              <button
                type="button"
                onClick={() => onSeek(segment.start)}
                className="font-mono text-2xs text-ink-3 hover:text-accent"
              >
                {clock(segment.start)}
              </button>
              <p className="text-2xs leading-relaxed text-ink-1">
                {runs.map((run, index) => {
                  const candidate = run.candidate;
                  if (!candidate) return <span key={index}>{run.text}</span>;
                  const isAccepted = accepted.has(candidate.id);
                  return (
                    // Two separate controls on purpose: jumping to a word to
                    // hear it must not change whether it gets cut. They used to
                    // be one button, so inspecting a word after "Accept all"
                    // silently dropped it from the selection.
                    <span
                      key={index}
                      className={cn(
                        'mx-px inline-flex items-baseline gap-px rounded',
                        isAccepted ? 'bg-danger/25' : 'bg-warn/15',
                      )}
                    >
                      <button
                        type="button"
                        title={`Jump to ${clock(candidate.start)}${candidate.estimatedTiming ? ' · timing estimated' : ''}`}
                        onClick={() => onSeek(candidate.start)}
                        className={cn(
                          'rounded-l px-0.5',
                          isAccepted ? 'text-danger line-through' : 'text-warn',
                        )}
                      >
                        {run.text}
                      </button>
                      <button
                        type="button"
                        title={isAccepted ? `Keep this one (${candidate.reason})` : `Cut this one (${candidate.reason})`}
                        aria-label={isAccepted ? 'Keep this word' : 'Cut this word'}
                        onClick={() => onToggle(candidate)}
                        className={cn(
                          'rounded-r px-0.5 text-[9px] leading-none',
                          isAccepted ? 'text-danger hover:bg-danger/25' : 'text-warn hover:bg-warn/25',
                        )}
                      >
                        {isAccepted ? '✕' : '＋'}
                      </button>
                    </span>
                  );
                })}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
        Click a word to jump there and hear it. Click the ✕ beside it to keep it instead. Struck-through words will be
        cut.
      </p>
    </>
  );
}

/**
 * Picks the moments worth covering with B-roll.
 *
 * Only segments naming something concrete are offered — a stock clip over an
 * abstract sentence is filler of a different kind.
 */
function brollCuesFromTranscript(
  segments: TranscriptSegment[],
): { start: number; duration: number; query: string; reason: string; sentence: string }[] {
  const SUBJECTS =
    /\b(team|office|meeting|customer|customers|growth|data|analytics|hiring|interview|startup|product|city|travel|money|revenue|coffee|laptop|computer|code|coding|design|market|marketing|sales|nature|training|workout|kitchen|cooking|school|student|students|research|science|factory|shipping|delivery)\b/i;

  const cues: { start: number; duration: number; query: string; reason: string; sentence: string }[] = [];
  for (const segment of segments) {
    const match = SUBJECTS.exec(segment.text);
    if (!match) continue;
    const length = segment.end - segment.start;
    if (length < 1.2) continue;
    cues.push({
      start: segment.start,
      duration: Math.min(4, length),
      query: match[0].toLowerCase(),
      sentence: segment.text,
      reason: `"${segment.text.slice(0, 60)}${segment.text.length > 60 ? '…' : ''}"`,
    });
    if (cues.length >= 8) break;
  }
  return cues;
}

