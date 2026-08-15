'use client';

import {
  Captions,
  Film,
  Music,
  Search,
  Sparkles,
  SlidersHorizontal,
  Type,
  ArrowRightLeft,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export type RailId = 'media' | 'broll' | 'text' | 'captions' | 'audio' | 'ai' | 'effects' | 'transitions';

const ITEMS: { id: RailId; label: string; icon: React.ReactNode }[] = [
  { id: 'media', label: 'Media', icon: <Film size={16} /> },
  { id: 'broll', label: 'B-roll', icon: <Search size={16} /> },
  { id: 'ai', label: 'AI', icon: <Sparkles size={16} /> },
  { id: 'text', label: 'Text', icon: <Type size={16} /> },
  { id: 'captions', label: 'Captions', icon: <Captions size={16} /> },
  { id: 'audio', label: 'Audio', icon: <Music size={16} /> },
  { id: 'effects', label: 'Effects', icon: <SlidersHorizontal size={16} /> },
  { id: 'transitions', label: 'Transitions', icon: <ArrowRightLeft size={16} /> },
];

export function SideRail({ active, onSelect }: { active: RailId; onSelect: (id: RailId) => void }) {
  return (
    <nav className="flex w-[62px] shrink-0 flex-col items-center gap-0.5 border-r border-line bg-bg-1 py-2">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={cn(
            'flex w-[54px] flex-col items-center gap-1 rounded-lg px-1 py-2 transition-colors',
            active === item.id ? 'bg-accent-ghost text-accent' : 'text-ink-2 hover:bg-bg-3 hover:text-ink-0',
          )}
        >
          {item.icon}
          <span className="text-[9px] font-medium leading-none">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
