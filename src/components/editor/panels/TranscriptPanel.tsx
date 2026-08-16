'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Captions,
  Check,
  Cpu,
  Cloud,
  Loader2,
  Pencil,
  Play,
  Plus,
  Scissors,
  Split,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import {
  cuesToSegments,
  formatTimestamp,
  normaliseSegments,
  parseTimestamp,
  segmentId,
  segmentsToCues,
  transcriptDuration,
  type TranscriptSegment,
  type TranscriptSource,
} from '@/features/transcript/model';
import { parseTranscript } from '@/features/transcript/parse';
import { LOCAL_WHISPER_MODELS, isLocalWhisperSupported, type WhisperModelSize } from '@/features/captions/localWhisper';
import {
  analysePrimaryClip,
  applyCaptions,
  applyCutPlan,
  countPlanSmoothing,
  condenseCues,
  countPlanTransitions,
  primaryClip,
  transcribeTimeline,
  type AnalysisResult,
} from '@/features/ai/autoEdit';
import { proposalCuts, proposalFromAi, smartAutoCut, type RecutProposal } from '@/features/ai/recut';
import {
  DEFAULT_CUT_TRANSITION,
  MAX_TRANSITION_SECONDS,
  cutTransitionLabel,
  type CutTransitionChoice,
} from '@/features/ai/cutTransitions';
import { DEFAULT_SEAM_OPTION, SEAM_OPTIONS, seamOption } from '@/features/edit/smoothing';
import { ProviderPicker } from '@/components/editor/ProviderPicker';
import { api, ApiClientError } from '@/lib/api-client';
import { sequenceDuration } from '@/lib/engine';
import { Badge, Button, Field, Input, PanelHeader, Select, Textarea } from '@/components/ui';
import { clock } from '@/lib/format';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';
import type { AiProviderName } from '@/types';

const EXAMPLE = `00:00 - 00:04
Hey guys, welcome back.

00:04 - 00:09
Today we're going to talk about AI marketing.`;

/**
 * The transcript is the hinge of the whole auto-edit workflow: captions and the
 * recut both read from it. Three sources produce it — a local model, a hosted
 * one, or the user pasting text — and after that nothing downstream cares which.
 *
 * Manual mode exists so neither a model download nor an API quota can block
 * editing.
 */
export function TranscriptPanel() {
  const sequence = useEditorStore((state) => state.sequence);
  const transcript = useEditorStore((state) => state.transcript);
  const setTranscript = useEditorStore((state) => state.setTranscript);
  const capabilities = useEditorStore((state) => state.capabilities);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const playhead = useEditorStore((state) => state.playhead);

  const [source, setSource] = useState<TranscriptSource>('manual');
  const [whisperModel, setWhisperModel] = useState<WhisperModelSize>('base');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [proposal, setProposal] = useState<RecutProposal | null>(null);
  // One choice drives both: a seam is either smoothed or decorated, never both.
  const [seam, setSeam] = useState<string>(DEFAULT_SEAM_OPTION.id);
  const [transition, setTransition] = useState<CutTransitionChoice>(DEFAULT_CUT_TRANSITION);
  const [aiProvider, setAiProvider] = useState<AiProviderName | 'auto'>('auto');
  const [targetSeconds, setTargetSeconds] = useState<number | ''>('');
  const proposalRef = useRef<HTMLDivElement>(null);

  const duration = sequence ? sequenceDuration(sequence) : 0;
  const primary = sequence ? primaryClip(sequence) : null;
  const segments = useMemo(() => transcript?.segments ?? [], [transcript]);
  const hostedReady = capabilities?.transcription.available ?? false;
  const aiReady = capabilities?.ai.available ?? false;
  const localSupported = typeof window !== 'undefined' && isLocalWhisperSupported();

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    try {
      await task();
    } catch (error) {
      toast.error('Transcript step failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
      setStatus(null);
    }
  };

  const store = (next: TranscriptSegment[], from: TranscriptSource, estimated: boolean) => {
    setTranscript({
      segments: normaliseSegments(next, duration || undefined),
      source: from,
      estimatedTimings: estimated,
      createdAt: new Date().toISOString(),
    });
  };

  const updateSegments = (next: TranscriptSegment[]) => {
    if (!transcript) return;
    setTranscript({ ...transcript, segments: normaliseSegments(next, duration || undefined) });
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Transcript"
        description="Captions and the AI recut both read from this."
        action={transcript ? <Badge tone="accent">{segments.length} segments</Badge> : null}
      />

      <div className="flex-1 overflow-y-auto p-2.5">
        {!primary ? (
          <p className="rounded-md border border-line bg-bg-2 px-2.5 py-2 text-2xs leading-relaxed text-ink-2">
            Add your video to the timeline first — the Edit panel will do it. A transcript can
            still be pasted below, but the timings will not line up with anything until there is footage.
          </p>
        ) : null}

        {/* ---- source ---- */}
        <p className="mb-1.5 mt-3 text-2xs uppercase tracking-wide text-ink-3">Source</p>
        <div className="space-y-1">
          <SourceOption
            id="manual"
            active={source === 'manual'}
            onSelect={() => setSource('manual')}
            icon={<Pencil size={12} />}
            title="Manual"
            note="Paste a transcript. No key, no model, always works."
          />
          <SourceOption
            id="local"
            active={source === 'local'}
            onSelect={() => setSource('local')}
            icon={<Cpu size={12} />}
            title="Local Whisper"
            note={
              localSupported
                ? 'Runs in this browser. Free, private, no quota — but it tidies out filler words.'
                : 'Not supported by this browser.'
            }
            disabled={!localSupported}
          />
          <SourceOption
            id="hosted"
            active={source === 'hosted'}
            onSelect={() => setSource('hosted')}
            icon={<Cloud size={12} />}
            title="Hosted"
            note={
              hostedReady
                ? `Uses ${capabilities?.transcription.provider ?? 'your provider'}. Word-level timings, and asked for a verbatim transcript.`
                : 'Needs a free GROQ_API_KEY.'
            }
            disabled={!hostedReady}
          />
        </div>

        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          Cutting fillers needs a transcript that still contains them. Whisper is trained to produce readable prose and
          drops hesitations unless it is told not to; the hosted request asks for verbatim text, the in-browser model
          has no way to be asked. If filler detection finds nothing, that is usually why.
        </p>

        {/* ---- manual ---- */}
        {source === 'manual' ? (
          <div className="mt-3">
            <p className="mb-1.5 text-2xs leading-relaxed text-ink-2">
              Paste the exact spoken words from your video. For best results, include timestamps.
            </p>
            <Textarea
              rows={8}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder={EXAMPLE}
              className="font-mono text-2xs"
            />
            <div className="mt-2 flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                disabled={pasted.trim().length === 0}
                onClick={() => {
                  const result = parseTranscript(pasted, duration || undefined);
                  if (result.segments.length === 0) {
                    toast.warn('Nothing to import', result.note);
                    return;
                  }
                  store(result.segments, 'manual', result.estimatedTimings);
                  if (result.droppedOutsideVideo > 0) toast.warn('Transcript imported', result.note);
                  else toast.success('Transcript imported', result.note);
                }}
              >
                Import Transcript
              </Button>
              <Button size="sm" onClick={() => setPasted(EXAMPLE)}>
                Example
              </Button>
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
              Accepts <code className="font-mono">00:00 - 00:04</code> ranges, SRT/VTT, one timestamp per line, or plain
              text with no timings at all.
            </p>
          </div>
        ) : null}

        {/* ---- local ---- */}
        {source === 'local' ? (
          <div className="mt-3">
            <Field label="Model" hint={`~${LOCAL_WHISPER_MODELS[whisperModel].downloadMb} MB once`}>
              <Select
                value={whisperModel}
                onChange={(event) => setWhisperModel(event.target.value as WhisperModelSize)}
                className="w-full"
              >
                {Object.entries(LOCAL_WHISPER_MODELS).map(([key, model]) => (
                  <option key={key} value={key}>
                    {model.label} — {model.note}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              size="sm"
              variant="primary"
              className="mt-2 w-full"
              loading={busy === 'local'}
              disabled={!localSupported || !primary}
              onClick={() =>
                void run('local', async () => {
                  setLocalError(null);
                  try {
                    const cues = await transcribeTimeline(setStatus, { mode: 'local', model: whisperModel });
                    if (cues.length === 0) {
                      toast.warn('No speech found', 'Try Manual, or a different model size.');
                      return;
                    }
                    store(cuesToSegments(cues), 'local', false);
                    toast.success(`Transcribed ${cues.length} lines on this device`);
                  } catch (error) {
                    setLocalError(error instanceof Error ? error.message : 'Local transcription failed');
                    throw error;
                  }
                })
              }
            >
              Transcribe on this device
            </Button>

            {localError ? (
              <div className="mt-2 rounded-md border border-warn/25 bg-warn/5 p-2">
                <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-warn">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  {localError}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" className="flex-1" disabled={!hostedReady} onClick={() => setSource('hosted')}>
                    Try Hosted
                  </Button>
                  <Button size="sm" variant="primary" className="flex-1" onClick={() => setSource('manual')}>
                    Use Manual
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ---- hosted ---- */}
        {source === 'hosted' ? (
          <div className="mt-3">
            <Button
              size="sm"
              variant="primary"
              className="w-full"
              loading={busy === 'hosted'}
              disabled={!hostedReady || !primary}
              onClick={() =>
                void run('hosted', async () => {
                  const cues = await transcribeTimeline(setStatus, { mode: 'hosted' });
                  if (cues.length === 0) {
                    toast.warn('No speech found in this recording');
                    return;
                  }
                  store(cuesToSegments(cues), 'hosted', false);
                  toast.success(`Transcribed ${cues.length} lines`);
                })
              }
            >
              Transcribe with {capabilities?.transcription.provider ?? 'provider'}
            </Button>
            {!hostedReady ? (
              <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
                Set a free <code className="font-mono">GROQ_API_KEY</code> for hosted transcription, or paste a
                transcript in Manual mode — the rest of the workflow is identical.
              </p>
            ) : null}
          </div>
        ) : null}

        {status ? (
          <p className="mt-2 flex items-center gap-1.5 text-2xs text-ink-2">
            <Loader2 size={10} className="animate-spin" />
            {status}
          </p>
        ) : null}

        {/* ---- transcript editor ---- */}
        {transcript && segments.length > 0 ? (
          <>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <p className="text-2xs uppercase tracking-wide text-ink-3">
                Transcript · {transcript.source}
              </p>
              {transcript.estimatedTimings ? <Badge tone="warn">estimated timings</Badge> : null}
            </div>

            {transcript.estimatedTimings ? (
              <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
                No timestamps were in the paste, so these are spread across the video by sentence length. Adjust any
                that matter before cutting.
              </p>
            ) : null}

            <div className="mt-2 space-y-1">
              {segments.map((segment, index) => (
                <SegmentRow
                  key={segment.id}
                  segment={segment}
                  active={playhead >= segment.start && playhead < segment.end}
                  onSeek={() => setPlayhead(segment.start)}
                  onChange={(next) => updateSegments(segments.map((s) => (s.id === segment.id ? next : s)))}
                  onDelete={() => updateSegments(segments.filter((s) => s.id !== segment.id))}
                  onSplit={() => {
                    const middle = (segment.start + segment.end) / 2;
                    const words = segment.text.split(/\s+/);
                    const half = Math.max(1, Math.floor(words.length / 2));
                    updateSegments([
                      ...segments.filter((s) => s.id !== segment.id),
                      { ...segment, end: middle, text: words.slice(0, half).join(' ') },
                      { id: segmentId(), start: middle, end: segment.end, text: words.slice(half).join(' ') },
                    ]);
                  }}
                  onAddAfter={() => {
                    const next = segments[index + 1];
                    const start = segment.end;
                    const end = next ? Math.min(next.start, start + 2) : start + 2;
                    updateSegments([
                      ...segments,
                      { id: segmentId(), start, end: Math.max(end, start + 0.5), text: 'New segment' },
                    ]);
                  }}
                />
              ))}
            </div>

            {/* ---- what the transcript unlocks ---- */}
            <div className="mt-4 space-y-1.5 border-t border-line pt-3">
              <Button
                size="sm"
                className="w-full justify-start"
                icon={<Captions size={12} />}
                onClick={() => {
                  const cues = segmentsToCues(segments);
                  if (cues.length === 0) {
                    toast.info('Nothing to caption');
                    return;
                  }
                  if (applyCaptions(cues, 'bold')) {
                    toast.success(`${cues.length} captions added`, 'Built from this transcript — no new request.');
                  }
                }}
              >
                Generate captions
              </Button>

              <div className="grid grid-cols-2 gap-1.5">
                <Field label="Target" hint="optional">
                  <Input
                    type="number"
                    min={5}
                    placeholder="auto"
                    value={targetSeconds}
                    onChange={(event) =>
                      setTargetSeconds(event.target.value === '' ? '' : Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="Provider">
                  <ProviderPicker value={aiProvider} onChange={setAiProvider} className="w-full" />
                </Field>
              </div>

              <Button
                size="sm"
                variant="primary"
                className="w-full justify-start"
                icon={<Wand2 size={12} />}
                loading={busy === 'recut'}
                disabled={!aiReady}
                onClick={() =>
                  void run('recut', async () => {
                    setStatus('Planning the recut…');
                    const sourceDuration = primary
                      ? primary.clip.sourceIn + primary.clip.duration * primary.clip.speed
                      : transcriptDuration(segments);

                    const { plan } = await api.planEdit({
                      durationSeconds: Math.max(1, sourceDuration),
                      targetSeconds:
                        targetSeconds === '' || Number(targetSeconds) < 5 ? undefined : Number(targetSeconds),
                      provider: aiProvider === 'auto' ? undefined : aiProvider,
                      cues: condenseCues(
                        segments.map((segment) => ({
                          start: segment.start,
                          end: segment.end,
                          text: segment.text,
                        })),
                      ),
                    });

                    setProposal(
                      proposalFromAi(plan.keep, plan.remove ?? [], sourceDuration, plan.summary || plan.title || ''),
                    );
                    setTimeout(() => proposalRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
                  })
                }
              >
                AI Recut
              </Button>

              <Button
                size="sm"
                className="w-full justify-start"
                icon={<Scissors size={12} />}
                loading={busy === 'smart'}
                onClick={() =>
                  void run('smart', async () => {
                    let current = analysis;
                    if (!current && primary) {
                      setStatus('Measuring pauses…');
                      current = await analysePrimaryClip().catch(() => null);
                      setAnalysis(current);
                    }
                    const sourceDuration = primary
                      ? primary.clip.sourceIn + primary.clip.duration * primary.clip.speed
                      : transcriptDuration(segments);
                    setProposal(smartAutoCut({ segments, analysis: current, duration: sourceDuration }));
                    setTimeout(() => proposalRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
                  })
                }
              >
                Smart Auto-Cut
                <span className="ml-auto text-2xs text-ink-3">no AI</span>
              </Button>

              {!aiReady ? (
                <p className="text-2xs leading-relaxed text-ink-3">
                  AI Recut needs a provider. Smart Auto-Cut works with no key — it removes long pauses, filler-only
                  segments and short fragments, and is not an AI.
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {/* ---- proposal review ---- */}
        {proposal ? (
          <div ref={proposalRef}>
            <ProposalReview
              proposal={proposal}
              seam={seam}
              onSeamChange={setSeam}
              transition={transition}
              onTransitionChange={setTransition}
              onCancel={() => setProposal(null)}
              onApply={() => {
                if (!primary) {
                  toast.error('No video on the timeline to cut');
                  return;
                }
                const cuts = proposalCuts(proposal)
                  .map((cut) => {
                    const localStart = (cut.start - primary.clip.sourceIn) / primary.clip.speed + primary.clip.start;
                    const localEnd = (cut.end - primary.clip.sourceIn) / primary.clip.speed + primary.clip.start;
                    return { start: localStart, end: localEnd };
                  })
                  .filter((cut) => cut.end > cut.start);

                const choice = seamOption(seam);
                const plan = {
                  cuts,
                  removedSeconds: proposal.removedSeconds,
                  label: proposal.origin === 'ai' ? 'AI recut' : 'Smart auto-cut',
                  smoothing: choice.smoothing,
                  transition: choice.transition === 'none' ? undefined : { ...transition, kind: choice.transition },
                };
                // Counted before the edit, because afterwards a treated seam is
                // indistinguishable from a join that was already there.
                const smoothed = countPlanSmoothing(plan);
                const decorated = countPlanTransitions(plan);

                if (!applyCutPlan(plan)) {
                  toast.info('Nothing was cut', 'The proposal did not overlap the clip on the timeline.');
                  return;
                }
                const seamNote =
                  smoothed.dissolved > 0
                    ? `${smoothed.dissolved} ${smoothed.dissolved === 1 ? 'join' : 'joins'} dissolved through the removed footage.`
                    : smoothed.seams > 0
                      ? `${smoothed.seams} ${smoothed.seams === 1 ? 'join' : 'joins'} faded to kill the click.`
                      : decorated > 0
                        ? `${cutTransitionLabel(choice.transition)} on ${decorated} ${decorated === 1 ? 'join' : 'joins'}.`
                        : '';
                toast.success(
                  `Removed ${clock(proposal.removedSeconds)}`,
                  `${seamNote}${seamNote ? ' ' : ''}Undo restores the original.`,
                );
                setProposal(null);
                setAnalysis(null);
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SourceOption({
  active,
  onSelect,
  icon,
  title,
  note,
  disabled,
}: {
  id: string;
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  note: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:opacity-45',
        active ? 'border-accent bg-accent-ghost' : 'border-line bg-bg-2 hover:border-line-strong',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
          active ? 'border-accent bg-accent' : 'border-ink-3',
        )}
      >
        {active ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('flex items-center gap-1.5 text-xs font-medium', active ? 'text-accent' : 'text-ink-0')}>
          {icon}
          {title}
        </span>
        <span className="mt-0.5 block text-2xs leading-relaxed text-ink-3">{note}</span>
      </span>
    </button>
  );
}

function SegmentRow({
  segment,
  onChange,
  onDelete,
  onSplit,
  onAddAfter,
  onSeek,
  active,
}: {
  segment: TranscriptSegment;
  onChange: (next: TranscriptSegment) => void;
  onDelete: () => void;
  onSplit: () => void;
  onAddAfter: () => void;
  onSeek: () => void;
  active: boolean;
}) {
  const [start, setStart] = useState(formatTimestamp(segment.start));
  const [end, setEnd] = useState(formatTimestamp(segment.end));

  const commit = (value: string, which: 'start' | 'end') => {
    const parsed = parseTimestamp(value);
    if (parsed === null) {
      // Reject silently by restoring the known-good value.
      if (which === 'start') setStart(formatTimestamp(segment.start));
      else setEnd(formatTimestamp(segment.end));
      return;
    }
    onChange({ ...segment, [which]: parsed });
  };

  return (
    <div
      className={cn(
        'group rounded-md border p-1.5 hover:border-line hover:bg-bg-2',
        active ? 'border-accent/50 bg-accent-ghost' : 'border-transparent',
      )}
    >
      <div className="flex items-center gap-1">
        <input
          value={start}
          onChange={(event) => setStart(event.target.value)}
          onBlur={(event) => commit(event.target.value, 'start')}
          className="w-11 rounded bg-transparent px-1 py-0.5 text-center font-mono text-2xs text-ink-2 hover:bg-bg-3 focus:bg-bg-3"
        />
        <span className="h-px flex-1 bg-line" />
        <input
          value={end}
          onChange={(event) => setEnd(event.target.value)}
          onBlur={(event) => commit(event.target.value, 'end')}
          className="w-11 rounded bg-transparent px-1 py-0.5 text-center font-mono text-2xs text-ink-2 hover:bg-bg-3 focus:bg-bg-3"
        />
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <IconBtn title="Jump the playhead here" onClick={onSeek}>
            <Play size={10} />
          </IconBtn>
          <IconBtn title="Split segment" onClick={onSplit}>
            <Split size={10} />
          </IconBtn>
          <IconBtn title="Add segment after" onClick={onAddAfter}>
            <Plus size={10} />
          </IconBtn>
          <IconBtn title="Delete segment" onClick={onDelete} danger>
            <Trash2 size={10} />
          </IconBtn>
        </span>
      </div>
      <textarea
        value={segment.text}
        onChange={(event) => onChange({ ...segment, text: event.target.value })}
        onFocus={onSeek}
        rows={2}
        className="mt-1 w-full resize-none rounded bg-transparent px-1 text-2xs leading-relaxed text-ink-1 hover:bg-bg-3 focus:bg-bg-3 focus:outline-none"
      />
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded text-ink-3 transition-colors',
        danger ? 'hover:text-danger' : 'hover:text-ink-0',
      )}
    >
      {children}
    </button>
  );
}

/** The proposal is shown in full before anything is cut. */
function ProposalReview({
  proposal,
  seam,
  onSeamChange,
  transition,
  onTransitionChange,
  onApply,
  onCancel,
}: {
  proposal: RecutProposal;
  seam: string;
  onSeamChange: (id: string) => void;
  transition: CutTransitionChoice;
  onTransitionChange: (choice: CutTransitionChoice) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-accent/40 bg-bg-2 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-ink-0">
            {proposal.origin === 'ai' ? 'AI Recut proposal' : 'Smart Auto-Cut proposal'}
          </p>
          <p className="mt-0.5 text-2xs text-ink-3">
            Removes {clock(proposal.removedSeconds)} · result {clock(proposal.resultSeconds)}
          </p>
        </div>
        <button type="button" onClick={onCancel} className="text-ink-3 hover:text-ink-0" aria-label="Dismiss proposal">
          <X size={13} />
        </button>
      </div>

      {proposal.summary ? <p className="mt-1.5 text-2xs leading-relaxed text-ink-2">{proposal.summary}</p> : null}

      <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
        {[...proposal.keep.map((span) => ({ ...span, kind: 'keep' as const })),
          ...proposal.remove.map((span) => ({ ...span, kind: 'remove' as const }))]
          .sort((a, b) => a.start - b.start)
          .map((span, index) => (
            <div key={`${span.kind}-${index}`} className="flex items-baseline gap-2 text-2xs">
              <span
                className={cn(
                  'w-14 shrink-0 rounded px-1 py-0.5 text-center font-medium',
                  span.kind === 'keep' ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger',
                )}
              >
                {span.kind === 'keep' ? 'KEEP' : 'REMOVE'}
              </span>
              <span className="shrink-0 font-mono text-ink-2">
                {formatTimestamp(span.start)}–{formatTimestamp(span.end)}
              </span>
              <span className="truncate text-ink-3">{span.reason}</span>
            </div>
          ))}
      </div>

      {/* ---- what to put on the joins the cuts leave behind ---- */}
      <div className="mt-2.5 border-t border-line pt-2.5">
        <p className="mb-1.5 text-2xs uppercase tracking-wide text-ink-3">At each cut</p>
        <div className="grid grid-cols-2 gap-1">
          {SEAM_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onSeamChange(option.id)}
              className={cn(
                'rounded-md border px-2 py-1.5 text-left transition-colors',
                seam === option.id ? 'border-accent bg-accent-ghost' : 'border-line bg-bg-2 hover:border-line-strong',
              )}
            >
              <span className="block text-2xs font-medium text-ink-0">{option.label}</span>
              <span className="block text-2xs leading-tight text-ink-3">{option.description}</span>
            </button>
          ))}
        </div>

        {transition.kind !== 'none' ? (
          <label className="mt-2 flex items-center gap-2 text-2xs text-ink-2">
            <span className="shrink-0">Length</span>
            <input
              type="range"
              min={0.1}
              max={MAX_TRANSITION_SECONDS}
              step={0.05}
              value={transition.seconds}
              onChange={(event) => onTransitionChange({ ...transition, seconds: Number(event.target.value) })}
              className="flex-1 accent-[#7c5cff]"
            />
            <span className="w-10 shrink-0 text-right font-mono text-ink-3">{transition.seconds.toFixed(2)}s</span>
          </label>
        ) : null}

        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          {seam === 'invisible'
            ? 'The outgoing shot carries on into the footage the cut removed while the next one fades up over it, so the blend happens across material nobody wanted and the removed words are never heard. The viewer should not notice the edit.'
            : seam === 'audio'
              ? 'A few frames of fade on each side removes the click. The picture still cuts hard, so a head jump stays visible.'
              : seam === 'none'
                ? 'The cuts stay as hard joins.'
                : 'Split across each join — the outgoing side plays out, the incoming side plays in. This is a visible effect; Invisible is the one the viewer will not notice.'}
        </p>
      </div>

      <div className="mt-2.5 flex gap-1.5">
        <Button size="sm" variant="primary" className="flex-1" onClick={onApply} disabled={proposal.remove.length === 0}>
          Apply Recut
        </Button>
        <Button size="sm" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="mt-1.5 text-2xs text-ink-3">Nothing changes until you apply. Undo restores the original.</p>
    </div>
  );
}
