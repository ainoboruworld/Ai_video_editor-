#!/usr/bin/env node
/**
 * Remotion render worker.
 *
 * Deploy this next to the Next.js app (any container host: Render, Fly,
 * Railway, ECS, a VM — anywhere a long-running Node process with a headless
 * browser is allowed) and point the app at it with:
 *
 *   RENDER_WORKER_URL=https://renderer.example.com
 *   RENDER_WORKER_TOKEN=<shared secret>
 *
 * Contract:
 *   POST /render  { jobId, callbackUrl, width, height, fps, format, project }
 *     → 202 immediately, then progress is PATCHed back to callbackUrl.
 *   GET  /health  → { ok: true }
 *   GET  /output/<jobId>.<ext> → the finished file (when no object storage is set)
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { renderProject } from './render-lib.mjs';

const PORT = Number(process.env.PORT ?? 4001);
const TOKEN = process.env.RENDER_WORKER_TOKEN ?? '';
const OUTPUT_DIR = path.resolve(process.env.RENDER_OUTPUT_DIR ?? './out');
const PUBLIC_URL = (process.env.RENDER_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');

await mkdir(OUTPUT_DIR, { recursive: true });

/** Reports progress back to the app so the export dialog can show real state. */
async function report(callbackUrl, patch) {
  if (!callbackUrl) return;
  try {
    await fetch(callbackUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(patch),
    });
  } catch (error) {
    console.warn('[worker] could not report progress:', error.message);
  }
}

async function handleRender(payload) {
  const { jobId, callbackUrl, project, width, height, fps, format } = payload;
  const extension = format === 'webm' ? 'webm' : 'mp4';
  const outputPath = path.join(OUTPUT_DIR, `${jobId}.${extension}`);

  await report(callbackUrl, { status: 'rendering', progress: 0.01, message: 'Preparing project…' });

  let lastReported = 0;
  try {
    await renderProject({
      project,
      outputPath,
      width,
      height,
      fps,
      format,
      onProgress: (progress) => {
        if (progress - lastReported < 0.02) return;
        lastReported = progress;
        void report(callbackUrl, {
          status: 'rendering',
          progress,
          message: `Rendering… ${Math.round(progress * 100)}%`,
        });
      },
    });

    await report(callbackUrl, { status: 'processing', progress: 0.97, message: 'Processing file…' });
    const info = await stat(outputPath);
    console.log(`[worker] ${jobId} rendered (${(info.size / 1024 / 1024).toFixed(1)} MB)`);

    await report(callbackUrl, {
      status: 'complete',
      progress: 1,
      message: 'Complete',
      outputUrl: `${PUBLIC_URL}/output/${jobId}.${extension}`,
    });
  } catch (error) {
    console.error(`[worker] ${jobId} failed:`, error);
    await report(callbackUrl, {
      status: 'failed',
      progress: 0,
      message: 'Render failed',
      error: String(error?.message ?? error).slice(0, 800),
    });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/output/')) {
    const name = path.basename(url.pathname);
    const file = path.join(OUTPUT_DIR, name);
    try {
      const info = await stat(file);
      response.writeHead(200, {
        'Content-Type': name.endsWith('.webm') ? 'video/webm' : 'video/mp4',
        'Content-Length': info.size,
        'Content-Disposition': `attachment; filename="${name}"`,
      });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end('Not found');
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/render') {
    if (TOKEN && request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) request.destroy();
    });
    request.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      if (!payload?.jobId || !payload?.project) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'jobId and project are required' }));
        return;
      }

      // Accept the job, then render in the background.
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ accepted: true, jobId: payload.jobId }));
      void handleRender(payload);
    });
    return;
  }

  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[worker] Remotion render worker listening on :${PORT}`);
  console.log(`[worker] output dir: ${OUTPUT_DIR}`);
});
