'use client';

import { useCallback, useRef, useState } from 'react';
import {
  AudioWaveform,
  Captions,
  Check,
  Film,
  Scissors,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import { uploadFile, ACCEPTED_MIME } from '@/features/media/upload';
import { addAssetToTimeline } from '@/features/timeline/operations';
import {
  analysePrimaryClip,
  applyCallouts,
  applyCaptions,
  applyCutPlan,
  findCutawayBroll,
  insertCutaway,
  planFillerCuts,
  planFromKeepRanges,
  planSilenceCuts,
  condenseCues,
  planTightenToTarget,
  primaryClip,
  transcribeTimeline,
  wordsFromCues,
  type AnalysisResult,
  type BrollSuggestion,
  type TranscriptionMode,
} from '@/features/ai/autoEdit';
import { LOCAL_WHISPER_MODELS, isLocalWhisperSupported, type WhisperModelSize } from '@/features/captions/localWhisper';
import { api, ApiClientError } from '@/lib/api-client';
import { sequenceDuration, type AspectRatio } from '@/lib/engine';
import { Badge, Button, EmptyState, Field, Input, PanelHeader, ProgressBar, Select, Textarea } from '@/components/ui';
import { AlertTriangle } from 'lucide-react';
import { ProviderPicker } from '@/components/editor/ProviderPicker';
import type { AiProviderName } from '@/types';
import { clock } from '@/lib/format';
import { toast } from '@/state/toastStore';
import type { CaptionCue } from '@/types';
import { cn } from '@/lib/cn';

/**
 * Auto-edit: the AI works on footage the user already has.
 *
 * The three tools stack from "always works" to "needs a key": silence cutting
 * runs entirely on decoded audio in this browser, filler-word cutting needs a
 * transcript, and restructuring to a target length needs an AI provider. Each
 * step previews what it will remove before touching the timeline.
 */
export function AutoEditPanel() {
  const sequence = useEditorStore((state) => state.sequence);
  const assets = useEditorStore((state) => state.assets);
  const projectId = useEditorStore((state) => state.projectId);
  const aspect = useEditorStore((state) => state.aspect);
  const capabilities = useEditorStore((state) => state.capabilities);
  const addAsset = useEditorStore((state) => state.addAsset);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [cues, setCues] = useState<CaptionCue[] | null>(null);
  const [keepPauses, setKeepPauses] = useState(false);
  const [mode, setMode] = useState<TranscriptionMode>('local');
  const [whisperModel, setWhisperModel] = useState<WhisperModelSize>('base');
  const localSupported = typeof window !== 'undefined' && isLocalWhisperSupported();

  const [targetSeconds, setTargetSeconds] = useState<number | ''>('');
  const [goal, setGoal] = useState('');
  const [suggestions, setSuggestions] = useState<BrollSuggestion[] | null>(null);
  const [planSummary, setPlanSummary] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProviderName | 'auto'>('auto');

  const primary = sequence ? primaryClip(sequence) : null;
  const duration = sequence ? sequenceDuration(sequence) : 0;
  const aiReady = capabilities?.ai.available ?? false;
  const transcriptionReady = capabilities?.transcription.available ?? false;

  const run = useCallback(async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    try {
      await task();
    } catch (error) {
      toast.error(
        'Auto-edit step failed',
        error instanceof ApiClientError || error instanceof Error ? error.message : undefined,
      );
    } finally {
      setBusy(null);
      setStatus(null);
    }
  }, []);

  const handleUpload = async (files: FileList) => {
    if (!projectId) return;
    const file = files[0];
    if (!file) return;
    setBusy('upload');
    setUploadProgress(0);
    try {
      const { asset, localOnly } = await uploadFile(file, projectId, setUploadProgress);
      addAsset(asset);
      addAssetToTimeline(asset, { role: 'video' });
      if (localOnly) toast.warn('This file stays in this browser', 'Configure object storage to keep it after a reload.');
      else toast.success('Video added to the timeline');
      setAnalysis(null);
      setCues(null);
    } catch (error) {
      toast.error('Upload failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
      setUploadProgress(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Auto-edit"
        description="Let AI cut the footage you already recorded."
        action={capabilities ? <Badge tone={aiReady ? 'accent' : 'warn'}>{aiReady ? capabilities.ai.active : 'local only'}</Badge> : null}
      />

      <div className="flex-1 overflow-y-auto p-2.5">
        {capabilities && !aiReady ? (
          <div className="mb-3 rounded-md border border-warn/25 bg-warn/5 p-2.5">
            <p className="flex items-start gap-1.5 text-2xs font-medium text-warn">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              No AI key on this deployment
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-2">
              Steps 2 and 3 stay locked until one is set. Add a free{' '}
              <code className="font-mono text-ink-1">GEMINI_API_KEY</code> (or{' '}
              <code className="font-mono text-ink-1">GROQ_API_KEY</code>) in your host&apos;s environment variables —
              on Vercel that is <span className="text-ink-1">Settings → Environment Variables</span>, then redeploy.
              Cutting dead air in step 1 works right now without it.
            </p>
          </div>
        ) : null}

        {!primary ? (
          <>
            <EmptyState
              icon={<Film size={20} />}
              title="Add your video first"
              description="Upload the recording you want edited. Everything below works on whatever is on the timeline."
            />
            <Button
              className="w-full"
              variant="primary"
              icon={<Upload size={13} />}
              loading={busy === 'upload'}
              onClick={() => inputRef.current?.click()}
            >
              Upload video
            </Button>
            {uploadProgress !== null ? <ProgressBar value={uploadProgress} className="mt-2" /> : null}
          </>
        ) : (
          <>
            <div className="mb-3 rounded-md border border-line bg-bg-2 p-2.5">
              <p className="flex items-center justify-between text-xs text-ink-0">
                <span className="truncate">{assets.find((a) => a.id === primary.clip.assetId)?.name ?? 'Your video'}</span>
                <span className="ml-2 shrink-0 font-mono text-2xs text-ink-3">{clock(duration)}</span>
              </p>
              <Button
                size="sm"
                className="mt-2 w-full"
                icon={<Upload size={11} />}
                loading={busy === 'upload'}
                onClick={() => inputRef.current?.click()}
              >
                Replace with another file
              </Button>
              {uploadProgress !== null ? <ProgressBar value={uploadProgress} className="mt-2" /> : null}
            </div>

            {/* Step 1 — works with no keys at all */}
            <Step number={1} title="Cut dead air" note="Works with no key">
              <Button
                size="sm"
                className="w-full justify-start"
                icon={<AudioWaveform size={12} />}
                loading={busy === 'analyse'}
                onClick={() =>
                  void run('analyse', async () => {
                    setStatus('Decoding audio…');
                    const result = await analysePrimaryClip();
                    setAnalysis(result);
                    toast.success(
                      `Found ${result.silences.length} silent stretches`,
                      `${clock(result.removableSeconds)} could be removed.`,
                    );
                  })
                }
              >
                {analysis ? 'Re-analyse audio' : 'Analyse audio'}
              </Button>

              {analysis ? (
                <>
                  <Waveform analysis={analysis} />
                  <p className="mt-1.5 text-2xs text-ink-2">
                    {analysis.silences.length} silences · {clock(analysis.removableSeconds)} removable ·{' '}
                    {clock(Math.max(0, duration - analysis.removableSeconds))} after cutting
                  </p>
                  <label className="mt-1.5 flex items-center gap-1.5 text-2xs text-ink-2">
                    <input
                      type="checkbox"
                      checked={keepPauses}
                      onChange={(event) => setKeepPauses(event.target.checked)}
                      className="accent-[#7c5cff]"
                    />
                    Keep natural pauses (only cut gaps over 1.2s)
                  </label>
                  <Button
                    size="sm"
                    variant="primary"
                    className="mt-2 w-full justify-start"
                    icon={<Scissors size={12} />}
                    onClick={() => {
                      const plan = planSilenceCuts(analysis, primary.clip, { keepPauses });
                      if (!applyCutPlan(plan)) {
                        toast.info('Nothing to cut', 'No silence long enough was found.');
                        return;
                      }
                      toast.success(`Removed ${clock(plan.removedSeconds)} of silence`);
                      setAnalysis(null);
                    }}
                  >
                    Remove silence
                  </Button>
                </>
              ) : null}
            </Step>

            {/* Step 2 — needs transcription */}
            <Step
              number={2}
              title="Transcript"
              note={mode === 'local' ? 'Free, no quota' : (capabilities?.transcription.provider ?? 'needs a key')}
            >
              {mode === 'hosted' &&
              transcriptionReady &&
              capabilities?.transcription.provider === 'gemini-audio' &&
              duration > 240 ? (
                <p className="mb-1.5 rounded border border-warn/25 bg-warn/5 px-2 py-1.5 text-2xs leading-relaxed text-warn">
                  This is a {clock(duration)} recording. Gemini bills audio by length and its free tier is small.
                  Switch to <span className="text-ink-1">On this device</span> above, or set a free{' '}
                  <code className="font-mono">GROQ_API_KEY</code>, to keep your Gemini quota for the AI recut.
                </p>
              ) : null}
              <div className="mb-2 flex items-center gap-1 rounded-md bg-bg-2 p-1">
                <button
                  type="button"
                  onClick={() => setMode('local')}
                  disabled={!localSupported}
                  className={cn(
                    'flex-1 rounded px-2 py-1 text-2xs font-medium transition-colors disabled:opacity-40',
                    mode === 'local' ? 'bg-bg-3 text-ink-0' : 'text-ink-3 hover:text-ink-1',
                  )}
                >
                  On this device
                </button>
                <button
                  type="button"
                  onClick={() => setMode('hosted')}
                  disabled={!transcriptionReady}
                  className={cn(
                    'flex-1 rounded px-2 py-1 text-2xs font-medium transition-colors disabled:opacity-40',
                    mode === 'hosted' ? 'bg-bg-3 text-ink-0' : 'text-ink-3 hover:text-ink-1',
                  )}
                >
                  Hosted {transcriptionReady ? '' : '(no key)'}
                </button>
              </div>

              {mode === 'local' ? (
                <Field label="Model" hint={`~${LOCAL_WHISPER_MODELS[whisperModel].downloadMb} MB once`} className="mb-2">
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
              ) : null}

              <Button
                size="sm"
                className="w-full justify-start"
                icon={<Captions size={12} />}
                loading={busy === 'transcribe'}
                disabled={mode === 'local' ? !localSupported : !transcriptionReady}
                onClick={() =>
                  void run('transcribe', async () => {
                    const result = await transcribeTimeline(setStatus, { mode, model: whisperModel });
                    setCues(result);
                    if (result.length === 0) {
                      toast.warn(
                        'No speech found in this recording',
                        'Captions and AI editing need spoken audio. Silence cutting still works.',
                      );
                      return;
                    }
                    toast.success(`Transcribed ${result.length} lines`);
                  })
                }
              >
                {cues ? (cues.length > 0 ? `Re-transcribe (${cues.length} lines)` : 'No speech found — try again') : 'Transcribe speech'}
              </Button>

              {cues && cues.length > 0 ? (
                <div className="mt-1.5 space-y-1.5">
                  <Button
                    size="sm"
                    className="w-full justify-start"
                    icon={<Captions size={12} />}
                    onClick={() => {
                      if (applyCaptions(cues)) toast.success('Captions added to the timeline');
                    }}
                  >
                    Add captions
                  </Button>
                  <Button
                    size="sm"
                    className="w-full justify-start"
                    icon={<Scissors size={12} />}
                    onClick={() => {
                      const plan = planFillerCuts(wordsFromCues(cues), primary.clip);
                      if (!applyCutPlan(plan)) {
                        toast.info('No filler words found');
                        return;
                      }
                      toast.success(`Removed ${plan.cuts.length} filler words`);
                    }}
                  >
                    Remove filler words
                  </Button>
                </div>
              ) : null}
              <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
                {mode === 'local'
                  ? 'Whisper runs in this browser: no API key, no quota, and your audio never leaves the device. The model downloads once and is cached.'
                  : transcriptionReady
                    ? 'Sends the audio to your configured provider. Faster, and Whisper backends return word-level timings for karaoke captions.'
                    : 'No hosted transcription key configured — use “On this device”, or set a free GROQ_API_KEY.'}
              </p>
            </Step>

            {/* Step 3 — needs an AI provider */}
            <Step number={3} title="AI edit" note={aiReady ? 'Uses the transcript' : 'Needs an AI key'}>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Target length" hint="optional">
                  <Input
                    type="number"
                    min={5}
                    placeholder="auto"
                    value={targetSeconds}
                    onChange={(event) => setTargetSeconds(event.target.value === '' ? '' : Number(event.target.value))}
                  />
                </Field>
                <Field label="Style">
                  <Select value={goal} onChange={(event) => setGoal(event.target.value)} className="w-full">
                    <option value="">Tighten it up</option>
                    <option value="Cut a punchy highlight reel of the best moments.">Highlights</option>
                    <option value="Keep only the single strongest moment as a short clip.">Best moment</option>
                    <option value="Keep the full explanation but remove rambling and repetition.">Full, tightened</option>
                  </Select>
                </Field>
              </div>
              <Textarea
                rows={2}
                className="mt-2 text-xs"
                placeholder="Anything specific? e.g. 'cut the intro, keep the demo'"
                value={goal.startsWith('Cut a') || goal.startsWith('Keep') ? '' : goal}
                onChange={(event) => setGoal(event.target.value)}
              />

              <ProviderPicker value={aiProvider} onChange={setAiProvider} className="mt-2 w-full" />

              {analysis && targetSeconds !== '' ? (
                <Button
                  size="sm"
                  className="mt-2 w-full justify-start"
                  icon={<Scissors size={12} />}
                  onClick={() => {
                    const plan = planTightenToTarget(analysis, primary.clip, duration, Number(targetSeconds));
                    if (!applyCutPlan(plan)) {
                      toast.info('Already at or under the target length');
                      return;
                    }
                    toast.success(`Tightened by ${clock(plan.removedSeconds)}`, 'Longest pauses cut first.');
                    setAnalysis(null);
                  }}
                >
                  Tighten to {targetSeconds}s without AI
                </Button>
              ) : null}

              <Button
                size="sm"
                variant="primary"
                className="mt-2 w-full justify-start"
                icon={<Wand2 size={12} />}
                loading={busy === 'plan'}
                disabled={!aiReady || !cues || cues.length === 0}
                onClick={() =>
                  void run('plan', async () => {
                    if (!cues || cues.length === 0) throw new Error('Transcribe the video first — the AI edits from what is said.');
                    setStatus('Planning the edit…');
                    const sourceDuration = primary.clip.sourceIn + primary.clip.duration * primary.clip.speed;
                    const condensed = condenseCues(cues);
                    if (condensed.length === 0) throw new Error('The transcript is empty — nothing to edit from.');

                    const { plan } = await api.planEdit({
                      // Guard the numeric fields the same way the API validates
                      // them, so a stray value can never turn into a bare
                      // "invalid request".
                      durationSeconds: Math.max(1, sourceDuration),
                      targetSeconds:
                        targetSeconds === '' || Number(targetSeconds) < 5 ? undefined : Number(targetSeconds),
                      goal: goal.trim() ? goal.trim().slice(0, 400) : undefined,
                      provider: aiProvider === 'auto' ? undefined : aiProvider,
                      cues: condensed,
                    });

                    setPlanSummary(plan.summary || plan.title || null);

                    const cutPlan = planFromKeepRanges(plan.keep, primary.clip, sourceDuration);
                    if (cutPlan.cuts.length > 0 && applyCutPlan(cutPlan)) {
                      toast.success(`Cut down by ${clock(cutPlan.removedSeconds)}`, plan.title || undefined);
                    } else {
                      toast.info('The AI kept the whole recording', 'Nothing was cut.');
                    }

                    if (plan.callouts.length > 0) applyCallouts(plan.callouts);

                    if (plan.brollCues.length > 0) {
                      setStatus('Finding cutaway B-roll…');
                      setSuggestions(await findCutawayBroll(plan.brollCues, aspect as AspectRatio));
                    }
                  })
                }
              >
                Edit my video
              </Button>

              <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
                {!aiReady
                  ? 'Blocked: no AI key on this deployment. Use “Tighten without AI” above, or add a key and redeploy.'
                  : !cues || cues.length === 0
                    ? 'Blocked: run step 2 first — the AI decides what to cut from what is said.'
                    : 'Ready. The AI will keep the strongest segments and propose cutaways.'}
              </p>
              {planSummary ? <p className="mt-2 text-2xs leading-relaxed text-ink-2">{planSummary}</p> : null}
            </Step>

            {suggestions && suggestions.length > 0 ? (
              <Step number={4} title="Suggested cutaways" note="You approve each one">
                <div className="space-y-2">
                  {suggestions.map((suggestion, index) => (
                    <CutawayRow
                      key={`${suggestion.cue.start}-${index}`}
                      suggestion={suggestion}
                      onInsert={async (item) => {
                        if (!projectId) return;
                        await insertCutaway(projectId, item, suggestion.cue.start, suggestion.cue.duration);
                        toast.success('Cutaway added');
                        setSuggestions((current) => current?.filter((_, i) => i !== index) ?? null);
                      }}
                      onDismiss={() => setSuggestions((current) => current?.filter((_, i) => i !== index) ?? null)}
                    />
                  ))}
                </div>
              </Step>
            ) : null}
          </>
        )}

        {status ? <p className="mt-2 text-2xs text-ink-2">{status}</p> : null}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MIME.join(',')}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void handleUpload(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  note,
  children,
}: {
  number: number;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-3 border-b border-line pb-3 last:border-0">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-2">
        <span className="flex h-4 w-4 items-center justify-center rounded bg-bg-3 text-[9px] text-ink-1">{number}</span>
        {title}
        {note ? <span className="ml-auto font-normal normal-case tracking-normal text-ink-3">{note}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** Loudness bars with the detected silences dimmed — the cut preview. */
function Waveform({ analysis }: { analysis: AnalysisResult }) {
  const bars = 96;
  const step = Math.max(1, Math.floor(analysis.envelope.values.length / bars));
  const peaks: { value: number; silent: boolean }[] = [];

  for (let i = 0; i < bars; i++) {
    let max = 0;
    for (let j = 0; j < step; j++) {
      max = Math.max(max, analysis.envelope.values[i * step + j] ?? 0);
    }
    const time = i * step * analysis.envelope.windowSeconds;
    const silent = analysis.silences.some((range) => time >= range.start && time < range.end);
    peaks.push({ value: analysis.envelope.peak > 0 ? max / analysis.envelope.peak : 0, silent });
  }

  return (
    <div className="mt-2 flex h-10 items-center gap-px rounded bg-bg-2 px-1">
      {peaks.map((peak, index) => (
        <span
          key={index}
          className={cn('flex-1 rounded-sm', peak.silent ? 'bg-danger/40' : 'bg-accent/70')}
          style={{ height: `${Math.max(6, peak.value * 100)}%` }}
        />
      ))}
    </div>
  );
}

function CutawayRow({
  suggestion,
  onInsert,
  onDismiss,
}: {
  suggestion: BrollSuggestion;
  onInsert: (item: BrollSuggestion['items'][number]) => Promise<void>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-md border border-line bg-bg-2 p-2">
      <p className="flex items-start justify-between gap-2 text-2xs text-ink-1">
        <span>
          <span className="font-mono text-ink-3">{clock(suggestion.cue.start)}</span> · {suggestion.cue.query}
        </span>
        <button type="button" onClick={onDismiss} className="shrink-0 text-ink-3 hover:text-danger" aria-label="Dismiss">
          <X size={11} />
        </button>
      </p>
      {suggestion.items.length === 0 ? (
        <p className="mt-1 text-2xs text-ink-3">No footage matched this moment.</p>
      ) : (
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {suggestion.items.slice(0, 4).map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onInsert(item);
                } finally {
                  setBusy(false);
                }
              }}
              className="group relative aspect-video overflow-hidden rounded border border-line disabled:opacity-50"
              title={`${item.provider} · ${item.title}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              <span className="absolute inset-0 hidden items-center justify-center bg-accent/70 group-hover:flex">
                <Check size={13} className="text-white" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
