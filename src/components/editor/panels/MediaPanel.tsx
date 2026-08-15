'use client';

import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, Film, ImageIcon, Music, Plus, Trash2, Upload } from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import { addAssetToTimeline } from '@/features/timeline/operations';
import { ACCEPTED_MIME, uploadFile } from '@/features/media/upload';
import { Badge, Button, EmptyState, IconButton, PanelHeader, ProgressBar } from '@/components/ui';
import { duration as formatDuration, fileSize } from '@/lib/format';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';
import type { Asset } from '@/types';

const KIND_ICON = {
  video: <Film size={13} />,
  image: <ImageIcon size={13} />,
  audio: <Music size={13} />,
};

/** Upload and manage the project's media library. */
export function MediaPanel() {
  const assets = useEditorStore((state) => state.assets);
  const addAsset = useEditorStore((state) => state.addAsset);
  const removeAsset = useEditorStore((state) => state.removeAsset);
  const projectId = useEditorStore((state) => state.projectId);
  const capabilities = useEditorStore((state) => state.capabilities);

  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<{ name: string; progress: number }[]>([]);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!projectId) return;
      const list = Array.from(files);
      for (const file of list) {
        setUploads((current) => [...current, { name: file.name, progress: 0 }]);
        try {
          const { asset, localOnly } = await uploadFile(file, projectId, (progress) => {
            setUploads((current) => current.map((u) => (u.name === file.name ? { ...u, progress } : u)));
          });
          addAsset(asset);
          if (localOnly) {
            toast.warn(`${file.name} stays in this browser`, 'Configure object storage to keep uploads after a reload.');
          }
        } catch (error) {
          toast.error('Upload failed', error instanceof Error ? error.message : undefined);
        } finally {
          setUploads((current) => current.filter((u) => u.name !== file.name));
        }
      }
    },
    [addAsset, projectId],
  );

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Media"
        description="Upload footage, images and audio. Drag a file anywhere in this panel."
        action={
          <Button size="sm" icon={<Upload size={12} />} onClick={() => inputRef.current?.click()}>
            Upload
          </Button>
        }
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_MIME.join(',')}
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void handleFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <div
        className={cn('flex-1 overflow-y-auto p-2', dragging && 'bg-accent-ghost')}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files.length > 0) void handleFiles(event.dataTransfer.files);
        }}
      >
        {capabilities && !capabilities.storage.directUpload ? (
          <p className="mb-2 flex items-start gap-1.5 rounded-md border border-warn/20 bg-warn/5 px-2 py-1.5 text-2xs leading-relaxed text-warn">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            No object storage configured — files over 4 MB stay in this browser tab only.
          </p>
        ) : null}

        {uploads.map((upload) => (
          <div key={upload.name} className="mb-2 rounded-md border border-line bg-bg-2 p-2">
            <p className="truncate text-2xs text-ink-1">{upload.name}</p>
            <ProgressBar value={upload.progress} className="mt-1.5" />
          </div>
        ))}

        {assets.length === 0 && uploads.length === 0 ? (
          <EmptyState
            icon={<Upload size={20} />}
            title="No media yet"
            description="MP4, WebM, MOV · JPG, PNG, WebP · MP3, WAV"
            action={
              <Button size="sm" onClick={() => inputRef.current?.click()}>
                Choose files
              </Button>
            }
          />
        ) : (
          <ul className="space-y-1">
            {assets.map((asset) => (
              <AssetRow key={asset.id} asset={asset} onRemove={() => removeAsset(asset.id)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AssetRow({ asset, onRemove }: { asset: Asset; onRemove: () => void }) {
  return (
    <li className="group flex items-center gap-2 rounded-md border border-transparent p-1.5 transition-colors hover:border-line hover:bg-bg-2">
      <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded bg-bg-3">
        {asset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center text-ink-3">{KIND_ICON[asset.kind]}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-ink-0" title={asset.name}>
          {asset.name}
        </p>
        <p className="flex items-center gap-1.5 text-2xs text-ink-3">
          <span>{formatDuration(asset.duration)}</span>
          <span>· {fileSize(asset.sizeBytes)}</span>
          {asset.ephemeral ? <Badge tone="warn">local</Badge> : null}
          {asset.credit && asset.credit.provider !== 'user' ? <Badge>{asset.credit.providerLabel}</Badge> : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton onClick={() => addAssetToTimeline(asset)} title="Add to timeline">
          <Plus size={13} />
        </IconButton>
        <IconButton tone="danger" onClick={onRemove} title="Remove from library">
          <Trash2 size={12} />
        </IconButton>
      </div>
    </li>
  );
}
