import { useState } from 'react';
import { Download, Check, Circle, CircleDot, XCircle } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { api, pollJob, type Job } from '../lib/api';
import { Modal, Select, Button, Progress, Spinner } from '../components/ui';
import { fileSize } from '../lib/format';
import { toast } from '../state/toastStore';

const STEPS = ['Prepare timeline', 'Render video', 'Encode audio', 'Finalize'];

export default function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [fps, setFps] = useState<24 | 25 | 30 | 60>(30);
  const [quality, setQuality] = useState<'draft' | 'standard' | 'high' | 'maximum'>('standard');
  const [phase, setPhase] = useState<'form' | 'running' | 'done' | 'error'>('form');
  const [job, setJob] = useState<Job | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelSignal] = useState<{ cancelled?: boolean }>({});

  async function start() {
    const { sequenceId } = useEditorStore.getState();
    if (!sequenceId) return;
    setPhase('running');
    setJob(null);
    setError(null);
    cancelSignal.cancelled = false;
    try {
      const { jobId } = await api.render(sequenceId, { resolution, fps, quality });
      setJobId(jobId);
      const final = await pollJob(jobId, setJob, 1200, cancelSignal);
      if (cancelSignal.cancelled) {
        setPhase('form');
        return;
      }
      if (final.status === 'error') {
        setError(final.error ?? 'Render failed');
        setPhase('error');
      } else {
        setJob(final);
        setPhase('done');
      }
    } catch (e: any) {
      setError(e.message ?? 'Render failed');
      setPhase('error');
    }
  }

  async function cancel() {
    cancelSignal.cancelled = true;
    if (jobId) {
      try {
        await api.cancelJob(jobId);
      } catch {
        /* already gone */
      }
    }
    setPhase('form');
    toast.info('Export cancelled');
  }

  function close() {
    if (phase === 'running') return;
    setPhase('form');
    setJob(null);
    onClose();
  }

  const outputUrl: string | null = job?.result?.outputUrl ?? null;
  const outputSize: number | null = job?.result?.sizeBytes ?? null;

  return (
    <Modal open={open} onClose={close} title="Export video">
      {phase === 'form' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">Resolution</span>
              <Select value={resolution} onChange={(e) => setResolution(e.target.value as any)}>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4K</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">Frame rate</span>
              <Select value={fps} onChange={(e) => setFps(Number(e.target.value) as any)}>
                {[24, 25, 30, 60].map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">Quality</span>
              <Select value={quality} onChange={(e) => setQuality(e.target.value as any)}>
                <option value="draft">Draft</option>
                <option value="standard">Standard</option>
                <option value="high">High</option>
                <option value="maximum">Maximum</option>
              </Select>
            </label>
          </div>
          <Button variant="primary" onClick={start} className="self-end">
            <Download size={13} /> Start export
          </Button>
        </div>
      )}

      {phase === 'running' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            {STEPS.map((label, i) => {
              const frac = (job?.progress ?? 0) / 100;
              const done = frac >= (i + 1) / STEPS.length;
              const current = !done && frac >= i / STEPS.length;
              return (
                <div key={label} className={`flex items-center gap-2 text-sm ${done ? 'text-[#6ee7a0]' : current ? 'text-ink-1' : 'text-ink-3'}`}>
                  {done ? <Check size={13} /> : current ? <CircleDot size={13} className="text-accent-hover" /> : <Circle size={13} />}
                  {label}
                  {current && job?.step && <span className="text-xs text-ink-3">— {job.step}</span>}
                </div>
              );
            })}
          </div>
          <Progress value={job?.progress ?? 0} />
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs text-ink-3">
              <Spinner /> Rendering… {Math.round(job?.progress ?? 0)}%
            </span>
            <Button variant="ghost" size="sm" onClick={cancel}>
              <XCircle size={12} /> Cancel
            </Button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="flex flex-col gap-3 items-center py-2">
          <Check size={24} className="text-[#6ee7a0]" />
          <div className="text-sm">Export complete{outputSize != null ? ` · ${fileSize(outputSize)}` : ''}</div>
          {outputUrl ? (
            <a href={outputUrl} download className="inline-flex">
              <Button variant="primary">
                <Download size={13} /> Download MP4
              </Button>
            </a>
          ) : (
            <div className="text-xs text-ink-3">Output URL unavailable</div>
          )}
          <Button variant="ghost" size="sm" onClick={close}>
            Close
          </Button>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-[#f0a5a8]">{error}</div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Button variant="primary" onClick={start}>
              Retry
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
