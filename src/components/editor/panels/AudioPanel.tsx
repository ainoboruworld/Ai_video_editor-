'use client';

import { useRef, useState } from 'react';
import { Mic, Music, Upload, Volume2 } from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import { addAssetToTimeline } from '@/features/timeline/operations';
import { uploadFile } from '@/features/media/upload';
import { Badge, Button, EmptyState, PanelHeader } from '@/components/ui';
import { duration as formatDuration } from '@/lib/format';
import { toast } from '@/state/toastStore';

/**
 * Audio: uploads, music and voiceover routing.
 *
 * No copyrighted library is bundled. The panel routes user-supplied audio to
 * the right track and links to freely licensed sources — Pixabay's audio
 * library and the Free Music Archive — rather than shipping music we have no
 * right to redistribute.
 */
const FREE_SOURCES = [
  { label: 'Pixabay Music', href: 'https://pixabay.com/music/', note: 'Free for commercial use' },
  { label: 'Pixabay Sound Effects', href: 'https://pixabay.com/sound-effects/', note: 'Whoosh, pop, ambience…' },
  { label: 'Free Music Archive', href: 'https://freemusicarchive.org/', note: 'Check each track licence' },
];

const SFX_CATEGORIES = ['Whoosh', 'Click', 'Pop', 'Transition', 'Notification', 'Nature', 'Ambient', 'Camera', 'Crowd'];

export function AudioPanel() {
  const assets = useEditorStore((state) => state.assets);
  const projectId = useEditorStore((state) => state.projectId);
  const addAsset = useEditorStore((state) => state.addAsset);
  const inputRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<'music' | 'voiceover'>('music');
  const [busy, setBusy] = useState(false);

  const audioAssets = assets.filter((asset) => asset.kind === 'audio');

  const upload = async (files: FileList) => {
    if (!projectId) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const { asset } = await uploadFile(file, projectId);
        addAsset(asset);
        addAssetToTimeline(asset, { role });
      }
      toast.success(role === 'music' ? 'Music added' : 'Voiceover added');
    } catch (error) {
      toast.error('Upload failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Audio" description="Music, voiceover and sound effects." />

      <div className="border-b border-line p-2">
        <div className="mb-2 flex items-center gap-1 rounded-md bg-bg-2 p-1">
          <button
            type="button"
            onClick={() => setRole('music')}
            className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-2xs font-medium ${
              role === 'music' ? 'bg-bg-3 text-ink-0' : 'text-ink-3'
            }`}
          >
            <Music size={11} /> Music
          </button>
          <button
            type="button"
            onClick={() => setRole('voiceover')}
            className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-2xs font-medium ${
              role === 'voiceover' ? 'bg-bg-3 text-ink-0' : 'text-ink-3'
            }`}
          >
            <Mic size={11} /> Voiceover
          </button>
        </div>
        <Button
          size="sm"
          className="w-full"
          icon={<Upload size={12} />}
          loading={busy}
          onClick={() => inputRef.current?.click()}
        >
          Upload {role === 'music' ? 'music' : 'voiceover'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/ogg"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {audioAssets.length === 0 ? (
          <EmptyState icon={<Volume2 size={18} />} title="No audio yet" description="Upload an MP3 or WAV to get started." />
        ) : (
          <ul className="mb-4 space-y-1">
            {audioAssets.map((asset) => (
              <li
                key={asset.id}
                className="flex items-center gap-2 rounded-md border border-transparent p-1.5 hover:border-line hover:bg-bg-2"
              >
                <Music size={13} className="shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-ink-0">{asset.name}</p>
                  <p className="text-2xs text-ink-3">{formatDuration(asset.duration)}</p>
                </div>
                <Button size="sm" onClick={() => addAssetToTimeline(asset, { role })}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="mb-1.5 text-2xs uppercase tracking-wide text-ink-3">Free sound libraries</p>
        <div className="space-y-1">
          {FREE_SOURCES.map((source) => (
            <a
              key={source.href}
              href={source.href}
              target="_blank"
              rel="noreferrer noopener"
              className="block rounded-md border border-line bg-bg-2 px-2.5 py-2 transition-colors hover:border-accent/40"
            >
              <p className="text-xs text-ink-0">{source.label}</p>
              <p className="text-2xs text-ink-3">{source.note}</p>
            </a>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-2xs uppercase tracking-wide text-ink-3">Sound effect categories</p>
        <div className="flex flex-wrap gap-1">
          {SFX_CATEGORIES.map((category) => (
            <a
              key={category}
              href={`https://pixabay.com/sound-effects/search/${encodeURIComponent(category.toLowerCase())}/`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Badge className="cursor-pointer hover:border-accent/40">{category}</Badge>
            </a>
          ))}
        </div>

        <p className="mt-4 text-2xs leading-relaxed text-ink-3">
          Downloaded audio keeps its source and licence in Project credits when you upload it here.
        </p>
      </div>
    </div>
  );
}
