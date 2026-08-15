'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, Download, MonitorPlay } from 'lucide-react';
import { sequenceDuration } from '@/lib/engine';
import { useEditorStore } from '@/state/editorStore';
import type { PlaybackEngine } from '@/features/timeline/playback';
import {
  downloadResult,
  exportInBrowser,
  isBrowserExportSupported,
  pickMimeType,
  type ExportProgress,
  type ExportResult,
} from '@/features/rendering/browserExport';
import { api, ApiClientError } from '@/lib/api-client';
import { Badge, Button, Field, Modal, ProgressBar, Select } from '@/components/ui';
import { clock, fileSize } from '@/lib/format';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';
import type { ExportSettings, RenderJob } from '@/types';

/**
 * Export. Two real paths:
 *  - Browser: records the composited canvas + mixed audio into a downloadable
 *    file. Works everywhere, no external service.
 *  - Cloud: queues a Remotion render on a worker and polls the job.
 */
export function ExportDialog({
  open,
  onClose,
  engine,
}: {
  open: boolean;
  onClose: () => void;
  engine: PlaybackEngine | null;
}) {
  const sequence = useEditorStore((state) => state.sequence);
  const name = useEditorStore((state) => state.name);
  const projectId = useEditorStore((state) => state.projectId);
  const capabilities = useEditorStore((state) => state.capabilities);
  const saveNow = useEditorStore((state) => state.saveNow);

  const [settings, setSettings] = useState<ExportSettings>({
    resolution: 1080,
    fps: 30,
    format: 'mp4',
    quality: 'high',
    target: 'browser',
  });
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const duration = sequence ? sequenceDuration(sequence) : 0;
  const cloudAvailable = capabilities?.rendering.cloud ?? false;
  const browserSupported = typeof window !== 'undefined' && isBrowserExportSupported();
  const supportedType = typeof window !== 'undefined' ? pickMimeType(settings.format) : null;
  const actualContainer = supportedType?.includes('mp4') ? 'mp4' : 'webm';

  // Poll a queued cloud render.
  useEffect(() => {
    if (!job || job.status === 'complete' || job.status === 'failed') return;
    const timer = setInterval(async () => {
      try {
        const { job: updated } = await api.getRenderJob(job.id);
        setJob(updated);
        setProgress({
          phase: updated.status === 'complete' ? 'complete' : 'rendering',
          progress: updated.progress,
          message: updated.message,
        });
      } catch {
        // Keep polling; a transient failure is not fatal.
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [job]);

  const startBrowserExport = async () => {
    if (!sequence || !engine) return;
    setError(null);
    setResult(null);
    abortRef.current = new AbortController();
    try {
      const output = await exportInBrowser({
        engine,
        sequence,
        settings,
        projectName: name || 'video',
        onProgress: setProgress,
        signal: abortRef.current.signal,
      });
      setResult(output);
      downloadResult(output);
      toast.success('Export complete', `${output.filename} · ${fileSize(output.sizeBytes)}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Export failed';
      setError(message);
      setProgress({ phase: 'failed', progress: 0, message });
    }
  };

  const startCloudExport = async () => {
    if (!projectId) return;
    setError(null);
    setProgress({ phase: 'preparing', progress: 0, message: 'Saving project…' });
    try {
      await saveNow();
      const { job: created } = await api.startRender({
        projectId,
        resolution: settings.resolution,
        fps: settings.fps,
        format: settings.format,
      });
      setJob(created);
      setProgress({ phase: 'rendering', progress: 0, message: created.message });
    } catch (caught) {
      const message = caught instanceof ApiClientError ? caught.message : 'Could not queue the render';
      setError(message);
      setProgress({ phase: 'failed', progress: 0, message });
    }
  };

  const running = progress !== null && progress.phase !== 'complete' && progress.phase !== 'failed';

  return (
    <Modal
      open={open}
      onClose={() => {
        if (running) abortRef.current?.abort();
        onClose();
      }}
      title="Export video"
      description={`${clock(duration)} · ${sequence?.width}×${sequence?.height}`}
      width="max-w-md"
    >
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, target: 'browser' }))}
            className={cn(
              'rounded-lg border px-3 py-2.5 text-left transition-colors',
              settings.target === 'browser' ? 'border-accent bg-accent-ghost' : 'border-line bg-bg-2',
            )}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-0">
              <MonitorPlay size={12} /> In this browser
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              Records the timeline in real time. No server needed.
            </p>
          </button>
          <button
            type="button"
            disabled={!cloudAvailable}
            onClick={() => setSettings((s) => ({ ...s, target: 'cloud' }))}
            className={cn(
              'rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50',
              settings.target === 'cloud' ? 'border-accent bg-accent-ghost' : 'border-line bg-bg-2',
            )}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-0">
              <Cloud size={12} /> Cloud render
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              {cloudAvailable ? 'Remotion worker, frame-accurate.' : 'Needs RENDER_WORKER_URL.'}
            </p>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Resolution">
            <Select
              value={settings.resolution}
              onChange={(event) => setSettings((s) => ({ ...s, resolution: Number(event.target.value) as 720 | 1080 | 1440 }))}
              className="w-full"
            >
              <option value={720}>720p</option>
              <option value={1080}>1080p</option>
              <option value={1440}>1440p</option>
            </Select>
          </Field>
          <Field label="FPS">
            <Select
              value={settings.fps}
              onChange={(event) => setSettings((s) => ({ ...s, fps: Number(event.target.value) as 24 | 30 | 60 }))}
              className="w-full"
            >
              <option value={24}>24</option>
              <option value={30}>30</option>
              <option value={60}>60</option>
            </Select>
          </Field>
          <Field label="Format">
            <Select
              value={settings.format}
              onChange={(event) => setSettings((s) => ({ ...s, format: event.target.value as 'mp4' | 'webm' }))}
              className="w-full"
            >
              <option value="mp4">MP4</option>
              <option value="webm">WebM</option>
            </Select>
          </Field>
        </div>

        {settings.target === 'browser' ? (
          <div className="space-y-2 rounded-md border border-line bg-bg-2 p-3">
            <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-ink-2">
              <AlertTriangle size={11} className="mt-0.5 shrink-0 text-warn" />
              Recording runs in real time — a {clock(duration)} video takes about {clock(duration)}. Keep this tab
              visible and do not switch away.
            </p>
            {supportedType && actualContainer !== settings.format ? (
              <p className="text-2xs text-warn">
                This browser cannot record {settings.format.toUpperCase()} — the file will be{' '}
                {actualContainer.toUpperCase()} (plays in every modern browser). Use cloud rendering for H.264 MP4.
              </p>
            ) : null}
            {!browserSupported ? (
              <p className="text-2xs text-danger">
                This browser does not support canvas recording. Use Chrome, Edge or Firefox, or configure cloud
                rendering.
              </p>
            ) : null}
          </div>
        ) : null}

        {progress ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-1">{progress.message}</span>
              <span className="font-mono text-ink-3">{Math.round(progress.progress * 100)}%</span>
            </div>
            <ProgressBar value={progress.progress} />
            {job ? <Badge tone={job.status === 'failed' ? 'danger' : 'neutral'}>{job.status}</Badge> : null}
          </div>
        ) : null}

        {error ? <p className="text-xs text-danger">{error}</p> : null}

        {result ? (
          <div className="flex items-center gap-2 rounded-md border border-ok/25 bg-ok/5 p-3">
            <CheckCircle2 size={16} className="shrink-0 text-ok" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-ink-0">{result.filename}</p>
              <p className="text-2xs text-ink-3">{fileSize(result.sizeBytes)}</p>
            </div>
            <Button size="sm" icon={<Download size={12} />} onClick={() => downloadResult(result)}>
              Save again
            </Button>
          </div>
        ) : null}

        {job?.status === 'complete' && job.outputUrl ? (
          <a href={job.outputUrl} target="_blank" rel="noreferrer noopener">
            <Button className="w-full" variant="primary" icon={<Download size={13} />}>
              Download rendered video
            </Button>
          </a>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button
            onClick={() => {
              if (running) abortRef.current?.abort();
              onClose();
            }}
          >
            {running ? 'Cancel' : 'Close'}
          </Button>
          <Button
            variant="primary"
            icon={<Download size={13} />}
            loading={running}
            disabled={duration <= 0 || (settings.target === 'browser' && !browserSupported)}
            onClick={() => void (settings.target === 'browser' ? startBrowserExport() : startCloudExport())}
          >
            {settings.target === 'browser' ? 'Start export' : 'Queue render'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
