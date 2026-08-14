import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Magnet,
  Scissors,
  Trash2,
  Copy,
  Bookmark,
  ZoomIn,
  ZoomOut,
  Maximize,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Headphones,
  Film,
  Music,
  Type,
  Captions,
} from 'lucide-react';
import { sequenceDuration, type Track } from '@ave/editor-core';
import { useEditorStore, findClip, clipAt } from '../../state/editorStore';
import { addAssetCommand } from '../../lib/timelineOps';
import { timecode, uid, clamp } from '../../lib/format';
import { IconButton, EditableLabel } from '../../components/ui';
import { ClipView } from './ClipView';
import { toast } from '../../state/toastStore';

const HEADER_W = 160;
const LANE_HEIGHTS: Record<string, number> = { video: 44, audio: 36, text: 28, caption: 28 };

export default function Timeline() {
  const sequence = useEditorStore((s) => s.sequence);
  const zoom = useEditorStore((s) => s.zoom);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!sequence) return <div className="h-full bg-bg-2 border-t border-line" />;

  const duration = Math.max(sequenceDuration(sequence), 30);
  const contentWidth = duration * zoom + 400;

  return (
    <div className="h-full flex flex-col bg-bg-2 border-t border-line min-h-0">
      <TimelineToolbar />
      <div className="flex-1 min-h-0 flex">
        {/* Track headers */}
        <div className="w-[160px] shrink-0 border-r border-line overflow-hidden flex flex-col">
          <div className="h-6 shrink-0 border-b border-line" />
          <div className="flex-1 overflow-hidden">
            <div id="tl-headers">
              {sequence.tracks.map((t) => (
                <TrackHeader key={t.id} track={t} />
              ))}
            </div>
          </div>
        </div>

        {/* Scrollable lanes */}
        <div
          ref={scrollRef}
          className="flex-1 min-w-0 overflow-auto relative"
          onScroll={(e) => {
            const el = e.currentTarget;
            const headers = document.getElementById('tl-headers');
            if (headers) headers.style.transform = `translateY(${-el.scrollTop}px)`;
            useEditorStore.getState().setScrollX(el.scrollLeft);
          }}
        >
          <div style={{ width: contentWidth, position: 'relative' }}>
            <TimelineRuler duration={duration} />
            <div className="relative">
              {sequence.tracks.map((t) => (
                <TrackLane key={t.id} track={t} contentWidth={contentWidth} />
              ))}
              <SnapGuide />
              <Playhead height={sequence.tracks.reduce((a, t) => a + (LANE_HEIGHTS[t.kind] ?? 36), 0)} />
              <Markers />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Toolbar ----------

function TimelineToolbar() {
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const apply = useEditorStore((s) => s.apply);
  const hasSelection = useEditorStore((s) => s.selection.length > 0);

  const split = useCallback(() => {
    const st = useEditorStore.getState();
    const seq = st.sequence;
    if (!seq) return;
    let target = st.selection.map((id) => findClip(seq, id)).find((f) => f && st.playhead > f.clip.start && st.playhead < f.clip.start + f.clip.duration);
    if (!target) target = clipAt(seq, st.playhead) ?? undefined;
    if (!target) {
      toast.info('No clip under playhead to split');
      return;
    }
    st.apply({ type: 'SPLIT_CLIP', clipId: target.clip.id, time: st.playhead, newClipId: uid('clip') }, 'Split clip');
  }, []);

  const del = useCallback(() => {
    const st = useEditorStore.getState();
    if (!st.sequence || st.selection.length === 0) return;
    st.apply(
      st.selection.map((clipId) => ({ type: 'DELETE_CLIP' as const, clipId })),
      `Delete ${st.selection.length} clip${st.selection.length > 1 ? 's' : ''}`,
    );
    st.select([]);
  }, []);

  const duplicate = useCallback(() => {
    const st = useEditorStore.getState();
    if (!st.sequence || st.selection.length === 0) return;
    st.apply(
      st.selection.map((clipId) => ({ type: 'DUPLICATE_CLIP' as const, clipId, newClipId: uid('clip') })),
      'Duplicate clip',
    );
  }, []);

  return (
    <div className="h-8 shrink-0 border-b border-line flex items-center px-2 gap-1">
      <IconButton onClick={split} title="Split at playhead (S)">
        <Scissors size={13} />
      </IconButton>
      <IconButton onClick={del} disabled={!hasSelection} title="Delete selected (Del)">
        <Trash2 size={13} />
      </IconButton>
      <IconButton onClick={duplicate} disabled={!hasSelection} title="Duplicate selected">
        <Copy size={13} />
      </IconButton>
      <IconButton
        onClick={() => {
          const st = useEditorStore.getState();
          apply({ type: 'ADD_MARKER', id: uid('marker'), time: st.playhead, label: 'Marker' }, 'Add marker');
        }}
        title="Add marker at playhead"
      >
        <Bookmark size={13} />
      </IconButton>
      <div className="w-px h-4 bg-line mx-1" />
      <IconButton onClick={toggleSnap} active={snapEnabled} title={`Snapping ${snapEnabled ? 'on' : 'off'}`}>
        <Magnet size={13} />
      </IconButton>
      <div className="flex-1" />
      <PlayheadReadout />
      <div className="flex-1" />
      <IconButton onClick={() => setZoom(zoom / 1.4)} title="Zoom out">
        <ZoomOut size={13} />
      </IconButton>
      <input
        type="range"
        min={2}
        max={400}
        step={1}
        value={zoom}
        onChange={(e) => setZoom(Number(e.target.value))}
        className="w-28"
        title="Zoom"
      />
      <IconButton onClick={() => setZoom(zoom * 1.4)} title="Zoom in">
        <ZoomIn size={13} />
      </IconButton>
      <IconButton
        onClick={() => {
          const st = useEditorStore.getState();
          if (!st.sequence) return;
          const dur = Math.max(1, sequenceDuration(st.sequence));
          setZoom((window.innerWidth - HEADER_W - 60) / dur);
        }}
        title="Fit timeline"
      >
        <Maximize size={13} />
      </IconButton>
    </div>
  );
}

function PlayheadReadout() {
  const playhead = useEditorStore((s) => s.playhead);
  const fps = useEditorStore((s) => s.sequence?.fps ?? 30);
  return <span className="text-xs tabular-nums text-ink-2">{timecode(playhead, fps)}</span>;
}

// ---------- Ruler ----------

function TimelineRuler({ duration }: { duration: number }) {
  const zoom = useEditorStore((s) => s.zoom);
  const fps = useEditorStore((s) => s.sequence?.fps ?? 30);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const draggingRef = useRef(false);

  // adaptive tick interval
  const interval = useMemo(() => {
    const candidates = [1 / fps, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    for (const c of candidates) if (c * zoom >= 60) return c;
    return 600;
  }, [zoom, fps]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= duration + interval; t += interval) out.push(t);
    return out;
  }, [duration, interval]);

  function timeFromEvent(e: React.PointerEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / zoom, 0, 100000);
  }

  return (
    <div
      className="h-6 sticky top-0 z-30 bg-bg-2 border-b border-line cursor-col-resize select-none"
      onPointerDown={(e) => {
        draggingRef.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setPlayhead(timeFromEvent(e));
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) setPlayhead(timeFromEvent(e));
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
    >
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 bottom-0" style={{ left: t * zoom }}>
          <div className="w-px h-full bg-line" />
          <span className="absolute top-0.5 left-1 text-[9px] tabular-nums text-ink-3">
            {interval < 1 ? timecode(t, fps) : formatTick(t)}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatTick(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return m > 0 ? `${m}:${s < 10 ? '0' : ''}${s}` : `${s}s`;
}

// ---------- Track header ----------

const TrackHeader = React.memo(function TrackHeader({ track }: { track: Track }) {
  const apply = useEditorStore((s) => s.apply);
  const h = LANE_HEIGHTS[track.kind] ?? 36;
  const Icon = track.kind === 'video' ? Film : track.kind === 'audio' ? Music : track.kind === 'text' ? Type : Captions;
  return (
    <div className="flex items-center gap-1 px-2 border-b border-line/60 bg-bg-2" style={{ height: h }}>
      <Icon size={11} className="text-ink-3 shrink-0" />
      <EditableLabel
        value={track.name}
        onChange={(name) => apply({ type: 'SET_TRACK_STATE', trackId: track.id, name }, 'Rename track')}
        className="text-xs flex-1 min-w-0"
      />
      <button
        className={`p-0.5 rounded ${track.locked ? 'text-[#f5c76e]' : 'text-ink-3 hover:text-ink-1'}`}
        title={track.locked ? 'Unlock track' : 'Lock track'}
        onClick={() => apply({ type: 'SET_TRACK_STATE', trackId: track.id, locked: !track.locked }, track.locked ? 'Unlock track' : 'Lock track')}
      >
        {track.locked ? <Lock size={10} /> : <Unlock size={10} />}
      </button>
      {(track.kind === 'video' || track.kind === 'text' || track.kind === 'caption') && (
        <button
          className={`p-0.5 rounded ${!track.visible ? 'text-[#f0a5a8]' : 'text-ink-3 hover:text-ink-1'}`}
          title={track.visible ? 'Hide track' : 'Show track'}
          onClick={() => apply({ type: 'SET_TRACK_STATE', trackId: track.id, visible: !track.visible }, 'Toggle visibility')}
        >
          {track.visible ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>
      )}
      {(track.kind === 'audio' || track.kind === 'video') && (
        <>
          <button
            className={`p-0.5 rounded ${track.muted ? 'text-[#f0a5a8]' : 'text-ink-3 hover:text-ink-1'}`}
            title={track.muted ? 'Unmute track' : 'Mute track'}
            onClick={() => apply({ type: 'SET_TRACK_STATE', trackId: track.id, muted: !track.muted }, 'Toggle mute')}
          >
            {track.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
          </button>
          <button
            className={`p-0.5 rounded ${track.solo ? 'text-accent-hover' : 'text-ink-3 hover:text-ink-1'}`}
            title="Solo track"
            onClick={() => apply({ type: 'SET_TRACK_STATE', trackId: track.id, solo: !track.solo }, 'Toggle solo')}
          >
            <Headphones size={10} />
          </button>
        </>
      )}
    </div>
  );
});

// ---------- Track lane ----------

function TrackLane({ track, contentWidth }: { track: Track; contentWidth: number }) {
  const zoom = useEditorStore((s) => s.zoom);
  const h = LANE_HEIGHTS[track.kind] ?? 36;
  const [dropX, setDropX] = useState<number | null>(null);

  return (
    <div
      data-lane-track-id={track.id}
      className={`relative border-b border-line/40 ${track.locked ? 'bg-bg-1/50' : 'bg-bg-1'}`}
      style={{ height: h, width: contentWidth }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          useEditorStore.getState().setPlayhead((e.clientX - rect.left) / zoom);
          useEditorStore.getState().select([]);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-ave-asset')) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          setDropX(e.clientX - rect.left);
        }
      }}
      onDragLeave={() => setDropX(null)}
      onDrop={(e) => {
        const assetId = e.dataTransfer.getData('application/x-ave-asset');
        setDropX(null);
        if (!assetId) return;
        e.preventDefault();
        const st = useEditorStore.getState();
        const seq = st.sequence;
        const asset = st.assets.find((a) => a.id === assetId);
        if (!seq || !asset) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const time = Math.max(0, (e.clientX - rect.left) / zoom);
        const wantKind = asset.kind === 'audio' ? 'audio' : 'video';
        const targetTrackId = track.kind === wantKind && !track.locked ? track.id : undefined;
        const cmd = addAssetCommand(seq, asset, time, targetTrackId);
        if (cmd) st.apply(cmd, `Add ${asset.name}`);
        else toast.error('No compatible track for this asset');
      }}
    >
      {track.clips.map((clip) => (
        <ClipView key={clip.id} clip={clip} track={track} laneHeight={h} />
      ))}
      {dropX !== null && <div className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none" style={{ left: dropX }} />}
    </div>
  );
}

// ---------- Playhead / snap guide / markers ----------

function Playhead({ height }: { height: number }) {
  const playhead = useEditorStore((s) => s.playhead);
  const zoom = useEditorStore((s) => s.zoom);
  const dragging = useRef(false);
  return (
    <div
      className="absolute top-0 z-40 cursor-col-resize"
      style={{ left: playhead * zoom - 5, width: 11, height }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const st = useEditorStore.getState();
        st.setPlayhead(Math.max(0, st.playhead + e.movementX / zoom));
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      <div className="absolute left-[5px] top-0 bottom-0 w-px bg-accent-hover" />
      <div className="absolute left-[1px] -top-0 w-[9px] h-[7px] bg-accent-hover" style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
    </div>
  );
}

function SnapGuide() {
  const snapGuide = useEditorStore((s) => s.snapGuide);
  const zoom = useEditorStore((s) => s.zoom);
  if (snapGuide == null) return null;
  return <div className="absolute top-0 bottom-0 w-px bg-[#f5c76e] z-30 pointer-events-none" style={{ left: snapGuide * zoom }} />;
}

function Markers() {
  const markers = useEditorStore((s) => s.sequence?.markers ?? []);
  const zoom = useEditorStore((s) => s.zoom);
  const apply = useEditorStore((s) => s.apply);
  return (
    <>
      {markers.map((m) => (
        <div
          key={m.id}
          className="absolute -top-0 w-2 h-2 rotate-45 z-30 cursor-pointer"
          style={{ left: m.time * zoom - 4, backgroundColor: m.color }}
          title={`${m.label} — double-click to remove`}
          onDoubleClick={() => apply({ type: 'DELETE_MARKER', id: m.id }, 'Delete marker')}
        />
      ))}
    </>
  );
}
