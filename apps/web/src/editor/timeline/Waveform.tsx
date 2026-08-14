import { useEffect, useRef } from 'react';

interface WaveformData {
  peaks: number[];
  samplesPerSecond: number;
}

const cache = new Map<string, Promise<WaveformData | null>>();

export function fetchWaveform(url: string): Promise<WaveformData | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

/** Canvas waveform for an audio clip segment. */
export default function Waveform({
  url,
  sourceIn,
  duration,
  speed,
  width,
  height,
  color = '#4ade80',
}: {
  url: string;
  sourceIn: number;
  duration: number;
  speed: number;
  width: number;
  height: number;
  color?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    fetchWaveform(url).then((data) => {
      if (!alive || !data || !ref.current) return;
      const canvas = ref.current;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = color;
      const sps = data.samplesPerSecond || 10;
      const startIdx = Math.floor(sourceIn * sps);
      const total = Math.max(1, Math.floor(duration * speed * sps));
      const bars = Math.max(1, Math.floor(width / 2));
      for (let i = 0; i < bars; i++) {
        const idx = startIdx + Math.floor((i / bars) * total);
        const peak = data.peaks[idx] ?? 0;
        const h = Math.max(1, peak * height * 0.9);
        ctx.fillRect(i * 2, (height - h) / 2, 1.2, h);
      }
    });
    return () => {
      alive = false;
    };
  }, [url, sourceIn, duration, speed, width, height, color]);

  return <canvas ref={ref} style={{ width, height, display: 'block' }} className="pointer-events-none opacity-70" />;
}
