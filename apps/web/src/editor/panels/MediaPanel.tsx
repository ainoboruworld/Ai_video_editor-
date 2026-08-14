import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Film, Music, Image as ImageIcon, AlertCircle, Trash2, Plus } from 'lucide-react';
import { useEditorStore } from '../../state/editorStore';
import { api, type Asset } from '../../lib/api';
import { addAssetCommand } from '../../lib/timelineOps';
import { durationLabel, fileSize } from '../../lib/format';
import { Progress, Spinner, EmptyState, Badge } from '../../components/ui';
import { toast } from '../../state/toastStore';

interface UploadItem {
  id: string;
  name: string;
  progress: number;
}

export default function MediaPanel() {
  const assets = useEditorStore((s) => s.assets);
  const projectId = useEditorStore((s) => s.projectId);
  const upsertAsset = useEditorStore((s) => s.upsertAsset);
  const refreshAssets = useEditorStore((s) => s.refreshAssets);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Poll processing assets
  useEffect(() => {
    const processing = assets.filter((a) => a.status === 'processing');
    if (processing.length === 0) return;
    const t = setInterval(async () => {
      for (const a of processing) {
        try {
          const fresh = await api.getAsset(a.id);
          if (fresh.status !== a.status) upsertAsset(fresh);
        } catch {
          /* offline; keep polling */
        }
      }
    }, 2000);
    return () => clearInterval(t);
  }, [assets, upsertAsset]);

  const doUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!projectId) return;
      for (const file of Array.from(files)) {
        const uploadId = `${file.name}-${Date.now()}`;
        setUploads((u) => [...u, { id: uploadId, name: file.name, progress: 0 }]);
        try {
          const asset = await api.uploadAsset(projectId, file, (f) =>
            setUploads((u) => u.map((x) => (x.id === uploadId ? { ...x, progress: f * 100 } : x))),
          );
          upsertAsset(asset);
        } catch (e: any) {
          toast.error(`Upload failed: ${e.message}`);
        } finally {
          setUploads((u) => u.filter((x) => x.id !== uploadId));
        }
      }
      refreshAssets();
    },
    [projectId, upsertAsset, refreshAssets],
  );

  return (
    <div className="flex flex-col">
      <div
        className={`m-3 border border-dashed rounded p-4 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-accent bg-accent/10' : 'border-line hover:border-[#3a3b40]'
        }`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files);
        }}
        title="Upload media"
      >
        <Upload size={16} className="mx-auto text-ink-3 mb-1" />
        <div className="text-sm text-ink-2">Drop files or click to upload</div>
        <div className="text-xs text-ink-3 mt-0.5">Video, audio, images</div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) doUpload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {uploads.map((u) => (
        <div key={u.id} className="mx-3 mb-2 p-2 border border-line rounded bg-bg-3">
          <div className="text-xs truncate mb-1.5">{u.name}</div>
          <Progress value={u.progress} />
        </div>
      ))}

      {assets.length === 0 && uploads.length === 0 && (
        <EmptyState icon={<Film size={22} />} title="No media yet" hint="Upload files to build your library. Drag assets onto the timeline to edit." />
      )}

      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        {assets.map((a) => (
          <AssetCard key={a.id} asset={a} />
        ))}
      </div>
    </div>
  );
}

function AssetCard({ asset }: { asset: Asset }) {
  const apply = useEditorStore((s) => s.apply);
  const refreshAssets = useEditorStore((s) => s.refreshAssets);

  function addToTimeline() {
    const { sequence, playhead } = useEditorStore.getState();
    if (!sequence) return;
    if (asset.status !== 'ready') {
      toast.info('Asset is still processing');
      return;
    }
    const cmd = addAssetCommand(sequence, asset, playhead);
    if (cmd) apply(cmd, `Add ${asset.name}`);
    else toast.error('No matching track available');
  }

  return (
    <div
      className="group border border-line rounded overflow-hidden bg-bg-3 hover:border-[#3a3b40] transition-colors cursor-grab active:cursor-grabbing"
      draggable={asset.status === 'ready'}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-ave-asset', asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={addToTimeline}
      title={`${asset.name}\n${fileSize(asset.sizeBytes)} · ${durationLabel(asset.duration)}\nDouble-click to add at playhead, or drag to the timeline`}
    >
      <div className="aspect-video bg-bg-0 relative flex items-center justify-center">
        {asset.thumbnailUrl ? (
          <img src={asset.thumbnailUrl} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : asset.kind === 'audio' ? (
          <Music size={18} className="text-ink-3" />
        ) : asset.kind === 'image' ? (
          <ImageIcon size={18} className="text-ink-3" />
        ) : (
          <Film size={18} className="text-ink-3" />
        )}
        {asset.status === 'processing' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center gap-1.5 text-xs text-ink-2">
            <Spinner /> Processing
          </div>
        )}
        {asset.status === 'error' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-1 text-xs text-[#f0a5a8]" title={asset.error ?? 'Processing failed'}>
            <AlertCircle size={12} /> Error
          </div>
        )}
        {asset.duration != null && (
          <span className="absolute bottom-1 right-1 bg-black/70 rounded px-1 text-[10px] tabular-nums">
            {durationLabel(asset.duration)}
          </span>
        )}
      </div>
      <div className="px-1.5 py-1 flex items-center gap-1">
        <span className="text-xs truncate flex-1">{asset.name}</span>
        <button
          className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-accent-hover transition-opacity"
          title="Add at playhead"
          onClick={addToTimeline}
        >
          <Plus size={12} />
        </button>
        <button
          className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-[#f0a5a8] transition-opacity"
          title="Delete asset"
          onClick={async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete "${asset.name}"?`)) return;
            try {
              await api.deleteAsset(asset.id);
              refreshAssets();
            } catch (err: any) {
              toast.error(`Delete failed: ${err.message}`);
            }
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
