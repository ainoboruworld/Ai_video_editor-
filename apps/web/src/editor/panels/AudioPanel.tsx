import { Music, Plus } from 'lucide-react';
import { useEditorStore } from '../../state/editorStore';
import { addAssetCommand } from '../../lib/timelineOps';
import { durationLabel } from '../../lib/format';
import { EmptyState, Spinner } from '../../components/ui';
import { toast } from '../../state/toastStore';

export default function AudioPanel() {
  const assets = useEditorStore((s) => s.assets);
  const apply = useEditorStore((s) => s.apply);
  const audio = assets.filter((a) => a.kind === 'audio');

  if (audio.length === 0) {
    return (
      <EmptyState
        icon={<Music size={22} />}
        title="No audio assets"
        hint="Upload music or voiceover in the Media panel — audio files appear here."
      />
    );
  }

  return (
    <div className="flex flex-col p-2 gap-1">
      {audio.map((a) => (
        <div
          key={a.id}
          className="group flex items-center gap-2 px-2 py-1.5 rounded border border-line bg-bg-3 hover:border-[#3a3b40] cursor-grab"
          draggable={a.status === 'ready'}
          onDragStart={(e) => e.dataTransfer.setData('application/x-ave-asset', a.id)}
          onDoubleClick={() => {
            const { sequence, playhead } = useEditorStore.getState();
            if (!sequence) return;
            const cmd = addAssetCommand(sequence, a, playhead);
            if (cmd) apply(cmd, `Add ${a.name}`);
            else toast.error('No audio track available');
          }}
          title="Double-click to add at playhead"
        >
          <Music size={14} className="text-[#6ee7a0] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{a.name}</div>
            <div className="text-xs text-ink-3">{durationLabel(a.duration)}</div>
          </div>
          {a.status === 'processing' && <Spinner />}
          <Plus size={13} className="text-ink-3 opacity-0 group-hover:opacity-100" />
        </div>
      ))}
    </div>
  );
}
