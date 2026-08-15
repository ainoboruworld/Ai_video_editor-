'use client';

/**
 * Editor state.
 *
 * The project document is the single source of truth; every mutation goes
 * through the command engine so undo/redo, AI edits and manual edits share one
 * code path. Saving is debounced and optimistic — editing never blocks on the
 * network, and a local snapshot survives a crashed tab or an ephemeral server.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import {
  EditorHistory,
  sequenceDuration,
  type AspectRatio,
  type Clip,
  type EditorCommand,
  type Sequence,
  type Track,
} from '@/lib/engine';
import { api, ApiClientError } from '@/lib/api-client';
import type { AiCapabilities, Asset, Project, StoredTranscript } from '@/types';
import { toast } from './toastStore';
import { loadSnapshot, saveSnapshot } from '@/features/projects/localSnapshot';
import type { AudioAnalysis } from '@/features/analysis/audioAnalysis';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
export type PanelId =
  | 'edit'
  | 'media'
  | 'broll'
  | 'text'
  | 'captions'
  | 'transcript'
  | 'audio'
  | 'autoedit'
  | 'effects'
  | 'transitions';

interface EditorState {
  loaded: boolean;
  loadError: string | null;
  projectId: string | null;
  name: string;
  aspect: AspectRatio;
  fps: number;
  version: number;
  sequence: Sequence | null;
  assets: Asset[];
  transcript: StoredTranscript | null;
  /**
   * Audio analysis for the current recording, and the user's decisions about
   * the fillers found in it. Both live here rather than in the Edit panel
   * because switching rails unmounts that panel, and re-analysing the audio
   * every time the user glances at the transcript is not acceptable. Neither
   * is persisted: the envelope is derived from media that is already saved.
   */
  audioAnalysis: AudioAnalysis | null;
  fillerDecisions: Record<string, boolean>;
  capabilities: AiCapabilities | null;

  history: EditorHistory;
  historyTick: number;

  playhead: number;
  playing: boolean;
  zoom: number;
  selection: string[];
  snapEnabled: boolean;
  activePanel: PanelId;
  saveStatus: SaveStatus;
  saveError: string | null;

  load: (projectId: string) => Promise<void>;
  setCapabilities: (capabilities: AiCapabilities) => void;
  apply: (commands: EditorCommand | EditorCommand[], label: string) => boolean;
  undo: () => void;
  redo: () => void;
  saveNow: () => Promise<void>;
  rename: (name: string) => void;
  setAspect: (aspect: AspectRatio) => void;

  setPlayhead: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  select: (ids: string[], additive?: boolean) => void;
  toggleSnap: () => void;
  setPanel: (panel: PanelId) => void;

  addAsset: (asset: Asset) => void;
  removeAsset: (assetId: string) => void;
  setTranscript: (transcript: StoredTranscript | null) => void;
  setAudioAnalysis: (analysis: AudioAnalysis | null) => void;
  setFillerDecision: (id: string, accepted: boolean) => void;
  setFillerDecisions: (decisions: Record<string, boolean>) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let flashTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditorStore = create<EditorState>((set, get) => ({
  loaded: false,
  loadError: null,
  projectId: null,
  name: '',
  aspect: '9:16',
  fps: 30,
  version: 0,
  sequence: null,
  assets: [],
  transcript: null,
  audioAnalysis: null,
  fillerDecisions: {},
  capabilities: null,

  history: new EditorHistory(),
  historyTick: 0,

  playhead: 0,
  playing: false,
  zoom: 48,
  selection: [],
  snapEnabled: true,
  activePanel: 'media',
  saveStatus: 'idle',
  saveError: null,

  load: async (projectId) => {
    set({ loaded: false, loadError: null, projectId, sequence: null, selection: [], playhead: 0, playing: false });
    try {
      const { project } = await api.getProject(projectId);
      const snapshot = loadSnapshot(projectId);
      // A newer local snapshot means the tab closed before the last save
      // landed (or the server store is ephemeral) — restore it.
      const restore = snapshot && snapshot.updatedAt > project.updatedAt ? snapshot.project : project;
      hydrate(set, restore, project.version);
      if (restore !== project) {
        toast.info('Restored unsaved changes from this browser');
        scheduleSave(get, set, 0);
      }
    } catch (error) {
      const snapshot = loadSnapshot(projectId);
      if (snapshot) {
        hydrate(set, snapshot.project, snapshot.project.version);
        toast.warn('Working offline', 'Loaded this project from local storage.');
        return;
      }
      set({
        loaded: true,
        loadError: error instanceof Error ? error.message : 'Could not load this project',
      });
    }
  },

  setCapabilities: (capabilities) => set({ capabilities }),

  apply: (commands, label) => {
    const { sequence, history } = get();
    if (!sequence) return false;
    try {
      const next = history.apply(sequence, commands, label);
      if (next === sequence) return false;
      set({ sequence: next, historyTick: get().historyTick + 1, saveStatus: 'dirty' });
      scheduleSave(get, set);
      return true;
    } catch (error) {
      toast.error('Edit failed', error instanceof Error ? error.message : undefined);
      return false;
    }
  },

  undo: () => {
    const { sequence, history } = get();
    if (!sequence) return;
    const previous = history.undo(sequence);
    if (!previous) return;
    set({ sequence: previous, historyTick: get().historyTick + 1, saveStatus: 'dirty', selection: [] });
    scheduleSave(get, set);
  },

  redo: () => {
    const { sequence, history } = get();
    if (!sequence) return;
    const next = history.redo(sequence);
    if (!next) return;
    set({ sequence: next, historyTick: get().historyTick + 1, saveStatus: 'dirty', selection: [] });
    scheduleSave(get, set);
  },

  saveNow: async () => {
    if (saveTimer) clearTimeout(saveTimer);
    await persist(get, set);
  },

  rename: (name) => {
    set({ name, saveStatus: 'dirty' });
    get().apply({ type: 'RENAME_SEQUENCE', name }, 'Rename project');
    scheduleSave(get, set);
  },

  setAspect: (aspect) => {
    set({ aspect });
    get().apply({ type: 'CHANGE_ASPECT_RATIO', aspect }, 'Change aspect ratio');
  },

  setPlayhead: (time) => set({ playhead: Math.max(0, time) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (zoom) => set({ zoom: Math.max(4, Math.min(400, zoom)) }),
  select: (ids, additive) =>
    set((state) => {
      if (!additive) return { selection: ids };
      const next = new Set(state.selection);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return { selection: [...next] };
    }),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  setPanel: (panel) => set({ activePanel: panel }),

  addAsset: (asset) => {
    set((state) => ({
      assets: [asset, ...state.assets.filter((a) => a.id !== asset.id)],
      saveStatus: 'dirty',
    }));
    scheduleSave(get, set);
  },

  removeAsset: (assetId) => {
    const { sequence } = get();
    const inUse = sequence?.tracks.some((track) => track.clips.some((clip) => clip.assetId === assetId));
    if (inUse) {
      toast.warn('That media is used on the timeline', 'Delete its clips first.');
      return;
    }
    set((state) => ({ assets: state.assets.filter((a) => a.id !== assetId), saveStatus: 'dirty' }));
    scheduleSave(get, set);
  },


  setTranscript: (transcript) => {
    set({ transcript, saveStatus: 'dirty' });
    scheduleSave(get, set);
  },

  setAudioAnalysis: (analysis) => set({ audioAnalysis: analysis }),

  setFillerDecision: (id, accepted) =>
    set((state) => ({ fillerDecisions: { ...state.fillerDecisions, [id]: accepted } })),

  setFillerDecisions: (decisions) => set({ fillerDecisions: decisions }),

}));

type Setter = (partial: Partial<EditorState>) => void;

function hydrate(set: Setter, project: Project, version: number): void {
  set({
    loaded: true,
    loadError: null,
    projectId: project.id,
    name: project.name,
    aspect: project.aspect,
    fps: project.fps,
    sequence: project.sequence,
    assets: project.assets,
    transcript: project.transcript ?? null,
    version,
    history: new EditorHistory(),
    historyTick: 0,
    saveStatus: 'idle',
    zoom: fitZoom(project.sequence),
  });
}

function fitZoom(sequence: Sequence): number {
  const duration = sequenceDuration(sequence);
  if (duration <= 0) return 48;
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth - 420;
  return Math.max(8, Math.min(160, width / duration));
}

function scheduleSave(get: () => EditorState, set: Setter, delay = 900): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist(get, set), delay);
}

/** Serialises the current project document for the API and local snapshot. */
export function serializeProject(state: EditorState): Project | null {
  if (!state.sequence || !state.projectId) return null;
  return {
    id: state.projectId,
    ownerId: '',
    name: state.name,
    aspect: state.aspect,
    width: state.sequence.width,
    height: state.sequence.height,
    fps: state.fps,
    sequence: state.sequence,
    assets: state.assets,
    transcript: state.transcript,
    settings: {
      brollProviders: ['pexels', 'pixabay', 'unsplash'],
      captionStyle: 'bold',
      musicVolume: 0.18,
      voiceoverVolume: 1,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: state.version,
  };
}

async function persist(get: () => EditorState, set: Setter): Promise<void> {
  const state = get();
  const document = serializeProject(state);
  if (!document || !state.projectId) return;

  // Local snapshot first: it must survive even if the request fails.
  saveSnapshot(state.projectId, document);

  set({ saveStatus: 'saving', saveError: null });
  try {
    const { project } = await api.saveProject(state.projectId, {
      name: document.name,
      aspect: document.aspect,
      fps: document.fps,
      sequence: document.sequence,
      assets: document.assets,
      transcript: document.transcript,
      version: state.version,
    });
    set({ version: project.version, saveStatus: 'saved', saveError: null });
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      if (get().saveStatus === 'saved') set({ saveStatus: 'idle' });
    }, 1800);
  } catch (error) {
    const message = error instanceof ApiClientError ? error.message : 'Could not save';
    set({ saveStatus: 'error', saveError: message });
    if (error instanceof ApiClientError && error.code === 'version_conflict') {
      toast.error('This project changed elsewhere', 'Reload the page to get the latest version.');
    }
  }
}

// ------------------------------------------------------------- selectors ---

export function findClip(sequence: Sequence, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of sequence.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function selectedClips(state: EditorState): { track: Track; clip: Clip }[] {
  if (!state.sequence) return [];
  return state.selection
    .map((id) => findClip(state.sequence!, id))
    .filter((entry): entry is { track: Track; clip: Clip } => entry !== null);
}

/**
 * Selectors must return stable references: zustand compares with Object.is, so
 * building a new object inside the selector would re-render forever.
 * Select stable slices, then derive with `useMemo`.
 */
export function useSelectedClip(): { track: Track; clip: Clip } | null {
  const sequence = useEditorStore((state) => state.sequence);
  const clipId = useEditorStore((state) => state.selection[0] ?? null);
  return useMemo(() => (sequence && clipId ? findClip(sequence, clipId) : null), [sequence, clipId]);
}

export function useAssetMap(): Map<string, Asset> {
  const assets = useEditorStore((state) => state.assets);
  return useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
}
