import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Maximize2 } from 'lucide-react';
import {
  interpolate,
  sequenceDuration,
  type Clip,
  type Sequence,
  type Track,
} from '@ave/editor-core';
import { useEditorStore, findClip } from '../state/editorStore';
import { timecodeLong } from '../lib/format';
import { IconButton, Select } from '../components/ui';

export default function PreviewPanel() {
  const sequence = useEditorStore((s) => s.sequence);
  const playing = useEditorStore((s) => s.playing);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const [rate, setRate] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 640, h: 360 });

  const fps = sequence?.fps ?? 30;

  // Fit stage into container
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !sequence) return;
    const ro = new ResizeObserver(() => {
      const pad = 24;
      const cw = el.clientWidth - pad;
      const ch = el.clientHeight - pad;
      const ar = sequence.width / sequence.height;
      let w = cw;
      let h = w / ar;
      if (h > ch) {
        h = ch;
        w = h * ar;
      }
      setStageSize({ w: Math.max(80, w), h: Math.max(80, h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sequence?.width, sequence?.height, sequence]);

  // Playback clock for gaps / non-video-driven time
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * rate;
      last = now;
      const st = useEditorStore.getState();
      const seq = st.sequence;
      if (!seq) return;
      const dur = sequenceDuration(seq);
      let next = st.playhead + dt;
      if (next >= dur) {
        next = dur;
        st.setPlaying(false);
      }
      st.setPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate]);

  if (!sequence) return <div className="h-full bg-bg-0" />;

  const scale = stageSize.w / sequence.width;

  return (
    <div className="h-full flex flex-col bg-bg-0 min-h-0">
      <div ref={containerRef} className="flex-1 min-h-0 flex items-center justify-center relative">
        <div
          ref={stageRef}
          className="relative bg-black overflow-hidden shadow-2xl"
          style={{ width: stageSize.w, height: stageSize.h }}
        >
          <StageContent sequence={sequence} scale={scale} playing={playing} rate={rate} />
        </div>
      </div>

      <div className="h-9 shrink-0 border-t border-line bg-bg-2 flex items-center px-2 gap-1">
        <IconButton onClick={() => useEditorStore.getState().setPlayhead(useEditorStore.getState().playhead - 1 / fps)} title="Previous frame (←)">
          <SkipBack size={13} />
        </IconButton>
        <IconButton onClick={() => setPlaying(!playing)} title="Play/pause (Space)">
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </IconButton>
        <IconButton onClick={() => useEditorStore.getState().setPlayhead(useEditorStore.getState().playhead + 1 / fps)} title="Next frame (→)">
          <SkipForward size={13} />
        </IconButton>
        <Timecode fps={fps} />
        <div className="flex-1" />
        <Select value={rate} onChange={(e) => setRate(Number(e.target.value))} title="Playback rate" className="w-[60px] h-6 text-xs">
          {[0.25, 0.5, 1, 1.5, 2, 4].map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </Select>
        <IconButton
          title="Fullscreen"
          onClick={() => {
            stageRef.current?.requestFullscreen?.();
          }}
        >
          <Maximize2 size={13} />
        </IconButton>
      </div>
    </div>
  );
}

function Timecode({ fps }: { fps: number }) {
  const playhead = useEditorStore((s) => s.playhead);
  return <span className="ml-2 text-xs tabular-nums text-ink-2">{timecodeLong(playhead, fps)}</span>;
}

// ---------- Stage composition ----------

function isTrackAudible(track: Track, seq: Sequence): boolean {
  const anySolo = seq.tracks.some((t) => t.solo);
  if (anySolo) return track.solo;
  return !track.muted;
}

function StageContent({
  sequence,
  scale,
  playing,
  rate,
}: {
  sequence: Sequence;
  scale: number;
  playing: boolean;
  rate: number;
}) {
  const playhead = useEditorStore((s) => s.playhead);
  const selection = useEditorStore((s) => s.selection);

  // Collect active clips; render video tracks bottom-up so later (overlay) tracks stack above.
  const layers = useMemo(() => {
    const out: { track: Track; clip: Clip; z: number }[] = [];
    const videoTracks = sequence.tracks.filter((t) => t.kind === 'video');
    // First video track = main; render in reverse order so track[0] is bottom? Premiere: higher tracks on top.
    // Our makeSequence: v1 main, v2 b-roll overlay → v2 should render above v1.
    videoTracks.forEach((track, i) => {
      if (!track.visible) return;
      for (const clip of track.clips) {
        if (playhead >= clip.start && playhead < clip.start + clip.duration) {
          out.push({ track, clip, z: 10 + i });
        }
      }
    });
    for (const track of sequence.tracks.filter((t) => t.kind === 'text')) {
      if (!track.visible) continue;
      for (const clip of track.clips) {
        if (playhead >= clip.start && playhead < clip.start + clip.duration) out.push({ track, clip, z: 40 });
      }
    }
    for (const track of sequence.tracks.filter((t) => t.kind === 'caption')) {
      if (!track.visible) continue;
      for (const clip of track.clips) {
        if (playhead >= clip.start && playhead < clip.start + clip.duration) out.push({ track, clip, z: 50 });
      }
    }
    return out;
  }, [sequence, playhead]);

  // Audio clips (audio tracks + muted flags)
  const audioClips = useMemo(() => {
    const out: { clip: Clip; track: Track }[] = [];
    for (const track of sequence.tracks.filter((t) => t.kind === 'audio')) {
      if (!isTrackAudible(track, sequence)) continue;
      for (const clip of track.clips) {
        if (playhead >= clip.start && playhead < clip.start + clip.duration) out.push({ clip, track });
      }
    }
    return out;
  }, [sequence, playhead]);

  const mainVideoLayer = layers.find((l) => l.track.kind === 'video' && l.clip.kind === 'video' && l.z === 10);

  return (
    <>
      {layers.map(({ track, clip, z }) => (
        <ClipLayer
          key={clip.id}
          clip={clip}
          track={track}
          sequence={sequence}
          scale={scale}
          z={z}
          playing={playing}
          rate={rate}
          isMainDriver={mainVideoLayer?.clip.id === clip.id}
          selected={selection.includes(clip.id)}
          playhead={playhead}
        />
      ))}
      {audioClips.map(({ clip, track }) => (
        <AudioClipPlayer key={clip.id} clip={clip} playing={playing} rate={rate} playhead={playhead} trackMuted={!isTrackAudible(track, sequence)} />
      ))}
      {layers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-3 text-xs">
          No clip at playhead
        </div>
      )}
    </>
  );
}

function filtersToCss(clip: Clip): string {
  const f = clip.filters;
  const parts: string[] = [];
  if (f.brightness !== 0) parts.push(`brightness(${1 + f.brightness})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.saturation !== 1) parts.push(`saturate(${f.saturation})`);
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);
  if (f.grayscale) parts.push('grayscale(1)');
  if (f.temperature !== 0) parts.push(`sepia(${Math.abs(f.temperature) * 0.4})`);
  return parts.join(' ');
}

const ClipLayer = React.memo(function ClipLayer({
  clip,
  track,
  sequence,
  scale,
  z,
  playing,
  rate,
  isMainDriver,
  selected,
  playhead,
}: {
  clip: Clip;
  track: Track;
  sequence: Sequence;
  scale: number;
  z: number;
  playing: boolean;
  rate: number;
  isMainDriver: boolean;
  selected: boolean;
  playhead: number;
}) {
  const localT = playhead - clip.start;
  const t = clip.transform;
  const x = interpolate(clip.keyframes.x, localT, t.x);
  const y = interpolate(clip.keyframes.y, localT, t.y);
  const sc = interpolate(clip.keyframes.scale, localT, t.scale);
  const rot = interpolate(clip.keyframes.rotation, localT, t.rotation);
  let opacity = interpolate(clip.keyframes.opacity, localT, t.opacity);

  // transitions approximated with opacity
  if (clip.transitionIn && localT < clip.transitionIn.duration) {
    opacity *= localT / clip.transitionIn.duration;
  }
  if (clip.transitionOut && clip.duration - localT < clip.transitionOut.duration) {
    opacity *= (clip.duration - localT) / clip.transitionOut.duration;
  }

  const style: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    zIndex: z,
    transform: `translate(-50%, -50%) translate(${x * scale}px, ${y * scale}px) scale(${sc}) rotate(${rot}deg)`,
    opacity,
    filter: filtersToCss(clip) || undefined,
  };

  const stageW = sequence.width * scale;
  const stageH = sequence.height * scale;

  let inner: React.ReactNode = null;
  if (clip.kind === 'video' && clip.assetId) {
    inner = (
      <VideoElement
        clip={clip}
        playing={playing && track.visible}
        rate={rate}
        playhead={playhead}
        muted={!isMainDriver || clip.muted || !isTrackAudible(track, sequence)}
        width={stageW}
        height={stageH}
      />
    );
  } else if (clip.kind === 'image' && clip.assetId) {
    inner = <ImageElement assetId={clip.assetId} width={stageW} height={stageH} />;
  } else if (clip.kind === 'text') {
    inner = <TextElement clip={clip} sequence={sequence} stageH={stageH} />;
  } else if (clip.kind === 'caption') {
    return (
      <div style={{ position: 'absolute', inset: 0, zIndex: z, opacity, pointerEvents: 'none' }}>
        <CaptionElement clip={clip} localT={localT} stageH={stageH} />
      </div>
    );
  }

  return (
    <div style={style}>
      {inner}
      {selected && <SelectionBox clip={clip} scale={scale} />}
    </div>
  );
});

function useAsset(assetId: string | null) {
  const assets = useEditorStore((s) => s.assets);
  return assetId ? (assets.find((a) => a.id === assetId) ?? null) : null;
}

function VideoElement({
  clip,
  playing,
  rate,
  playhead,
  muted,
  width,
  height,
}: {
  clip: Clip;
  playing: boolean;
  rate: number;
  playhead: number;
  muted: boolean;
  width: number;
  height: number;
}) {
  const asset = useAsset(clip.assetId);
  const ref = useRef<HTMLVideoElement>(null);
  const src = asset ? (asset.proxyUrl ?? asset.originalUrl) : null;

  const targetTime = clip.sourceIn + (playhead - clip.start) * clip.speed;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) {
      v.playbackRate = Math.min(16, Math.max(0.0625, clip.speed * rate));
      if (Math.abs(v.currentTime - targetTime) > 0.35) v.currentTime = targetTime;
      v.play().catch(() => {});
    } else {
      v.pause();
      if (Math.abs(v.currentTime - targetTime) > 1 / 60) v.currentTime = targetTime;
    }
  }, [playing, rate, clip.speed, playing ? Math.floor(targetTime) : targetTime]);

  if (!asset || !src) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center bg-bg-3 text-ink-3 text-xs">
        {asset?.status === 'processing' ? 'Processing…' : 'Missing media'}
      </div>
    );
  }

  return (
    <video
      ref={ref}
      src={src}
      muted={muted}
      playsInline
      preload="auto"
      style={{ width, height, objectFit: 'contain', display: 'block' }}
      onError={() => {}}
    />
  );
}

function ImageElement({ assetId, width, height }: { assetId: string; width: number; height: number }) {
  const asset = useAsset(assetId);
  if (!asset) return null;
  return <img src={asset.originalUrl} alt="" style={{ width, height, objectFit: 'contain' }} draggable={false} />;
}

function TextElement({ clip, sequence, stageH }: { clip: Clip; sequence: Sequence; stageH: number }) {
  const st = clip.textStyle;
  if (!st) return <span>{clip.text}</span>;
  const px = (st.fontSize / sequence.height) * stageH;
  return (
    <div
      style={{
        fontFamily: st.fontFamily,
        fontSize: px,
        fontWeight: st.fontWeight,
        color: st.color,
        backgroundColor: st.backgroundColor ?? undefined,
        textAlign: st.align,
        padding: st.backgroundColor ? `${px * 0.15}px ${px * 0.35}px` : undefined,
        borderRadius: st.backgroundColor ? 4 : undefined,
        textShadow: st.shadow ? '0 2px 8px rgba(0,0,0,0.6)' : undefined,
        WebkitTextStroke: st.strokeColor && st.strokeWidth ? `${st.strokeWidth}px ${st.strokeColor}` : undefined,
        whiteSpace: 'pre-wrap',
        maxWidth: '80vw',
      }}
    >
      {clip.text}
    </div>
  );
}

function CaptionElement({ clip, localT, stageH }: { clip: Clip; localT: number; stageH: number }) {
  const style = clip.captionStyle ?? 'bold';
  const base = stageH * 0.045;
  const words = clip.captionWords;

  const common: React.CSSProperties = {
    position: 'absolute',
    left: '10%',
    right: '10%',
    bottom: '10%',
    textAlign: 'center',
    fontSize: base,
    lineHeight: 1.3,
    fontFamily: 'Inter',
  };

  if ((style === 'karaoke' || style === 'dynamic') && words && words.length > 0) {
    return (
      <div style={{ ...common, fontWeight: 800, textShadow: '0 2px 6px rgba(0,0,0,0.8)' }}>
        {words.map((w, i) => {
          const active = localT >= w.start && localT < w.end;
          const past = localT >= w.end;
          const color =
            style === 'karaoke'
              ? active || past
                ? '#7c7ff5'
                : '#ffffff'
              : active
                ? '#f5c76e'
                : '#ffffff';
          return (
            <span
              key={i}
              style={{
                color,
                display: 'inline-block',
                marginRight: base * 0.25,
                transform: style === 'dynamic' && active ? 'scale(1.15)' : undefined,
                transition: 'transform 0.08s',
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    );
  }

  const variants: Record<string, React.CSSProperties> = {
    minimal: { color: '#fff', fontWeight: 400, textShadow: '0 1px 4px rgba(0,0,0,0.8)' },
    bold: { color: '#fff', fontWeight: 800, textTransform: 'uppercase', textShadow: '0 2px 6px rgba(0,0,0,0.9)' },
    creator: { color: '#fff', fontWeight: 700 },
    karaoke: { color: '#fff', fontWeight: 800 },
    dynamic: { color: '#fff', fontWeight: 800 },
  };

  if (style === 'creator') {
    return (
      <div style={common}>
        <span
          style={{
            ...variants.creator,
            backgroundColor: 'rgba(0,0,0,0.75)',
            padding: `${base * 0.15}px ${base * 0.4}px`,
            borderRadius: 6,
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
          }}
        >
          {clip.text}
        </span>
      </div>
    );
  }

  return <div style={{ ...common, ...variants[style] }}>{clip.text}</div>;
}

function AudioClipPlayer({
  clip,
  playing,
  rate,
  playhead,
  trackMuted,
}: {
  clip: Clip;
  playing: boolean;
  rate: number;
  playhead: number;
  trackMuted: boolean;
}) {
  const asset = useAsset(clip.assetId);
  const ref = useRef<HTMLAudioElement>(null);
  const targetTime = clip.sourceIn + (playhead - clip.start) * clip.speed;

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.volume = Math.min(1, clip.muted || trackMuted ? 0 : clip.volume);
    if (playing) {
      a.playbackRate = Math.min(16, Math.max(0.0625, clip.speed * rate));
      if (Math.abs(a.currentTime - targetTime) > 0.35) a.currentTime = targetTime;
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  }, [playing, rate, clip.speed, clip.volume, clip.muted, trackMuted, playing ? Math.floor(targetTime) : targetTime]);

  if (!asset) return null;
  return <audio ref={ref} src={asset.originalUrl} preload="auto" />;
}

// ---------- Selection box with drag-to-move + scale handle ----------

function SelectionBox({ clip, scale }: { clip: Clip; scale: number }) {
  const apply = useEditorStore((s) => s.apply);
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number; mode: 'move' | 'scale'; oScale: number } | null>(null);

  function onPointerDown(e: React.PointerEvent, mode: 'move' | 'scale') {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      ox: clip.transform.x,
      oy: clip.transform.y,
      oScale: clip.transform.scale,
      mode,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    if (d.mode === 'move') {
      apply({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { x: d.ox + dx, y: d.oy + dy } }, 'Move layer');
    } else {
      const ns = Math.max(0.05, d.oScale + dx / 400);
      apply({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { scale: ns } }, 'Scale layer');
    }
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  return (
    <div
      className="absolute inset-0 border border-accent cursor-move"
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-accent rounded-sm cursor-nwse-resize"
        onPointerDown={(e) => onPointerDown(e, 'scale')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Drag to scale"
      />
    </div>
  );
}
