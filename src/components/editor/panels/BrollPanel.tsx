'use client';

import { useState } from 'react';
import { ExternalLink, Film, ImageIcon, Loader2, Plus, Search, Sparkles } from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import { useMediaSearch } from '@/hooks/useMediaSearch';
import { api, ApiClientError } from '@/lib/api-client';
import { addAssetToTimeline } from '@/features/timeline/operations';
import { Badge, Button, EmptyState, Input, PanelHeader, Skeleton } from '@/components/ui';
import { duration as formatDuration } from '@/lib/format';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';
import type { Asset, StockMediaItem } from '@/types';

const SUGGESTED = ['city timelapse', 'coffee pour', 'forest walk', 'office team', 'ocean waves', 'cooking hands'];

/**
 * Free stock browser. Results come from our own /api/media/search, which merges
 * Pexels, Pixabay and Unsplash server-side and ranks them for this project's
 * framing and scene length.
 */
export function BrollPanel() {
  const aspect = useEditorStore((state) => state.aspect);
  const projectId = useEditorStore((state) => state.projectId);
  const addAsset = useEditorStore((state) => state.addAsset);
  const capabilities = useEditorStore((state) => state.capabilities);

  const [type, setType] = useState<'video' | 'image'>('video');
  const search = useMediaSearch({ aspect, type });
  const [importing, setImporting] = useState<string | null>(null);

  const noProviders =
    capabilities && !capabilities.stock.pexels && !capabilities.stock.pixabay && !capabilities.stock.unsplash;

  const importItem = async (item: StockMediaItem, addToTimeline: boolean): Promise<Asset | null> => {
    if (!projectId) return null;
    setImporting(item.id);
    try {
      const { asset } = await api.importStockAsset({ projectId, item });
      addAsset(asset);
      if (addToTimeline) addAssetToTimeline(asset, { role: 'broll' });
      toast.success(addToTimeline ? 'Added to timeline' : 'Added to media library');
      return asset;
    } catch (error) {
      toast.error('Could not add this clip', error instanceof ApiClientError ? error.message : undefined);
      return null;
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="B-roll"
        description="Free stock from Pexels, Pixabay and Unsplash — ranked for your format."
      />

      <div className="border-b border-line p-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            placeholder="Search footage…"
            className="pl-8"
          />
          {search.loading ? (
            <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-ink-3" />
          ) : null}
        </div>

        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setType('video')}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-2xs font-medium transition-colors',
              type === 'video' ? 'bg-accent-ghost text-accent' : 'text-ink-3 hover:text-ink-1',
            )}
          >
            <Film size={11} /> Video
          </button>
          <button
            type="button"
            onClick={() => setType('image')}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-2xs font-medium transition-colors',
              type === 'image' ? 'bg-accent-ghost text-accent' : 'text-ink-3 hover:text-ink-1',
            )}
          >
            <ImageIcon size={11} /> Photos
          </button>
          <span className="ml-auto text-2xs text-ink-3">{search.providers.join(' · ')}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {noProviders ? (
          <EmptyState
            icon={<Sparkles size={20} />}
            title="No stock provider configured"
            description="Add a free PEXELS_API_KEY (and optionally PIXABAY_API_KEY / UNSPLASH_ACCESS_KEY) to search B-roll."
          />
        ) : search.query.trim().length < 2 ? (
          <div className="px-1">
            <p className="mb-2 text-2xs uppercase tracking-wide text-ink-3">Try</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => search.search(term)}
                  className="rounded-full border border-line px-2.5 py-1 text-2xs text-ink-2 transition-colors hover:border-accent/40 hover:text-ink-0"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        ) : search.loading && search.items.length === 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="aspect-video" />
            ))}
          </div>
        ) : search.error && search.items.length === 0 ? (
          <EmptyState title="No results" description={search.error} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {search.items.map((item) => (
                <StockCard
                  key={item.id}
                  item={item}
                  busy={importing === item.id}
                  onAdd={() => void importItem(item, true)}
                  onSave={() => void importItem(item, false)}
                />
              ))}
            </div>
            {search.hasMore ? (
              <Button size="sm" className="mt-2 w-full" onClick={search.loadMore} loading={search.loading}>
                Load more
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function StockCard({
  item,
  busy,
  onAdd,
  onSave,
}: {
  item: StockMediaItem;
  busy: boolean;
  onAdd: () => void;
  onSave?: () => void;
}) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      className="group relative overflow-hidden rounded-md border border-line bg-bg-2"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="relative aspect-video overflow-hidden bg-bg-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.thumbnailUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
        {hovering && item.previewUrl ? (
          <video
            src={item.previewUrl}
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
          />
        ) : null}

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4">
          <span className="font-mono text-2xs text-white/90">
            {item.duration ? formatDuration(item.duration) : `${item.width}×${item.height}`}
          </span>
          <span className="rounded bg-black/60 px-1 text-2xs text-white/80">{item.orientation.slice(0, 4)}</span>
        </div>

        {typeof item.score === 'number' ? (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1 py-0.5 text-2xs font-medium text-white/90">
            {Math.round(item.score * 100)}%
          </span>
        ) : null}

        <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
          <Button size="sm" variant="primary" onClick={onAdd} loading={busy} icon={<Plus size={12} />}>
            Add
          </Button>
          {onSave ? (
            <Button size="sm" onClick={onSave} disabled={busy}>
              Save
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-1 px-1.5 py-1">
        <span className="truncate text-2xs text-ink-3" title={item.title}>
          {item.creator ?? item.title}
        </span>
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 text-ink-3 transition-colors hover:text-ink-1"
          title={`${item.provider} · ${item.license}`}
        >
          <ExternalLink size={10} />
        </a>
      </div>
      <Badge className="absolute right-1.5 top-1.5">{item.provider}</Badge>
    </div>
  );
}
