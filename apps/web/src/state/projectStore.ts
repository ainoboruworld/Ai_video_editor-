import { create } from 'zustand';
import { api, type Project } from '../lib/api';
import { toast } from './toastStore';

interface ProjectState {
  projects: Project[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (name: string) => Promise<Project | null>;
  rename: (id: string, name: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await api.listProjects();
      set({ projects, loading: false });
    } catch (e: any) {
      set({ error: e.message ?? 'Failed to load projects', loading: false });
    }
  },

  create: async (name) => {
    try {
      const p = await api.createProject(name);
      set({ projects: [p, ...get().projects] });
      return p;
    } catch (e: any) {
      toast.error(`Create failed: ${e.message}`);
      return null;
    }
  },

  rename: async (id, name) => {
    const prev = get().projects;
    set({ projects: prev.map((p) => (p.id === id ? { ...p, name } : p)) });
    try {
      await api.renameProject(id, name);
    } catch (e: any) {
      set({ projects: prev });
      toast.error(`Rename failed: ${e.message}`);
    }
  },

  duplicate: async (id) => {
    try {
      const p = await api.duplicateProject(id);
      set({ projects: [p, ...get().projects] });
      toast.success('Project duplicated');
    } catch (e: any) {
      toast.error(`Duplicate failed: ${e.message}`);
    }
  },

  remove: async (id) => {
    const prev = get().projects;
    set({ projects: prev.filter((p) => p.id !== id) });
    try {
      await api.deleteProject(id);
    } catch (e: any) {
      set({ projects: prev });
      toast.error(`Delete failed: ${e.message}`);
    }
  },
}));
