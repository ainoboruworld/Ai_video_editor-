import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { makeSequence, validateCommands, type AspectRatio, type Sequence as SequenceDoc } from '@ave/editor-core';
import { prisma } from './db.js';
import {
  storage, DATA_DIR, sanitizeFilename, kindForExtension, mimetypeAllowed, MAX_UPLOAD_BYTES,
} from './storage.js';
import { createJob, cancelJob } from './queue.js';
import { processAsset } from './pipeline.js';
import { detectSilence } from './ffmpeg.js';
import {
  transcribeAsset, getTranscript, findFillers, detectAssetScenes, clipSuggestionsJob,
  generateHooks, analyzeAsset,
} from './analysis.js';
import { runAssistant } from './assistant.js';
import { renderSequence, type RenderParams } from './render/renderer.js';

const app = Fastify({ logger: true, bodyLimit: 16 * 1024 * 1024 });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
await app.register(fastifyStatic, { root: DATA_DIR, prefix: '/media/' });

// ------------------------------------------------------------------ helpers

function notFound(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, what: string) {
  return reply.code(404).send({ error: `${what} not found` });
}

function serializeSequenceRow(row: { id: string; projectId: string; name: string; doc: string; version: number; updatedAt: Date; createdAt: Date }) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    doc: JSON.parse(row.doc) as SequenceDoc,
    version: row.version,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

function serializeJob(job: { id: string; type: string; status: string; progress: number; step: string | null; error: string | null; result: string | null }) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    step: job.step,
    error: job.error,
    result: job.result ? JSON.parse(job.result) : null,
  };
}

// ------------------------------------------------------------------ projects

app.get('/api/projects', async () => prisma.project.findMany({ orderBy: { updatedAt: 'desc' } }));

app.post<{ Body: { name?: string } }>('/api/projects', async (req, reply) => {
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 200) : null;
  if (!name) return reply.code(400).send({ error: 'name is required' });
  return prisma.project.create({ data: { name } });
});

app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { sequences: { orderBy: { updatedAt: 'desc' } }, assets: { orderBy: { createdAt: 'desc' } } },
  });
  if (!project) return notFound(reply, 'Project');
  return {
    ...project,
    sequences: project.sequences.map((s) => ({ id: s.id, projectId: s.projectId, name: s.name, version: s.version, updatedAt: s.updatedAt, createdAt: s.createdAt })),
  };
});

app.patch<{ Params: { id: string }; Body: { name?: string } }>('/api/projects/:id', async (req, reply) => {
  const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!existing) return notFound(reply, 'Project');
  const data: { name?: string } = {};
  if (typeof req.body?.name === 'string' && req.body.name.trim()) data.name = req.body.name.trim().slice(0, 200);
  return prisma.project.update({ where: { id: req.params.id }, data });
});

app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
  const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!existing) return notFound(reply, 'Project');
  await prisma.project.delete({ where: { id: req.params.id } });
  await storage.remove(path.join('media', existing.id)).catch(() => {});
  return { ok: true };
});

app.post<{ Params: { id: string } }>('/api/projects/:id/duplicate', async (req, reply) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { sequences: true },
  });
  if (!project) return notFound(reply, 'Project');
  const copy = await prisma.project.create({
    data: { name: `${project.name} (copy)`, thumbnailUrl: project.thumbnailUrl },
  });
  for (const s of project.sequences) {
    await prisma.sequence.create({ data: { projectId: copy.id, name: s.name, doc: s.doc, version: 1 } });
  }
  return copy;
});

// ------------------------------------------------------------------ sequences

app.post<{ Params: { id: string }; Body: { name?: string; aspect?: AspectRatio } }>(
  '/api/projects/:id/sequences',
  async (req, reply) => {
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return notFound(reply, 'Project');
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 200) : 'Sequence';
    const aspects = ['16:9', '9:16', '1:1', '4:5', '4:3'];
    const aspect = aspects.includes(req.body?.aspect as string) ? (req.body!.aspect as AspectRatio) : '16:9';
    const id = randomUUID();
    const doc = makeSequence(id, name, aspect);
    const row = await prisma.sequence.create({
      data: { id, projectId: project.id, name, doc: JSON.stringify(doc), version: 1 },
    });
    return serializeSequenceRow(row);
  },
);

app.get<{ Params: { id: string } }>('/api/sequences/:id', async (req, reply) => {
  const row = await prisma.sequence.findUnique({ where: { id: req.params.id } });
  if (!row) return notFound(reply, 'Sequence');
  return serializeSequenceRow(row);
});

app.put<{ Params: { id: string }; Body: { doc?: unknown; version?: number } }>('/api/sequences/:id', async (req, reply) => {
  const row = await prisma.sequence.findUnique({ where: { id: req.params.id } });
  if (!row) return notFound(reply, 'Sequence');
  const { doc, version } = req.body ?? {};
  if (typeof doc !== 'object' || doc === null || !Array.isArray((doc as SequenceDoc).tracks)) {
    return reply.code(400).send({ error: 'doc must be a Sequence object' });
  }
  if (typeof version !== 'number' || version !== row.version) {
    return reply.code(409).send({ error: `Version conflict: expected ${row.version}, got ${String(version)}` });
  }
  await prisma.sequenceVersion.upsert({
    where: { sequenceId_version: { sequenceId: row.id, version: row.version } },
    create: { sequenceId: row.id, version: row.version, doc: row.doc },
    update: { doc: row.doc },
  });
  const updated = await prisma.sequence.update({
    where: { id: row.id },
    data: { doc: JSON.stringify(doc), version: row.version + 1, name: (doc as SequenceDoc).name ?? row.name },
  });
  return { version: updated.version };
});

app.get<{ Params: { id: string } }>('/api/sequences/:id/versions', async (req, reply) => {
  const row = await prisma.sequence.findUnique({ where: { id: req.params.id } });
  if (!row) return notFound(reply, 'Sequence');
  const versions = await prisma.sequenceVersion.findMany({
    where: { sequenceId: row.id },
    orderBy: { version: 'desc' },
    select: { version: true, createdAt: true },
  });
  return versions;
});

app.post<{ Params: { id: string }; Body: { version?: number } }>('/api/sequences/:id/restore', async (req, reply) => {
  const row = await prisma.sequence.findUnique({ where: { id: req.params.id } });
  if (!row) return notFound(reply, 'Sequence');
  const version = req.body?.version;
  if (typeof version !== 'number') return reply.code(400).send({ error: 'version is required' });
  const snap = await prisma.sequenceVersion.findUnique({
    where: { sequenceId_version: { sequenceId: row.id, version } },
  });
  if (!snap) return notFound(reply, 'Version');
  await prisma.sequenceVersion.upsert({
    where: { sequenceId_version: { sequenceId: row.id, version: row.version } },
    create: { sequenceId: row.id, version: row.version, doc: row.doc },
    update: { doc: row.doc },
  });
  const updated = await prisma.sequence.update({
    where: { id: row.id },
    data: { doc: snap.doc, version: row.version + 1 },
  });
  return serializeSequenceRow(updated);
});

// ------------------------------------------------------------------ assets

app.post<{ Params: { id: string } }>('/api/projects/:id/assets', async (req, reply) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) return notFound(reply, 'Project');
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: 'multipart field "file" is required' });
  const filename = sanitizeFilename(file.filename || 'upload');
  const ext = path.extname(filename).toLowerCase();
  const kind = kindForExtension(ext);
  if (!kind || !mimetypeAllowed(file.mimetype)) {
    file.file.resume();
    return reply.code(400).send({ error: `Unsupported file type: ${ext || file.mimetype}` });
  }
  const assetId = randomUUID();
  const relDir = path.join('media', project.id);
  await storage.ensureDir(relDir);
  const rel = path.join(relDir, `${assetId}-${filename}`);
  const abs = storage.absPath(rel);
  try {
    await pipeline(file.file, fs.createWriteStream(abs));
  } catch (err) {
    await fs.promises.rm(abs, { force: true });
    throw err;
  }
  if (file.file.truncated) {
    await fs.promises.rm(abs, { force: true });
    return reply.code(413).send({ error: 'File exceeds the 4GB upload limit' });
  }
  const st = await fs.promises.stat(abs);
  const asset = await prisma.asset.create({
    data: {
      id: assetId,
      projectId: project.id,
      kind,
      name: filename,
      status: 'processing',
      originalUrl: storage.url(rel),
      sizeBytes: st.size,
    },
  });
  await createJob('asset-process', asset.id, (ctx) => processAsset(asset.id, ctx));
  return asset;
});

app.get<{ Params: { id: string } }>('/api/projects/:id/assets', async (req, reply) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) return notFound(reply, 'Project');
  return prisma.asset.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' } });
});

app.get<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return notFound(reply, 'Asset');
  return asset;
});

app.delete<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return notFound(reply, 'Asset');
  await prisma.asset.delete({ where: { id: asset.id } });
  const rel = asset.originalUrl.replace(/^\/media\//, '');
  const dir = path.dirname(rel);
  const base = path.basename(rel).replace(/\.[^.]+$/, '');
  // remove original + derived files
  const dirAbs = storage.absPath(dir);
  try {
    for (const f of await fs.promises.readdir(dirAbs)) {
      if (f.startsWith(path.basename(rel)) || f.startsWith(base) || f.includes(asset.id)) {
        await fs.promises.rm(path.join(dirAbs, f), { force: true });
      }
    }
  } catch {
    /* ignore */
  }
  return { ok: true };
});

// ------------------------------------------------------------------ analysis

function assetAbs(originalUrl: string): string {
  return storage.absPath(originalUrl.replace(/^\/media\//, ''));
}

app.post<{ Params: { id: string } }>('/api/assets/:id/transcribe', async (req, reply) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return notFound(reply, 'Asset');
  if (asset.kind === 'image') return reply.code(400).send({ error: 'Cannot transcribe an image' });
  const jobId = await createJob('transcribe', asset.id, (ctx) => transcribeAsset(asset.id, ctx));
  return { jobId };
});

app.get<{ Params: { id: string } }>('/api/assets/:id/transcript', async (req, reply) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return notFound(reply, 'Asset');
  return (await getTranscript(asset.id)) ?? reply.send(null);
});

app.post<{ Params: { id: string }; Body: { minDuration?: number; noiseDb?: number } }>(
  '/api/assets/:id/silence',
  async (req, reply) => {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return notFound(reply, 'Asset');
    if (asset.kind === 'image') return reply.code(400).send({ error: 'Cannot analyze an image for silence' });
    const minDuration = typeof req.body?.minDuration === 'number' && req.body.minDuration > 0.05 ? req.body.minDuration : 0.6;
    const noiseDb = typeof req.body?.noiseDb === 'number' && req.body.noiseDb < 0 ? req.body.noiseDb : -35;
    const sections = await detectSilence(assetAbs(asset.originalUrl), minDuration, noiseDb);
    return { sections };
  },
);

app.get<{ Params: { id: string } }>('/api/assets/:id/fillers', async (req, reply) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return notFound(reply, 'Asset');
  const doc = await getTranscript(asset.id);
  if (!doc) return reply.code(400).send({ error: 'No transcript available. Run transcription first.' });
  return { words: findFillers(doc) };
});

app.post<{ Params: { id: string } }>('/api/assets/:id/scenes', async (req, reply) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return notFound(reply, 'Asset');
  if (asset.kind !== 'video') return reply.code(400).send({ error: 'Scene detection requires a video asset' });
  const jobId = await createJob('scenes', asset.id, (ctx) => detectAssetScenes(asset.id, ctx));
  return { jobId };
});

app.get<{ Params: { id: string } }>('/api/assets/:id/scenes', async (req, reply) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return notFound(reply, 'Asset');
  const scenes = await prisma.scene.findMany({ where: { assetId: asset.id }, orderBy: { index: 'asc' } });
  return { scenes: scenes.map((s) => ({ id: s.id, start: s.start, end: s.end, thumbnailUrl: s.thumbnailUrl })) };
});

app.post<{ Params: { id: string } }>('/api/assets/:id/analyze', async (req, reply) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return notFound(reply, 'Asset');
  const jobId = await createJob('analyze', asset.id, (ctx) => analyzeAsset(asset.id, ctx));
  return { jobId };
});

app.get<{ Params: { id: string }; Querystring: { kind?: string } }>('/api/assets/:id/suggestions', async (req, reply) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return notFound(reply, 'Asset');
  const kind = req.query.kind;
  const rows = await prisma.suggestion.findMany({
    where: { assetId: asset.id, ...(kind ? { kind } : {}) },
    orderBy: [{ score: 'desc' }, { start: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id, assetId: r.assetId, kind: r.kind, start: r.start, end: r.end,
    title: r.title, description: r.description, score: r.score, payload: JSON.parse(r.payload),
  }));
});

app.post<{ Params: { id: string }; Body: { count?: number; minDuration?: number; maxDuration?: number; platform?: string; style?: string } }>(
  '/api/assets/:id/clips',
  async (req, reply) => {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return notFound(reply, 'Asset');
    const b = req.body ?? {};
    const opts = {
      count: Math.max(1, Math.min(20, typeof b.count === 'number' ? b.count : 5)),
      minDuration: Math.max(2, typeof b.minDuration === 'number' ? b.minDuration : 8),
      maxDuration: Math.min(300, typeof b.maxDuration === 'number' ? b.maxDuration : 60),
      platform: typeof b.platform === 'string' ? b.platform.slice(0, 40) : undefined,
      style: typeof b.style === 'string' ? b.style.slice(0, 40) : undefined,
    };
    const jobId = await createJob('clips', asset.id, (ctx) => clipSuggestionsJob(asset.id, opts, ctx));
    return { jobId };
  },
);

app.post<{ Params: { id: string }; Body: { start?: number; end?: number } }>('/api/assets/:id/hooks', async (req, reply) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) return notFound(reply, 'Asset');
  const start = typeof req.body?.start === 'number' ? req.body.start : 0;
  const end = typeof req.body?.end === 'number' ? req.body.end : (asset.duration ?? 60);
  return { hooks: await generateHooks(asset.id, start, end) };
});

// ------------------------------------------------------------------ AI assistant

app.post<{ Params: { id: string }; Body: { prompt?: string; assetId?: string } }>('/api/sequences/:id/ai', async (req, reply) => {
  const row = await prisma.sequence.findUnique({ where: { id: req.params.id } });
  if (!row) return notFound(reply, 'Sequence');
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return reply.code(400).send({ error: 'prompt is required' });
  const seq = JSON.parse(row.doc) as SequenceDoc;
  const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId : undefined;
  const result = await runAssistant(seq, prompt, assetId);
  const v = validateCommands(seq, result.commands);
  if (!v.ok) return { commands: [], summary: `Command validation failed: ${v.errors.slice(0, 3).join('; ')}` };
  return result;
});

// ------------------------------------------------------------------ jobs

app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return notFound(reply, 'Job');
  return serializeJob(job);
});

app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (req, reply) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return notFound(reply, 'Job');
  await cancelJob(job.id);
  return { ok: true };
});

// ------------------------------------------------------------------ render

app.post<{ Params: { id: string }; Body: Partial<RenderParams> }>('/api/sequences/:id/render', async (req, reply) => {
  const row = await prisma.sequence.findUnique({ where: { id: req.params.id } });
  if (!row) return notFound(reply, 'Sequence');
  const b = req.body ?? {};
  const params: RenderParams = {
    resolution: ['720p', '1080p', '4k'].includes(b.resolution as string) ? (b.resolution as RenderParams['resolution']) : '1080p',
    fps: [24, 25, 30, 60].includes(b.fps as number) ? (b.fps as RenderParams['fps']) : 30,
    quality: ['draft', 'standard', 'high', 'maximum'].includes(b.quality as string) ? (b.quality as RenderParams['quality']) : 'standard',
  };
  const jobId = await createJob('render', row.id, (ctx) => renderSequence(row.id, params, ctx));
  return { jobId };
});

// ------------------------------------------------------------------ start

const port = Number(process.env.PORT) || 4001;
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`API listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
