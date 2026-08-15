import type { Project, ProjectSummary, RenderJob } from '@/types';

export interface ProjectStore {
  readonly driver: string;
  /** False when data does not survive a redeploy / cold start. */
  readonly durable: boolean;
  init(): Promise<void>;
  list(ownerId: string): Promise<ProjectSummary[]>;
  get(ownerId: string, projectId: string): Promise<Project | null>;
  put(project: Project): Promise<Project>;
  remove(ownerId: string, projectId: string): Promise<void>;

  createRenderJob(job: RenderJob): Promise<RenderJob>;
  getRenderJob(ownerId: string, jobId: string): Promise<RenderJob | null>;
  updateRenderJob(jobId: string, patch: Partial<RenderJob>): Promise<RenderJob | null>;
  listRenderJobs(ownerId: string, projectId: string): Promise<RenderJob[]>;
}

export class OwnershipError extends Error {
  constructor(message = 'Project not found') {
    super(message);
  }
}
