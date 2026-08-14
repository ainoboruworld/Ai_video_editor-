import { ArrowLeftRight, LogIn, LogOut, XCircle } from 'lucide-react';
import type { TransitionKind } from '@ave/editor-core';
import { useEditorStore, findClip } from '../../state/editorStore';
import { Button } from '../../components/ui';
import { toast } from '../../state/toastStore';

const TRANSITIONS: { kind: TransitionKind; label: string }[] = [
  { kind: 'fade', label: 'Fade' },
  { kind: 'cross-dissolve', label: 'Cross dissolve' },
  { kind: 'dip-to-black', label: 'Dip to black' },
  { kind: 'dip-to-white', label: 'Dip to white' },
  { kind: 'slide', label: 'Slide' },
  { kind: 'zoom', label: 'Zoom' },
  { kind: 'blur', label: 'Blur' },
];

export default function TransitionsPanel() {
  const apply = useEditorStore((s) => s.apply);
  const selection = useEditorStore((s) => s.selection);
  const hasSelection = selection.length > 0;

  function applyTransition(kind: TransitionKind, position: 'in' | 'out') {
    const { sequence, selection } = useEditorStore.getState();
    if (!sequence || selection.length === 0) {
      toast.info('Select a clip in the timeline first');
      return;
    }
    const cmds = selection
      .filter((id) => findClip(sequence, id))
      .map((clipId) => ({
        type: 'ADD_TRANSITION' as const,
        clipId,
        position,
        transition: { kind, duration: 0.5, position },
      }));
    if (cmds.length) apply(cmds, `${kind} (${position})`);
  }

  function clear() {
    const { sequence, selection } = useEditorStore.getState();
    if (!sequence || selection.length === 0) return;
    apply(
      selection.flatMap((clipId) => [
        { type: 'ADD_TRANSITION' as const, clipId, position: 'in' as const, transition: null },
        { type: 'ADD_TRANSITION' as const, clipId, position: 'out' as const, transition: null },
      ]),
      'Clear transitions',
    );
  }

  return (
    <div className="p-3 flex flex-col gap-2">
      <p className="text-xs text-ink-3 mb-1">
        {hasSelection
          ? 'Apply a 0.5s transition to the selected clip.'
          : 'Select a clip in the timeline, then click a transition.'}
      </p>
      {TRANSITIONS.map((t) => (
        <div key={t.kind} className="flex items-center gap-1.5 border border-line rounded bg-bg-3 px-2.5 py-1.5">
          <ArrowLeftRight size={13} className="text-accent-hover shrink-0" />
          <span className="text-sm flex-1">{t.label}</span>
          <Button size="sm" variant="ghost" disabled={!hasSelection} title={`Apply to clip start`} onClick={() => applyTransition(t.kind, 'in')}>
            <LogIn size={11} /> In
          </Button>
          <Button size="sm" variant="ghost" disabled={!hasSelection} title={`Apply to clip end`} onClick={() => applyTransition(t.kind, 'out')}>
            <LogOut size={11} /> Out
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" disabled={!hasSelection} onClick={clear} className="self-start mt-1">
        <XCircle size={12} /> Remove transitions
      </Button>
    </div>
  );
}
