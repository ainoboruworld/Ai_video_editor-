import {
  FolderOpen,
  Music,
  Type,
  Captions,
  Film,
  ArrowLeftRight,
  Sparkles,
  AlignLeft,
} from 'lucide-react';
import { useEditorStore, type PanelId } from '../state/editorStore';

const ITEMS: { id: PanelId; icon: React.ReactNode; label: string }[] = [
  { id: 'media', icon: <FolderOpen size={16} />, label: 'Media' },
  { id: 'audio', icon: <Music size={16} />, label: 'Audio' },
  { id: 'text', icon: <Type size={16} />, label: 'Text' },
  { id: 'captions', icon: <Captions size={16} />, label: 'Captions' },
  { id: 'broll', icon: <Film size={16} />, label: 'B-roll' },
  { id: 'transitions', icon: <ArrowLeftRight size={16} />, label: 'Transitions' },
  { id: 'ai', icon: <Sparkles size={16} />, label: 'AI' },
  { id: 'transcript', icon: <AlignLeft size={16} />, label: 'Transcript' },
];

export default function SideToolbar() {
  const active = useEditorStore((s) => s.activePanel);
  const setActive = useEditorStore((s) => s.setActivePanel);
  return (
    <div className="h-full w-12 bg-bg-2 border-r border-line flex flex-col items-center py-1.5 gap-0.5">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          title={item.label}
          onClick={() => setActive(item.id)}
          className={`w-10 h-10 rounded flex flex-col items-center justify-center gap-0.5 transition-colors ${
            active === item.id
              ? 'bg-accent/15 text-accent-hover'
              : 'text-ink-3 hover:text-ink-1 hover:bg-bg-4'
          }`}
        >
          {item.icon}
          <span className="text-[8px] leading-none">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
