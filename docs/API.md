# HTTP API

All routes are Next.js route handlers under `src/app/api`, run on the Node
runtime, and are scoped to the caller's identity (an http-only cookie today, a
real auth provider when one is wired in — see `src/lib/auth/session.ts`). API
keys never leave the server. Errors are JSON: `{ error, code, details? }`.

## Capabilities

```
GET /api/config
→ { capabilities: { ai, stock, storage, database, transcription, rendering }, ownerId }
```

Used by the UI to show what is really available.

## Projects

```
GET    /api/projects              → { projects: ProjectSummary[] }
POST   /api/projects              { name, aspect, fps? }        → { project }
GET    /api/projects/:id                                        → { project }
PUT    /api/projects/:id          full document + version       → { project }
PATCH  /api/projects/:id          { name } | { action:'duplicate' } → { project }
DELETE /api/projects/:id                                        → { deleted: true }
```

`PUT` validates the whole document (`src/lib/database/schema.ts`) and rejects a
stale `version` with 409. Reading or writing another owner's project returns 404.

## Stock media

```
GET  /api/media/search?q=&type=video|image|all&aspect=&orientation=&duration=&page=&perPage=
→ { items: StockMediaItem[], providers, missingKeys, errors, query }

GET  /api/media/proxy?src=<provider URL>      same-origin, range-aware passthrough
POST /api/assets/import  { projectId, item, persist? }  → { asset }
```

`missingKeys` names providers that are not configured, so the UI can tell the
user what to add. `/api/media/proxy` only accepts the stock providers' CDN hosts.

## Uploads

```
POST /api/upload/sign  { projectId, filename, contentType, sizeBytes } → { ticket, kind }
POST /api/upload?key=  raw body (fallback path, ≤ 4 MB)                → { key, url, sizeBytes }
GET  /api/files/*                                                      → the object
```

With object storage configured the ticket is a presigned PUT and the browser
uploads straight to the bucket. File type and size are validated server-side, and
upload keys are namespaced per owner and project.

## AI

```
POST /api/ai/script    { prompt, durationSeconds, aspect, tone?, sceneCount? } → { storyboard }
POST /api/ai/broll     { aspect, scenes[], perScene?, type?, topic? }          → { recommendations, providers, missingKeys }
POST /api/ai/captions  { segments[] }                                          → { results }
POST /api/ai/suggest   { summary }                                             → { suggestions, provider }   503 without a provider
POST /api/ai/titles    { topic, script }                                       → { payload, provider }
```

`storyboard.provider` is `gemini`, `groq`, `openai` or `offline`, so the client
always knows what produced the result.

## Captions from audio

```
POST /api/captions/transcribe   multipart: audio (16 kHz mono WAV), language?
→ { cues: [{ text, start, end, words[] }], provider }        503 without a provider
```

## Rendering

```
POST  /api/render        { projectId, resolution, fps, format }  → 202 { job }   503 without a worker
GET   /api/render?projectId=                                     → { jobs }
GET   /api/render/:id                                            → { job }
PATCH /api/render/:id    worker-only, Bearer RENDER_WORKER_TOKEN → { job }
```
