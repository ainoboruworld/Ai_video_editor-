'use client';

import { useMemo, useState } from 'react';
import { Captions, Mic, Trash2, Type } from 'lucide-react';
import { CAPTION_PRESETS } from '@/features/timeline/compositor';
import { renderTimelineAudio } from '@/features/captions/extractAudio';
import { api, ApiClientError } from '@/lib/api-client';
import { trackByRole, type CaptionColors, type CaptionStyleName, type EditorCommand } from '@/lib/engine';
import { useEditorStore } from '@/state/editorStore';
import { Badge, Button, EmptyState, Input, PanelHeader } from '@/components/ui';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';

/**
 * Captions from the real timeline audio. The result is ordinary caption clips
 * that can be retimed, restyled and rewritten like anything else on the
 * timeline. Building captions from an existing transcript lives in the Edit and
 * Transcript panels, which do it without a second transcription request.
 */
const SWATCHES = ['#ffffff', '#000000', '#7c5cff', '#34d399', '#f5b544', '#fb7185', '#38bdf8'];

function ColourRow({
  label,
  value,
  onChange,
  disabled,
  clearable,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  clearable?: boolean;
}) {
  return (
    <div className={cn('mb-1.5 flex items-center gap-1', disabled && 'opacity-40')}>
      <span className="w-14 shrink-0 text-2xs text-ink-2">{label}</span>
      <div className="flex flex-1 items-center gap-0.5">
        {clearable ? (
          <button
            type="button"
            disabled={disabled}
            title={`No ${label.toLowerCase()}`}
            onClick={() => onChange(null)}
            className={cn(
              'h-5 w-5 rounded border text-2xs leading-none text-ink-3',
              value === null ? 'border-accent bg-accent-ghost' : 'border-line bg-bg-2',
            )}
          >
            ∅
          </button>
        ) : null}
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            disabled={disabled}
            title={swatch}
            onClick={() => onChange(swatch)}
            style={{ background: swatch }}
            className={cn(
              'h-5 w-5 rounded border',
              value?.toLowerCase() === swatch ? 'border-accent ring-1 ring-accent' : 'border-line',
            )}
          />
        ))}
        <input
          type="color"
          disabled={disabled}
          value={value && value.startsWith('#') ? value : '#ffffff'}
          onChange={(event) => onChange(event.target.value)}
          title="Custom colour"
          className="h-5 w-6 cursor-pointer rounded border border-line bg-transparent p-0"
        />
      </div>
    </div>
  );
}

export function CaptionsPanel() {
  const sequence = useEditorStore((state) => state.sequence);
  const assets = useEditorStore((state) => state.assets);
  const capabilities = useEditorStore((state) => state.capabilities);
  const apply = useEditorStore((state) => state.apply);
  const select = useEditorStore((state) => state.select);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);

  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const captionTrack = sequence ? trackByRole(sequence, 'caption') : null;
  const captions = useMemo(() => captionTrack?.clips ?? [], [captionTrack]);

  const autoCaption = async () => {
    if (!sequence) return;
    setBusy('auto');
    try {
      const audio = await renderTimelineAudio({ sequence, assets, onProgress: setStatus });
      setStatus('Transcribing…');
      const { cues } = await api.transcribe(audio);
      if (!captionTrack) throw new Error('This project has no caption track.');
      const commands: EditorCommand[] = [
        ...captions.map((clip) => ({ type: 'DELETE_CLIP' as const, clipId: clip.id })),
        ...cues.map((cue, index) => ({
          type: 'ADD_CAPTION' as const,
          trackId: captionTrack.id,
          clipId: `cap_auto_${index}`,
          text: cue.text,
          start: cue.start,
          duration: Math.max(0.3, cue.end - cue.start),
          words: cue.words.map((word) => ({
            text: word.text,
            start: word.start - cue.start,
            end: word.end - cue.start,
          })),
          style: 'karaoke' as const,
        })),
      ];
      apply(commands, 'Auto captions');
      toast.success(`${cues.length} captions added`);
    } catch (error) {
      toast.error('Auto captions failed', error instanceof ApiClientError || error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
      setStatus(null);
    }
  };

  // Colours apply to every caption at once: subtitles that change palette
  // halfway through a video are a mistake, not a feature.
  const recolour = (colors: CaptionColors | null, label: string) => {
    if (captions.length === 0) return;
    apply(
      captions.map((clip) => ({ type: 'SET_CAPTION_COLORS' as const, clipId: clip.id, colors })),
      label,
    );
  };

  const current = captions[0]?.captionColors ?? null;
  const preset = CAPTION_PRESETS[captions[0]?.captionStyle ?? 'bold'] ?? CAPTION_PRESETS.bold!;

  const restyle = (style: CaptionStyleName) => {
    if (captions.length === 0) return;
    apply(
      captions.map((clip) => ({ type: 'SET_CAPTION_STYLE' as const, clipId: clip.id, style })),
      'Caption style',
    );
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Captions" description="Burned-in subtitles that stay editable." />

      <div className="space-y-1.5 border-b border-line p-2">
        <Button
          size="sm"
          variant="primary"
          className="w-full justify-start"
          icon={<Mic size={12} />}
          loading={busy === 'auto'}
          disabled={!capabilities?.transcription.available}
          onClick={() => void autoCaption()}
        >
          Auto-caption from audio
        </Button>
        {!capabilities?.transcription.available ? (
          <p className="text-2xs leading-relaxed text-ink-3">
            Automatic captions need a transcription provider — a free{' '}
            <code className="font-mono">GEMINI_API_KEY</code> or <code className="font-mono">GROQ_API_KEY</code> is
            enough. You can still build captions from a transcript in the Edit panel, or type them by hand.
          </p>
        ) : null}
        {status ? <p className="text-2xs text-ink-2">{status}</p> : null}

      </div>

      <div className="border-b border-line p-2">
        <p className="mb-1.5 text-2xs uppercase tracking-wide text-ink-3">Style</p>
        <div className="grid grid-cols-3 gap-1.5">
          {Object.keys(CAPTION_PRESETS).map((preset) => {
            const active = captions[0]?.captionStyle === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => restyle(preset as CaptionStyleName)}
                disabled={captions.length === 0}
                className={cn(
                  'rounded border px-1.5 py-2 text-2xs font-medium capitalize transition-colors disabled:opacity-40',
                  active ? 'border-accent bg-accent-ghost text-accent' : 'border-line bg-bg-2 text-ink-1',
                )}
              >
                {preset}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-b border-line p-2">
        <p className="mb-1.5 text-2xs uppercase tracking-wide text-ink-3">Colour</p>

        <ColourRow
          label="Text"
          value={current?.text ?? preset.color}
          disabled={captions.length === 0}
          onChange={(text) => recolour({ text: text ?? '#ffffff' }, 'Caption colour')}
        />
        <ColourRow
          label="Highlight"
          value={(current?.highlight === undefined ? preset.highlight : current.highlight) ?? null}
          disabled={captions.length === 0}
          clearable
          onChange={(highlight) => recolour({ highlight }, 'Caption highlight')}
        />
        <ColourRow
          label="Outline"
          value={(current?.stroke === undefined ? preset.stroke : current.stroke) ?? null}
          disabled={captions.length === 0}
          clearable
          onChange={(stroke) => recolour({ stroke }, 'Caption outline')}
        />
        <ColourRow
          label="Box"
          value={(current?.background === undefined ? preset.background : current.background) ?? null}
          disabled={captions.length === 0}
          clearable
          onChange={(background) => recolour({ background }, 'Caption background')}
        />

        {current ? (
          <button
            type="button"
            onClick={() => recolour(null, 'Reset caption colours')}
            className="mt-1.5 text-2xs text-ink-3 underline-offset-2 hover:text-ink-1 hover:underline"
          >
            Back to the preset&apos;s colours
          </button>
        ) : null}
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          The preset sets size and position; these set the palette. An outline is what keeps white text readable over
          bright footage.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {captions.length === 0 ? (
          <EmptyState
            icon={<Captions size={20} />}
            title="No captions yet"
            description="Auto-caption the audio, generate from the script, or add caption clips by hand."
          />
        ) : (
          <ul className="space-y-1">
            {captions.map((clip) => (
              <li key={clip.id} className="group flex items-start gap-1.5 rounded-md p-1 hover:bg-bg-2">
                <button
                  type="button"
                  onClick={() => {
                    select([clip.id]);
                    setPlayhead(clip.start);
                  }}
                  className="mt-1 shrink-0 font-mono text-2xs text-ink-3 hover:text-accent"
                >
                  {clip.start.toFixed(1)}s
                </button>
                <Input
                  value={clip.text ?? ''}
                  onChange={(event) => apply({ type: 'SET_TEXT', clipId: clip.id, text: event.target.value }, 'Edit caption')}
                  className="h-7 flex-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => apply({ type: 'DELETE_CLIP', clipId: clip.id }, 'Delete caption')}
                  className="mt-1 shrink-0 text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line px-2 py-1.5">
        <Badge>
          <Type size={9} /> {captions.length} caption clips
        </Badge>
      </div>
    </div>
  );
}
