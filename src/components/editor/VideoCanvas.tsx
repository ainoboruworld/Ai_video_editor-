'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { sequenceDuration, type AspectRatio } from '@/lib/engine';
import { useEditorStore } from '@/state/editorStore';
import type { PlaybackEngine } from '@/features/timeline/playback';
import { IconButton, Select } from '@/components/ui';
import { timecode } from '@/lib/format';
import { cn } from '@/lib/cn';

const ASPECTS: { value: AspectRatio; label: string; hint: string }[] = [
  { value: '9:16', label: '9:16', hint: 'Reels · TikTok · Shorts' },
  { value: '16:9', label: '16:9', hint: 'YouTube' },
  { value: '1:1', label: '1:1', hint: 'Feed' },
  { value: '4:5', label: '4:5', hint: 'Instagram feed' },
  { value: '4:3', label: '4:3', hint: 'Classic' },
];

/**
 * The program monitor. The canvas is the real composited frame at sequence
 * resolution, scaled with CSS — so nothing is stretched and what plays here is
 * exactly what the exporter records.
 */
export function VideoCanvas({
  engine,
  attach,
}: {
  engine: PlaybackEngine | null;
  attach: (canvas: HTMLCanvasElement | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState({ width: 320, height: 568 });
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);

  const sequence = useEditorStore((state) => state.sequence);
  const playing = useEditorStore((state) => state.playing);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const playhead = useEditorStore((state) => state.playhead);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const aspect = useEditorStore((state) => state.aspect);
  const setAspect = useEditorStore((state) => state.setAspect);

  const duration = sequence ? sequenceDuration(sequence) : 0;
  const fps = sequence?.fps ?? 30;

  useEffect(() => {
    attach(canvasRef.current);
    return () => attach(null);
  }, [attach]);

  // Fit the stage inside the available space, preserving the project ratio.
  useEffect(() => {
    const element = containerRef.current;
    if (!element || !sequence) return;
    const measure = () => {
      const padding = 32;
      const availableWidth = element.clientWidth - padding;
      const availableHeight = element.clientHeight - padding;
      const ratio = sequence.width / sequence.height;
      let width = availableWidth;
      let height = width / ratio;
      if (height > availableHeight) {
        height = availableHeight;
        width = height * ratio;
      }
      setStage({ width: Math.max(80, width), height: Math.max(80, height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [sequence]);

  useEffect(() => {
    engine?.setRate(rate);
  }, [engine, rate]);

  useEffect(() => {
    engine?.pool.setMasterVolume(muted ? 0 : 1);
  }, [engine, muted]);

  // Loop playback restarts instead of stopping at the end.
  useEffect(() => {
    if (!loop || playing || duration <= 0) return;
    if (playhead >= duration - 0.05) {
      setPlayhead(0);
      setPlaying(true);
    }
  }, [loop, playing, playhead, duration, setPlayhead, setPlaying]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-0">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-bg-1 px-2">
        <span className="text-2xs font-medium uppercase tracking-wider text-ink-3">Preview</span>
        <div className="ml-2 flex items-center gap-1">
          {ASPECTS.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              onClick={() => setAspect(option.value)}
              className={cn(
                'rounded px-1.5 py-0.5 text-2xs font-medium transition-colors',
                aspect === option.value ? 'bg-accent-ghost text-accent' : 'text-ink-3 hover:text-ink-1',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="ml-auto font-mono text-2xs text-ink-3">
          {sequence ? `${sequence.width}×${sequence.height} · ${fps}fps` : ''}
        </div>
      </div>

      <div ref={containerRef} className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        <div
          ref={stageRef}
          className="relative overflow-hidden rounded-sm bg-black shadow-2xl ring-1 ring-white/5"
          style={{ width: stage.width, height: stage.height }}
        >
          <canvas
            ref={canvasRef}
            width={sequence?.width ?? 1080}
            height={sequence?.height ?? 1920}
            className="h-full w-full"
          />
          {duration === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
              <p className="text-xs font-medium text-ink-2">Nothing on the timeline yet</p>
              <p className="max-w-[26ch] text-2xs text-ink-3">
                Add media, or generate a storyboard from the AI panel.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 border-t border-line bg-bg-1 px-2">
        <IconButton onClick={() => setPlayhead(playhead - 1 / fps)} title="Previous frame (←)">
          <SkipBack size={13} />
        </IconButton>
        <IconButton onClick={() => setPlaying(!playing)} title="Play / pause (Space)" active={playing}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </IconButton>
        <IconButton onClick={() => setPlayhead(playhead + 1 / fps)} title="Next frame (→)">
          <SkipForward size={13} />
        </IconButton>

        <span className="ml-2 font-mono text-xs tabular-nums text-ink-1">{timecode(playhead, fps)}</span>
        <span className="font-mono text-xs text-ink-3">/ {timecode(duration, fps)}</span>

        <div className="ml-auto flex items-center gap-1">
          <IconButton onClick={() => setLoop(!loop)} active={loop} title="Loop playback">
            <Repeat size={13} />
          </IconButton>
          <IconButton onClick={() => setMuted(!muted)} active={muted} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </IconButton>
          <Select
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
            className="h-7 w-[62px] text-xs"
            title="Playback speed"
          >
            {[0.25, 0.5, 1, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </Select>
          <IconButton onClick={() => void stageRef.current?.requestFullscreen?.()} title="Fullscreen">
            <Maximize2 size={13} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
