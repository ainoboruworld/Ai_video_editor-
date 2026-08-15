import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { RemotionClip, RemotionProps } from './types';

/**
 * Frame-accurate render of a project document.
 *
 * The browser exporter records the canvas compositor in real time; this
 * composition reproduces the same model with Remotion primitives so a cloud
 * render is deterministic and can run faster (or slower) than real time.
 */

interface CaptionPreset {
  fontSize: number;
  fontWeight: number;
  color: string;
  stroke: string | null;
  background: string | null;
  uppercase: boolean;
  y: number;
}

const DEFAULT_CAPTION: CaptionPreset = {
  fontSize: 62,
  fontWeight: 800,
  color: '#fff',
  stroke: '#000',
  background: null,
  uppercase: true,
  y: 0.8,
};

const CAPTION_PRESETS: Record<string, CaptionPreset> = {
  minimal: { fontSize: 46, fontWeight: 600, color: '#fff', stroke: null, background: 'rgba(0,0,0,0.55)', uppercase: false, y: 0.86 },
  bold: { fontSize: 62, fontWeight: 800, color: '#fff', stroke: '#000', background: null, uppercase: true, y: 0.8 },
  creator: { fontSize: 58, fontWeight: 800, color: '#fff', stroke: '#000', background: null, uppercase: true, y: 0.74 },
  karaoke: { fontSize: 58, fontWeight: 800, color: '#fff', stroke: '#000', background: null, uppercase: true, y: 0.78 },
  dynamic: { fontSize: 66, fontWeight: 900, color: '#fff', stroke: '#000', background: null, uppercase: true, y: 0.7 },
};

function filterCss(clip: RemotionClip): string {
  const f = clip.filters;
  const parts: string[] = [];
  if (f.brightness !== 0) parts.push(`brightness(${1 + f.brightness})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.saturation !== 1) parts.push(`saturate(${f.saturation})`);
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);
  if (f.grayscale) parts.push('grayscale(1)');
  if (f.temperature > 0) parts.push(`sepia(${f.temperature * 0.45})`);
  if (f.temperature < 0) parts.push(`hue-rotate(${f.temperature * 24}deg)`);
  return parts.join(' ');
}

function useClipOpacity(clip: RemotionClip, fps: number): number {
  const frame = useCurrentFrame();
  const local = frame / fps;
  let opacity = clip.transform.opacity;
  if (clip.transitionIn && clip.transitionIn.duration > 0) {
    opacity *= interpolate(local, [0, clip.transitionIn.duration], [0, 1], { extrapolateRight: 'clamp' });
  }
  if (clip.transitionOut && clip.transitionOut.duration > 0) {
    opacity *= interpolate(
      local,
      [clip.duration - clip.transitionOut.duration, clip.duration],
      [1, 0],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );
  }
  return Math.max(0, Math.min(1, opacity));
}

const VisualClip: React.FC<{ clip: RemotionClip; url: string | null }> = ({ clip, url }) => {
  const { fps } = useVideoConfig();
  const opacity = useClipOpacity(clip, fps);
  const t = clip.transform;
  const pip = clip.brollMode === 'pip';

  const inset = clip.crop
    ? `inset(${clip.crop.top * 100}% ${clip.crop.right * 100}% ${clip.crop.bottom * 100}% ${clip.crop.left * 100}%)`
    : undefined;

  const style: React.CSSProperties = {
    opacity,
    filter: filterCss(clip) || undefined,
    transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale}) rotate(${t.rotation}deg)`,
    clipPath: inset,
  };

  const mediaStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    // Cover-fit: fill the frame without ever stretching the picture.
    objectFit: 'cover',
  };

  const wrapper: React.CSSProperties = pip
    ? {
        position: 'absolute',
        width: '36%',
        height: '36%',
        right: '4%',
        bottom: '6%',
        borderRadius: 24,
        overflow: 'hidden',
        ...style,
      }
    : style;

  if (!url) return null;

  return (
    <AbsoluteFill style={wrapper}>
      {clip.kind === 'image' ? (
        <Img src={url} style={mediaStyle} />
      ) : (
        <OffthreadVideo
          src={url}
          startFrom={Math.round(clip.sourceIn * fps)}
          playbackRate={clip.speed}
          volume={clip.muted ? 0 : clip.volume}
          style={mediaStyle}
        />
      )}
      {clip.filters.vignette ? (
        <AbsoluteFill
          style={{ background: 'radial-gradient(circle at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%)' }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const TextClip: React.FC<{ clip: RemotionClip }> = ({ clip }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const local = frame / fps;
  const style = clip.textStyle;
  if (!style || !clip.text) return null;

  const animation = clip.textAnimation ?? 'none';
  const progress =
    animation === 'none'
      ? 1
      : interpolate(local, [0, Math.min(0.45, clip.duration / 3)], [0, 1], { extrapolateRight: 'clamp' });

  const translateY = animation === 'slide' ? (1 - progress) * 60 : 0;
  const scale =
    animation === 'pop' ? 0.8 + progress * 0.2 : animation === 'scale' ? 0.85 + progress * 0.15 : 1;

  // Typewriter / word-reveal are text reveals rather than container animations.
  const revealed =
    animation === 'typewriter'
      ? (clip.text ?? '').slice(
          0,
          Math.ceil((clip.text ?? '').length * Math.min(1, local / Math.max(0.3, clip.duration * 0.6))),
        )
      : animation === 'word-reveal'
        ? (clip.text ?? '')
            .split(/\s+/)
            .slice(
              0,
              Math.max(
                1,
                Math.ceil(
                  (clip.text ?? '').split(/\s+/).length * Math.min(1, local / Math.max(0.3, clip.duration * 0.7)),
                ),
              ),
            )
            .join(' ')
        : clip.text;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        opacity: animation === 'typewriter' || animation === 'word-reveal' ? 1 : progress,
        transform: `translate(${clip.transform.x}px, ${clip.transform.y + translateY}px) scale(${clip.transform.scale * scale})`,
      }}
    >
      <div
        style={{
          maxWidth: '84%',
          textAlign: style.align,
          fontFamily: `${style.fontFamily}, Inter, system-ui, sans-serif`,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          color: style.color,
          background: style.backgroundColor ?? undefined,
          padding: style.backgroundColor ? `${style.fontSize * 0.28}px ${style.fontSize * 0.4}px` : undefined,
          borderRadius: style.backgroundColor ? style.fontSize * 0.18 : undefined,
          textShadow: style.shadow ? `0 ${style.fontSize * 0.05}px ${style.fontSize * 0.22}px rgba(0,0,0,0.55)` : undefined,
          WebkitTextStroke: style.strokeColor && style.strokeWidth > 0 ? `${style.strokeWidth}px ${style.strokeColor}` : undefined,
          lineHeight: 1.18,
          whiteSpace: 'pre-wrap',
        }}
      >
        {revealed}
      </div>
    </AbsoluteFill>
  );
};

const CaptionClip: React.FC<{ clip: RemotionClip }> = ({ clip }) => {
  const { height } = useVideoConfig();
  const preset = CAPTION_PRESETS[clip.captionStyle ?? 'bold'] ?? DEFAULT_CAPTION;
  if (!clip.text) return null;
  const fontSize = Math.round(preset.fontSize * Math.max(0.55, (height / 1920) * 1.35));
  const text = preset.uppercase ? clip.text.toUpperCase() : clip.text;

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center' }}>
      <div
        style={{
          position: 'absolute',
          top: `${preset.y * 100}%`,
          transform: `translateY(-50%) translateY(${clip.transform.y}px)`,
          maxWidth: '86%',
          textAlign: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize,
          fontWeight: preset.fontWeight,
          color: preset.color,
          background: preset.background ?? undefined,
          padding: preset.background ? `${fontSize * 0.24}px ${fontSize * 0.35}px` : undefined,
          borderRadius: preset.background ? fontSize * 0.22 : undefined,
          WebkitTextStroke: preset.stroke ? `${Math.max(4, fontSize * 0.08)}px ${preset.stroke}` : undefined,
          paintOrder: 'stroke fill',
          lineHeight: 1.16,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const ProjectComposition: React.FC<RemotionProps> = ({ project }) => {
  const { fps } = useVideoConfig();
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const anySolo = project.sequence.tracks.some((track) => track.solo);

  const visualTracks = project.sequence.tracks.filter((track) => track.kind !== 'audio');
  const audioTracks = project.sequence.tracks.filter((track) => track.kind === 'audio');

  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      {visualTracks.map((track) =>
        track.visible
          ? track.clips.map((clip) => (
              <Sequence
                key={clip.id}
                from={Math.round(clip.start * fps)}
                durationInFrames={Math.max(1, Math.round(clip.duration * fps))}
                layout="none"
              >
                {clip.kind === 'text' ? (
                  <TextClip clip={clip} />
                ) : clip.kind === 'caption' ? (
                  <CaptionClip clip={clip} />
                ) : (
                  <VisualClip clip={clip} url={clip.assetId ? assets.get(clip.assetId)?.url ?? null : null} />
                )}
              </Sequence>
            ))
          : null,
      )}

      {audioTracks.map((track) => {
        const audible = anySolo ? track.solo : !track.muted;
        if (!audible) return null;
        return track.clips.map((clip) => {
          const url = clip.assetId ? assets.get(clip.assetId)?.url : null;
          if (!url) return null;
          return (
            <Sequence
              key={clip.id}
              from={Math.round(clip.start * fps)}
              durationInFrames={Math.max(1, Math.round(clip.duration * fps))}
              layout="none"
            >
              <Audio
                src={url}
                startFrom={Math.round(clip.sourceIn * fps)}
                volume={(frame) => {
                  if (clip.muted) return 0;
                  const local = frame / fps;
                  let volume = clip.volume;
                  if (clip.fadeIn > 0) volume *= Math.min(1, local / clip.fadeIn);
                  if (clip.fadeOut > 0) volume *= Math.min(1, Math.max(0, clip.duration - local) / clip.fadeOut);
                  return Math.max(0, Math.min(1, volume));
                }}
              />
            </Sequence>
          );
        });
      })}
    </AbsoluteFill>
  );
};
