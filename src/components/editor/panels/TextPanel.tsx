'use client';

import { Type } from 'lucide-react';
import { addTextClip } from '@/features/timeline/operations';
import { Button, PanelHeader } from '@/components/ui';
import { useEditorStore } from '@/state/editorStore';

const PRESETS = [
  { label: 'Heading', text: 'Your heading', fontSize: 96, fontWeight: 800, preview: 'text-lg font-extrabold' },
  { label: 'Subtitle', text: 'Supporting line', fontSize: 64, fontWeight: 600, preview: 'text-sm font-semibold' },
  { label: 'Body', text: 'Body copy goes here', fontSize: 44, fontWeight: 400, preview: 'text-xs' },
];

const TEMPLATES = [
  { label: 'Hook', text: 'Nobody tells you this', animation: 'pop', color: '#ffffff', background: null },
  { label: 'Callout', text: 'Step 1', animation: 'slide', color: '#08090c', background: '#f5b544' },
  { label: 'Stat', text: '87%', animation: 'scale', color: '#34d399', background: null },
  { label: 'CTA', text: 'Follow for more', animation: 'fade', color: '#ffffff', background: '#7c5cff' },
] as const;

/** Text presets and animated templates that land on the text track. */
export function TextPanel() {
  const sequence = useEditorStore((state) => state.sequence);
  const scale = (sequence?.height ?? 1920) / 1920;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Text" description="Click a style to drop it at the playhead." />

      <div className="flex-1 overflow-y-auto p-2">
        <p className="mb-1.5 text-2xs uppercase tracking-wide text-ink-3">Styles</p>
        <div className="space-y-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() =>
                addTextClip(preset.text, {
                  style: { fontSize: Math.round(preset.fontSize * scale), fontWeight: preset.fontWeight },
                })
              }
              className="flex w-full items-center justify-between rounded-md border border-line bg-bg-2 px-3 py-2.5 text-left transition-colors hover:border-accent/40"
            >
              <span className={`${preset.preview} text-ink-0`}>{preset.label}</span>
              <Type size={13} className="text-ink-3" />
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-2xs uppercase tracking-wide text-ink-3">Animated templates</p>
        <div className="grid grid-cols-2 gap-1.5">
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() =>
                addTextClip(template.text, {
                  style: {
                    fontSize: Math.round(72 * scale),
                    fontWeight: 800,
                    color: template.color,
                    backgroundColor: template.background,
                  },
                })
              }
              className="flex aspect-video flex-col items-center justify-center gap-1 rounded-md border border-line bg-bg-2 p-2 text-center transition-colors hover:border-accent/40"
            >
              <span
                className="rounded px-1.5 py-0.5 text-2xs font-bold"
                style={{ color: template.color, background: template.background ?? 'transparent' }}
              >
                {template.text}
              </span>
              <span className="text-2xs text-ink-3">{template.label}</span>
            </button>
          ))}
        </div>

        <Button className="mt-4 w-full" size="sm" onClick={() => addTextClip('New text')}>
          Add blank text
        </Button>
      </div>
    </div>
  );
}
