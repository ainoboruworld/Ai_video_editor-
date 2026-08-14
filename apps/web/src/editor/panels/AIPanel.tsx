import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Send,
  Scissors,
  MicOff,
  MessageSquareX,
  Check,
  Circle,
  CircleDot,
  ExternalLink,
  Plus,
} from 'lucide-react';
import { makeClip, type EditorCommand } from '@ave/editor-core';
import { useEditorStore, primaryAssetId } from '../../state/editorStore';
import { api, pollJob, type Job, type Suggestion, type SilenceSection, type FillerWord } from '../../lib/api';
import { timecode, uid, durationLabel } from '../../lib/format';
import { Button, Input, Spinner, Tabs, Badge, Select, EmptyState } from '../../components/ui';
import { toast } from '../../state/toastStore';
import { ensureTranscript } from '../../lib/transcript';

export default function AIPanel() {
  const [tab, setTab] = useState('assistant');
  return (
    <div className="flex flex-col h-full">
      <Tabs
        tabs={[
          { id: 'assistant', label: 'Assistant' },
          { id: 'clips', label: 'Clips' },
          { id: 'cleanup', label: 'Cleanup' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'assistant' && <Assistant />}
      {tab === 'clips' && <ClipsGenerator />}
      {tab === 'cleanup' && <Cleanup />}
    </div>
  );
}

// ---------- (a) AI Assistant ----------

function Assistant() {
  const apply = useEditorStore((s) => s.apply);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ summary: string; commands: EditorCommand[] } | null>(null);

  async function ask() {
    const { sequenceId } = useEditorStore.getState();
    const p = prompt.trim();
    if (!p || !sequenceId) return;
    setBusy(true);
    try {
      const assetId = primaryAssetId(useEditorStore.getState()) ?? undefined;
      const res = await api.aiAssist(sequenceId, p, assetId);
      setPreview(res);
    } catch (e: any) {
      toast.error(`AI request failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-3 flex flex-col gap-3">
      <p className="text-xs text-ink-3">
        Describe an edit — e.g. "add a title that says Welcome", "speed up the first clip 2x", "remove everything after 30 seconds".
      </p>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask the assistant…" disabled={busy} />
        <Button variant="primary" type="submit" disabled={busy || !prompt.trim()} title="Send">
          {busy ? <Spinner /> : <Send size={13} />}
        </Button>
      </form>

      {preview && (
        <div className="border border-accent/40 rounded bg-accent/5 p-3 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles size={13} className="text-accent-hover" /> Proposed edit
          </div>
          <p className="text-sm text-ink-2">{preview.summary}</p>
          <div className="text-xs text-ink-3 max-h-32 overflow-y-auto flex flex-col gap-0.5">
            {preview.commands.map((c, i) => (
              <div key={i} className="font-mono">
                {c.type}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const ok = apply(preview.commands, `AI: ${preview.summary.slice(0, 40)}`);
                if (ok) toast.success('AI edit applied — undo with Ctrl+Z');
                setPreview(null);
                setPrompt('');
              }}
            >
              Apply
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- (b) AI Clips generator ----------

const DURATION_PRESETS = [
  { label: '15–30s', min: 15, max: 30 },
  { label: '30–60s', min: 30, max: 60 },
  { label: '60–90s', min: 60, max: 90 },
];

function ClipsGenerator() {
  const navigate = useNavigate();
  const apply = useEditorStore((s) => s.apply);
  const [count, setCount] = useState(5);
  const [durIdx, setDurIdx] = useState(1);
  const [platform, setPlatform] = useState('tiktok');
  const [style, setStyle] = useState('viral');
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Suggestion[] | null>(null);

  async function generate() {
    setBusy(true);
    setResults(null);
    setJob(null);
    try {
      const state = useEditorStore.getState();
      const assetId = primaryAssetId(state);
      if (!assetId) throw new Error('No video asset in this project yet');
      const preset = DURATION_PRESETS[durIdx]!;
      const { jobId } = await api.generateClips(assetId, {
        count,
        minDuration: preset.min,
        maxDuration: preset.max,
        platform,
        style,
      });
      const final = await pollJob(jobId, setJob, 1500);
      if (final.status === 'error') throw new Error(final.error ?? 'Clip generation failed');
      const list = await api.getSuggestions(assetId, 'clip');
      setResults(list ?? []);
    } catch (e: any) {
      toast.error(e.message ?? 'Clip generation failed');
    } finally {
      setBusy(false);
    }
  }

  async function openInEditor(s: Suggestion) {
    try {
      const { projectId, assets } = useEditorStore.getState();
      if (!projectId) return;
      const asset = assets.find((a) => a.id === s.assetId);
      const seq = await api.createSequence(projectId, s.title || 'AI Clip', '9:16');
      const track = seq.doc.tracks.find((t) => t.kind === 'video');
      if (track) {
        const clip = makeClip({
          id: uid('clip'),
          kind: 'video',
          name: s.title || asset?.name || 'Clip',
          assetId: s.assetId,
          start: 0,
          duration: Math.max(0.5, s.end - s.start),
          sourceIn: s.start,
        });
        const doc = {
          ...seq.doc,
          tracks: seq.doc.tracks.map((t) => (t.id === track.id ? { ...t, clips: [clip] } : t)),
        };
        await api.saveSequence(seq.id, doc, seq.version);
      }
      navigate(`/editor/${seq.id}`);
    } catch (e: any) {
      toast.error(`Failed to open clip: ${e.message}`);
    }
  }

  function addToTimeline(s: Suggestion) {
    const { sequence, playhead } = useEditorStore.getState();
    if (!sequence) return;
    const track = sequence.tracks.find((t) => t.kind === 'video' && !t.locked);
    if (!track) return;
    const clip = makeClip({
      id: uid('clip'),
      kind: 'video',
      name: s.title || 'AI Clip',
      assetId: s.assetId,
      start: playhead,
      duration: Math.max(0.5, s.end - s.start),
      sourceIn: s.start,
    });
    apply({ type: 'ADD_CLIP', trackId: track.id, clip }, `Add clip: ${s.title}`);
    toast.success('Clip added at playhead');
  }

  const STEPS = ['Transcribe', 'Analyze scenes', 'Score moments', 'Generate clips'];

  return (
    <div className="p-3 flex flex-col gap-3 overflow-y-auto">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">Clips</span>
          <Select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[3, 5, 10, 20].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">Duration</span>
          <Select value={durIdx} onChange={(e) => setDurIdx(Number(e.target.value))}>
            {DURATION_PRESETS.map((d, i) => (
              <option key={d.label} value={i}>
                {d.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">Platform</span>
          <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="tiktok">TikTok</option>
            <option value="youtube-shorts">YouTube Shorts</option>
            <option value="reels">Instagram Reels</option>
            <option value="linkedin">LinkedIn</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">Style</span>
          <Select value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="viral">Viral</option>
            <option value="educational">Educational</option>
            <option value="funny">Funny</option>
            <option value="highlights">Highlights</option>
          </Select>
        </label>
      </div>
      <Button variant="primary" onClick={generate} disabled={busy} className="w-full">
        {busy ? <Spinner /> : <Sparkles size={13} />}
        {busy ? 'Generating…' : 'Generate clips'}
      </Button>

      {busy && job && (
        <div className="border border-line rounded bg-bg-3 p-2.5 flex flex-col gap-1">
          {STEPS.map((label, i) => {
            const frac = job.progress / 100;
            const stepFrac = (i + 1) / STEPS.length;
            const done = frac >= stepFrac;
            const current = !done && frac >= i / STEPS.length;
            return (
              <div key={label} className={`flex items-center gap-2 text-xs ${done ? 'text-[#6ee7a0]' : current ? 'text-ink-1' : 'text-ink-3'}`}>
                {done ? <Check size={12} /> : current ? <CircleDot size={12} className="text-accent-hover" /> : <Circle size={12} />}
                {label}
                {current && job.step && <span className="text-ink-3">— {job.step}</span>}
              </div>
            );
          })}
        </div>
      )}

      {results !== null && results.length === 0 && (
        <EmptyState icon={<Scissors size={20} />} title="No clips found" hint="Try a longer video with clear speech." />
      )}

      <div className="flex flex-col gap-2">
        {results?.map((s) => (
          <div key={s.id} className="border border-line rounded bg-bg-3 p-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium flex-1 truncate">{s.title || 'Untitled clip'}</span>
              {s.score != null && <Badge color="indigo">{Math.round(s.score)}</Badge>}
            </div>
            <div className="text-xs text-ink-3 tabular-nums">
              {timecode(s.start)} – {timecode(s.end)} · {durationLabel(s.end - s.start)}
            </div>
            {s.payload?.hook && <div className="text-xs text-[#f5c76e] italic">"{s.payload.hook}"</div>}
            {s.description && <p className="text-xs text-ink-3">{s.description}</p>}
            <div className="flex gap-1.5 mt-0.5">
              <Button size="sm" onClick={() => openInEditor(s)} title="Create a new vertical sequence with this clip">
                <ExternalLink size={11} /> Open in editor
              </Button>
              <Button size="sm" variant="ghost" onClick={() => addToTimeline(s)} title="Add trimmed clip at playhead">
                <Plus size={11} /> Add to timeline
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- (c)(d) Silence + fillers ----------

function Cleanup() {
  const apply = useEditorStore((s) => s.apply);
  const [silences, setSilences] = useState<SilenceSection[] | null>(null);
  const [fillers, setFillers] = useState<FillerWord[] | null>(null);
  const [busySilence, setBusySilence] = useState(false);
  const [busyFillers, setBusyFillers] = useState(false);
  const [fillerStep, setFillerStep] = useState<string | null>(null);

  async function detectSilence() {
    setBusySilence(true);
    try {
      const assetId = primaryAssetId(useEditorStore.getState());
      if (!assetId) throw new Error('No video asset in this project yet');
      const res = await api.detectSilence(assetId);
      setSilences(res.sections);
    } catch (e: any) {
      toast.error(e.message ?? 'Silence detection failed');
    } finally {
      setBusySilence(false);
    }
  }

  async function detectFillers() {
    setBusyFillers(true);
    try {
      await ensureTranscript((j) => setFillerStep(`Transcribing… ${Math.round(j.progress)}%`));
      const assetId = primaryAssetId(useEditorStore.getState());
      if (!assetId) throw new Error('No video asset');
      const res = await api.getFillers(assetId);
      setFillers(res.words);
    } catch (e: any) {
      toast.error(e.message ?? 'Filler detection failed');
    } finally {
      setBusyFillers(false);
      setFillerStep(null);
    }
  }

  function removeRanges(ranges: { start: number; end: number }[], label: string) {
    if (ranges.length === 0) return;
    // Apply back-to-front so earlier removals don't shift later ranges.
    const sorted = [...ranges].sort((a, b) => b.start - a.start);
    const commands: EditorCommand[] = sorted.map((r) => ({
      type: 'REMOVE_RANGE',
      start: r.start,
      end: r.end,
      ripple: true,
    }));
    const ok = apply(commands, label);
    if (ok) toast.success(`${label}: removed ${ranges.length} section${ranges.length > 1 ? 's' : ''}`);
  }

  return (
    <div className="p-3 flex flex-col gap-4 overflow-y-auto">
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <MicOff size={13} className="text-accent-hover" /> Silence removal
        </div>
        <Button onClick={detectSilence} disabled={busySilence} size="sm">
          {busySilence ? <Spinner /> : null} Detect silences
        </Button>
        {silences !== null && silences.length === 0 && <p className="text-xs text-ink-3">No silences detected.</p>}
        {silences && silences.length > 0 && (
          <>
            <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
              {silences.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 border border-line rounded bg-bg-3 tabular-nums">
                  <span className="flex-1">
                    {timecode(s.start)} – {timecode(s.end)}
                  </span>
                  <span className="text-ink-3">{s.duration.toFixed(1)}s</span>
                </div>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={() => removeRanges(silences, 'Remove silences')}>
              <Scissors size={12} /> Remove all ({silences.length})
            </Button>
          </>
        )}
      </section>

      <div className="border-t border-line" />

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <MessageSquareX size={13} className="text-accent-hover" /> Filler words
        </div>
        <Button onClick={detectFillers} disabled={busyFillers} size="sm">
          {busyFillers ? <Spinner /> : null} {fillerStep ?? 'Detect fillers'}
        </Button>
        {fillers !== null && fillers.length === 0 && <p className="text-xs text-ink-3">No filler words found.</p>}
        {fillers && fillers.length > 0 && (
          <>
            <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
              {fillers.map((w, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 border border-line rounded bg-bg-3">
                  <span className="font-medium text-[#f5c76e]">"{w.text}"</span>
                  <span className="flex-1 text-right text-ink-3 tabular-nums">{timecode(w.start)}</span>
                </div>
              ))}
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                removeRanges(
                  fillers.map((w) => ({ start: w.start, end: w.end })),
                  'Remove filler words',
                )
              }
            >
              <Scissors size={12} /> Remove all ({fillers.length})
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
