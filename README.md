# AI Video Editor

An AI-first professional video editor that runs entirely on free, local,
open-source tooling: a real timeline editor in the browser, FFmpeg rendering
on the server, local Whisper transcription, and AI features (clip generation,
silence/filler removal, captions, B-roll suggestions, natural-language
editing) that propose structured edits the user reviews and applies.

**No paid API is required.** Ollama and stock-footage APIs are optional
adapters, never dependencies.

## Quick start

```bash
npm install
npm run db:setup      # SQLite via Prisma
npm run dev           # API on :4001, web app on :5173
```

Requires Node 22+ and FFmpeg (`sudo apt-get install -y ffmpeg`).
Optional local transcription: `pip install faster-whisper`.
See [docs/SETUP.md](docs/SETUP.md).

## What's inside

```
apps/web              React + Vite + Zustand + Tailwind editor UI
                      (timeline, preview, inspector, transcript, AI panels, export)
apps/api              Fastify + Prisma/SQLite + FFmpeg job workers
                      (upload pipeline, analysis, AI endpoints, render engine)
packages/editor-core  Pure TS editing engine: sequence model, command system,
                      undo history, snapping, keyframes, AI-command validation
scripts/              Standalone FFmpeg/Whisper/Remotion utility scripts
docs/                 Architecture & subsystem documentation
```

## Core features

- **Professional timeline** — multi-track (video/B-roll/text/captions/audio/music),
  drag, trim with source-mapping, split, ripple delete, snapping, zoom,
  track lock/mute/solo, markers, keyboard shortcuts (Space, S, J/K/L, ⌘Z…).
- **Everything undoable** — one command engine for manual and AI edits;
  AI batches undo in a single step.
- **Media pipeline** — streamed uploads, ffprobe metadata, thumbnails,
  audio waveforms, proxy generation for long videos.
- **Transcription & transcript editing** — local faster-whisper with word
  timestamps; click-to-seek, search inside video, delete text → delete video.
- **Silence & filler removal** — FFmpeg silence detection + transcript-based
  filler detection, applied as reviewable ripple edits.
- **AI clip generation** — scene detection + transcript heuristics (optionally
  refined by a local Ollama LLM) score sentence-aligned moments into short
  clips with hooks; every clip opens as a fully editable sequence.
- **Captions** — generated from the transcript as timeline objects with
  styles (minimal/bold/creator/karaoke/dynamic) and word-level highlighting.
- **B-roll workflow** — transcript keyword analysis proposes B-roll windows,
  filled from your own library on a dedicated track.
- **Aspect ratios & social formats** — 16:9, 9:16, 1:1, 4:5, 4:3 presets.
- **AI assistant** — "remove silence", "add captions", "make this 2x faster" →
  validated `EditorCommand[]` with preview/apply/cancel.
- **FFmpeg export** — server-side H.264/AAC MP4 render (720p–4K, quality
  presets) with live progress and cancel.

## Documentation

- [docs/SETUP.md](docs/SETUP.md) — installation, optional local AI
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — monorepo & data flow
- [docs/EDITOR_ENGINE.md](docs/EDITOR_ENGINE.md) — the command engine
- [docs/AI_ENGINE.md](docs/AI_ENGINE.md) — AI features & providers
- [docs/RENDERING.md](docs/RENDERING.md) — FFmpeg render pipeline
- [docs/API.md](docs/API.md) — HTTP API contract

## Tests

```bash
npm test          # editor-core engine tests
npm run typecheck
```
