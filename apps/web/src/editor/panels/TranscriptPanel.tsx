import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlignLeft, Search, Scissors, Trash2, FileText } from 'lucide-react';
import { makeClip } from '@ave/editor-core';
import { useEditorStore } from '../../state/editorStore';
import { api, type TranscriptSegment } from '../../lib/api';
import { ensureTranscript } from '../../lib/transcript';
import { timecode, uid } from '../../lib/format';
import { Button, Input, Spinner, EmptyState } from '../../components/ui';
import { toast } from '../../state/toastStore';

export default function TranscriptPanel() {
  const transcript = useEditorStore((s) => s.transcript);
  const apply = useEditorStore((s) => s.apply);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  async function loadTranscript() {
    setBusy(true);
    try {
      await ensureTranscript((j) => setStep(`Transcribing… ${Math.round(j.progress)}%`));
    } catch (e: any) {
      toast.error(e.message ?? 'Transcription failed');
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  const filtered = useMemo(() => {
    if (!transcript) return [];
    if (!query.trim()) return transcript.segments;
    const q = query.toLowerCase();
    return transcript.segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [transcript, query]);

  const selectedSeg = transcript?.segments.find((s) => s.id === selected) ?? null;

  function deleteFromTimeline(seg: TranscriptSegment) {
    // MVP: assume main clip at 0 with sourceIn 0 → transcript time == timeline time.
    const ok = apply(
      { type: 'REMOVE_RANGE', start: seg.start, end: seg.end, ripple: true },
      'Delete transcript segment',
    );
    if (ok) toast.success('Segment removed from timeline');
    setSelected(null);
  }

  async function createClip(seg: TranscriptSegment) {
    try {
      const { projectId, transcriptAssetId } = useEditorStore.getState();
      if (!projectId || !transcriptAssetId) return;
      const seq = await api.createSequence(projectId, seg.text.slice(0, 32) || 'Clip', '9:16');
      const track = seq.doc.tracks.find((t) => t.kind === 'video');
      if (track) {
        const clip = makeClip({
          id: uid('clip'),
          kind: 'video',
          name: seg.text.slice(0, 24),
          assetId: transcriptAssetId,
          start: 0,
          duration: Math.max(0.5, seg.end - seg.start),
          sourceIn: seg.start,
        });
        const doc = { ...seq.doc, tracks: seq.doc.tracks.map((t) => (t.id === track.id ? { ...t, clips: [clip] } : t)) };
        await api.saveSequence(seq.id, doc, seq.version);
      }
      navigate(`/editor/${seq.id}`);
    } catch (e: any) {
      toast.error(`Create clip failed: ${e.message}`);
    }
  }

  if (!transcript) {
    return (
      <EmptyState
        icon={<FileText size={22} />}
        title="No transcript yet"
        hint="Transcribe the main video to browse, search and edit by text."
        action={
          <Button variant="primary" onClick={loadTranscript} disabled={busy}>
            {busy ? <Spinner /> : <AlignLeft size={13} />} {busy ? (step ?? 'Working…') : 'Transcribe video'}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-line shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input placeholder="Search transcript…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-6" />
        </div>
      </div>

      {selectedSeg && (
        <div className="p-2 border-b border-line flex gap-1.5 shrink-0 bg-bg-3">
          <Button size="sm" variant="danger" onClick={() => deleteFromTimeline(selectedSeg)} title="Ripple-delete this range from the timeline">
            <Trash2 size={11} /> Delete from timeline
          </Button>
          <Button size="sm" onClick={() => createClip(selectedSeg)} title="Create a new sequence from this segment">
            <Scissors size={11} /> Create clip
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-4 text-xs text-ink-3 text-center">No segments match "{query}"</div>
        )}
        {filtered.map((seg) => (
          <button
            key={seg.id}
            className={`w-full text-left px-3 py-1.5 border-b border-line/50 hover:bg-bg-3 transition-colors ${
              selected === seg.id ? 'bg-accent/10 border-l-2 border-l-accent' : ''
            }`}
            onClick={() => {
              setSelected(selected === seg.id ? null : seg.id);
              setPlayhead(seg.start);
            }}
            title="Click to seek and select"
          >
            <div className="text-[10px] text-ink-3 tabular-nums mb-0.5">{timecode(seg.start)}</div>
            <div className="text-sm text-ink-1 leading-snug">{highlight(seg.text, query)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent/40 text-ink-1 rounded-sm">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
