import 'server-only';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isServerless } from '@/lib/env';
import type { Project, ProjectSummary, RenderJob } from '@/types';
import { toSummary } from './summary';
import type { ProjectStore } from './types';

/**
 * JSON-file store for local development: `npm run dev` needs no database and
 * projects survive a restart. On serverless it degrades to /tmp (per-instance),
 * which `durable` reports honestly.
 */
export class FileProjectStore implements ProjectStore {
  readonly driver = 'file';
  readonly durable = !isServerless;
  private root: string;

  constructor() {
    this.root = isServerless ? '/tmp/ave-data' : resolve(process.cwd(), '.data');
  }

  private projectsDir(ownerId: string): string {
    return join(this.root, 'projects', safe(ownerId));
  }

  private jobsDir(): string {
    return join(this.root, 'renders');
  }

  async init(): Promise<void> {
    await mkdir(join(this.root, 'projects'), { recursive: true });
    await mkdir(this.jobsDir(), { recursive: true });
  }

  async list(ownerId: string): Promise<ProjectSummary[]> {
    const dir = this.projectsDir(ownerId);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const projects: Project[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const project = await readJson<Project>(join(dir, name));
      if (project) projects.push(project);
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(toSummary);
  }

  async get(ownerId: string, projectId: string): Promise<Project | null> {
    const project = await readJson<Project>(join(this.projectsDir(ownerId), `${safe(projectId)}.json`));
    if (!project || project.ownerId !== ownerId) return null;
    return project;
  }

  async put(project: Project): Promise<Project> {
    const dir = this.projectsDir(project.ownerId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${safe(project.id)}.json`), JSON.stringify(project), 'utf8');
    return project;
  }

  async remove(ownerId: string, projectId: string): Promise<void> {
    await rm(join(this.projectsDir(ownerId), `${safe(projectId)}.json`), { force: true });
  }

  async createRenderJob(job: RenderJob): Promise<RenderJob> {
    await mkdir(this.jobsDir(), { recursive: true });
    await writeFile(join(this.jobsDir(), `${safe(job.id)}.json`), JSON.stringify(job), 'utf8');
    return job;
  }

  async getRenderJob(ownerId: string, jobId: string): Promise<RenderJob | null> {
    const job = await readJson<RenderJob>(join(this.jobsDir(), `${safe(jobId)}.json`));
    if (!job || job.ownerId !== ownerId) return null;
    return job;
  }

  async updateRenderJob(jobId: string, patch: Partial<RenderJob>): Promise<RenderJob | null> {
    const path = join(this.jobsDir(), `${safe(jobId)}.json`);
    const job = await readJson<RenderJob>(path);
    if (!job) return null;
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    await writeFile(path, JSON.stringify(next), 'utf8');
    return next;
  }

  async listRenderJobs(ownerId: string, projectId: string): Promise<RenderJob[]> {
    let names: string[];
    try {
      names = await readdir(this.jobsDir());
    } catch {
      return [];
    }
    const jobs: RenderJob[] = [];
    for (const name of names) {
      const job = await readJson<RenderJob>(join(this.jobsDir(), name));
      if (job && job.ownerId === ownerId && job.projectId === projectId) jobs.push(job);
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

function safe(value: string): string {
  return value.replace(/[^\w-]+/g, '') || 'anon';
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
