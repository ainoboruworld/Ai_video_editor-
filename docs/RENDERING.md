# Rendering and export

There are two real export paths. Both consume the same project document, and
neither shows progress it has not actually made.

## 1. Browser export (default, no external service)

`src/features/rendering/browserExport.ts`

```
project → compositor → <canvas> ─ captureStream ─┐
                                                 ├─ MediaRecorder → Blob → download
Web Audio mix ─ MediaStreamDestination ──────────┘
```

- Plays the timeline once in real time, drawing every frame with the same
  compositor the preview uses, at the chosen export resolution.
- Audio is the live Web Audio mix (clip volume, fades, track mute/solo), attached
  only when the timeline actually has audio.
- The result is a real file the browser downloads.

Container: MP4 when the browser can genuinely record H.264 (desktop Chrome,
Edge, Safari) — the check asks for an explicit `avc1` profile, because some
Chromium builds claim to support `video/mp4` and then emit an unplayable file.
Otherwise WebM (VP9/VP8 + Opus), which every modern browser plays.

Trade-offs, stated plainly: recording is real time, the tab must stay in the
foreground, and WebM files recorded this way carry no duration header (players
still play and seek them). For frame-accurate H.264 at any length, use the cloud
path.

## 2. Cloud rendering with Remotion

```
Editor ─ POST /api/render ─► job (queued)
                              │
                              ├─► POST <RENDER_WORKER_URL>/render  { project, size, fps }
                              │        worker: bundle → renderMedia → file
                              │        worker: PATCH /api/render/:id  { progress, status, outputUrl }
                              └─◄ editor polls GET /api/render/:id
```

- `remotion/ProjectComposition.tsx` maps the project document to Remotion
  primitives (`OffthreadVideo`, `Img`, `Audio`, `Sequence`) with the same
  cover-fit, transform, filter, transition, text and caption rules.
- `scripts/render-worker.mjs` is the HTTP worker; `scripts/render-cli.mjs`
  renders a project file locally:

  ```bash
  npm run render -- ./project.json out/video.mp4 --height 1080 --fps 30
  ```

- Vercel cannot host the worker (Remotion needs a long-lived process and a
  headless browser). Without `RENDER_WORKER_URL`, `/api/render` returns a clear
  503 and the editor uses the browser path instead.

## Why not render in a serverless function

A one-minute 1080p render takes minutes of CPU and hundreds of MB of temporary
space. That does not fit a serverless request, so the architecture never
pretends it does: rendering is either client-side (real time, free) or delegated
to infrastructure built for it.
