'use client';

import { useMemo } from 'react';
import {
  Crop,
  Layers,
  Move,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Volume2,
} from 'lucide-react';
import { CAPTION_PRESETS } from '@/features/timeline/compositor';
import type { CaptionStyleName, TextAnimation, TransitionKind } from '@/lib/engine';
import { useEditorStore, useSelectedClip } from '@/state/editorStore';
import { deleteSelection } from '@/features/timeline/operations';
import { Button, EmptyState, Field, IconButton, Input, PanelHeader, Select, Slider, Textarea, Toggle } from '@/components/ui';

const TRANSITIONS: { value: TransitionKind | 'none'; label: string }[] = [
  { value: 'none', label: 'Cut (none)' },
  { value: 'fade', label: 'Fade' },
  { value: 'cross-dissolve', label: 'Dissolve' },
  { value: 'dip-to-black', label: 'Dip to black' },
  { value: 'dip-to-white', label: 'Dip to white' },
  { value: 'slide', label: 'Slide' },
  { value: 'zoom', label: 'Zoom' },
];

const TEXT_ANIMATIONS: TextAnimation[] = ['none', 'fade', 'slide', 'pop', 'scale', 'typewriter', 'word-reveal'];

/** Properties of the selected clip. Every control writes an undoable command. */
export function Inspector() {
  const selected = useSelectedClip();
  const apply = useEditorStore((state) => state.apply);
  const assets = useEditorStore((state) => state.assets);
  const asset = useMemo(
    () => (selected?.clip.assetId ? assets.find((a) => a.id === selected.clip.assetId) ?? null : null),
    [assets, selected],
  );

  if (!selected) {
    return (
      <aside className="flex w-[280px] shrink-0 flex-col border-l border-line bg-bg-1">
        <PanelHeader title="Inspector" />
        <EmptyState
          icon={<Layers size={20} />}
          title="No clip selected"
          description="Select a clip on the timeline to adjust position, size, effects, audio and transitions."
        />
      </aside>
    );
  }

  const { clip, track } = selected;
  const isVisual = clip.kind === 'video' || clip.kind === 'image';
  const hasAudio = clip.kind === 'video' || clip.kind === 'audio';

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-line bg-bg-1">
      <PanelHeader
        title="Inspector"
        description={`${clip.kind} · ${track.name}`}
        action={
          <IconButton tone="danger" onClick={deleteSelection} title="Delete clip (Del)">
            <Trash2 size={13} />
          </IconButton>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <Section title="Clip" icon={<Layers size={12} />}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start">
              <Input
                type="number"
                step="0.1"
                min={0}
                value={round(clip.start)}
                onChange={(event) =>
                  apply({ type: 'MOVE_CLIP', clipId: clip.id, start: Number(event.target.value) }, 'Move clip')
                }
              />
            </Field>
            <Field label="Duration">
              <Input
                type="number"
                step="0.1"
                min={0.1}
                value={round(clip.duration)}
                onChange={(event) =>
                  apply(
                    {
                      type: 'TRIM_CLIP',
                      clipId: clip.id,
                      start: clip.start,
                      duration: Math.max(0.1, Number(event.target.value)),
                    },
                    'Change duration',
                  )
                }
              />
            </Field>
          </div>
          {clip.kind === 'video' ? (
            <Slider
              label="Speed"
              min={0.25}
              max={4}
              step={0.05}
              value={clip.speed}
              format={(value) => `${value.toFixed(2)}×`}
              onChange={(speed) => apply({ type: 'CHANGE_SPEED', clipId: clip.id, speed }, 'Change speed')}
            />
          ) : null}
          {asset ? (
            <p className="mt-1 truncate text-2xs text-ink-3" title={asset.name}>
              {asset.name}
            </p>
          ) : null}
        </Section>

        {isVisual ? (
          <>
            <Section title="Transform" icon={<Move size={12} />}>
              <div className="grid grid-cols-2 gap-2">
                <Field label="X">
                  <Input
                    type="number"
                    value={Math.round(clip.transform.x)}
                    onChange={(event) =>
                      apply(
                        { type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { x: Number(event.target.value) } },
                        'Move',
                      )
                    }
                  />
                </Field>
                <Field label="Y">
                  <Input
                    type="number"
                    value={Math.round(clip.transform.y)}
                    onChange={(event) =>
                      apply(
                        { type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { y: Number(event.target.value) } },
                        'Move',
                      )
                    }
                  />
                </Field>
              </div>
              <Slider
                label="Scale"
                min={0.1}
                max={4}
                value={clip.transform.scale}
                format={(value) => `${Math.round(value * 100)}%`}
                onChange={(scale) => apply({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { scale } }, 'Scale')}
              />
              <Slider
                label="Rotation"
                min={-180}
                max={180}
                step={1}
                value={clip.transform.rotation}
                format={(value) => `${Math.round(value)}°`}
                onChange={(rotation) =>
                  apply({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { rotation } }, 'Rotate')
                }
              />
              <Slider
                label="Opacity"
                min={0}
                max={1}
                value={clip.transform.opacity}
                format={(value) => `${Math.round(value * 100)}%`}
                onChange={(opacity) =>
                  apply({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { opacity } }, 'Opacity')
                }
              />
              <div className="mt-1 flex gap-1.5">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() =>
                    apply(
                      {
                        type: 'CHANGE_TRANSFORM',
                        clipId: clip.id,
                        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
                      },
                      'Reset transform',
                    )
                  }
                >
                  Reset
                </Button>
                <Select
                  value={clip.brollMode ?? 'fullscreen'}
                  onChange={(event) =>
                    apply(
                      {
                        type: 'SET_BROLL_MODE',
                        clipId: clip.id,
                        mode: event.target.value as NonNullable<typeof clip.brollMode>,
                      },
                      'Change layout',
                    )
                  }
                  className="flex-1"
                  title="B-roll layout"
                >
                  <option value="fullscreen">Full frame</option>
                  <option value="pip">Picture in picture</option>
                </Select>
              </div>
            </Section>

            <Section title="Crop" icon={<Crop size={12} />}>
              {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
                <Slider
                  key={side}
                  label={side}
                  min={0}
                  max={0.45}
                  value={clip.crop?.[side] ?? 0}
                  format={(value) => `${Math.round(value * 100)}%`}
                  onChange={(value) =>
                    apply(
                      {
                        type: 'SET_CROP',
                        clipId: clip.id,
                        crop: { left: 0, right: 0, top: 0, bottom: 0, ...clip.crop, [side]: value },
                      },
                      'Crop',
                    )
                  }
                />
              ))}
              {clip.crop ? (
                <Button size="sm" className="mt-1 w-full" onClick={() => apply({ type: 'SET_CROP', clipId: clip.id, crop: null }, 'Reset crop')}>
                  Clear crop
                </Button>
              ) : null}
            </Section>

            <Section title="Effects" icon={<Sparkles size={12} />}>
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
            </Section>
          </>
        ) : null}

        {clip.kind === 'text' ? (
          <Section title="Text" icon={<TypeIcon size={12} />}>
            <Textarea
              rows={3}
              value={clip.text ?? ''}
              onChange={(event) => apply({ type: 'SET_TEXT', clipId: clip.id, text: event.target.value }, 'Edit text')}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Size">
                <Input
                  type="number"
                  min={8}
                  max={280}
                  value={clip.textStyle?.fontSize ?? 64}
                  onChange={(event) =>
                    apply({ type: 'SET_TEXT', clipId: clip.id, style: { fontSize: Number(event.target.value) } }, 'Text size')
                  }
                />
              </Field>
              <Field label="Weight">
                <Select
                  value={clip.textStyle?.fontWeight ?? 700}
                  onChange={(event) =>
                    apply({ type: 'SET_TEXT', clipId: clip.id, style: { fontWeight: Number(event.target.value) } }, 'Text weight')
                  }
                  className="w-full"
                >
                  {[400, 500, 600, 700, 800, 900].map((weight) => (
                    <option key={weight} value={weight}>
                      {weight}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Colour">
                <input
                  type="color"
                  value={clip.textStyle?.color ?? '#ffffff'}
                  onChange={(event) => apply({ type: 'SET_TEXT', clipId: clip.id, style: { color: event.target.value } }, 'Text colour')}
                  className="h-8 w-full cursor-pointer rounded-md border border-line bg-bg-3"
                />
              </Field>
              <Field label="Align">
                <Select
                  value={clip.textStyle?.align ?? 'center'}
                  onChange={(event) =>
                    apply(
                      { type: 'SET_TEXT', clipId: clip.id, style: { align: event.target.value as 'left' | 'center' | 'right' } },
                      'Text align',
                    )
                  }
                  className="w-full"
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </Select>
              </Field>
            </div>
            <Field label="Animation" className="mt-2">
              <Select
                value={clip.textAnimation}
                onChange={(event) =>
                  apply({ type: 'SET_TEXT', clipId: clip.id, animation: event.target.value as TextAnimation }, 'Text animation')
                }
                className="w-full"
              >
                {TEXT_ANIMATIONS.map((animation) => (
                  <option key={animation} value={animation}>
                    {animation}
                  </option>
                ))}
              </Select>
            </Field>
          </Section>
        ) : null}

        {clip.kind === 'caption' ? (
          <Section title="Caption" icon={<TypeIcon size={12} />}>
            <Textarea
              rows={2}
              value={clip.text ?? ''}
              onChange={(event) => apply({ type: 'SET_TEXT', clipId: clip.id, text: event.target.value }, 'Edit caption')}
            />
            <Field label="Style" className="mt-2">
              <Select
                value={clip.captionStyle ?? 'bold'}
                onChange={(event) =>
                  apply(
                    { type: 'SET_CAPTION_STYLE', clipId: clip.id, style: event.target.value as CaptionStyleName },
                    'Caption style',
                  )
                }
                className="w-full"
              >
                {Object.keys(CAPTION_PRESETS).map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </Select>
            </Field>
            <Slider
              label="Vertical offset"
              min={-600}
              max={600}
              step={5}
              value={clip.transform.y}
              format={(value) => `${Math.round(value)}px`}
              onChange={(y) => apply({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { y } }, 'Caption position')}
            />
          </Section>
        ) : null}

        {hasAudio ? (
          <Section title="Audio" icon={<Volume2 size={12} />}>
            <Slider
              label="Volume"
              min={0}
              max={2}
              value={clip.volume}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(volume) => apply({ type: 'CHANGE_VOLUME', clipId: clip.id, volume }, 'Volume')}
            />
            <Toggle
              label="Mute"
              checked={clip.muted}
              onChange={(muted) => apply({ type: 'CHANGE_VOLUME', clipId: clip.id, volume: clip.volume, muted }, 'Mute')}
            />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Fade in">
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  value={round(clip.fadeIn)}
                  onChange={(event) => apply({ type: 'SET_FADE', clipId: clip.id, fadeIn: Number(event.target.value) }, 'Fade in')}
                />
              </Field>
              <Field label="Fade out">
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  value={round(clip.fadeOut)}
                  onChange={(event) => apply({ type: 'SET_FADE', clipId: clip.id, fadeOut: Number(event.target.value) }, 'Fade out')}
                />
              </Field>
            </div>
          </Section>
        ) : null}

        <Section title="Transitions" icon={<Sparkles size={12} />}>
          {(['in', 'out'] as const).map((position) => {
            const current = position === 'in' ? clip.transitionIn : clip.transitionOut;
            return (
              <Field key={position} label={position === 'in' ? 'In' : 'Out'} className="mb-2">
                <div className="flex gap-1.5">
                  <Select
                    value={current?.kind ?? 'none'}
                    onChange={(event) => {
                      const value = event.target.value as TransitionKind | 'none';
                      apply(
                        {
                          type: 'ADD_TRANSITION',
                          clipId: clip.id,
                          position,
                          transition:
                            value === 'none'
                              ? null
                              : { kind: value, duration: current?.duration ?? 0.5, position },
                        },
                        'Transition',
                      );
                    }}
                    className="flex-1"
                  >
                    {TRANSITIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    step="0.1"
                    min={0.1}
                    max={3}
                    disabled={!current}
                    value={current?.duration ?? 0.5}
                    onChange={(event) =>
                      current &&
                      apply(
                        {
                          type: 'ADD_TRANSITION',
                          clipId: clip.id,
                          position,
                          transition: { ...current, duration: Number(event.target.value) },
                        },
                        'Transition length',
                      )
                    }
                    className="w-16"
                  />
                </div>
              </Field>
            );
          })}
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-2">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
