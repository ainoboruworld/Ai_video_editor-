'use client';

import { useMemo, useState } from 'react';
import { BarChart3, List, Newspaper, Quote, Type } from 'lucide-react';
import { addGraphicClip, addTextClip } from '@/features/timeline/operations';
import { GRAPHIC_ACCENTS, emptyGraphic, suggestGraphics } from '@/features/edit/graphics';
import { Button, PanelHeader } from '@/components/ui';
import { useEditorStore } from '@/state/editorStore';
import { clock } from '@/lib/format';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';
import type { Graphic } from '@/lib/engine';

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

const GRAPHIC_KINDS: { kind: Graphic['kind']; label: string; icon: React.ReactNode; blurb: string }[] = [
  { kind: 'stat', label: 'Stat', icon: <BarChart3 size={13} />, blurb: 'A number with a label' },
  { kind: 'list', label: 'List', icon: <List size={13} />, blurb: 'Bulleted points' },
  { kind: 'quote', label: 'Quote', icon: <Quote size={13} />, blurb: 'A line worth remembering' },
  { kind: 'citation', label: 'Citation', icon: <Newspaper size={13} />, blurb: 'Headline, source, date' },
];

/** Text presets, animated templates and infographics — all on the text track. */
export function TextPanel() {
  const sequence = useEditorStore((state) => state.sequence);
  const transcript = useEditorStore((state) => state.transcript);
  const scale = (sequence?.height ?? 1920) / 1920;
  const [accent, setAccent] = useState(GRAPHIC_ACCENTS[0]!.value);

  // Suggestions are derived from the transcript, so they update as it is edited
  // and cost nothing when there is not one.
  const suggestions = useMemo(() => suggestGraphics(transcript?.segments ?? []), [transcript]);

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

        {/* ---- infographics ---- */}
        <p className="mb-1.5 mt-5 text-2xs uppercase tracking-wide text-ink-3">Infographics</p>
        <p className="mb-2 text-2xs leading-relaxed text-ink-2">
          Drawn on the frame rather than pasted in as a picture, so they stay sharp at any export size and stay
          editable as text.
        </p>

        <div className="mb-2 flex items-center gap-1">
          <span className="mr-1 text-2xs text-ink-3">Accent</span>
          {GRAPHIC_ACCENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.name}
              onClick={() => setAccent(option.value)}
              style={{ background: option.value }}
              className={cn(
                'h-5 w-5 rounded border',
                accent === option.value ? 'border-accent ring-1 ring-accent' : 'border-line',
              )}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {GRAPHIC_KINDS.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              onClick={() => addGraphicClip({ ...emptyGraphic(entry.kind), accent })}
              className="flex flex-col items-center gap-1 rounded-md border border-line bg-bg-2 px-1.5 py-2.5 text-center transition-colors hover:border-accent/40"
            >
              <span className="text-ink-1">{entry.icon}</span>
              <span className="text-2xs font-medium text-ink-0">{entry.label}</span>
              <span className="text-2xs leading-tight text-ink-3">{entry.blurb}</span>
            </button>
          ))}
        </div>

        {suggestions.length > 0 ? (
          <>
            <p className="mb-1.5 mt-4 text-2xs uppercase tracking-wide text-ink-3">
              From your transcript ({suggestions.length})
            </p>
            <div className="space-y-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => {
                    const added = addGraphicClip(
                      { ...suggestion.graphic, accent },
                      { start: suggestion.start, duration: suggestion.duration },
                    );
                    if (added) toast.success('Graphic added', `At ${clock(suggestion.start)} — edit it in the Inspector.`);
                  }}
                  className="w-full rounded-md border border-line bg-bg-2 p-2 text-left transition-colors hover:border-accent/40"
                >
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-mono text-2xs text-ink-3">{clock(suggestion.start)}</span>
                    <span className="text-2xs font-semibold text-ink-0">
                      {suggestion.graphic.kind === 'list'
                        ? `${suggestion.graphic.items.length} points`
                        : suggestion.graphic.value}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-2xs text-ink-3">“{suggestion.source}”</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-2 text-2xs leading-relaxed text-ink-3">
            {transcript
              ? 'Nothing in this transcript names a figure or an explicit list, so there is nothing to suggest.'
              : 'Get a transcript and any numbers or lists you mention will be offered here.'}
          </p>
        )}
      </div>
    </div>
  );
}
