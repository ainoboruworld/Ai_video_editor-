# Deployment

The product deploys as two pieces. This split is not optional: FFmpeg
rendering, multi-GB uploads, and long transcription jobs cannot run inside
serverless functions (Vercel functions cap execution time and disk), so the
backend must live on a real server. Every feature works with this setup.

```
Browser ──► Vercel (static Vite frontend, apps/web)
                │  VITE_API_URL
                ▼
        Container host (Render / Railway / Fly / VPS)
        apps/api: Fastify + SQLite + FFmpeg + faster-whisper
        persistent /data volume for media + renders + DB
```

## 1. Frontend → Vercel

1. Vercel → Add New Project → import this repo.
2. **Root Directory: `apps/web`** (keep "Include source files outside of the
   Root Directory" enabled — the app imports `packages/editor-core`).
3. Framework Preset auto-detects **Vite** (`apps/web/vercel.json` pins the
   build command, output `dist/`, and SPA rewrites).
4. Environment variable: `VITE_API_URL = https://<your-api-host>`.

If an existing Vercel project was created while the repo still had a root
`requirements.txt`, its Framework Preset may be pinned to Python — fix it in
Project Settings → Build and Deployment (preset: Vite) or delete and
re-import the project.

## 2. Backend → any container host

`apps/api/Dockerfile` packages the API, FFmpeg, and faster-whisper. It needs
a persistent volume mounted at `/data`.

**Render (one click):** the repo root `render.yaml` is a Render Blueprint —
"New → Blueprint" and point it at this repo. It provisions the Docker
service with a 10 GB disk.

**Railway / Fly / VPS:** build `apps/api/Dockerfile` with the repo root as
build context, mount a volume at `/data`, expose port 4001:

```bash
docker build -f apps/api/Dockerfile -t ave-api .
docker run -p 4001:4001 -v ave-data:/data ave-api
```

Optional env: `OLLAMA_URL` (local/remote Ollama for LLM-refined clips and
assistant), `WHISPER_MODEL` (tiny…large-v3).

## 3. Connect them

Set the Vercel env `VITE_API_URL` to the backend URL and redeploy the
frontend. The API allows cross-origin requests, and the frontend routes all
`/api` and `/media` traffic to that origin.

## Local development (unchanged)

```bash
npm install && npm run db:setup && npm run dev
```
