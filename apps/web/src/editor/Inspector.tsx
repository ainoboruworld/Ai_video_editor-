import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { CaptionStyleName, Clip, TextAnimation } from '@ave/editor-core';
import { useEditorStore, findClip } from '../state/editorStore';
import { Slider, Select, Input, Section, EmptyState } from '../components/ui';

export default function Inspector() {
  const sequence = useEditorStore((s) => s.sequence);
  const selection = useEditorStore((s) => s.selection);
  const clipId = selection[0] ?? null;
  const found = sequence && clipId ? findClip(sequence, clipId) : null;

  return (
    <div className="h-full bg-bg-2 border-l border-line flex flex-col min-h-0">
      <div className="h-8 shrink-0 flex items-center px-3 border-b border-line text-sm font-semibold">
        Inspector
      </div>
      <div className="flex-1 overflow-y-auto">
        {!found ? (
          <EmptyState
            icon={<SlidersHorizontal size={20} />}
            title="Nothing selected"
            hint="Select a clip in the timeline to edit its properties."
          />
        ) : (
          <ClipInspector clip={found.clip} />
        )}
      </div>
    </div>
  );
}

/** Throttled command applier for slider drags (~100ms). */
function useThrottledApply() {
  const apply = useEditorStore((s) => s.apply);
  const last = useRef(0);
  return (cmd: Parameters<typeof apply>[0], label: string, force = false) => {
    const now = Date.now();
    if (!force && now - last.current < 100) return;
    last.current = now;
    apply(cmd, label);
  };
}

function ClipInspector({ clip }: { clip: Clip }) {
  const apply = useEditorStore((s) => s.apply);
  const throttled = useThrottledApply();
  const kind = clip.kind;

  return (
    <div>
      <div className="px-3 py-2 border-b border-line">
        <div className="text-sm font-medium truncate">{clip.name || clip.text || clip.kind}</div>
        <div className="text-xs text-ink-3 capitalize">{clip.kind} clip</div>
      </div>

      {(kind === 'video' || kind === 'image' || kind === 'text') && (
        <Section title="Transform">
          <Slider label="Position X" value={clip.transform.x} min={-1000} max={1000} step={1} format={(v) => `${Math.round(v)}`} onChange={(v) => throttled({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { x: v } }, 'Position X')} onCommit={(v) => throttled({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { x: v } }, 'Position X', true)} />
          <Slider label="Position Y" value={clip.transform.y} min={-1000} max={1000} step={1} format={(v) => `${Math.round(v)}`} onChange={(v) => throttled({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { y: v } }, 'Position Y')} onCommit={(v) => throttled({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { y: v } }, 'Position Y', true)} />
          <Slider label="Scale" value={clip.transform.scale} min={0.1} max={4} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => throttled({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { scale: v } }, 'Scale')} onCommit={(v) => throttled({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { scale: v } }, 'Scale', true)} />
          <Slider label="Rotation" value={clip.transform.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => throttled({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { rotation: v } }, 'Rotation')} onCommit={(v) => throttled({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { rotation: v } }, 'Rotation', true)} />
          <Slider label="Opacity" value={clip.transform.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => throttled({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { opacity: v } }, 'Opacity')} onCommit={(v) => throttled({ type: 'CHANGE_TRANSFORM', clipId: clip.id, transform: { opacity: v } }, 'Opacity', true)} />
        </Section>
      )}

      {(kind === 'video' || kind === 'audio') && (
        <Section title="Speed">
          <Select
            value={clip.speed}
            onChange={(e) => apply({ type: 'CHANGE_SPEED', clipId: clip.id, speed: Number(e.target.value) }, `Speed ${e.target.value}x`)}
            className="w-full"
          >
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </Select>
        </Section>
      )}

      {(kind === 'video' || kind === 'audio') && (
        <Section title="Audio">
          <Slider label="Volume" value={clip.volume} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => throttled({ type: 'CHANGE_VOLUME', clipId: clip.id, volume: v }, 'Volume')} onCommit={(v) => throttled({ type: 'CHANGE_VOLUME', clipId: clip.id, volume: v }, 'Volume', true)} />
          <label className="flex items-center gap-2 py-1 text-xs text-ink-2">
            <input
              type="checkbox"
              checked={clip.muted}
              onChange={(e) => apply({ type: 'CHANGE_VOLUME', clipId: clip.id, volume: clip.volume, muted: e.target.checked }, e.target.checked ? 'Mute clip' : 'Unmute clip')}
              className="accent-indigo-500"
            />
            Muted
          </label>
          <Slider label="Fade in" value={clip.fadeIn} min={0} max={5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => throttled({ type: 'SET_FADE', clipId: clip.id, fadeIn: v }, 'Fade in')} onCommit={(v) => throttled({ type: 'SET_FADE', clipId: clip.id, fadeIn: v }, 'Fade in', true)} />
          <Slider label="Fade out" value={clip.fadeOut} min={0} max={5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => throttled({ type: 'SET_FADE', clipId: clip.id, fadeOut: v }, 'Fade out')} onCommit={(v) => throttled({ type: 'SET_FADE', clipId: clip.id, fadeOut: v }, 'Fade out', true)} />
        </Section>
      )}

      {(kind === 'video' || kind === 'image') && (
        <Section title="Filters">
          <Slider label="Brightness" value={clip.filters.brightness} min={-1} max={1} step={0.01} onChange={(v) => throttled({ type: 'SET_FILTERS', clipId: clip.id, filters: { brightness: v } }, 'Brightness')} onCommit={(v) => throttled({ type: 'SET_FILTERS', clipId: clip.id, filters: { brightness: v } }, 'Brightness', true)} />
          <Slider label="Contrast" value={clip.filters.contrast} min={0} max={2} step={0.01} onChange={(v) => throttled({ type: 'SET_FILTERS', clipId: clip.id, filters: { contrast: v } }, 'Contrast')} onCommit={(v) => throttled({ type: 'SET_FILTERS', clipId: clip.id, filters: { contrast: v } }, 'Contrast', true)} />
          <Slider label="Saturation" value={clip.filters.saturation} min={0} max={2} step={0.01} onChange={(v) => throttled({ type: 'SET_FILTERS', clipId: clip.id, filters: { saturation: v } }, 'Saturation')} onCommit={(v) => throttled({ type: 'SET_FILTERS', clipId: clip.id, filters: { saturation: v } }, 'Saturation', true)} />
          <Slider label="Blur" value={clip.filters.blur} min={0} max={20} step={0.5} format={(v) => `${v}px`} onChange={(v) => throttled({ type: 'SET_FILTERS', clipId: clip.id, filters: { blur: v } }, 'Blur')} onCommit={(v) => throttled({ type: 'SET_FILTERS', clipId: clip.id, filters: { blur: v } }, 'Blur', true)} />
          <label className="flex items-center gap-2 py-1 text-xs text-ink-2">
            <input type="checkbox" checked={clip.filters.grayscale} onChange={(e) => apply({ type: 'SET_FILTERS', clipId: clip.id, filters: { grayscale: e.target.checked } }, 'Grayscale')} className="accent-indigo-500" />
            Grayscale
          </label>
        </Section>
      )}

      {kind === 'text' && <TextInspector clip={clip} />}
      {kind === 'caption' && <CaptionInspector clip={clip} />}
      {clip.brollMode !== null && <BrollInspector clip={clip} />}

      <TimingSection clip={clip} />
    </div>
  );
}

function TextInspector({ clip }: { clip: Clip }) {
  const apply = useEditorStore((s) => s.apply);
  const throttled = useThrottledApply();
  const [draft, setDraft] = useState(clip.text ?? '');
  useEffect(() => setDraft(clip.text ?? ''), [clip.id]);
  const st = clip.textStyle;

  return (
    <Section title="Text">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== clip.text) apply({ type: 'SET_TEXT', clipId: clip.id, text: draft }, 'Edit text');
        }}
        rows={3}
        className="w-full mb-2 px-2 py-1.5 rounded bg-bg-1 border border-line text-sm focus:outline-none focus:border-accent resize-y"
      />
      {st && (
        <>
          <Slider label="Font size" value={st.fontSize} min={12} max={240} step={1} format={(v) => `${Math.round(v)}`} onChange={(v) => throttled({ type: 'SET_TEXT', clipId: clip.id, style: { fontSize: v } }, 'Font size')} onCommit={(v) => throttled({ type: 'SET_TEXT', clipId: clip.id, style: { fontSize: v } }, 'Font size', true)} />
          <label className="flex items-center gap-2 py-0.5">
            <span className="w-[76px] shrink-0 text-xs text-ink-2">Weight</span>
            <Select value={st.fontWeight} onChange={(e) => apply({ type: 'SET_TEXT', clipId: clip.id, style: { fontWeight: Number(e.target.value) } }, 'Font weight')} className="flex-1">
              {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 py-0.5">
            <span className="w-[76px] shrink-0 text-xs text-ink-2">Color</span>
            <input type="color" value={st.color} onChange={(e) => apply({ type: 'SET_TEXT', clipId: clip.id, style: { color: e.target.value } }, 'Text color')} />
            <span className="text-xs text-ink-3">{st.color}</span>
          </label>
          <label className="flex items-center gap-2 py-0.5">
            <span className="w-[76px] shrink-0 text-xs text-ink-2">Background</span>
            <input type="color" value={st.backgroundColor ?? '#000000'} onChange={(e) => apply({ type: 'SET_TEXT', clipId: clip.id, style: { backgroundColor: e.target.value } }, 'Text background')} />
            <button className="text-xs text-ink-3 hover:text-ink-1" onClick={() => apply({ type: 'SET_TEXT', clipId: clip.id, style: { backgroundColor: null } }, 'Clear background')}>
              None
            </button>
          </label>
          <label className="flex items-center gap-2 py-0.5">
            <span className="w-[76px] shrink-0 text-xs text-ink-2">Align</span>
            <Select value={st.align} onChange={(e) => apply({ type: 'SET_TEXT', clipId: clip.id, style: { align: e.target.value as any } }, 'Text align')} className="flex-1">
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </Select>
          </label>
        </>
      )}
      <label className="flex items-center gap-2 py-0.5">
        <span className="w-[76px] shrink-0 text-xs text-ink-2">Animation</span>
        <Select value={clip.textAnimation} onChange={(e) => apply({ type: 'SET_TEXT', clipId: clip.id, animation: e.target.value as TextAnimation }, 'Text animation')} className="flex-1">
          {(['none', 'fade', 'slide', 'pop', 'scale', 'typewriter', 'word-reveal'] as const).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </label>
    </Section>
  );
}

function CaptionInspector({ clip }: { clip: Clip }) {
  const apply = useEditorStore((s) => s.apply);
  const [draft, setDraft] = useState(clip.text ?? '');
  useEffect(() => setDraft(clip.text ?? ''), [clip.id]);
  return (
    <Section title="Caption">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== clip.text) apply({ type: 'SET_TEXT', clipId: clip.id, text: draft }, 'Edit caption');
        }}
        rows={2}
        className="w-full mb-2 px-2 py-1.5 rounded bg-bg-1 border border-line text-sm focus:outline-none focus:border-accent resize-y"
      />
      <label className="flex items-center gap-2 py-0.5">
        <span className="w-[76px] shrink-0 text-xs text-ink-2">Style</span>
        <Select value={clip.captionStyle ?? 'bold'} onChange={(e) => apply({ type: 'SET_CAPTION_STYLE', clipId: clip.id, style: e.target.value as CaptionStyleName }, 'Caption style')} className="flex-1">
          {(['minimal', 'bold', 'creator', 'karaoke', 'dynamic'] as const).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </label>
    </Section>
  );
}

function BrollInspector({ clip }: { clip: Clip }) {
  const apply = useEditorStore((s) => s.apply);
  return (
    <Section title="B-roll">
      <label className="flex items-center gap-2 py-0.5">
        <span className="w-[76px] shrink-0 text-xs text-ink-2">Mode</span>
        <Select
          value={clip.brollMode ?? 'fullscreen'}
          onChange={() => {
            /* brollMode has no dedicated command; approximate with transform presets */
          }}
          className="flex-1"
          disabled
          title="B-roll mode is set at insert time"
        >
          {(['fullscreen', 'cutaway', 'overlay', 'pip'] as const).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </label>
    </Section>
  );
}

function TimingSection({ clip }: { clip: Clip }) {
  const apply = useEditorStore((s) => s.apply);
  const [start, setStart] = useState(String(clip.start.toFixed(2)));
  const [dur, setDur] = useState(String(clip.duration.toFixed(2)));
  useEffect(() => {
    setStart(clip.start.toFixed(2));
    setDur(clip.duration.toFixed(2));
  }, [clip.start, clip.duration]);

  function commit() {
    const s = parseFloat(start);
    const d = parseFloat(dur);
    if (!Number.isFinite(s) || !Number.isFinite(d)) return;
    if (s !== clip.start) {
      apply({ type: 'MOVE_CLIP', clipId: clip.id, start: s }, 'Set clip start');
    }
    if (d !== clip.duration) {
      apply({ type: 'TRIM_CLIP', clipId: clip.id, start: Math.max(0, s), duration: d }, 'Set clip duration');
    }
  }

  return (
    <Section title="Timing">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">Start (s)</span>
          <Input value={start} onChange={(e) => setStart(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">Duration (s)</span>
          <Input value={dur} onChange={(e) => setDur(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        </label>
      </div>
    </Section>
  );
}
