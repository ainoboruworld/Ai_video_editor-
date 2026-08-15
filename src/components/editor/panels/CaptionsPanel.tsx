'use client';

import { useMemo, useState } from 'react';
import { Captions, Mic, Trash2, Type, Wand2 } from 'lucide-react';
import { CAPTION_PRESETS } from '@/features/timeline/compositor';
import { renderTimelineAudio } from '@/features/captions/extractAudio';
import { generateCaptionsFromScript } from '@/features/ai/actions';
import { api, ApiClientError } from '@/lib/api-client';
import { trackByRole, type CaptionStyleName, type EditorCommand } from '@/lib/engine';
import { useEditorStore } from '@/state/editorStore';
import { Badge, Button, EmptyState, Input, PanelHeader } from '@/components/ui';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';

/**
 * Captions: transcribe the real timeline audio, or derive cues from the
 * storyboard script. Either way the result is ordinary caption clips that can
 * be retimed, restyled and rewritten on the timeline.
 */
export function CaptionsPanel() {
  const sequence = useEditorStore((state) => state.sequence);
  const assets = useEditorStore((state) => state.assets);
  const storyboard = useEditorStore((state) => state.storyboard);
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
            Automatic captions need a transcription provider (<code className="font-mono">OPENAI_API_KEY</code>). You
            can still generate captions from the script, or type them by hand.
          </p>
        ) : null}
        {status ? <p className="text-2xs text-ink-2">{status}</p> : null}

        <Button
          size="sm"
          className="w-full justify-start"
          icon={<Wand2 size={12} />}
          disabled={!storyboard}
          loading={busy === 'script'}
          onClick={async () => {
            setBusy('script');
            try {
              await generateCaptionsFromScript();
              toast.success('Captions generated from the script');
            } catch (error) {
              toast.error('Could not generate captions', error instanceof Error ? error.message : undefined);
            } finally {
              setBusy(null);
            }
          }}
        >
          Generate from script
        </Button>
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
