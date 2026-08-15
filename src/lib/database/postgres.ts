import 'server-only';
import type { Pool } from 'pg';
import { env } from '@/lib/env';
import type { Project, ProjectSummary, RenderJob } from '@/types';
import { toSummary } from './summary';
import type { ProjectStore } from './types';

/**
 * Postgres store (Vercel Postgres, Neon, Supabase, RDS…). The project document
 * is stored as JSONB: the editor's document model is the source of truth and
 * the schema stays stable while the editor evolves. Ownership is enforced in
 * every query — a user can never read another user's row.
 */
export class PostgresProjectStore implements ProjectStore {
  readonly driver = 'postgres';
  readonly durable = true;
  private pool: Pool | null = null;
  private ready: Promise<void> | null = null;

  private async getPool(): Promise<Pool> {
    if (!this.pool) {
      const { Pool: PgPool } = await import('pg');
      this.pool = new PgPool({
        connectionString: env.DATABASE_URL!,
        max: 3,
        ssl: shouldUseSsl(env.DATABASE_URL!) ? { rejectUnauthorized: false } : undefined,
      });
    }
    return this.pool;
  }

  async init(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const pool = await this.getPool();
        await pool.query(`
          CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            name TEXT NOT NULL,
            doc JSONB NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (owner_id, updated_at DESC);`);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS render_jobs (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            doc JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
        `);
        await pool.query(
          `CREATE INDEX IF NOT EXISTS render_jobs_owner_idx ON render_jobs (owner_id, project_id, created_at DESC);`,
        );
      })();
    }
    await this.ready;
  }

  async list(ownerId: string): Promise<ProjectSummary[]> {
    await this.init();
    const pool = await this.getPool();
    const res = await pool.query<{ doc: Project }>(
      'SELECT doc FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 200',
      [ownerId],
    );
    return res.rows.map((row) => toSummary(row.doc));
  }

  async get(ownerId: string, projectId: string): Promise<Project | null> {
    await this.init();
    const pool = await this.getPool();
    const res = await pool.query<{ doc: Project }>(
      'SELECT doc FROM projects WHERE id = $1 AND owner_id = $2 LIMIT 1',
      [projectId, ownerId],
    );
    return res.rows[0]?.doc ?? null;
  }

  async put(project: Project): Promise<Project> {
    await this.init();
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO projects (id, owner_id, name, doc, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             doc = EXCLUDED.doc,
             version = EXCLUDED.version,
             updated_at = EXCLUDED.updated_at
         WHERE projects.owner_id = EXCLUDED.owner_id`,
      [project.id, project.ownerId, project.name, project, project.version, project.createdAt, project.updatedAt],
    );
    return project;
  }

  async remove(ownerId: string, projectId: string): Promise<void> {
    await this.init();
    const pool = await this.getPool();
    await pool.query('DELETE FROM projects WHERE id = $1 AND owner_id = $2', [projectId, ownerId]);
  }

  async createRenderJob(job: RenderJob): Promise<RenderJob> {
    await this.init();
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO render_jobs (id, owner_id, project_id, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
      [job.id, job.ownerId, job.projectId, job, job.createdAt, job.updatedAt],
    );
    return job;
  }

  async getRenderJob(ownerId: string, jobId: string): Promise<RenderJob | null> {
    await this.init();
    const pool = await this.getPool();
    const res = await pool.query<{ doc: RenderJob }>(
      'SELECT doc FROM render_jobs WHERE id = $1 AND owner_id = $2 LIMIT 1',
      [jobId, ownerId],
    );
    return res.rows[0]?.doc ?? null;
  }

  async updateRenderJob(jobId: string, patch: Partial<RenderJob>): Promise<RenderJob | null> {
    await this.init();
    const pool = await this.getPool();
    const res = await pool.query<{ doc: RenderJob }>('SELECT doc FROM render_jobs WHERE id = $1 LIMIT 1', [jobId]);
    const job = res.rows[0]?.doc;
    if (!job) return null;
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    await pool.query('UPDATE render_jobs SET doc = $2, updated_at = $3 WHERE id = $1', [jobId, next, next.updatedAt]);
    return next;
  }

  async listRenderJobs(ownerId: string, projectId: string): Promise<RenderJob[]> {
    await this.init();
    const pool = await this.getPool();
    const res = await pool.query<{ doc: RenderJob }>(
      'SELECT doc FROM render_jobs WHERE owner_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 50',
      [ownerId, projectId],
    );
    return res.rows.map((row) => row.doc);
  }
}

function shouldUseSsl(url: string): boolean {
  if (/sslmode=disable/.test(url)) return false;
  return !/localhost|127\.0\.0\.1/.test(url);
}
