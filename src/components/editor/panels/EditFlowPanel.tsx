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
  Clapperboard,
  ChevronDown,
  Download,
  FileText,
  Film,
  GripVertical,
  Music,
  Newspaper,
  Scissors,
  Search,

  Upload,
  Wand2,
} from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import { uploadFile, ACCEPTED_MIME } from '@/features/media/upload';
import { addAssetToTimeline, addGraphicClip } from '@/features/timeline/operations';
import {
  analyseTimeline,
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
import { CUT_KIND_LABELS, defaultAcceptedCuts, detectSmartCuts, type SmartCut } from '@/features/edit/smartCuts';
import { analyseReference } from '@/features/template/analyse';
import { planTemplate, type TemplatePlan } from '@/features/template/apply';
import {
  describeProfile,
  INTENSITY_LABELS,
  type StyleProfile,
  type TemplateIntensity,
} from '@/features/template/profile';
import { deleteTemplate, listTemplates, saveTemplate } from '@/features/template/store';
import { SMOOTHING_STYLES, smoothingCommands, smoothSeams, type SmoothingStyle } from '@/features/edit/smoothing';
import {
  DEFAULT_EDIT_STYLE,
  EDIT_STYLES,
  TECHNIQUE_LABELS,
  type CutTechnique,
  type EditStyle,
} from '@/features/edit/cutJudgement';
import { buildSmoothPlan, type SmoothPlan } from '@/features/edit/smoothPlan';
import { DUCKING_DEFAULTS, duckingKeyframes } from '@/features/edit/ducking';
import { citationDate, citationGraphic, newsCuesFromTranscript, type NewsCue } from '@/features/edit/news';
import { closeGapsCommands, joinCommands, moveInOrder, orderedClips, reorderCommands, type OrderedClip } from '@/features/edit/clips';
import { STEPS, suggestedStep, workflowState, type StepId } from '@/features/edit/workflow';
import { segmentsToCues, type TranscriptSegment, type TranscriptSource } from '@/features/transcript/model';
import { mergeRanges, type AudioAnalysis, type Range } from '@/features/analysis/audioAnalysis';
import { coalesceCuts } from '@/features/edit/coalesce';
import { api } from '@/lib/api-client';
import { sequenceDuration, trackByRole } from '@/lib/engine';
import { Badge, Button, EmptyState, PanelHeader, ProgressBar } from '@/components/ui';
import { clock } from '@/lib/format';
import { toast } from '@/state/toastStore';
import type { Asset, NewsArticle } from '@/types';
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
  const decisions = useEditorStore((state) => state.cutDecisions);
  const setCutDecision = useEditorStore((state) => state.setCutDecision);
  const setCutDecisions = useEditorStore((state) => state.setCutDecisions);

  const [open, setOpen] = useState<StepId | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [aggression, setAggression] = useState(DEFAULT_AGGRESSION);
  const [smoothing, setSmoothing] = useState<SmoothingStyle>('dissolve');
  const [appliedCuts, setAppliedCuts] = useState(0);
  const [pausesTrimmed, setPausesTrimmed] = useState(false);
  const [suggestions, setSuggestions] = useState<BrollSuggestion[] | null>(null);
  const [articles, setArticles] = useState<{ cue: NewsCue; found: NewsArticle[] }[] | null>(null);
  const [templates, setTemplates] = useState<StyleProfile[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<StyleProfile | null>(null);
  const [intensity, setIntensity] = useState<TemplateIntensity>('medium');
  const [appliedTemplate, setAppliedTemplate] = useState<string | null>(null);
  // Music levels a template asked for, so the music step mixes like the reference.
  const [templateDucking, setTemplateDucking] = useState<{ bed: number; ducked: number } | null>(null);
  const [editing, setEditing] = useState<EditStyle>(DEFAULT_EDIT_STYLE);
  const [smoothPlan, setSmoothPlan] = useState<SmoothPlan | null>(null);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const segments: TranscriptSegment[] = useMemo(() => transcript?.segments ?? [], [transcript]);
  const primary = sequence ? primaryClip(sequence) : null;
  const duration = sequence ? sequenceDuration(sequence) : 0;

  // Cuts the transcript justifies beyond fillers: repeats, false starts,
  // corrections, restatements, rambling and marked tangents. Same decision
  // record as the fillers, so one list of ids drives the whole plan.
  const lineCuts = useMemo(
    () => detectSmartCuts({ segments, silences: analysis?.silences }),
    [segments, analysis],
  );

  const acceptedLines = useMemo(() => {
    const auto = defaultAcceptedCuts(lineCuts);
    return lineCuts.filter((cut) => decisions[cut.id] ?? auto.has(cut.id));
  }, [lineCuts, decisions]);

  const state = useMemo(
    () =>
      workflowState({
        sequence,
        transcriptSegments: segments.length,
        lineCandidates: lineCuts.length,
        linesAccepted: acceptedLines.length,
        templateApplied: appliedTemplate,
        appliedCuts,
        hasPauseCuts: pausesTrimmed,
      }),
    [sequence, segments.length, lineCuts.length, acceptedLines.length, appliedCuts, pausesTrimmed, appliedTemplate],
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

  const clips = useMemo(() => (sequence ? orderedClips(sequence) : []), [sequence]);

  // Saved templates live in this browser, so they are available in every
  // project without an account or a server round-trip.
  useEffect(() => {
    setTemplates(listTemplates());
  }, []);

  const suggested = suggestedStep(state);
  useEffect(() => {
    setOpen((current) => current ?? suggested);
  }, [suggested]);

  const toggleCandidate = useCallback(
    (candidate: FillerCandidate) => setCutDecision(candidate.id, !accepted.has(candidate.id)),
    [accepted, setCutDecision],
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

  // The analysis is measured across the whole timeline, so its silences are
  // already timeline seconds — no per-clip mapping, and pauses inside the fourth
  // clip are found the same way as pauses inside the first.
  const pauses: PauseCut[] = useMemo(() => {
    if (!analysis) return [];
    return pauseCuts({ silences: analysis.silences, duration, aggression });
  }, [analysis, duration, aggression]);

  // Merged, so a filler inside a cut line is not counted or cut twice — then
  // coalesced, so two cuts that nearly touch do not leave a sliver of footage
  // between them that reads as a glitch and costs two joins instead of one.
  const plan = useMemo(
    () =>
      coalesceCuts({
        cuts: mergeRanges([
          ...acceptedFillers.map((f) => ({ start: f.start, end: f.end })),
          ...acceptedLines.map((c) => ({ start: c.start, end: c.end })),
          ...pauses,
        ]),
        segments,
      }),
    [acceptedFillers, acceptedLines, pauses, segments],
  );
  const plannedCuts: Range[] = plan.cuts;
  const swallowed = plan.swallowed;
  const plannedSeconds = plannedCuts.reduce((total, cut) => total + (cut.end - cut.start), 0);

  // A plan describes one specific set of cuts. Change which cuts are selected,
  // or the style, and the old decisions no longer describe anything.
  useEffect(() => {
    setSmoothPlan(null);
  }, [plannedCuts, editing]);

  // Where B-roll could cover a cut: what is already on the B-roll track, plus
  // the moments the B-roll step has found footage for.
  const brollRanges: Range[] = useMemo(() => {
    const track = sequence ? trackByRole(sequence, 'broll') : null;
    const placed = (track?.clips ?? []).map((clip) => ({ start: clip.start, end: clip.start + clip.duration }));
    const offered = (suggestions ?? []).map((entry) => ({
      start: entry.cue.start,
      end: entry.cue.start + entry.cue.duration,
    }));
    return [...placed, ...offered];
  }, [sequence, suggestions]);

  // -------------------------------------------------------------- actions ---

  /**
   * Uploads one or more clips and appends them in the order they were given.
   *
   * Sequential rather than parallel on purpose: the running order is the order
   * the user picked, and appending depends on the clip before it already being
   * on the timeline. One failure does not abandon the rest — the others still
   * land and the failure is named.
   */
  const onUpload = useCallback(
    async (files: File[]) => {
      if (!projectId || files.length === 0) return;
      setBusy('upload');
      setUploadProgress(0);
      let added = 0;
      let localOnlyCount = 0;
      try {
        for (const [index, file] of files.entries()) {
          try {
            const { asset, localOnly } = await uploadFile(file, projectId, (fraction) =>
              setUploadProgress((index + fraction) / files.length),
            );
            useEditorStore.getState().addAsset(asset);
            addAssetToTimeline(asset);
            added += 1;
            if (localOnly) localOnlyCount += 1;
          } catch (error) {
            toast.error(`${file.name} failed`, error instanceof Error ? error.message : undefined);
          }
        }
        if (added > 1) toast.success(`${added} clips added`, 'They play in this order. Drag to change it.');
        if (localOnlyCount > 0) {
          toast.info('Stored in this browser only', 'Configure object storage to keep it across reloads.');
        }
        if (added > 0) setOpen('transcript');
      } finally {
        setBusy(null);
        setUploadProgress(null);
      }
    },
    [projectId],
  );

  /**
   * Softens the joins between clips.
   *
   * A join between two different recordings has no removed footage to dissolve
   * through, so this is a short audio fade on both sides — which is what takes
   * the click out — plus an optional quarter-second dissolve on the incoming
   * clip. Any gaps left by a deleted clip are closed in the same batch, because
   * a hole between two clips is a black frame.
   */
  const smoothJoins = useCallback(
    (dissolve: boolean) => {
      if (!sequence) return;
      const commands = [...closeGapsCommands(sequence), ...joinCommands(sequence, { dissolve })];
      if (commands.length === 0) {
        toast.info('Nothing to smooth', 'The joins between these clips are already handled.');
        return;
      }
      setBusy('joins');
      const ok = apply(commands, 'Smooth the joins between clips');
      setBusy(null);
      if (ok) {
        toast.success(
          'Joins smoothed',
          dissolve ? 'Short dissolve and audio fade at each join.' : 'Audio fade at each join.',
        );
      }
    },
    [sequence, apply],
  );

  /** Reordering is one undoable batch, so the running order is never half-changed. */
  const applyOrder = useCallback(
    (order: string[]) => {
      if (!sequence) return;
      const commands = reorderCommands(sequence, order);
      if (commands.length === 0) return;
      apply(commands, 'Reorder clips');
    },
    [sequence, apply],
  );

  const runAnalysis = useCallback(async () => {
    setBusy('analyse');
    try {
      const result = await analyseTimeline();
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

  /**
   * Works out how each cut should be handled, before touching anything.
   *
   * This is the expensive step — it samples the real frames either side of every
   * seam — and it is deliberately separate from applying, because the whole
   * point is that the user sees the reasoning and can overrule it.
   */
  const planCuts = useCallback(async () => {
    if (!sequence || plannedCuts.length === 0) return;
    setBusy('plan');
    setPlanNote('Looking at the frames either side of each cut…');
    try {
      const plan = await buildSmoothPlan({
        sequence,
        cutCommands: cutsToCommands(plannedCuts),
        cuts: plannedCuts,
        assets,
        style: editing,
        envelope: analysis?.envelope ?? null,
        silences: analysis?.silences,
        segments,
        brollRanges,
        newId: (prefix) => `${prefix}_${Math.round(performance.now() * 1000).toString(36)}`,
        onProgress: (done, total) => setPlanNote(`Reading frames… ${done}/${total} cuts`),
      });
      setSmoothPlan(plan);
      if (plan.visualBlind) {
        toast.info(
          'Judged on sound alone',
          'No frames could be read from this media, so the picture side of each cut was not measured.',
        );
      }
    } catch (error) {
      toast.error('Could not plan the cuts', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
      setPlanNote(null);
    }
  }, [sequence, plannedCuts, assets, editing, analysis, segments, brollRanges]);

  const applyPlannedCuts = useCallback(() => {
    if (!sequence || plannedCuts.length === 0) return;
    const cutCommands = cutsToCommands(plannedCuts);
    // Without a plan, fall back to the single-technique smoothing rather than
    // refusing to cut — but the planned path is the one that reads the footage.
    const decoration = smoothPlan
      ? smoothPlan.commands
      : smoothingCommands({ sequence, cutCommands, cuts: plannedCuts, style: smoothing }).commands;

    if (!apply([...cutCommands, ...decoration], 'Remove fillers and pauses')) {
      toast.info('Nothing was cut', 'The suggestions did not overlap the clip on the timeline.');
      return;
    }

    setAppliedCuts(plannedCuts.length);
    setPausesTrimmed(pauses.length > 0);
    setAnalysis(null);
    if (smoothPlan) {
      const counts = new Map<string, number>();
      for (const entry of smoothPlan.entries) {
        counts.set(entry.judgement.technique, (counts.get(entry.judgement.technique) ?? 0) + 1);
      }
      const summary = [...counts.entries()]
        .map(([technique, count]) => `${count} ${TECHNIQUE_LABELS[technique as CutTechnique].toLowerCase()}`)
        .join(', ');
      toast.success(`Removed ${clock(plannedSeconds)}`, `${summary}. Undo restores the original.`);
    } else {
      toast.success(`Removed ${clock(plannedSeconds)}`, 'Undo restores the original.');
    }
    setSmoothPlan(null);
    setOpen('music');
  }, [sequence, plannedCuts, smoothing, smoothPlan, apply, pauses.length, plannedSeconds, setAnalysis]);

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
    toast.success(
      result.dissolved > 0 ? `${result.dissolved} joins dissolved` : `${result.seams} joins smoothed`,
      'Undo restores the hard cuts.',
    );
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
      const result = analysis ?? (await analyseTimeline());
      setAnalysis(result);
      const keyframes = duckingKeyframes({
        clip,
        speech: result.speech,
        // A reference's measured levels win over the defaults, so applying a
        // template really does change the mix rather than only the picture.
        options: templateDucking ?? undefined,
      });
      if (!apply({ type: 'SET_KEYFRAMES', clipId: clip.id, prop: 'volume', keyframes }, 'Duck music under speech')) {
        toast.info('Nothing changed', 'The music clip is already ducked this way.');
        return;
      }
      toast.success(
        'Music ducks under speech',
        `${Math.round((templateDucking?.bed ?? DUCKING_DEFAULTS.bed) * 100)}% in the gaps, ${Math.round((templateDucking?.ducked ?? DUCKING_DEFAULTS.ducked) * 100)}% while talking.`,
      );
    } catch (error) {
      toast.error('Could not set up ducking', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  }, [sequence, analysis, apply, setAnalysis, templateDucking]);

  /**
   * Measures a reference video's editing style.
   *
   * The file is read in this browser and never uploaded — a reference is
   * usually someone else's finished work, and nothing is needed from it but
   * statistics.
   */
  const onReference = useCallback(async (file: File) => {
    setBusy('template');
    setAnalysisNote('Reading the reference…');
    try {
      const profile = await analyseReference(file, file.name, {
        onProgress: (message) => setAnalysisNote(message),
      });
      setActiveTemplate(profile);
      setTemplates(saveTemplate(profile));
      toast.success('Reference analysed', describeProfile(profile));
    } catch (error) {
      toast.error('Could not analyse that video', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
      setAnalysisNote(null);
    }
  }, []);

  /** The plan is computed for display first; nothing is applied until asked. */
  const templatePlan = useMemo(
    () =>
      sequence && activeTemplate
        ? planTemplate({ sequence, profile: activeTemplate, intensity, currentAggression: aggression })
        : null,
    [sequence, activeTemplate, intensity, aggression],
  );

  const applyTemplate = useCallback(() => {
    if (!activeTemplate || !templatePlan) return;
    setBusy('apply-template');
    try {
      // Settings the later steps read, and clip commands, in one go. The
      // commands are one undoable batch; the settings are just where the
      // sliders now sit, so the user can still overrule any of them.
      setAggression(templatePlan.aggression);
      setSmoothing(templatePlan.smoothing);
      setTemplateDucking(templatePlan.ducking);
      if (templatePlan.commands.length > 0) {
        apply(templatePlan.commands, `Apply "${activeTemplate.name}" style`);
      }
      setAppliedTemplate(activeTemplate.name);
      toast.success(`"${activeTemplate.name}" applied`, templatePlan.effects[0]);
    } finally {
      setBusy(null);
    }
  }, [activeTemplate, templatePlan, apply]);

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

  /**
   * News articles for the claims in the transcript.
   *
   * Only metadata comes back — headline, publisher, date — and an approved
   * article lands as a citation the compositor draws. Publisher photography is
   * theirs; footage keeps coming from the licensed stock providers.
   */
  const findNews = useCallback(async () => {
    if (segments.length === 0) {
      toast.info('Need a transcript first', 'Citations are matched to the claims you actually make.');
      return;
    }
    setBusy('news');
    try {
      const cues = newsCuesFromTranscript(segments);
      if (cues.length === 0) {
        setArticles([]);
        toast.info('No claims to cite', 'Nothing here names a figure, a year or a study, so a source would be decoration.');
        return;
      }
      const { recommendations } = await api.findNews({
        cues: cues.map((cue, index) => ({ id: String(index), query: cue.query })),
      });

      const found = recommendations.flatMap((entry) => {
        const cue = cues[Number(entry.cueId)];
        if (!cue || entry.articles.length === 0) return [];
        return [{ cue, found: entry.articles }];
      });
      setArticles(found);
      if (found.length === 0) toast.info('No coverage found', 'The news index had nothing for these claims.');
    } catch (error) {
      toast.error('News search failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  }, [segments]);

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
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length) void onUpload(files);
          }}
        />
        {primary ? (
          <>
            <ClipRunningOrder
              clips={clips}
              assets={assets}
              onReorder={applyOrder}
              onSeek={seek}
              onSmoothJoins={smoothJoins}
              busy={busy === 'joins'}
            />
            <Button
              size="sm"
              variant={analysis ? undefined : 'primary'}
              className="mt-2 w-full justify-start"
              icon={<AudioWaveform size={12} />}
              loading={busy === 'analyse'}
              onClick={() => void runAnalysis()}
            >
              {analysis ? 'Re-analyse' : clips.length > 1 ? `Analyse all ${clips.length} clips` : 'Analyse video'}
            </Button>
            {analysis ? <AnalysisSummary analysis={analysis} duration={duration} fillers={candidates.length} /> : null}
            <Button size="sm" className="mt-1.5 w-full justify-start" icon={<Upload size={12} />} onClick={() => inputRef.current?.click()}>
              Add more clips
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
        source={transcript?.source ?? null}
        candidates={candidates}
        accepted={accepted}
        onToggle={toggleCandidate}
        onSeek={seek}
        onAcceptAll={() => setCutDecisions(Object.fromEntries(candidates.map((c) => [c.id, true])))}
        onRejectAll={() => setCutDecisions(Object.fromEntries(candidates.map((c) => [c.id, false])))}
      />
    ),

    lines: (
      <SmartCutReview
        cuts={lineCuts}
        hasTranscript={segments.length > 0}
        accepted={new Set(acceptedLines.map((cut) => cut.id))}
        onToggle={(cut, next) => setCutDecision(cut.id, next)}
        onSeek={seek}
        onAcceptAll={() => setCutDecisions({ ...decisions, ...Object.fromEntries(lineCuts.map((c) => [c.id, true])) })}
        onRejectAll={() => setCutDecisions({ ...decisions, ...Object.fromEntries(lineCuts.map((c) => [c.id, false])) })}
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
          The dissolve is built from the footage each cut removed, so the blend happens over the deleted filler rather
          than over anything you kept — and that filler is never heard.
        </p>
      </>
    ),

    template: (
      <>
        <input
          ref={templateInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/x-m4v"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void onReference(file);
          }}
        />
        <p className="text-2xs leading-relaxed text-ink-2">
          Point this at a video whose editing you like. It measures how that video was cut — pace, shot length, joins,
          caption placement, music level — and applies the same approach here. None of its footage is copied.
        </p>
        <Button
          size="sm"
          variant="primary"
          className="mt-2 w-full justify-start"
          icon={<Clapperboard size={12} />}
          loading={busy === 'template'}
          onClick={() => templateInputRef.current?.click()}
        >
          Analyse a reference video
        </Button>
        {analysisNote ? <p className="mt-1 text-2xs text-ink-3">{analysisNote}</p> : null}

        {templates.length > 0 ? (
          <>
            <p className="mb-1 mt-3 text-2xs uppercase tracking-wide text-ink-3">Saved templates</p>
            <div className="space-y-1">
              {templates.map((profile) => (
                <div
                  key={profile.id}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-1.5 py-1.5',
                    activeTemplate?.id === profile.id ? 'border-accent bg-accent/5' : 'border-line bg-bg-2',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveTemplate(profile)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-2xs font-medium text-ink-0">{profile.name}</span>
                    <span className="block truncate text-2xs text-ink-3">{describeProfile(profile)}</span>
                  </button>
                  <button
                    type="button"
                    title="Delete this template"
                    onClick={() => {
                      setTemplates(deleteTemplate(profile.id));
                      if (activeTemplate?.id === profile.id) setActiveTemplate(null);
                    }}
                    className="shrink-0 px-1 text-2xs text-ink-3 hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {activeTemplate ? (
          <TemplatePreview
            profile={activeTemplate}
            plan={templatePlan}
            intensity={intensity}
            onIntensity={setIntensity}
            onApply={applyTemplate}
            busy={busy === 'apply-template'}
          />
        ) : null}
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

        {/* ---- news articles ---- */}
        <p className="mt-4 border-t border-line pt-3 text-2xs leading-relaxed text-ink-2">
          When you make a claim, the source is worth showing. These are matched to what you said and land as a citation
          drawn on the frame — headline, publisher and date only, never the publisher&rsquo;s own photography.
        </p>
        <Button
          size="sm"
          className="mt-2 w-full justify-start"
          icon={<Newspaper size={12} />}
          loading={busy === 'news'}
          onClick={() => void findNews()}
        >
          Find news to cite
        </Button>
        {articles?.length ? (
          <div className="mt-2 space-y-2">
            {articles.map((entry, index) => (
              <div key={index} className="rounded-md border border-line bg-bg-2 p-1.5">
                <button
                  type="button"
                  onClick={() => seek(entry.cue.start)}
                  className="block w-full text-left text-2xs font-medium text-ink-0 hover:text-accent"
                >
                  {clock(entry.cue.start)} — {entry.cue.query}
                </button>
                <p className="mt-0.5 truncate text-2xs text-ink-3">&ldquo;{entry.cue.sentence}&rdquo;</p>
                <div className="mt-1 space-y-1">
                  {entry.found.map((article) => (
                    <div key={article.id} className="rounded border border-line/70 bg-bg-1 p-1.5">
                      <p className="text-2xs font-medium leading-snug text-ink-0">{article.title}</p>
                      <p className="mt-0.5 text-2xs text-ink-3">
                        {article.source}
                        {article.publishedAt ? ` · ${citationDate(article.publishedAt)}` : ''}
                      </p>
                      <div className="mt-1 flex gap-1">
                        <Button
                          size="sm"
                          variant="primary"
                          className="flex-1 justify-center"
                          onClick={() => {
                            const added = addGraphicClip(citationGraphic(article), {
                              start: entry.cue.start,
                              duration: entry.cue.duration,
                            });
                            if (added) {
                              toast.success('Citation added', `At ${clock(entry.cue.start)} — edit it in the Inspector.`);
                            }
                          }}
                        >
                          Cite at {clock(entry.cue.start)}
                        </Button>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded border border-line px-1.5 py-1 text-2xs text-ink-2 hover:border-accent/40 hover:text-ink-0"
                        >
                          Read
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : articles ? (
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
            Nothing came back. Citations are only offered for sentences that make a checkable claim — a figure, a year,
            a study, a company.
          </p>
        ) : null}
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
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length) void onUpload(files);
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
              {acceptedFillers.length} fillers · {acceptedLines.length} lines · {pauses.length} pauses · removes{' '}
              {clock(plannedSeconds)} ·{' '}
              {clock(Math.max(0, duration - plannedSeconds))} after
            </p>
            {swallowed.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-2xs text-ink-3 hover:text-ink-1">
                  {swallowed.length} {swallowed.length === 1 ? 'fragment' : 'fragments'} between cuts swallowed too
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {swallowed.map((entry) => (
                    <li key={`${entry.start}-${entry.end}`} className="text-2xs leading-relaxed text-ink-3">
                      <button
                        type="button"
                        onClick={() => seek(Math.max(0, entry.start - 0.5))}
                        className="font-mono hover:text-accent"
                      >
                        {clock(entry.start)}
                      </button>{' '}
                      · {entry.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {smoothPlan ? (
              <>
                <EditPlanReview plan={smoothPlan} onSeek={seek} />
                <Button
                  size="sm"
                  variant="primary"
                  className="mt-2 w-full justify-center"
                  icon={<Scissors size={12} />}
                  onClick={applyPlannedCuts}
                >
                  Apply {plannedCuts.length} cuts
                </Button>
                <p className="mt-1.5 text-2xs text-ink-3">Undo restores the original.</p>
              </>
            ) : (
              <>
                <div className="mt-2 flex gap-1">
                  {EDIT_STYLES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      title={option.blurb}
                      onClick={() => setEditing(option.id)}
                      className={cn(
                        'flex-1 rounded border px-1 py-1 text-2xs',
                        editing === option.id
                          ? 'border-accent bg-accent/10 text-ink-0'
                          : 'border-line text-ink-2 hover:text-ink-0',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-2xs leading-relaxed text-ink-3">
                  {EDIT_STYLES.find((option) => option.id === editing)?.blurb}
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  className="mt-2 w-full justify-center"
                  icon={<Scissors size={12} />}
                  loading={busy === 'plan'}
                  onClick={() => void planCuts()}
                >
                  Plan how each cut is handled
                </Button>
                {planNote ? <p className="mt-1 text-2xs text-ink-3">{planNote}</p> : null}
                <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
                  Reads the frames either side of every cut and decides each one on its own. Most cuts need nothing.
                </p>
              </>
            )}
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
  source,
  candidates,
  accepted,
  onToggle,
  onSeek,
  onAcceptAll,
  onRejectAll,
}: {
  segments: TranscriptSegment[];
  source: TranscriptSource | null;
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
    // "None found" is nearly always the transcript's fault rather than the
    // speaker's: Whisper is trained to write readable prose, which means it
    // deletes the hesitations before we ever see them. Saying which source
    // produced this transcript is the difference between a dead end and a fix.
    return (
      <>
        <p className="text-2xs leading-relaxed text-ink-2">No filler words found in this transcript.</p>
        {source === 'local' ? (
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
            Whisper writes a tidied transcript by default, and the in-browser build cannot be told to keep the
            hesitations — so a local transcript often has none to find even when the recording is full of them. The
            hosted transcript is asked for a verbatim one. Switch source in the Transcript panel, or paste a transcript
            that keeps the &ldquo;um&rdquo;s.
          </p>
        ) : source === 'hosted' ? (
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
            The hosted transcript is asked for verbatim text, so this usually means the recording really is clean. If
            you can hear hesitations that are not written down, type them into the transcript at the right point and
            they will be detected.
          </p>
        ) : source === 'manual' ? (
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
            Pasted transcripts are usually already cleaned up. Add the &ldquo;um&rdquo;s and &ldquo;uh&rdquo;s where you
            hear them and they become cuts — or skip this step and trim the pauses instead.
          </p>
        ) : null}
      </>
    );
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


/**
 * The running order, with drag-to-reorder.
 *
 * Deliberately a list rather than a second timeline: the timeline below already
 * shows where things are, and what the user needs here is which take comes
 * after which. Dragging reorders the real clips — one undoable batch — so the
 * preview and the exported file follow immediately.
 */
function ClipRunningOrder({
  clips,
  assets,
  onReorder,
  onSeek,
  onSmoothJoins,
  busy,
}: {
  clips: OrderedClip[];
  assets: Asset[];
  onReorder: (order: string[]) => void;
  onSeek: (time: number) => void;
  onSmoothJoins: (dissolve: boolean) => void;
  busy: boolean;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const name = (clip: OrderedClip) =>
    assets.find((asset) => asset.id === clip.clip.assetId)?.name ?? clip.clip.name ?? 'Clip';

  if (clips.length === 0) return null;

  if (clips.length === 1) {
    const only = clips[0]!;
    return (
      <p className="text-2xs text-ink-2">
        {name(only)} · {clock(only.duration)}
      </p>
    );
  }

  const drop = (target: number) => {
    if (dragging === null) return;
    const order = moveInOrder(
      clips.map((entry) => entry.clip.id),
      dragging,
      target,
    );
    setDragging(null);
    setOver(null);
    onReorder(order);
  };

  return (
    <>
      <p className="mb-1 text-2xs uppercase tracking-wide text-ink-3">
        Running order ({clips.length} clips · {clock(clips.reduce((total, entry) => total + entry.duration, 0))})
      </p>
      <ol className="space-y-1">
        {clips.map((entry, index) => (
          <li
            key={entry.clip.id}
            draggable
            onDragStart={() => setDragging(index)}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              drop(index);
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-md border bg-bg-2 px-1.5 py-1.5',
              dragging === index ? 'opacity-40' : '',
              over === index && dragging !== null && dragging !== index ? 'border-accent' : 'border-line',
            )}
          >
            <GripVertical size={12} className="shrink-0 cursor-grab text-ink-3" />
            <span className="w-4 shrink-0 text-center font-mono text-2xs text-ink-3">{index + 1}</span>
            <button
              type="button"
              onClick={() => onSeek(entry.start)}
              className="min-w-0 flex-1 truncate text-left text-2xs text-ink-0 hover:text-accent"
              title={`${name(entry)} — starts at ${clock(entry.start)}`}
            >
              {name(entry)}
            </button>
            <span className="shrink-0 font-mono text-2xs text-ink-3">{clock(entry.duration)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-2xs leading-relaxed text-ink-3">
        Drag to reorder. They are edited as one continuous video, and each clip keeps its own audio in sync.
      </p>
      <div className="mt-1.5 flex gap-1">
        <Button size="sm" className="flex-1 justify-center" loading={busy} onClick={() => onSmoothJoins(false)}>
          Soften joins
        </Button>
        <Button size="sm" className="flex-1 justify-center" loading={busy} onClick={() => onSmoothJoins(true)}>
          + dissolve
        </Button>
      </div>
    </>
  );
}

/**
 * The unnecessary-line review.
 *
 * Every candidate shows the four things needed to judge it: where it is, what
 * would go, why, and how sure the detector is. Clicking the text plays it —
 * which is the only preview that settles an argument about whether a line is
 * needed — and the decision is one click either way.
 *
 * Confident removals arrive ticked; anything the detector called REVIEW arrives
 * unticked, because cutting someone's sentences on a guess is worse than
 * leaving them in.
 */
function SmartCutReview({
  cuts,
  hasTranscript,
  accepted,
  onToggle,
  onSeek,
  onAcceptAll,
  onRejectAll,
}: {
  cuts: SmartCut[];
  hasTranscript: boolean;
  accepted: Set<string>;
  onToggle: (cut: SmartCut, next: boolean) => void;
  onSeek: (time: number) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  if (!hasTranscript) {
    return (
      <p className="text-2xs leading-relaxed text-ink-2">
        This reads the transcript for repeats, false starts, corrections and rambling. Get a transcript and the
        candidates appear here.
      </p>
    );
  }

  if (cuts.length === 0) {
    return (
      <p className="text-2xs leading-relaxed text-ink-2">
        Nothing here reads as a repeat, a false start, a correction or a ramble. Fillers and pauses are handled in
        their own steps.
      </p>
    );
  }

  const toRemove = cuts.filter((cut) => cut.verdict === 'remove').length;
  const seconds = cuts.filter((cut) => accepted.has(cut.id)).reduce((total, cut) => total + (cut.end - cut.start), 0);

  return (
    <>
      <p className="text-2xs leading-relaxed text-ink-2">
        {cuts.length} candidates · {toRemove} confident, {cuts.length - toRemove} to review · {accepted.size} selected
        {seconds > 0 ? ` · removes ${clock(seconds)}` : ''}
      </p>
      <div className="mt-1.5 flex gap-1">
        <Button size="sm" className="flex-1 justify-center" onClick={onAcceptAll}>
          Accept all
        </Button>
        <Button size="sm" className="flex-1 justify-center" onClick={onRejectAll}>
          Reject all
        </Button>
      </div>

      <ul className="mt-2 space-y-1.5">
        {cuts.map((cut) => {
          const on = accepted.has(cut.id);
          return (
            <li
              key={cut.id}
              className={cn(
                'rounded-md border p-1.5',
                on ? 'border-accent/50 bg-accent/5' : 'border-line bg-bg-2',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-bg-3 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-2">
                  {CUT_KIND_LABELS[cut.kind]}
                </span>
                <span
                  className={cn(
                    'rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                    cut.verdict === 'remove' ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn',
                  )}
                >
                  {cut.verdict === 'remove' ? 'Remove' : 'Review'}
                </span>
                <span className="text-[9px] uppercase tracking-wide text-ink-3">{cut.confidence}</span>
                <span className="ml-auto font-mono text-2xs text-ink-3">
                  {clock(cut.start)}–{clock(cut.end)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onSeek(cut.start)}
                title="Play from here"
                className={cn(
                  'mt-1 block w-full text-left text-2xs leading-relaxed hover:text-accent',
                  on ? 'text-ink-2 line-through' : 'text-ink-0',
                )}
              >
                “{cut.text.length > 180 ? `${cut.text.slice(0, 179)}…` : cut.text}”
              </button>

              <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
                {cut.reason}
                {cut.estimatedTiming ? ' · timing estimated' : ''}
              </p>

              <div className="mt-1 flex gap-1">
                <Button
                  size="sm"
                  variant={on ? 'primary' : undefined}
                  className="flex-1 justify-center"
                  onClick={() => onToggle(cut, !on)}
                >
                  {on ? 'Will be cut' : 'Cut this'}
                </Button>
                <Button size="sm" className="flex-1 justify-center" onClick={() => onSeek(cut.start)}>
                  Preview
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * What a template measured, and what applying it would do.
 *
 * The measurements are shown before the button, deliberately: a style
 * transplant that silently retimes someone's video is the kind of magic that
 * makes an editor stop trusting a tool. Everything the plan will *not* do is
 * listed with the same weight as everything it will.
 */
function TemplatePreview({
  profile,
  plan,
  intensity,
  onIntensity,
  onApply,
  busy,
}: {
  profile: StyleProfile;
  plan: TemplatePlan | null;
  intensity: TemplateIntensity;
  onIntensity: (value: TemplateIntensity) => void;
  onApply: () => void;
  busy: boolean;
}) {
  const measured: [string, string][] = [
    ['Pace', `${profile.pacing.cutsPerMinute.toFixed(1)} cuts/min · ${profile.pacing.averageShotSeconds.toFixed(1)}s average shot`],
    [
      'Joins',
      profile.transitions.style === 'hard'
        ? 'hard cuts'
        : `${profile.transitions.style} · ${Math.round(profile.transitions.dissolveShare * 100)}% gradual`,
    ],
    ['Motion', profile.motion.staticShare > 0.6 ? 'mostly locked off' : `energy ${Math.round(profile.motion.energy * 100)}%`],
    [
      'Captions',
      profile.captions.present
        ? `${profile.captions.band}, on ${Math.round(profile.captions.coverage * 100)}% of the video`
        : 'none burned in',
    ],
    [
      'Music',
      profile.music.present
        ? `bed at ${Math.round(profile.music.bedLevel * 100)}% between phrases`
        : 'none detected',
    ],
  ];

  return (
    <div className="mt-3 rounded-md border border-line bg-bg-2 p-2">
      <p className="text-2xs font-semibold text-ink-0">{profile.name}</p>
      <dl className="mt-1 space-y-0.5">
        {measured.map(([label, value]) => (
          <div key={label} className="flex gap-2 text-2xs">
            <dt className="w-14 shrink-0 text-ink-3">{label}</dt>
            <dd className="min-w-0 flex-1 text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mb-1 mt-2.5 text-2xs uppercase tracking-wide text-ink-3">Intensity</p>
      <div className="flex gap-1">
        {INTENSITY_LABELS.map((option) => (
          <button
            key={option.id}
            type="button"
            title={option.blurb}
            onClick={() => onIntensity(option.id)}
            className={cn(
              'flex-1 rounded border px-1 py-1 text-2xs',
              intensity === option.id ? 'border-accent bg-accent/10 text-ink-0' : 'border-line text-ink-2 hover:text-ink-0',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-2xs leading-relaxed text-ink-3">
        {INTENSITY_LABELS.find((option) => option.id === intensity)?.blurb}
      </p>

      {plan ? (
        <>
          <p className="mb-0.5 mt-2.5 text-2xs uppercase tracking-wide text-ink-3">This will</p>
          <ul className="space-y-0.5">
            {plan.effects.map((effect) => (
              <li key={effect} className="text-2xs leading-relaxed text-ink-2">
                · {effect}
              </li>
            ))}
          </ul>
          <p className="mb-0.5 mt-2 text-2xs uppercase tracking-wide text-ink-3">This will not</p>
          <ul className="space-y-0.5">
            {plan.skipped.map((note) => (
              <li key={note} className="text-2xs leading-relaxed text-ink-3">
                · {note}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="primary"
            className="mt-2 w-full justify-center"
            loading={busy}
            icon={<Wand2 size={12} />}
            onClick={onApply}
          >
            Apply this style
          </Button>
        </>
      ) : (
        <p className="mt-2 text-2xs text-ink-3">Add your clips first and the plan appears here.</p>
      )}

      {profile.caveats.length > 0 ? (
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">{profile.caveats.join(' ')}</p>
      ) : null}
    </div>
  );
}

/**
 * The edit plan, cut by cut.
 *
 * The number worth looking at first is how many cuts were left alone: a plan
 * that treats every seam is a plan that has not understood the footage. Each
 * entry shows what was measured, what was decided and why, so a decision can be
 * argued with rather than taken on trust.
 */
function EditPlanReview({ plan, onSeek }: { plan: SmoothPlan; onSeek: (time: number) => void }) {
  const counts = new Map<CutTechnique, number>();
  for (const entry of plan.entries) {
    counts.set(entry.judgement.technique, (counts.get(entry.judgement.technique) ?? 0) + 1);
  }

  const tone = (technique: CutTechnique) =>
    technique === 'clean'
      ? 'bg-ok/15 text-ok'
      : technique === 'broll'
        ? 'bg-accent/20 text-accent'
        : 'bg-bg-3 text-ink-2';

  return (
    <div className="mt-2 rounded-md border border-line bg-bg-1 p-2">
      <p className="text-2xs font-semibold text-ink-0">
        {plan.untouched} of {plan.entries.length} joins need nothing
      </p>
      <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
        {[...counts.entries()]
          .filter(([technique]) => technique !== 'clean')
          .map(([technique, count]) => `${count} ${TECHNIQUE_LABELS[technique].toLowerCase()}`)
          .join(' · ') || 'Nothing needed anywhere — every join already reads as clean.'}
      </p>
      {plan.visualBlind ? (
        <p className="mt-1 text-2xs leading-relaxed text-warn">
          No frames could be read from this media, so the picture side of each cut was not measured. The decisions
          below come from the audio and the transcript alone.
        </p>
      ) : null}

      <ul className="mt-1.5 max-h-64 space-y-1 overflow-y-auto">
        {plan.entries.map((entry) => (
          <li key={entry.judgement.id} className="rounded border border-line/70 bg-bg-2 p-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                  tone(entry.judgement.technique),
                )}
              >
                {TECHNIQUE_LABELS[entry.judgement.technique]}
              </span>
              <button
                type="button"
                onClick={() => onSeek(Math.max(0, entry.judgement.time - 0.6))}
                className="font-mono text-2xs text-ink-3 hover:text-accent"
                title="Play across this cut"
              >
                {clock(entry.judgement.time)}
              </button>
              <span className="ml-auto text-[9px] uppercase tracking-wide text-ink-3">
                {Math.round(entry.judgement.noticeability * 100)}
                {entry.judgement.technique === 'clean'
                  ? ''
                  : ` → ${Math.round(entry.judgement.residual * 100)}`}
              </span>
            </div>
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">{entry.judgement.reason}</p>
          </li>
        ))}
      </ul>

      {plan.skipped.length > 0 ? (
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          {plan.skipped.length} {plan.skipped.length === 1 ? 'cut needs' : 'cuts need'} something this step cannot do
          on its own — see the reasons above.
        </p>
      ) : null}
      <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
        The number on the right is how obvious each join is out of 100, before and after. Lower is better. Joins
        between separate recordings are judged here too, not just the ones these cuts create.
      </p>
    </div>
  );
}
