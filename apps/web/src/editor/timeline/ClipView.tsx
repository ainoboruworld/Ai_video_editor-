import React, { useRef, useState } from 'react';
import type { Clip, Track } from '@ave/editor-core';
import { snapTargets, snapTime } from '@ave/editor-core';
import { useEditorStore } from '../../state/editorStore';
import { timecode } from '../../lib/format';
import Waveform from './Waveform';

const KIND_COLORS: Record<string, { bg: string; border: string; selBorder: string }> = {
  video: { bg: '#31415f', border: '#42537a', selBorder: '#8b8ef7' },
  broll: { bg: '#1f4a49', border: '#2c6361', selBorder: '#5eead4' },
  audio: { bg: '#1e4230', border: '#2b5a42', selBorder: '#6ee7a0' },
  image: { bg: '#31415f', border: '#42537a', selBorder: '#8b8ef7' },
  text: { bg: '#4a3b1d', border: '#635026', selBorder: '#f5c76e' },
  caption: { bg: '#3d2c56', border: '#523c71', selBorder: '#c4b5fd' },
};

interface DragState {
  mode: 'move' | 'trim-l' | 'trim-r';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  origStart: number;
  origDuration: number;
  targets: number[];
  moved: boolean;
  trackId: string;
  hoverTrackId: string | null;
}

export const ClipView = React.memo(function ClipView({
  clip,
  track,
  laneHeight,
}: {
  clip: Clip;
  track: Track;
  laneHeight: number;
}) {
  const zoom = useEditorStore((s) => s.zoom);
  const selected = useEditorStore((s) => s.selection.includes(clip.id));
  const asset = useEditorStore((s) => (clip.assetId ? s.assets.find((a) => a.id === clip.assetId) : undefined));
  const apply = useEditorStore((s) => s.apply);
  const select = useEditorStore((s) => s.select);

  const dragRef = useRef<DragState | null>(null);
  const [ghost, setGhost] = useState<{ start: number; duration: number; snapped: number | null } | null>(null);
  const [trimTip, setTrimTip] = useState<string | null>(null);

  const colorKey = clip.brollMode !== null ? 'broll' : clip.kind;
  const colors = KIND_COLORS[colorKey] ?? KIND_COLORS.video!;

  const dispStart = ghost?.start ?? clip.start;
  const dispDur = ghost?.duration ?? clip.duration;
  const left = dispStart * zoom;
  const width = Math.max(4, dispDur * zoom);

  function onPointerDown(e: React.PointerEvent, mode: DragState['mode']) {
    if (track.locked) return;
    e.stopPropagation();
    if (mode === 'move') select([clip.id], e.shiftKey);
    const st = useEditorStore.getState();
    const seq = st.sequence!;
    const targets = st.snapEnabled ? snapTargets(seq, st.playhead, new Set([clip.id])) : [];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origStart: clip.start,
      origDuration: clip.duration,
      targets,
      moved: false,
      trackId: track.id,
      hoverTrackId: null,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startClientX) / zoom;
    if (Math.abs(e.clientX - d.startClientX) > 3) d.moved = true;
    if (!d.moved) return;
    const threshold = 8 / zoom;

    if (d.mode === 'move') {
      let nStart = Math.max(0, d.origStart + dx);
      let snappedAt: number | null = null;
      if (d.targets.length) {
        const s1 = snapTime(nStart, d.targets, threshold);
        const s2 = snapTime(nStart + d.origDuration, d.targets, threshold);
        if (s1.snapped) {
          nStart = s1.time;
          snappedAt = s1.time;
        } else if (s2.snapped) {
          nStart = s2.time - d.origDuration;
          snappedAt = s2.time;
        }
      }
      // vertical: detect lane under pointer of same kind
      const lane = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find((el) => el instanceof HTMLElement && el.dataset.laneTrackId) as HTMLElement | undefined;
      d.hoverTrackId = lane?.dataset.laneTrackId ?? null;
      setGhost({ start: nStart, duration: d.origDuration, snapped: snappedAt });
      useEditorStore.setState({ snapGuide: snappedAt } as any);
    } else if (d.mode === 'trim-r') {
      let nEnd = d.origStart + Math.max(0.05, d.origDuration + dx);
      let snappedAt: number | null = null;
      if (d.targets.length) {
        const s = snapTime(nEnd, d.targets, threshold);
        if (s.snapped) {
          nEnd = s.time;
          snappedAt = s.time;
        }
      }
      const nDur = Math.max(0.05, nEnd - d.origStart);
      setGhost({ start: d.origStart, duration: nDur, snapped: snappedAt });
      setTrimTip(timecode(nDur));
    } else {
      let nStart = Math.min(d.origStart + d.origDuration - 0.05, Math.max(0, d.origStart + dx));
      let snappedAt: number | null = null;
      if (d.targets.length) {
        const s = snapTime(nStart, d.targets, threshold);
        if (s.snapped) {
          nStart = Math.min(d.origStart + d.origDuration - 0.05, s.time);
          snappedAt = s.time;
        }
      }
      const nDur = d.origStart + d.origDuration - nStart;
      setGhost({ start: nStart, duration: nDur, snapped: snappedAt });
      setTrimTip(timecode(nDur));
    }
  }

  function onPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    useEditorStore.setState({ snapGuide: null } as any);
    setTrimTip(null);
    if (!d || !d.moved) {
      setGhost(null);
      return;
    }
    const g = ghost;
    setGhost(null);
    if (!g) return;
    if (d.mode === 'move') {
      const st = useEditorStore.getState();
      const seq = st.sequence!;
      let targetTrackId: string | undefined;
      if (d.hoverTrackId && d.hoverTrackId !== d.trackId) {
        const target = seq.tracks.find((t) => t.id === d.hoverTrackId);
        const from = seq.tracks.find((t) => t.id === d.trackId);
        if (target && from && target.kind === from.kind && !target.locked) targetTrackId = target.id;
      }
      apply({ type: 'MOVE_CLIP', clipId: clip.id, start: g.start, trackId: targetTrackId }, `Move ${clip.name || clip.kind}`);
    } else {
      apply({ type: 'TRIM_CLIP', clipId: clip.id, start: g.start, duration: g.duration }, 'Trim clip');
    }
  }

  const label = clip.kind === 'text' || clip.kind === 'caption' ? (clip.text ?? clip.name) : clip.name || asset?.name || clip.kind;

  return (
    <div
      className="absolute rounded overflow-hidden cursor-grab active:cursor-grabbing group"
      style={{
        left,
        width,
        top: 3,
        height: laneHeight - 6,
        backgroundColor: colors.bg,
        border: `1px solid ${selected ? colors.selBorder : colors.border}`,
        boxShadow: selected ? `0 0 0 1px ${colors.selBorder}` : undefined,
        opacity: track.locked ? 0.5 : 1,
        zIndex: ghost ? 20 : 1,
      }}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={`${label}\n${timecode(clip.start)} – ${timecode(clip.start + clip.duration)}`}
    >
      {/* thumbnail bg for video */}
      {clip.kind === 'video' && asset?.thumbnailUrl && (
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: `url(${asset.thumbnailUrl})`,
            backgroundSize: 'auto 100%',
            backgroundRepeat: 'repeat-x',
          }}
        />
      )}
      {/* waveform for audio */}
      {clip.kind === 'audio' && asset?.waveformUrl && width > 10 && (
        <div className="absolute inset-0">
          <Waveform url={asset.waveformUrl} sourceIn={clip.sourceIn} duration={dispDur} speed={clip.speed} width={width} height={laneHeight - 8} />
        </div>
      )}
      <div className="relative px-1.5 py-0.5 text-[10px] font-medium text-white/90 truncate pointer-events-none">
        {clip.speed !== 1 && <span className="mr-1 opacity-80">{clip.speed}x</span>}
        {label}
      </div>

      {/* transition badges */}
      {clip.transitionIn && <div className="absolute left-0 top-0 bottom-0 w-2 bg-white/20 pointer-events-none" title={clip.transitionIn.kind} />}
      {clip.transitionOut && <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/20 pointer-events-none" title={clip.transitionOut.kind} />}

      {/* trim handles */}
      {!track.locked && width > 16 && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/30"
            onPointerDown={(e) => onPointerDown(e, 'trim-l')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/30"
            onPointerDown={(e) => onPointerDown(e, 'trim-r')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </>
      )}

      {trimTip && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-bg-4 border border-line rounded px-1.5 py-0.5 text-[10px] tabular-nums whitespace-nowrap z-30">
          {trimTip}
        </div>
      )}
    </div>
  );
});
