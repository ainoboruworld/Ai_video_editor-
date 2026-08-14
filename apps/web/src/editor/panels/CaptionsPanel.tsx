import { useState } from 'react';
import { Captions, Sparkles } from 'lucide-react';
import type { CaptionStyleName, EditorCommand } from '@ave/editor-core';
import { useEditorStore } from '../../state/editorStore';
import { ensureTranscript } from '../../lib/transcript';
import { uid } from '../../lib/format';
import { Button, Spinner, Section } from '../../components/ui';
import { toast } from '../../state/toastStore';

const STYLES: { id: CaptionStyleName; label: string; previewClass: string }[] = [
  { id: 'minimal', label: 'Minimal', previewClass: 'text-xs text-white' },
  { id: 'bold', label: 'Bold', previewClass: 'text-xs font-extrabold text-white uppercase' },
  { id: 'creator', label: 'Creator', previewClass: 'text-xs font-bold text-white bg-black/70 px-1 rounded' },
  { id: 'karaoke', label: 'Karaoke', previewClass: 'text-xs font-bold text-accent-hover' },
  { id: 'dynamic', label: 'Dynamic', previewClass: 'text-xs font-extrabold text-[#f5c76e]' },
];

export default function CaptionsPanel() {
  const apply = useEditorStore((s) => s.apply);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [style, setStyle] = useState<CaptionStyleName>('bold');

  async function generate() {
    setBusy(true);
    setStep('Checking transcript…');
    try {
      const result = await ensureTranscript((job) => setStep(`Transcribing… ${Math.round(job.progress)}%`));
      if (!result) return;
      const { transcript } = result;
      const { sequence } = useEditorStore.getState();
      if (!sequence) return;
      const track = sequence.tracks.find((t) => t.kind === 'caption' && !t.locked);
      if (!track) {
        toast.error('No caption track available');
        return;
      }
      // Assume main clip at 0 with sourceIn 0 (MVP): transcript times map directly to timeline.
      const commands: EditorCommand[] = transcript.segments.map((seg) => ({
        type: 'ADD_CAPTION',
        trackId: track.id,
        clipId: uid('cap'),
        text: seg.text.trim(),
        start: seg.start,
        duration: Math.max(0.3, seg.end - seg.start),
        style,
        words: seg.words?.map((w) => ({
          text: w.text,
          start: Math.max(0, w.start - seg.start),
          end: Math.max(0, w.end - seg.start),
        })),
      }));
      if (commands.length === 0) {
        toast.info('Transcript has no segments');
        return;
      }
      apply(commands, `Generate ${commands.length} captions`);
      toast.success(`Added ${commands.length} caption clips`);
    } catch (e: any) {
      toast.error(e.message ?? 'Caption generation failed');
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  function applyStyle(s: CaptionStyleName) {
    setStyle(s);
    const { sequence, selection } = useEditorStore.getState();
    if (!sequence) return;
    const captionTrack = sequence.tracks.filter((t) => t.kind === 'caption');
    const allCaptions = captionTrack.flatMap((t) => t.clips);
    const selectedCaptions = allCaptions.filter((c) => selection.includes(c.id));
    const targets = selectedCaptions.length > 0 ? selectedCaptions : allCaptions;
    if (targets.length === 0) return;
    apply(
      targets.map((c) => ({ type: 'SET_CAPTION_STYLE', clipId: c.id, style: s }) as EditorCommand),
      `Caption style: ${s}`,
    );
    toast.success(`Applied "${s}" to ${targets.length} caption${targets.length > 1 ? 's' : ''}`);
  }

  return (
    <div>
      <Section title="Generate">
        <p className="text-xs text-ink-3 mb-2">
          Transcribes the main video (if needed) and adds a caption clip per segment with word-level timing.
        </p>
        <Button variant="primary" onClick={generate} disabled={busy} className="w-full">
          {busy ? <Spinner /> : <Sparkles size={13} />}
          {busy ? (step ?? 'Working…') : 'Generate captions'}
        </Button>
      </Section>

      <Section title="Style">
        <p className="text-xs text-ink-3 mb-2">Applies to selected captions, or all captions if none selected.</p>
        <div className="grid grid-cols-2 gap-1.5">
          {STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => applyStyle(s.id)}
              className={`border rounded p-2 flex flex-col items-center gap-1 transition-colors bg-bg-0 ${
                style === s.id ? 'border-accent' : 'border-line hover:border-[#3a3b40]'
              }`}
              title={`Apply ${s.label} style`}
            >
              <span className={s.previewClass}>Caption</span>
              <span className="text-[10px] text-ink-3">{s.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <div className="p-3 text-xs text-ink-3 flex items-start gap-1.5">
        <Captions size={13} className="mt-0.5 shrink-0" />
        Select a caption clip in the timeline to edit its text and timing in the Inspector.
      </div>
    </div>
  );
}
