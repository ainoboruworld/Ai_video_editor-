# Architecture

One Next.js (App Router) application, TypeScript end to end. There is no Python
and no separate API server: route handlers under `src/app/api` are the backend,
and the only optional out-of-process component is the Remotion render worker.

```
Browser (editor)                     Next.js server (Vercel)          External
─────────────────                    ───────────────────────          ────────
Canvas compositor  ── /api/media/search ──►  Media providers  ──────►  Pexels
Playback engine    ── /api/ai/*        ──►  AI providers      ──────►  OpenAI / Gemini
Timeline + history ── /api/projects    ──►  Project store     ──────►  Postgres
Browser exporter   ── /api/upload/sign ──►  Storage driver    ──────►  S3 / R2
                   └─ /api/render      ──►  Render job API    ──────►  Remotion worker
```

## Layout

```
src/
  app/                 routes + API handlers
    api/…              projects, media search, uploads, AI, captions, render
    projects/[id]/     the editor
  components/
    editor/            EditorShell, TopBar, VideoCanvas, Timeline, Inspector,
                       ExportDialog, CreditsDialog, panels/
    home/              project browser + upload entry
    ui/                shared primitives
  features/
    ai/                transcript-driven recut, B-roll search, cut transitions
    edit/              fillers, pauses, smoothing, ducking, the step workflow
    broll/             approved B-roll → timeline placement, auto-fit
    captions/          timeline audio mixdown for transcription
    media/             media element pool, upload pipeline
    rendering/         in-browser exporter
    timeline/          compositor, playback engine, editing operations
  hooks/               usePlaybackEngine, useMediaSearch, useShortcuts
  lib/
    ai/                provider abstraction (OpenAI, Gemini, offline draft)
    database/          store abstraction (Postgres, file, memory) + validation
    engine/            the pure editing engine (no React, no DOM, no Node)
    media/             stock provider abstraction + ranking
    storage/           storage abstraction (S3-compatible, filesystem)
    auth/              session + ownership
  state/               zustand stores (editor, toasts)
  types/               shared domain types
remotion/              composition used by the cloud renderer
scripts/               render worker + render CLI
```

## Key decisions

**One document, one engine.** A project is a JSON document. Every mutation —
manual edit, keyboard shortcut, or AI assembly — is an `EditorCommand` applied by
`src/lib/engine`. That is what makes undo/redo, AI batch edits and validation of
untrusted input all work through a single path. The engine is pure and unit
tested.

**One compositor for preview and export.** `features/timeline/compositor.ts`
paints a frame of the sequence onto a 2D canvas. The preview draws it every
frame; the browser exporter records the same canvas. There is no second renderer
that could drift from what you see. The Remotion composition mirrors the same
model for cloud renders.

**Providers behind interfaces.** Stock media, AI, storage and the database each
sit behind a small interface with multiple drivers. Adding Deepgram, Drizzle or
another stock library is a new file, not a refactor — and no component ever holds
an API key.

**Degrade, never fake.** Each capability reports its real state through
`/api/config`, and the UI shows it. Missing keys produce an explanation and a
working alternative (local filler/pause detection, browser export, local storage),
never a fake progress bar or invented data.

**Serverless-shaped.** No long-running processes, no reliance on a writable
filesystem, no large bodies through functions: uploads go browser → object
storage with a presigned URL, and video rendering is either in the browser or on
a dedicated worker.
