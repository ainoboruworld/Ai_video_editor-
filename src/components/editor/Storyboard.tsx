'use client';

import { useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import { useStoryboardStore } from '@/state/storyboardStore';
import { applyStoryboardToTimeline, attachItemToScene, findBrollForScenes } from '@/features/ai/actions';
import { StockCard } from '@/components/editor/panels/BrollPanel';
import { Badge, Button, IconButton, Input, Textarea } from '@/components/ui';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';
import type { StoryboardScene } from '@/types';

/**
 * The storyboard: an editable scene list with B-roll recommendations.
 * Nothing reaches the timeline until the user approves it here.
 */
export function Storyboard() {
  const storyboard = useEditorStore((state) => state.storyboard);
  const open = useEditorStore((state) => state.storyboardOpen);
  const setOpen = useEditorStore((state) => state.setStoryboardOpen);
  const [busy, setBusy] = useState<string | null>(null);

  if (!open || !storyboard) return null;

  const totalDuration = storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-bg-0/97 backdrop-blur-sm animate-fade-in">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink-0">{storyboard.title}</h2>
          <p className="truncate text-2xs text-ink-3">{storyboard.prompt}</p>
        </div>
        <div className="ml-2 flex items-center gap-1.5">
          <Badge tone={storyboard.provider === 'offline' ? 'warn' : 'accent'}>
            {storyboard.provider === 'offline' ? 'draft (no AI key)' : storyboard.provider}
          </Badge>
          <Badge>
            <Clock size={9} /> {Math.round(totalDuration)}s
          </Badge>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            icon={<Search size={12} />}
            loading={busy === 'all'}
            onClick={async () => {
              setBusy('all');
              try {
                const found = await findBrollForScenes(storyboard.scenes);
                useStoryboardStore.getState().setRecommendations(found);
              } catch (error) {
                toast.error('B-roll search failed', error instanceof Error ? error.message : undefined);
              } finally {
                setBusy(null);
              }
            }}
          >
            Find B-roll for all scenes
          </Button>
          <Button size="sm" variant="primary" icon={<Wand2 size={12} />} onClick={() => applyStoryboardToTimeline()}>
            Assemble on timeline
          </Button>
          <IconButton onClick={() => setOpen(false)} aria-label="Close storyboard">
            <X size={15} />
          </IconButton>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-5xl space-y-3">
          {storyboard.hook ? (
            <div className="rounded-lg border border-line bg-bg-1 px-4 py-3">
              <p className="text-2xs uppercase tracking-wide text-ink-3">Hook</p>
              <p className="mt-1 text-sm text-ink-0">{storyboard.hook}</p>
            </div>
          ) : null}

          {storyboard.scenes.map((scene) => (
            <SceneCard key={scene.id} scene={scene} />
          ))}

          {storyboard.cta ? (
            <div className="rounded-lg border border-line bg-bg-1 px-4 py-3">
              <p className="text-2xs uppercase tracking-wide text-ink-3">Call to action</p>
              <p className="mt-1 text-sm text-ink-0">{storyboard.cta}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SceneCard({ scene }: { scene: StoryboardScene }) {
  const updateScene = useEditorStore((state) => state.updateScene);
  const removeScene = useEditorStore((state) => state.removeScene);
  const duplicateScene = useEditorStore((state) => state.duplicateScene);
  const assets = useEditorStore((state) => state.assets);
  const recommendation = useStoryboardStore((state) => state.recommendations[scene.id]);
  const setSceneRecommendation = useStoryboardStore((state) => state.setSceneRecommendation);

  const [searching, setSearching] = useState(false);
  const [attaching, setAttaching] = useState<string | null>(null);

  const chosen = scene.assetId ? assets.find((asset) => asset.id === scene.assetId) ?? null : null;

  const findBroll = async () => {
    setSearching(true);
    try {
      const found = await findBrollForScenes([scene]);
      const entry = found[scene.id];
      if (entry) setSceneRecommendation(scene.id, entry);
      if (!entry || entry.items.length === 0) toast.info('No footage matched', 'Try editing the visual description.');
    } catch (error) {
      toast.error('B-roll search failed', error instanceof Error ? error.message : undefined);
    } finally {
      setSearching(false);
    }
  };

  return (
    <article className="rounded-lg border border-line bg-bg-1">
      <div className="flex items-start gap-3 p-3">
        <div className="flex w-16 shrink-0 flex-col items-center gap-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-3 text-xs font-semibold text-ink-1">
            {scene.index + 1}
          </span>
          <Input
            type="number"
            min={0.5}
            step={0.5}
            value={scene.duration}
            onChange={(event) => updateScene(scene.id, { duration: Math.max(0.5, Number(event.target.value)) })}
            className="h-6 px-1 text-center text-2xs"
            title="Scene duration (seconds)"
          />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <Input
            value={scene.title}
            onChange={(event) => updateScene(scene.id, { title: event.target.value })}
            className="h-7 border-transparent bg-transparent px-0 text-sm font-medium focus:border-line focus:px-2"
          />

          <div className="grid gap-2 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-3">Narration</span>
              <Textarea
                rows={2}
                value={scene.script}
                onChange={(event) => updateScene(scene.id, { script: event.target.value })}
                className="text-xs"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-3">Visual</span>
              <Textarea
                rows={2}
                value={scene.visual}
                onChange={(event) => updateScene(scene.id, { visual: event.target.value })}
                className="text-xs"
              />
            </label>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-3">On-screen text</span>
              <Input
                value={scene.onScreenText}
                onChange={(event) => updateScene(scene.id, { onScreenText: event.target.value })}
                className="text-xs"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-3">Search queries</span>
              <Input
                value={scene.brollQueries.join(', ')}
                onChange={(event) =>
                  updateScene(scene.id, {
                    brollQueries: event.target.value
                      .split(',')
                      .map((query) => query.trim())
                      .filter(Boolean),
                  })
                }
                className="text-xs"
              />
            </label>
          </div>
        </div>

        <div className="flex w-40 shrink-0 flex-col gap-1.5">
          <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-bg-2">
            {chosen?.thumbnailUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={chosen.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-ok/90 px-1 py-0.5 text-2xs font-medium text-black">
                  <Check size={9} className="inline" /> selected
                </span>
              </>
            ) : (
              <span className="flex h-full items-center justify-center text-2xs text-ink-3">No B-roll</span>
            )}
          </div>
          <Button size="sm" icon={<Search size={11} />} loading={searching} onClick={() => void findBroll()}>
            Find B-roll
          </Button>
          <div className="flex gap-1">
            <IconButton onClick={() => duplicateScene(scene.id)} title="Duplicate scene">
              <Copy size={12} />
            </IconButton>
            <IconButton onClick={() => void findBroll()} title="Refresh options">
              <RefreshCw size={12} />
            </IconButton>
            <IconButton tone="danger" onClick={() => removeScene(scene.id)} title="Delete scene">
              <Trash2 size={12} />
            </IconButton>
          </div>
        </div>
      </div>

      {recommendation ? (
        <div className="border-t border-line p-3">
          {recommendation.error ? (
            <p className="text-2xs text-danger">{recommendation.error}</p>
          ) : recommendation.items.length === 0 ? (
            <p className="text-2xs text-ink-3">No matches. Try rewriting the visual description.</p>
          ) : (
            <>
              <p className="mb-2 text-2xs text-ink-3">
                Queries: <span className="text-ink-2">{recommendation.queries.join(' · ')}</span>
              </p>
              <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
                {recommendation.items.map((item) => (
                  <StockCard
                    key={item.id}
                    item={item}
                    busy={attaching === item.id}
                    onAdd={async () => {
                      setAttaching(item.id);
                      try {
                        await attachItemToScene(scene.id, item);
                        toast.success('B-roll attached to scene');
                      } catch (error) {
                        toast.error('Could not attach', error instanceof Error ? error.message : undefined);
                      } finally {
                        setAttaching(null);
                      }
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}

      {searching ? (
        <div className={cn('flex items-center gap-2 border-t border-line px-3 py-2 text-2xs text-ink-3')}>
          <Loader2 size={11} className="animate-spin" /> Searching Pexels, Pixabay and Unsplash…
        </div>
      ) : null}
    </article>
  );
}
