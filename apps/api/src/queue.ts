import type { ChildProcess } from 'node:child_process';
import { prisma } from './db.js';

export interface JobContext {
  jobId: string;
  setProgress(progress: number, step?: string): Promise<void>;
  /** Register the currently running child process so cancel can kill it. */
  registerChild(child: ChildProcess | null): void;
  isCancelled(): boolean;
}

type JobFn = (ctx: JobContext) => Promise<unknown>;

interface QueueEntry {
  jobId: string;
  fn: JobFn;
}

const pending: QueueEntry[] = [];
const running = new Map<string, { child: ChildProcess | null; cancelled: boolean }>();
let active = 0;
const CONCURRENCY = 2;

export async function createJob(type: string, refId: string | null, fn: JobFn): Promise<string> {
  const job = await prisma.job.create({ data: { type, refId, status: 'queued' } });
  pending.push({ jobId: job.id, fn });
  void pump();
  return job.id;
}

async function pump(): Promise<void> {
  while (active < CONCURRENCY && pending.length > 0) {
    const entry = pending.shift()!;
    active++;
    void runEntry(entry).finally(() => {
      active--;
      void pump();
    });
  }
}

async function runEntry(entry: QueueEntry): Promise<void> {
  const state = { child: null as ChildProcess | null, cancelled: false };
  running.set(entry.jobId, state);
  const ctx: JobContext = {
    jobId: entry.jobId,
    async setProgress(progress, step) {
      try {
        await prisma.job.update({
          where: { id: entry.jobId },
          data: { progress: Math.max(0, Math.min(1, progress)), ...(step !== undefined ? { step } : {}) },
        });
      } catch {
        /* job may have been deleted */
      }
    },
    registerChild(child) {
      state.child = child;
      if (state.cancelled && child) child.kill('SIGKILL');
    },
    isCancelled() {
      return state.cancelled;
    },
  };
  try {
    await prisma.job.update({ where: { id: entry.jobId }, data: { status: 'running' } });
    const result = await entry.fn(ctx);
    if (state.cancelled) {
      await prisma.job.update({ where: { id: entry.jobId }, data: { status: 'error', error: 'Cancelled' } });
    } else {
      await prisma.job.update({
        where: { id: entry.jobId },
        data: { status: 'done', progress: 1, result: JSON.stringify(result ?? null) },
      });
    }
  } catch (err) {
    const message = state.cancelled ? 'Cancelled' : err instanceof Error ? err.message : String(err);
    try {
      await prisma.job.update({ where: { id: entry.jobId }, data: { status: 'error', error: message } });
    } catch {
      /* ignore */
    }
  } finally {
    running.delete(entry.jobId);
  }
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const idx = pending.findIndex((e) => e.jobId === jobId);
  if (idx !== -1) {
    pending.splice(idx, 1);
    await prisma.job.update({ where: { id: jobId }, data: { status: 'error', error: 'Cancelled' } });
    return true;
  }
  const state = running.get(jobId);
  if (state) {
    state.cancelled = true;
    if (state.child) state.child.kill('SIGKILL');
    return true;
  }
  return false;
}
