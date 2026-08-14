import { create } from 'zustand';
import {
  EditorHistory,
  sequenceDuration,
  type EditorCommand,
  type Sequence,
} from '@ave/editor-core';
import { api, type Asset, type SequenceRow, type Transcript } from '../lib/api';
import { toast } from './toastStore';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed';
export type PanelId = 'media' | 'audio' | 'text' | 'captions' | 'broll' | 'transitions' | 'ai' | 'transcript';

export interface ClipboardClipData {
  // serialized clips with times relative to earliest clip
  clips: import('@ave/editor-core').Clip[];
}

interface EditorState {
  // loading
  loaded: boolean;
  loadError: string | null;

  sequenceId: string | null;
  projectId: string | null;
  projectName: string;
  sequenceRow: SequenceRow | null;
  sequence: Sequence | null;
  version: number;
  history: EditorHistory;
  historyTick: number; // bump to re-render undo/redo buttons

  playhead: number;
  playing: boolean;
  zoom: number; // px per second
  scrollX: number;
  selection: string[];
  snapEnabled: boolean;
  snapGuide: number | null;
  activePanel: PanelId;
  saveStatus: SaveStatus;

  assets: Asset[];
  transcript: Transcript | null;
  transcriptAssetId: string | null;
  clipboard: ClipboardClipData | null;

  // actions
  load: (sequenceId: string) => Promise<void>;
  reset: () => void;
  apply: (commands: EditorCommand | EditorCommand[], label: string) => boolean;
  undo: () => void;
  redo: () => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (z: number) => void;
  setScrollX: (x: number) => void;
  select: (ids: string[], additive?: boolean) => void;
  toggleSnap: () => void;
  setActivePanel: (p: PanelId) => void;
  setClipboard: (c: ClipboardClipData | null) => void;
  refreshAssets: () => Promise<void>;
  upsertAsset: (a: Asset) => void;
  setTranscript: (t: Transcript | null, assetId: string | null) => void;
  renameSequenceRow: (name: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savedFlashTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditorStore = create<EditorState>((set, get) => ({
  loaded: false,
  loadError: null,
  sequenceId: null,
  projectId: null,
  projectName: '',
  sequenceRow: null,
  sequence: null,
  version: 0,
  history: new EditorHistory(),
  historyTick: 0,
  playhead: 0,
  playing: false,
  zoom: 60,
  scrollX: 0,
  selection: [],
  snapEnabled: true,
  snapGuide: null,
  activePanel: 'media',
  saveStatus: 'idle',
  assets: [],
  transcript: null,
  transcriptAssetId: null,
  clipboard: null,

  load: async (sequenceId) => {
    set({
      loaded: false,
      loadError: null,
      sequenceId,
      sequence: null,
      selection: [],
      playhead: 0,
      playing: false,
      history: new EditorHistory(),
      historyTick: 0,
      transcript: null,
      transcriptAssetId: null,
      saveStatus: 'idle',
    });
    try {
      const row = await api.getSequence(sequenceId);
      set({
        sequenceRow: row,
        sequence: row.doc,
        version: row.version,
        projectId: row.projectId,
        loaded: true,
      });
      // fit zoom roughly to content
      const dur = sequenceDuration(row.doc);
      if (dur > 0) {
        const target = Math.max(8, Math.min(200, (window.innerWidth - 200) / dur));
        set({ zoom: target });
      }
      // load project name + assets in the background
      api
        .getProject(row.projectId)
        .then((p) => {
          set({ projectName: p.name, assets: p.assets ?? [] });
        })
        .catch(() => {
          /* non-fatal */
        });
    } catch (e: any) {
      set({ loadError: e.message ?? 'Failed to load sequence', loaded: true });
    }
  },

  reset: () => {
    if (saveTimer) clearTimeout(saveTimer);
    set({
      loaded: false,
      loadError: null,
      sequenceId: null,
      sequenceRow: null,
      sequence: null,
      playing: false,
      selection: [],
      transcript: null,
      transcriptAssetId: null,
    });
  },

  apply: (commands, label) => {
    const { sequence, history } = get();
    if (!sequence) return false;
    try {
      const next = history.apply(sequence, commands, label);
      if (next === sequence) return false;
      set({ sequence: next, historyTick: get().historyTick + 1, saveStatus: 'dirty' });
      scheduleSave(get, set);
      return true;
    } catch (e: any) {
      toast.error(`Edit failed: ${e.message}`);
      return false;
    }
  },

  undo: () => {
    const { sequence, history } = get();
    if (!sequence) return;
    const prev = history.undo(sequence);
    if (prev) {
      set({ sequence: prev, historyTick: get().historyTick + 1, saveStatus: 'dirty', selection: [] });
      scheduleSave(get, set);
    }
  },

  redo: () => {
    const { sequence, history } = get();
    if (!sequence) return;
    const next = history.redo(sequence);
    if (next) {
      set({ sequence: next, historyTick: get().historyTick + 1, saveStatus: 'dirty', selection: [] });
      scheduleSave(get, set);
    }
  },

  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (p) => set({ playing: p }),
  setZoom: (z) => set({ zoom: Math.max(2, Math.min(400, z)) }),
  setScrollX: (x) => set({ scrollX: x }),
  select: (ids, additive) =>
    set((s) => {
      if (!additive) return { selection: ids };
      const cur = new Set(s.selection);
      for (const id of ids) {
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
      }
      return { selection: [...cur] };
    }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  setActivePanel: (p) => set({ activePanel: p }),
  setClipboard: (c) => set({ clipboard: c }),

  refreshAssets: async () => {
    const { projectId } = get();
    if (!projectId) return;
    try {
      const assets = await api.listAssets(projectId);
      set({ assets });
    } catch {
      /* keep old */
    }
  },

  upsertAsset: (a) =>
    set((s) => {
      const idx = s.assets.findIndex((x) => x.id === a.id);
      if (idx === -1) return { assets: [a, ...s.assets] };
      const assets = [...s.assets];
      assets[idx] = a;
      return { assets };
    }),

  setTranscript: (t, assetId) => set({ transcript: t, transcriptAssetId: assetId }),

  renameSequenceRow: (name) => {
    get().apply({ type: 'RENAME_SEQUENCE', name }, 'Rename sequence');
  },
}));

function scheduleSave(get: () => EditorState, set: (p: Partial<EditorState>) => void) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { sequenceId, sequence, version } = get();
    if (!sequenceId || !sequence) return;
    set({ saveStatus: 'saving' });
    try {
      const res = await api.saveSequence(sequenceId, sequence, version);
      set({ version: res.version, saveStatus: 'saved' });
      if (savedFlashTimer) clearTimeout(savedFlashTimer);
      savedFlashTimer = setTimeout(() => {
        if (useEditorStore.getState().saveStatus === 'saved') set({ saveStatus: 'idle' });
      }, 2000);
    } catch (e: any) {
      set({ saveStatus: 'failed' });
    }
  }, 800);
}

// ---------- Selectors / helpers ----------

export function findClip(seq: Sequence, clipId: string) {
  for (const track of seq.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** Topmost visible clip under a time, preferring video tracks in order. */
export function clipAt(seq: Sequence, time: number, kinds?: string[]) {
  for (const track of seq.tracks) {
    if (kinds && !kinds.includes(track.kind)) continue;
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clip.duration) return { track, clip };
    }
  }
  return null;
}

/** The primary asset of the sequence: asset of first clip on first video track, else first ready video asset. */
export function primaryAssetId(state: Pick<EditorState, 'sequence' | 'assets'>): string | null {
  const seq = state.sequence;
  if (seq) {
    for (const track of seq.tracks) {
      if (track.kind !== 'video') continue;
      for (const clip of track.clips) {
        if (clip.assetId) return clip.assetId;
      }
    }
  }
  const ready = state.assets.find((a) => a.kind === 'video' && a.status === 'ready');
  return ready?.id ?? state.assets.find((a) => a.kind === 'video')?.id ?? null;
}
