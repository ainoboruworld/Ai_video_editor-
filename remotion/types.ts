/**
 * The render worker consumes the exact same project document the editor saves.
 * These are structural mirrors of `src/types` and `src/lib/engine` so the
 * Remotion bundle stays independent of the Next app's path aliases.
 */
export interface RemotionProps {
  project: {
    name: string;
    width: number;
    height: number;
    fps: number;
    sequence: {
      width: number;
      height: number;
      fps: number;
      tracks: {
        id: string;
        kind: 'video' | 'audio' | 'text' | 'caption';
        role?: string;
        visible: boolean;
        muted: boolean;
        solo: boolean;
        clips: RemotionClip[];
      }[];
    };
    assets: { id: string; kind: string; url: string }[];
  };
}

export interface RemotionClip {
  id: string;
  kind: 'video' | 'audio' | 'image' | 'text' | 'caption';
  assetId: string | null;
  start: number;
  duration: number;
  sourceIn: number;
  speed: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  transform: { x: number; y: number; scale: number; rotation: number; opacity: number };
  crop: { left: number; right: number; top: number; bottom: number } | null;
  filters: {
    brightness: number;
    contrast: number;
    saturation: number;
    temperature: number;
    blur: number;
    grayscale: boolean;
    vignette: boolean;
  };
  transitionIn: { kind: string; duration: number } | null;
  transitionOut: { kind: string; duration: number } | null;
  text: string | null;
  textStyle: {
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    color: string;
    backgroundColor: string | null;
    align: 'left' | 'center' | 'right';
    strokeColor: string | null;
    strokeWidth: number;
    shadow: boolean;
  } | null;
  textAnimation: 'none' | 'fade' | 'slide' | 'pop' | 'scale' | 'typewriter' | 'word-reveal';
  captionStyle: string | null;
  captionWords: { text: string; start: number; end: number }[] | null;
  brollMode: string | null;
}
