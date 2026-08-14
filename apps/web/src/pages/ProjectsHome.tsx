import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clapperboard,
  Plus,
  Upload,
  MoreVertical,
  Pencil,
  Copy,
  Trash2,
  Film,
  AlertCircle,
} from 'lucide-react';
import { useProjectStore } from '../state/projectStore';
import { api, type Project } from '../lib/api';
import { relativeTime } from '../lib/format';
import { Button, Input, Modal, Progress, Spinner, EmptyState } from '../components/ui';
import { toast } from '../state/toastStore';

export default function ProjectsHome() {
  const { projects, loading, error, load, create, rename, duplicate, remove } = useProjectStore();
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const close = () => setMenuFor(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  async function openProject(p: Project) {
    try {
      const full = await api.getProject(p.id);
      let seq = full.sequences?.[0];
      if (!seq) seq = await api.createSequence(p.id, 'Sequence 1');
      navigate(`/editor/${seq.id}`);
    } catch (e: any) {
      toast.error(`Open failed: ${e.message}`);
    }
  }

  return (
    <div className="min-h-full bg-bg-1">
      <header className="h-12 border-b border-line flex items-center px-5 gap-2.5 sticky top-0 bg-bg-1/95 backdrop-blur z-10">
        <div className="w-6 h-6 rounded bg-accent flex items-center justify-center">
          <Clapperboard size={14} className="text-white" />
        </div>
        <span className="font-semibold text-sm tracking-tight">AVE</span>
        <span className="text-ink-3 text-sm">AI Video Editor</span>
        <div className="flex-1" />
        <Button variant="primary" onClick={() => setNewOpen(true)}>
          <Plus size={13} /> New project
        </Button>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-6">
        <h1 className="text-sm font-semibold text-ink-2 mb-3">Recent projects</h1>

        {loading && (
          <div className="flex items-center gap-2 text-ink-3 py-10 justify-center">
            <Spinner /> Loading projects…
          </div>
        )}

        {error && !loading && (
          <div className="border border-[#4a2225] bg-[#2b1517] rounded p-4 flex items-center gap-3 text-sm text-[#f0a5a8]">
            <AlertCircle size={16} />
            <div className="flex-1">{error}</div>
            <Button size="sm" onClick={() => load()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <EmptyState
            icon={<Film size={28} />}
            title="No projects yet"
            hint="Create a project and import a video to start editing."
            action={
              <Button variant="primary" onClick={() => setNewOpen(true)}>
                <Plus size={13} /> New project
              </Button>
            }
          />
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group border border-line rounded bg-bg-2 hover:border-[#3a3b40] transition-colors cursor-pointer overflow-hidden"
              onClick={() => openProject(p)}
            >
              <div className="aspect-video bg-bg-0 flex items-center justify-center relative">
                {p.thumbnailUrl ? (
                  <img src={p.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Film size={22} className="text-ink-3" />
                )}
              </div>
              <div className="px-2.5 py-2 flex items-start gap-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-ink-3">Updated {relativeTime(p.updatedAt)}</div>
                </div>
                <div className="relative">
                  <button
                    className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-ink-1 p-0.5 rounded hover:bg-bg-4 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(menuFor === p.id ? null : p.id);
                    }}
                    title="Project actions"
                  >
                    <MoreVertical size={14} />
                  </button>
                  {menuFor === p.id && (
                    <div
                      className="absolute right-0 top-6 z-20 w-36 bg-bg-3 border border-line rounded shadow-xl py-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MenuItem
                        icon={<Pencil size={12} />}
                        label="Rename"
                        onClick={() => {
                          setRenaming(p);
                          setRenameValue(p.name);
                          setMenuFor(null);
                        }}
                      />
                      <MenuItem
                        icon={<Copy size={12} />}
                        label="Duplicate"
                        onClick={() => {
                          duplicate(p.id);
                          setMenuFor(null);
                        }}
                      />
                      <MenuItem
                        icon={<Trash2 size={12} />}
                        label="Delete"
                        danger
                        onClick={() => {
                          if (confirm(`Delete "${p.name}"? This cannot be undone.`)) remove(p.id);
                          setMenuFor(null);
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      <NewProjectModal open={newOpen} onClose={() => setNewOpen(false)} />

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename project">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (renaming && renameValue.trim()) rename(renaming.id, renameValue.trim());
            setRenaming(null);
          }}
          className="flex flex-col gap-3"
        >
          <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Rename
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-2.5 h-7 text-sm hover:bg-bg-4 ${
        danger ? 'text-[#f0a5a8]' : 'text-ink-1'
      }`}
      onClick={onClick}
    >
      {icon} {label}
    </button>
  );
}

function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('Untitled project');
  const [phase, setPhase] = useState<'form' | 'uploading' | 'creating'>('form');
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const createProject = useProjectStore((s) => s.create);

  async function createBlank() {
    setPhase('creating');
    const p = await createProject(name.trim() || 'Untitled project');
    if (!p) return setPhase('form');
    try {
      const seq = await api.createSequence(p.id, 'Sequence 1');
      navigate(`/editor/${seq.id}`);
    } catch (e: any) {
      toast.error(`Failed to create sequence: ${e.message}`);
      setPhase('form');
    }
  }

  async function createWithImport(file: File) {
    setPhase('uploading');
    setProgress(0);
    const p = await createProject(name.trim() === 'Untitled project' ? file.name.replace(/\.[^.]+$/, '') : name.trim());
    if (!p) return setPhase('form');
    try {
      await api.uploadAsset(p.id, file, (f) => setProgress(f * 100));
      const seq = await api.createSequence(p.id, 'Sequence 1');
      toast.success('Uploading in background — asset will appear in Media once ready');
      navigate(`/editor/${seq.id}`);
    } catch (e: any) {
      toast.error(`Import failed: ${e.message}`);
      setPhase('form');
    }
  }

  return (
    <Modal open={open} onClose={phase === 'form' ? onClose : () => {}} title="New project">
      {phase === 'form' && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-2">Project name</span>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              onClick={createBlank}
              className="border border-line rounded p-3 hover:border-accent hover:bg-accent/5 transition-colors text-left"
            >
              <Plus size={16} className="text-accent-hover mb-1.5" />
              <div className="text-sm font-medium">Blank project</div>
              <div className="text-xs text-ink-3 mt-0.5">Start with an empty timeline</div>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="border border-line rounded p-3 hover:border-accent hover:bg-accent/5 transition-colors text-left"
            >
              <Upload size={16} className="text-accent-hover mb-1.5" />
              <div className="text-sm font-medium">Import video</div>
              <div className="text-xs text-ink-3 mt-0.5">Upload a file to begin</div>
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="video/*,audio/*,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) createWithImport(f);
            }}
          />
        </div>
      )}
      {phase === 'uploading' && (
        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Spinner /> Uploading… {Math.round(progress)}%
          </div>
          <Progress value={progress} />
        </div>
      )}
      {phase === 'creating' && (
        <div className="flex items-center gap-2 text-sm py-3">
          <Spinner /> Creating project…
        </div>
      )}
    </Modal>
  );
}
