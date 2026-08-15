# Deployment

## Vercel

The repository is a standard Next.js app at the root — no monorepo wiring, no
custom server, no native build step.

1. Import the repository at https://vercel.com/new. Framework preset:
   **Next.js**. Root directory: **/**. Build command `next build`, install
   command `npm install` (both are the defaults and are also pinned in
   `vercel.json`). Node.js 20 or newer.
2. Add the environment variables you want from `.env.example` under
   *Settings → Environment Variables*. None are required to build.
3. Deploy.

Recommended production set — all free tiers:

```
PEXELS_API_KEY=…          # B-roll search (free)
GEMINI_API_KEY=…          # optional AI recut and B-roll queries (free tier)
GROQ_API_KEY=…            # AI fallback + free Whisper captions
DATABASE_URL=…            # Postgres so projects persist across deploys
STORAGE_URL=…             # S3-compatible bucket for uploads
STORAGE_BUCKET=…
STORAGE_ACCESS_KEY=…
STORAGE_SECRET_KEY=…
STORAGE_PUBLIC_URL=…      # CDN base for reading objects
APP_URL=https://your-app.vercel.app
```

### What Vercel does and does not run

Vercel runs the editor, all API routes and the AI/stock integrations. It does
**not** run video rendering:

- Browser export needs no server at all — the file is produced in the user's tab.
- Cloud rendering runs on a separate worker (below); the Vercel function only
  queues the job and receives progress callbacks.

Function durations are set in `vercel.json` (60s for AI and captions, 30s for
media search); everything else stays well inside the defaults. Uploads bypass
functions entirely when object storage is configured, which is why that is the
recommended setup for real media.

### A note on the legacy `ai-video-editor-api` project

An earlier version of this repository was a monorepo, and a Vercel project was
created with its **Root Directory** set to `apps/api` — a Fastify/FFmpeg
container that no longer exists. Vercel resolves the root directory before it
reads anything from the repository, so once that directory was removed, every
deployment of that project failed with an error no code change could fix.

`apps/api` now contains only a static notice page and a `vercel.json` that builds
nothing, so the legacy project deploys successfully and explains itself. The
right end state is still to **delete that project** (or repoint it to `/` with
the Next.js preset) and then delete `apps/api` — nothing in the application
imports from it.

## Render worker (optional, for cloud rendering)

`scripts/render-worker.mjs` is a small Node HTTP server that bundles the
Remotion composition and renders jobs. Deploy it anywhere a long-running Node
process with a headless browser is allowed — Render, Fly.io, Railway, ECS, a VM.

```bash
# on the worker host
npm install
RENDER_WORKER_TOKEN=<shared-secret> \
RENDER_PUBLIC_URL=https://renderer.example.com \
npm run render:worker
```

Then set on Vercel:

```
RENDER_WORKER_URL=https://renderer.example.com
RENDER_WORKER_TOKEN=<same shared secret>
APP_URL=https://your-app.vercel.app
```

The worker needs Chrome's shared libraries. On a Debian/Ubuntu image:

```bash
npx remotion browser ensure
```

For a serverless renderer instead of a host, swap `renderProject` in
`scripts/render-lib.mjs` for `@remotion/lambda` — the job API and the editor do
not change.

## Self-hosting

```bash
npm install
npm run build
npm start          # next start, port 3000
```

Behind a reverse proxy, set `APP_URL` to the public origin so render callbacks
resolve.
