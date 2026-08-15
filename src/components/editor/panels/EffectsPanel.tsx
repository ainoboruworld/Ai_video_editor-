'use client';

import { Contrast, Droplets, Sparkles, Sun, Wand2 } from 'lucide-react';
import type { Filters } from '@/lib/engine';
import { useEditorStore, useSelectedClip } from '@/state/editorStore';
import { EmptyState, PanelHeader, Slider, Toggle } from '@/components/ui';

const LOOKS: { name: string; description: string; filters: Partial<Filters> }[] = [
  { name: 'None', description: 'Reset to the original look', filters: { brightness: 0, contrast: 1, saturation: 1, temperature: 0, blur: 0, grayscale: false, vignette: false } },
  { name: 'Punch', description: 'Contrast and colour lift', filters: { contrast: 1.18, saturation: 1.22, brightness: 0.04 } },
  { name: 'Warm', description: 'Golden-hour tint', filters: { temperature: 0.35, saturation: 1.1, brightness: 0.05 } },
  { name: 'Cool', description: 'Clean, blue-leaning', filters: { temperature: -0.3, contrast: 1.06 } },
  { name: 'Film', description: 'Soft contrast with vignette', filters: { contrast: 0.92, saturation: 0.9, vignette: true } },
  { name: 'Mono', description: 'Black and white', filters: { grayscale: true, contrast: 1.1 } },
];

/** Quick looks plus the raw adjustments, applied to the selected clip. */
export function EffectsPanel() {
  const selected = useSelectedClip();
  const apply = useEditorStore((state) => state.apply);

  if (!selected || (selected.clip.kind !== 'video' && selected.clip.kind !== 'image')) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="Effects" />
        <EmptyState
          icon={<Sparkles size={20} />}
          title="Select a video or image clip"
          description="Effects apply to the selected clip on the timeline."
        />
      </div>
    );
  }

  const { clip } = selected;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Effects" description={clip.name || clip.kind} />
      <div className="flex-1 overflow-y-auto p-2.5">
        <p className="mb-1.5 text-2xs uppercase tracking-wide text-ink-3">Looks</p>
        <div className="grid grid-cols-2 gap-1.5">
          {LOOKS.map((look) => (
            <button
              key={look.name}
              type="button"
              title={look.description}
              onClick={() => apply({ type: 'SET_FILTERS', clipId: clip.id, filters: look.filters }, `Look: ${look.name}`)}
              className="rounded-md border border-line bg-bg-2 px-2 py-2 text-left transition-colors hover:border-accent/40"
            >
              <p className="text-xs font-medium text-ink-0">{look.name}</p>
              <p className="mt-0.5 line-clamp-1 text-2xs text-ink-3">{look.description}</p>
            </button>
          ))}
        </div>

        <p className="mb-1 mt-4 flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-3">
          <Sun size={11} /> Adjust
        </p>
        <Slider
          label="Brightness"
          min={-1}
          max={1}
          value={clip.filters.brightness}
          onChange={(brightness) => apply({ type: 'SET_FILTERS', clipId: clip.id, filters: { brightness } }, 'Brightness')}
        />
        <Slider
          label="Contrast"
          min={0}
          max={2}
          value={clip.filters.contrast}
          onChange={(contrast) => apply({ type: 'SET_FILTERS', clipId: clip.id, filters: { contrast } }, 'Contrast')}
        />
        <Slider
          label="Saturation"
          min={0}
          max={2}
          value={clip.filters.saturation}
          onChange={(saturation) => apply({ type: 'SET_FILTERS', clipId: clip.id, filters: { saturation } }, 'Saturation')}
        />
        <Slider
          label="Warmth"
          min={-1}
          max={1}
          value={clip.filters.temperature}
          onChange={(temperature) => apply({ type: 'SET_FILTERS', clipId: clip.id, filters: { temperature } }, 'Warmth')}
        />
        <Slider
          label="Blur"
          min={0}
          max={40}
          step={0.5}
          value={clip.filters.blur}
          format={(value) => `${value.toFixed(1)}px`}
          onChange={(blur) => apply({ type: 'SET_FILTERS', clipId: clip.id, filters: { blur } }, 'Blur')}
        />
        <Slider
          label="Opacity"
          min={0}
          max={1}
          value={clip.transform.opacity}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(opacity) => apply({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { opacity } }, 'Opacity')}
        />

        <div className="mt-2 space-y-0.5">
          <Toggle
            label="Black & white"
            checked={clip.filters.grayscale}
            onChange={(grayscale) => apply({ type: 'SET_FILTERS', clipId: clip.id, filters: { grayscale } }, 'Grayscale')}
          />
          <Toggle
            label="Vignette"
            checked={clip.filters.vignette}
            onChange={(vignette) => apply({ type: 'SET_FILTERS', clipId: clip.id, filters: { vignette } }, 'Vignette')}
          />
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-2xs leading-relaxed text-ink-3">
          <Wand2 size={11} className="mt-0.5 shrink-0" />
          Effects render live in the preview and are baked into the export — the preview and the exported file use the
          same compositor.
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-2xs text-ink-3">
          <Contrast size={11} /> <Droplets size={11} /> Adjustments are per clip, not per track.
        </p>
      </div>
    </div>
  );
}
