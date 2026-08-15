'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Eye,
  EyeOff,
  Lock,
  Magnet,
  Scissors,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { sequenceDuration, type Clip, type Sequence, type Track, type TrackRole } from '@/lib/engine';
import { useEditorStore } from '@/state/editorStore';
import { deleteSelection, duplicateSelection, snapCandidate, splitAtPlayhead } from '@/features/timeline/operations';
import { IconButton } from '@/components/ui';
import { timecode } from '@/lib/format';
import { cn } from '@/lib/cn';

const TRACK_HEIGHT = 46;
const HEADER_WIDTH = 168;
const RULER_HEIGHT = 26;

const ROLE_COLORS: Record<TrackRole, string> = {
  video: 'bg-track-video',
  broll: 'bg-track-broll',
  overlay: 'bg-track-overlay',
  text: 'bg-track-text',
  caption: 'bg-track-caption',
  audio: 'bg-track-audio',
  music: 'bg-track-music',
  voiceover: 'bg-track-voice',
};

type DragMode = 'move' | 'trim-start' | 'trim-end';

interface DragState {
  mode: DragMode;
  clipId: string;
  trackId: string;
  originX: number;
  originStart: number;
  originDuration: number;
  targetTrackId: string;
}

/**
 * Multi-track timeline: drag to move, drag the edges to trim, snap to
 * neighbours, split at the playhead, zoom, mute/lock/hide tracks. Every
 * interaction dispatches engine commands, so everything is undoable.
 */
export function Timeline() {
  const sequence = useEditorStore((state) => state.sequence);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  const playhead = useEditorStore((state) => state.playhead);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const selection = useEditorStore((state) => state.selection);
  const select = useEditorStore((state) => state.select);
  const apply = useEditorStore((state) => state.apply);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const toggleSnap = useEditorStore((state) => state.toggleSnap);
  const fps = useEditorStore((state) => state.fps);

  const scrollRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<{ start: number; duration: number; trackId: string } | null>(null);

  const duration = sequence ? sequenceDuration(sequence) : 0;
  const contentWidth = Math.max(600, (duration + 6) * zoom);

  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const lane = laneRef.current;
      if (!lane) return 0;
      const rect = lane.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left) / zoom);
    },
    [zoom],
  );

  // Drag handling lives on the window so the pointer can leave the lane.
  useEffect(() => {
    if (!drag || !sequence) return;

    const onMove = (event: PointerEvent) => {
      const deltaSeconds = (event.clientX - drag.originX) / zoom;
      const exclude = new Set([drag.clipId]);

      if (drag.mode === 'move') {
        const rawStart = drag.originStart + deltaSeconds;
        const start = snapCandidate(sequence, rawStart, exclude, zoom);
        const trackId = trackAtPointer(sequence, event.clientY) ?? drag.trackId;
        setPreview({ start, duration: drag.originDuration, trackId });
      } else if (drag.mode === 'trim-start') {
        const rawStart = drag.originStart + deltaSeconds;
        const start = Math.min(
          snapCandidate(sequence, rawStart, exclude, zoom),
          drag.originStart + drag.originDuration - 0.1,
        );
        setPreview({
          start,
          duration: drag.originStart + drag.originDuration - start,
          trackId: drag.trackId,
        });
      } else {
        const rawEnd = drag.originStart + drag.originDuration + deltaSeconds;
        const end = Math.max(snapCandidate(sequence, rawEnd, exclude, zoom), drag.originStart + 0.1);
        setPreview({ start: drag.originStart, duration: end - drag.originStart, trackId: drag.trackId });
      }
    };

    const onUp = () => {
      const current = preview;
      if (current) {
        if (drag.mode === 'move') {
          apply(
            {
              type: 'MOVE_CLIP',
              clipId: drag.clipId,
              trackId: current.trackId !== drag.trackId ? current.trackId : undefined,
              start: current.start,
            },
            'Move clip',
          );
        } else {
          apply(
            { type: 'TRIM_CLIP', clipId: drag.clipId, start: current.start, duration: current.duration },
            'Trim clip',
          );
        }
      }
      setDrag(null);
      setPreview(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, preview, sequence, zoom, apply]);

  if (!sequence) return <div className="h-full bg-bg-1" />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-1">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <IconButton onClick={splitAtPlayhead} title="Split at playhead (S)">
          <Scissors size={13} />
        </IconButton>
        <IconButton onClick={duplicateSelection} disabled={selection.length === 0} title="Duplicate (⌘D)">
          <Copy size={13} />
        </IconButton>
        <IconButton onClick={deleteSelection} disabled={selection.length === 0} tone="danger" title="Delete (Del)">
          <Trash2 size={13} />
        </IconButton>
        <div className="mx-1 h-4 w-px bg-line" />
        <IconButton onClick={toggleSnap} active={snapEnabled} title="Snapping">
          <Magnet size={13} />
        </IconButton>
        <span className="ml-2 font-mono text-2xs text-ink-3">{timecode(playhead, fps)}</span>

        <div className="ml-auto flex items-center gap-1">
          <IconButton onClick={() => setZoom(zoom / 1.4)} title="Zoom out (-)">
            <ZoomOut size={13} />
          </IconButton>
          <input
            type="range"
            min={6}
            max={220}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-24"
            title="Timeline zoom"
          />
          <IconButton onClick={() => setZoom(zoom * 1.4)} title="Zoom in (+)">
            <ZoomIn size={13} />
          </IconButton>
        </div>
      </div>

      {/* One vertical scroll box holds the headers and the lanes, so they can
          never drift out of alignment when the project has many tracks. */}
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="sticky left-0 z-20 shrink-0 border-r border-line bg-bg-1" style={{ width: HEADER_WIDTH }}>
          <div className="sticky top-0 z-10 border-b border-line bg-bg-2" style={{ height: RULER_HEIGHT }} />
          {sequence.tracks.map((track) => (
            <TrackHeader key={track.id} track={track} />
          ))}
        </div>

        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: contentWidth }}>
            <Ruler
              zoom={zoom}
              duration={duration}
              width={contentWidth}
              onScrub={(time) => setPlayhead(time)}
            />

            <div
              ref={laneRef}
              className="relative"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                  select([]);
                  setPlayhead(timeFromEvent(event.clientX));
                }
              }}
            >
              {sequence.tracks.map((track) => (
                <div
                  key={track.id}
                  data-track-id={track.id}
                  className={cn(
                    'relative border-b border-line/60',
                    track.locked && 'bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(255,255,255,0.02)_6px,rgba(255,255,255,0.02)_12px)]',
                  )}
                  style={{ height: TRACK_HEIGHT }}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) {
                      select([]);
                      setPlayhead(timeFromEvent(event.clientX));
                    }
                  }}
                >
                  {track.clips.map((clip) => (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      track={track}
                      zoom={zoom}
                      selected={selection.includes(clip.id)}
                      preview={preview && drag?.clipId === clip.id ? preview : null}
                      onSelect={(additive) => select([clip.id], additive)}
                      onDragStart={(mode, clientX) => {
                        if (track.locked) return;
                        select([clip.id]);
                        setDrag({
                          mode,
                          clipId: clip.id,
                          trackId: track.id,
                          targetTrackId: track.id,
                          originX: clientX,
                          originStart: clip.start,
                          originDuration: clip.duration,
                        });
                        setPreview({ start: clip.start, duration: clip.duration, trackId: track.id });
                      }}
                    />
                  ))}
                </div>
              ))}

              <div
                className="pointer-events-none absolute top-0 z-30 w-px bg-accent"
                style={{ left: playhead * zoom, height: sequence.tracks.length * TRACK_HEIGHT }}
              >
                <span className="absolute -left-[5px] -top-[1px] h-2.5 w-2.5 rounded-sm bg-accent" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Ruler({
  zoom,
  duration,
  width,
  onScrub,
}: {
  zoom: number;
  duration: number;
  width: number;
  onScrub: (time: number) => void;
}) {
  const step = useMemo(() => {
    const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    return candidates.find((value) => value * zoom >= 64) ?? 600;
  }, [zoom]);

  const ticks: number[] = [];
  for (let t = 0; t <= duration + step * 2; t += step) ticks.push(t);

  const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onScrub(Math.max(0, (event.clientX - rect.left) / zoom));
  };

  return (
    <div
      className="sticky top-0 z-10 cursor-ew-resize select-none border-b border-line bg-bg-2"
      style={{ width, height: RULER_HEIGHT }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        scrub(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) scrub(event);
      }}
    >
      {ticks.map((tick) => (
        <div key={tick} className="absolute top-0 h-full border-l border-line/70 pl-1" style={{ left: tick * zoom }}>
          <span className="font-mono text-2xs text-ink-3" style={{ lineHeight: `${RULER_HEIGHT}px` }}>{formatTick(tick)}</span>
        </div>
      ))}
    </div>
  );
}

function formatTick(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function TrackHeader({ track }: { track: Track }) {
  const apply = useEditorStore((state) => state.apply);
  return (
    <div
      className="flex items-center gap-1 border-b border-line/60 px-2"
      style={{ height: TRACK_HEIGHT }}
    >
      <span className={cn('h-4 w-1 shrink-0 rounded-full', ROLE_COLORS[track.role])} />
      <span className="min-w-0 flex-1 truncate text-2xs font-medium text-ink-1" title={track.name}>
        {track.name}
      </span>
      <IconButton
        className="h-5 w-5"
        onClick={() => apply({ type: 'SET_TRACK_STATE', trackId: track.id, visible: !track.visible }, 'Toggle track')}
        title={track.visible ? 'Hide track' : 'Show track'}
      >
        {track.visible ? <Eye size={11} /> : <EyeOff size={11} className="text-ink-3" />}
      </IconButton>
      {track.kind !== 'text' && track.kind !== 'caption' ? (
        <IconButton
          className="h-5 w-5"
          onClick={() => apply({ type: 'SET_TRACK_STATE', trackId: track.id, muted: !track.muted }, 'Mute track')}
          title={track.muted ? 'Unmute track' : 'Mute track'}
        >
          {track.muted ? <VolumeX size={11} className="text-ink-3" /> : <Volume2 size={11} />}
        </IconButton>
      ) : null}
      <IconButton
        className="h-5 w-5"
        onClick={() => apply({ type: 'SET_TRACK_STATE', trackId: track.id, locked: !track.locked }, 'Lock track')}
        title={track.locked ? 'Unlock track' : 'Lock track'}
      >
        {track.locked ? <Lock size={11} className="text-warn" /> : <Unlock size={11} />}
      </IconButton>
    </div>
  );
}

function ClipView({
  clip,
  track,
  zoom,
  selected,
  preview,
  onSelect,
  onDragStart,
}: {
  clip: Clip;
  track: Track;
  zoom: number;
  selected: boolean;
  preview: { start: number; duration: number; trackId: string } | null;
  onSelect: (additive: boolean) => void;
  onDragStart: (mode: DragMode, clientX: number) => void;
}) {
  const assets = useEditorStore((state) => state.assets);
  const asset = clip.assetId ? assets.find((a) => a.id === clip.assetId) : null;
  const start = preview?.start ?? clip.start;
  const duration = preview?.duration ?? clip.duration;
  const label = clip.kind === 'text' || clip.kind === 'caption' ? clip.text || clip.name : clip.name || asset?.name || clip.kind;

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect(false);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(event.shiftKey);
        onDragStart('move', event.clientX);
      }}
      className={cn(
        'group absolute top-[3px] cursor-grab overflow-hidden rounded-[5px] border text-left transition-shadow active:cursor-grabbing',
        selected ? 'border-accent shadow-[0_0_0_1px_rgba(124,92,255,0.6)]' : 'border-black/40 hover:border-line-strong',
        track.locked && 'cursor-not-allowed opacity-60',
      )}
      style={{
        left: start * zoom,
        width: Math.max(6, duration * zoom),
        height: TRACK_HEIGHT - 8,
      }}
    >
      <div className={cn('absolute inset-0 opacity-90', ROLE_COLORS[track.role])} />
      {asset?.thumbnailUrl && clip.kind !== 'audio' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.thumbnailUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-40 mix-blend-luminosity"
          draggable={false}
        />
      ) : null}

      <div className="relative flex h-full items-center gap-1 px-1.5">
        <span className="truncate text-2xs font-medium text-white/95 drop-shadow">{label}</span>
        {clip.muted ? <VolumeX size={9} className="shrink-0 text-white/70" /> : null}
      </div>

      {clip.transitionIn ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/60 to-transparent" />
      ) : null}
      {clip.transitionOut ? (
        <span className="pointer-events-none absolute inset-y-0 right-0 w-3 bg-gradient-to-l from-black/60 to-transparent" />
      ) : null}

      <span
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect(false);
          onDragStart('trim-start', event.clientX);
        }}
        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 transition-colors group-hover:bg-white/30"
      />
      <span
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect(false);
          onDragStart('trim-end', event.clientX);
        }}
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 transition-colors group-hover:bg-white/30"
      />
    </div>
  );
}

/** Which track lane is under the pointer — used for cross-track dragging. */
function trackAtPointer(sequence: Sequence, clientY: number): string | null {
  const lanes = document.querySelectorAll<HTMLElement>('[data-track-id]');
  for (const lane of lanes) {
    const rect = lane.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      const id = lane.dataset.trackId;
      const track = sequence.tracks.find((t) => t.id === id);
      if (track && !track.locked) return track.id;
    }
  }
  return null;
}
