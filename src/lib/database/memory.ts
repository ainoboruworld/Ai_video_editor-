import type { Project, ProjectSummary, RenderJob } from '@/types';
import { toSummary } from './summary';
import type { ProjectStore } from './types';

/**
 * In-process store. Used by tests and as the final fallback so the API always
 * has a working backend; it advertises `durable: false` so the UI can tell the
 * user their work only lives in this browser session unless a database is
 * configured.
 */
export class MemoryProjectStore implements ProjectStore {
  readonly driver = 'memory';
  readonly durable = false;
  private projects = new Map<string, Project>();
  private jobs = new Map<string, RenderJob>();

  async init(): Promise<void> {}

  async list(ownerId: string): Promise<ProjectSummary[]> {
    return [...this.projects.values()]
      .filter((p) => p.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toSummary);
  }

  async get(ownerId: string, projectId: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project || project.ownerId !== ownerId) return null;
    return project;
  }

  async put(project: Project): Promise<Project> {
    this.projects.set(project.id, project);
    return project;
  }

  async remove(ownerId: string, projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (project && project.ownerId === ownerId) this.projects.delete(projectId);
  }

  async createRenderJob(job: RenderJob): Promise<RenderJob> {
    this.jobs.set(job.id, job);
    return job;
  }

  async getRenderJob(ownerId: string, jobId: string): Promise<RenderJob | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== ownerId) return null;
    return job;
  }

  async updateRenderJob(jobId: string, patch: Partial<RenderJob>): Promise<RenderJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(jobId, next);
    return next;
  }

  async listRenderJobs(ownerId: string, projectId: string): Promise<RenderJob[]> {
    return [...this.jobs.values()].filter((j) => j.ownerId === ownerId && j.projectId === projectId);
  }
}
