import type { TextStyle } from '@ave/editor-core';
import { useEditorStore } from '../../state/editorStore';
import { uid } from '../../lib/format';
import { toast } from '../../state/toastStore';

interface Preset {
  name: string;
  text: string;
  style: Partial<TextStyle>;
  previewClass: string;
}

const PRESETS: Preset[] = [
  { name: 'Heading', text: 'Heading', style: { fontSize: 96, fontWeight: 800 }, previewClass: 'text-lg font-extrabold' },
  { name: 'Subtitle', text: 'Subtitle text', style: { fontSize: 48, fontWeight: 500 }, previewClass: 'text-sm font-medium' },
  {
    name: 'Lower third',
    text: 'Name — Title',
    style: { fontSize: 40, fontWeight: 600, align: 'left', backgroundColor: '#111214cc' },
    previewClass: 'text-xs font-semibold bg-black/60 px-1.5 py-0.5 rounded self-start',
  },
  {
    name: 'Quote',
    text: '“Your quote here”',
    style: { fontSize: 56, fontWeight: 400 },
    previewClass: 'text-sm italic',
  },
  {
    name: 'CTA',
    text: 'Subscribe now',
    style: { fontSize: 64, fontWeight: 800, color: '#ffffff', backgroundColor: '#6366f1' },
    previewClass: 'text-sm font-extrabold bg-accent px-2 py-0.5 rounded',
  },
];

export default function TextPanel() {
  const apply = useEditorStore((s) => s.apply);

  function addPreset(p: Preset) {
    const { sequence, playhead } = useEditorStore.getState();
    if (!sequence) return;
    const track = sequence.tracks.find((t) => t.kind === 'text' && !t.locked);
    if (!track) {
      toast.error('No text track available');
      return;
    }
    apply(
      {
        type: 'ADD_TEXT',
        trackId: track.id,
        clipId: uid('text'),
        text: p.text,
        start: playhead,
        duration: 4,
        style: p.style,
      },
      `Add ${p.name}`,
    );
  }

  return (
    <div className="p-3 flex flex-col gap-2">
      <p className="text-xs text-ink-3 mb-1">Click a preset to add it at the playhead (4s). Edit content and style in the Inspector.</p>
      {PRESETS.map((p) => (
        <button
          key={p.name}
          onClick={() => addPreset(p)}
          className="border border-line rounded bg-bg-3 hover:border-accent hover:bg-accent/5 transition-colors p-3 flex flex-col gap-1.5 text-left"
          title={`Add ${p.name} at playhead`}
        >
          <span className="text-xs text-ink-3 uppercase tracking-wider">{p.name}</span>
          <span className={`text-ink-1 ${p.previewClass}`}>{p.text}</span>
        </button>
      ))}
    </div>
  );
}
