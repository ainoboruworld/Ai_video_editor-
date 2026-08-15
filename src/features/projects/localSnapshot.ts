'use client';

/**
 * Crash/offline safety net.
 *
 * Every save writes the project document to localStorage before it goes to the
 * server. If the tab dies mid-edit, the API is unreachable, or the deployment
 * uses an ephemeral store, the editor can still recover the user's work.
 */
import type { Project } from '@/types';

const PREFIX = 'ave:snapshot:';
const MAX_SNAPSHOTS = 12;

interface Snapshot {
  project: Project;
  updatedAt: string;
}

export function saveSnapshot(projectId: string, project: Project): void {
  if (typeof window === 'undefined') return;
  const snapshot: Snapshot = { project, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(`${PREFIX}${projectId}`, JSON.stringify(snapshot));
    pruneSnapshots();
  } catch {
    // Quota exceeded (large project) — drop the oldest snapshots and retry once.
    pruneSnapshots(true);
    try {
      window.localStorage.setItem(`${PREFIX}${projectId}`, JSON.stringify(snapshot));
    } catch {
      // Give up silently: the server save is still the primary path.
    }
  }
}

export function loadSnapshot(projectId: string): Snapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${projectId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    return parsed?.project?.sequence ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSnapshot(projectId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(`${PREFIX}${projectId}`);
}

function pruneSnapshots(aggressive = false): void {
  const keys: { key: string; updatedAt: string }[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? '{}') as Snapshot;
      keys.push({ key, updatedAt: parsed.updatedAt ?? '' });
    } catch {
      keys.push({ key, updatedAt: '' });
    }
  }
  const limit = aggressive ? 2 : MAX_SNAPSHOTS;
  keys
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(limit)
    .forEach(({ key }) => window.localStorage.removeItem(key));
}
