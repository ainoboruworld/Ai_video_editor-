# Setup

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Install and run

```bash
npm install
cp .env.example .env.local
npm run dev
```

The app runs at http://localhost:3000. With no keys configured it still works:
projects are saved under `.data/`, uploads under 4 MB go to `.data/storage`,
prompts produce a labelled structural draft, and export runs in the browser.

## Getting the free API keys

| Key | Where | Free tier | Enables |
| --- | --- | --- | --- |
| `PEXELS_API_KEY` | https://www.pexels.com/api/ | Yes, generous | Stock video + photo search (primary) |
| `PIXABAY_API_KEY` | https://pixabay.com/api/docs/ | Yes | Stock video + image fallback |
| `UNSPLASH_ACCESS_KEY` | https://unsplash.com/developers | Yes (demo tier) | Photo B-roll and stills |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | Yes | Scripts, storyboards, captions, edit review |
| `GROQ_API_KEY` | https://console.groq.com/keys | Yes | Same AI features, plus free Whisper transcription for automatic captions |
| `OPENAI_API_KEY` | https://platform.openai.com | No (paid) | Optional alternative for the same features — never required |

Start with `PEXELS_API_KEY` — it unlocks the B-roll workflow, which is the part
of the product that most depends on an external service. Then add
`GEMINI_API_KEY` or `GROQ_API_KEY` for written scripts.

Provider preference is free-first: Gemini, then Groq, then OpenAI. `AI_PROVIDER`
forces a specific one.

## Optional infrastructure

**Postgres** (`DATABASE_URL`) — projects survive deploys and are shared across
devices. Tables are created automatically on first use. Without it, the file
store is used: durable locally, per-instance and short-lived on serverless.

**Object storage** (`STORAGE_URL`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`,
`STORAGE_SECRET_KEY`, optional `STORAGE_PUBLIC_URL`) — any S3-compatible service.
The browser uploads straight to the bucket with a presigned URL, so large files
never pass through a serverless function. Without it, uploads over 4 MB stay in
the browser tab (usable for the session, gone after a reload — the UI says so).

**Render worker** (`RENDER_WORKER_URL`, `RENDER_WORKER_TOKEN`) — see
[RENDERING.md](RENDERING.md).

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## End-to-end smoke test (optional)

`scripts/smoke-e2e.mjs` drives the whole product flow in a real browser —
prompt → storyboard → assemble → edit → play → split → undo → export — and fails
if the export does not produce a file. Playwright is not a project dependency,
so install it on demand:

```bash
npm run build && npm start &
npm i --no-save playwright && npx playwright install chromium
node scripts/smoke-e2e.mjs
```
