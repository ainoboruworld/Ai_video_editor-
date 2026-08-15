'use client';

import { useEffect, useMemo, useRef } from 'react';
import { PlaybackEngine } from '@/features/timeline/playback';
import { useEditorStore } from '@/state/editorStore';

/**
 * Binds the playback engine to the store: the store owns "what the project is",
 * the engine owns "what is on screen right now".
 */
export function usePlaybackEngine(): { engine: PlaybackEngine | null; attach: (canvas: HTMLCanvasElement | null) => void } {
  const engineRef = useRef<PlaybackEngine | null>(null);
  const seekingFromEngine = useRef(false);

  const engine = useMemo(() => {
    if (typeof window === 'undefined') return null;
    if (!engineRef.current) {
      engineRef.current = new PlaybackEngine({
        onTimeUpdate: (time) => {
          seekingFromEngine.current = true;
          useEditorStore.getState().setPlayhead(time);
          seekingFromEngine.current = false;
        },
        onEnded: () => useEditorStore.getState().setPlaying(false),
      });
    }
    return engineRef.current;
  }, []);

  // Keep the engine's document in sync.
  const sequence = useEditorStore((state) => state.sequence);
  const assets = useEditorStore((state) => state.assets);
  useEffect(() => {
    if (engine && sequence) engine.update(sequence, assets);
  }, [engine, sequence, assets]);

  // Play/pause.
  const playing = useEditorStore((state) => state.playing);
  useEffect(() => {
    if (!engine) return;
    if (playing) engine.play();
    else engine.pause();
  }, [engine, playing]);

  // Scrubbing from the timeline seeks the engine (but engine ticks must not
  // bounce back and cause a seek loop).
  const playhead = useEditorStore((state) => state.playhead);
  useEffect(() => {
    if (!engine || seekingFromEngine.current) return;
    if (Math.abs(engine.currentTime - playhead) > 0.02) engine.seek(playhead);
  }, [engine, playhead]);

  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  return {
    engine,
    attach: (canvas: HTMLCanvasElement | null) => engine?.attach(canvas),
  };
}
