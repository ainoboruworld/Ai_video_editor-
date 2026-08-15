'use client';

import { ArrowRightLeft } from 'lucide-react';
import type { TransitionKind } from '@/lib/engine';
import { useEditorStore, useSelectedClip } from '@/state/editorStore';
import { EmptyState, PanelHeader, Slider } from '@/components/ui';
import { cn } from '@/lib/cn';

const TRANSITIONS: { kind: TransitionKind | 'cut'; label: string; description: string }[] = [
  { kind: 'cut', label: 'Cut', description: 'No transition' },
  { kind: 'fade', label: 'Fade', description: 'Fade from transparent' },
  { kind: 'cross-dissolve', label: 'Dissolve', description: 'Blend into the next shot' },
  { kind: 'dip-to-black', label: 'Dip to black', description: 'Through black' },
  { kind: 'dip-to-white', label: 'Dip to white', description: 'Through white' },
  { kind: 'slide', label: 'Slide', description: 'Push in horizontally' },
  { kind: 'zoom', label: 'Zoom', description: 'Scale in' },
  { kind: 'blur', label: 'Blur', description: 'Soften on entry' },
];

/** Applies a transition to both edges of the selected clip. */
export function TransitionsPanel() {
  const selected = useSelectedClip();
  const apply = useEditorStore((state) => state.apply);
  const duration = 0.5;

  if (!selected) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="Transitions" />
        <EmptyState
          icon={<ArrowRightLeft size={20} />}
          title="Select a clip"
          description="Transitions attach to the start or end of a clip."
        />
      </div>
    );
  }

  const { clip } = selected;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Transitions" description={clip.name || clip.kind} />
      <div className="flex-1 overflow-y-auto p-2.5">
        {(['in', 'out'] as const).map((position) => {
          const current = position === 'in' ? clip.transitionIn : clip.transitionOut;
          return (
            <div key={position} className="mb-4">
              <p className="mb-1.5 text-2xs uppercase tracking-wide text-ink-3">
                {position === 'in' ? 'Entering' : 'Leaving'}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {TRANSITIONS.map((transition) => {
                  const active = transition.kind === 'cut' ? !current : current?.kind === transition.kind;
                  return (
                    <button
                      key={transition.kind}
                      type="button"
                      onClick={() =>
                        apply(
                          {
                            type: 'ADD_TRANSITION',
                            clipId: clip.id,
                            position,
                            transition:
                              transition.kind === 'cut'
                                ? null
                                : {
                                    kind: transition.kind,
                                    duration: current?.duration ?? duration,
                                    position,
                                  },
                          },
                          'Transition',
                        )
                      }
                      className={cn(
                        'rounded-md border px-2 py-2 text-left transition-colors',
                        active ? 'border-accent bg-accent-ghost' : 'border-line bg-bg-2 hover:border-line-strong',
                      )}
                    >
                      <p className={cn('text-xs font-medium', active ? 'text-accent' : 'text-ink-0')}>
                        {transition.label}
                      </p>
                      <p className="mt-0.5 line-clamp-1 text-2xs text-ink-3">{transition.description}</p>
                    </button>
                  );
                })}
              </div>
              {current ? (
                <Slider
                  label="Length"
                  min={0.1}
                  max={2}
                  step={0.05}
                  value={current.duration}
                  format={(value) => `${value.toFixed(2)}s`}
                  onChange={(value) =>
                    apply(
                      { type: 'ADD_TRANSITION', clipId: clip.id, position, transition: { ...current, duration: value } },
                      'Transition length',
                    )
                  }
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
