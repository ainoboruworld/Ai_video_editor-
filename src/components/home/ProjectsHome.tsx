'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clapperboard,
  Copy,
  Film,
  Loader2,
  MoreHorizontal,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, ApiClientError } from '@/lib/api-client';
import type { AspectRatio } from '@/lib/engine';
import type { AiCapabilities, ProjectSummary } from '@/types';
import { Badge, Button, EmptyState, IconButton, Input, Skeleton, Textarea } from '@/components/ui';
import { clock, relativeTime } from '@/lib/format';
import { toast } from '@/state/toastStore';
import { cn } from '@/lib/cn';

const FORMATS: { aspect: AspectRatio; label: string; platforms: string; ratio: string }[] = [
  { aspect: '9:16', label: 'Vertical', platforms: 'Reels · TikTok · Shorts', ratio: 'aspect-[9/16]' },
  { aspect: '16:9', label: 'Landscape', platforms: 'YouTube · Web', ratio: 'aspect-video' },
  { aspect: '1:1', label: 'Square', platforms: 'Feed posts', ratio: 'aspect-square' },
  { aspect: '4:5', label: 'Portrait', platforms: 'Instagram feed', ratio: 'aspect-[4/5]' },
];

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  groq: 'Groq',
  openai: 'OpenAI',
  offline: 'Draft mode',
};

export function ProjectsHome() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [capabilities, setCapabilities] = useState<AiCapabilities | null>(null);
  const [aspect, setAspect] = useState<AspectRatio>('9:16');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { projects: list } = await api.listProjects();
      setProjects(list);
    } catch (caught) {
      setProjects([]);
      setError(caught instanceof ApiClientError ? caught.message : 'Could not load projects');
    }
  }, []);

  useEffect(() => {
    void refresh();
    api
      .config()
      .then(({ capabilities: caps }) => setCapabilities(caps))
      .catch(() => setCapabilities(null));
  }, [refresh]);

  const create = useCallback(
    async () => {
      setCreating(true);
      setError(null);
      try {
        const { project } = await api.createProject({ name: 'My video', aspect });
        router.push(`/projects/${project.id}`);
      } catch (caught) {
        setError(caught instanceof ApiClientError ? caught.message : 'Could not create the project');
        setCreating(false);
      }
    },
    [aspect, router],
  );

  const aiBadge = useMemo(() => {
    if (!capabilities) return null;
    if (capabilities.ai.available) {
      return <Badge tone="accent">{PROVIDER_LABELS[capabilities.ai.active]} connected</Badge>;
    }
    return <Badge tone="warn">Draft mode — no AI key</Badge>;
  }, [capabilities]);

  return (
    <main className="min-h-screen bg-bg-0">
      <div className="grid-bg border-b border-line">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white">
              <Clapperboard size={15} />
            </span>
            <span className="text-sm font-semibold tracking-tight">Reelframe</span>
          </div>
          <div className="flex items-center gap-2">
            {aiBadge}
            {capabilities && !capabilities.stock.pexels && !capabilities.stock.pixabay && !capabilities.stock.unsplash ? (
              <Badge tone="warn">No stock provider</Badge>
            ) : null}
          </div>
        </header>

        <section className="mx-auto max-w-3xl px-6 pb-16 pt-8 text-center">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Upload your video. Edit it in a fraction of the time.
          </h1>
          <p className="mx-auto mt-3 max-w-[54ch] text-sm leading-relaxed text-ink-2">
            Get the transcript, cut the filler words and dead air, smooth the joins, add music, B-roll and captions,
            then export. Every cut is a suggestion you approve — you stay the editor.
          </p>

          <div className="mt-8 rounded-xl border border-line bg-bg-1 p-6 text-left shadow-panel">
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
              <Upload size={22} className="text-ink-3" />
              <p className="text-sm font-medium text-ink-0">Upload your video</p>
              <p className="max-w-[46ch] text-xs leading-relaxed text-ink-2">
                Start a project and drop your recording in. The first pass — reading the audio, finding the pauses and
                the filler words — runs entirely in your browser.
              </p>

              <div className="mt-1 flex items-center gap-1 rounded-lg bg-bg-2 p-1">
                {FORMATS.map((format) => (
                  <button
                    key={format.aspect}
                    type="button"
                    onClick={() => setAspect(format.aspect)}
                    title={format.platforms}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      aspect === format.aspect ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink-0',
                    )}
                  >
                    {format.aspect}
                  </button>
                ))}
              </div>

              <Button
                variant="primary"
                size="lg"
                className="mt-2"
                icon={<Scissors size={14} />}
                loading={creating}
                onClick={() => void create()}
              >
                Edit My Video
              </Button>
              <p className="text-2xs text-ink-3">
                No API key needed to cut pauses or paste a transcript. Keys only add hosted transcription and B-roll.
              </p>
            </div>
          </div>

          {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
        </section>
      </div>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-1">Your projects</h2>
          <Button size="sm" icon={<Plus size={13} />} onClick={() => void create()} disabled={creating}>
            New project
          </Button>
        </div>

        {projects === null ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-40" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-bg-1">
            <EmptyState
              icon={<Film size={22} />}
              title="No projects yet"
              description="Describe a video above, or start blank and upload your own footage."
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onChanged={refresh} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ProjectCard({ project, onChanged }: { project: ProjectSummary; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (action: 'duplicate' | 'delete') => {
    setBusy(true);
    setMenuOpen(false);
    try {
      if (action === 'duplicate') {
        const { project: copy } = await api.duplicateProject(project.id);
        toast.success('Project duplicated');
        router.push(`/projects/${copy.id}`);
        return;
      }
      await api.deleteProject(project.id);
      toast.success('Project deleted');
      await onChanged();
    } catch (error) {
      toast.error('Action failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-lg border border-line bg-bg-1 transition-colors hover:border-line-strong">
      <button
        type="button"
        onClick={() => router.push(`/projects/${project.id}`)}
        className="block w-full text-left"
      >
        <div className="relative aspect-video overflow-hidden bg-bg-2">
          {project.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.thumbnailUrl} alt="" className="h-full w-full object-cover opacity-90" />
          ) : (
            <div className="flex h-full items-center justify-center text-ink-3">
              <Film size={20} />
            </div>
          )}
          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-2xs font-medium text-white">
            {project.aspect}
          </span>
          {project.duration > 0 ? (
            <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-2xs text-white">
              {clock(project.duration)}
            </span>
          ) : null}
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-medium text-ink-0">{project.name}</p>
          <p className="mt-1 flex items-center gap-2 text-2xs text-ink-3">
            <span>{relativeTime(project.updatedAt)}</span>
            {project.sceneCount > 0 ? <span>· {project.sceneCount} scenes</span> : null}
            {project.assetCount > 0 ? <span>· {project.assetCount} assets</span> : null}
          </p>
        </div>
      </button>

      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <IconButton
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Project actions"
          className="bg-black/60 backdrop-blur"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <MoreHorizontal size={14} />}
        </IconButton>
        {menuOpen ? (
          <div className="absolute right-0 top-8 z-10 w-36 overflow-hidden rounded-md border border-line bg-bg-2 shadow-pop">
            <button
              type="button"
              onClick={() => void act('duplicate')}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-xs text-ink-1 hover:bg-bg-3"
            >
              <Copy size={12} /> Duplicate
            </button>
            <button
              type="button"
              onClick={() => void act('delete')}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-xs text-danger hover:bg-danger/10"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

