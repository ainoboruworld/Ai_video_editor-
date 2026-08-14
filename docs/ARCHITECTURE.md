# Architecture

## Monorepo

```
apps/
  web/            React + Vite + Zustand + Tailwind editor UI
  api/            Fastify + Prisma (SQLite) + FFmpeg workers
packages/
  editor-core/    Pure TypeScript editing engine (no React, no Node APIs)
docs/             This documentation
scripts/          Standalone FFmpeg/Whisper/Remotion utility scripts (legacy workspace)
```

## Core principle: one command engine

`@ave/editor-core` owns the editing model (`Sequence → Track → Clip`) and a
serializable command vocabulary (`EditorCommand`). Both manual UI editing and
AI editing produce the same commands:

```
User drag / AI provider
        ↓
   EditorCommand[]           (plain JSON, serializable)
        ↓
   validateCommands()        (untrusted AI output must pass)
        ↓
   EditorHistory.apply()     (undo entry recorded)
        ↓
   applyCommand()            (pure function, immutable Sequence)
        ↓
   Zustand store → React UI  /  autosave → API
```

An LLM never touches React state or the database. It emits commands; the
engine validates and executes them; everything is undoable.

## Data flow

- The **sequence document** (full `Sequence` JSON) is the unit of persistence.
  The client autosaves it (debounced) with optimistic versioning; each save
  snapshots the previous doc into `SequenceVersion` for recovery.
- **Assets** are uploaded to the API, stored on local disk via a
  `StorageProvider` abstraction (S3/R2 can be added later), and processed in a
  background job queue: ffprobe → thumbnail → waveform → proxy.
- **Analysis** (transcription, scene detection, silence, clip suggestions)
  runs as jobs; results are stored (Transcript, Scene, Suggestion rows) and
  surfaced in the UI as proposals the user applies.
- **Rendering** runs server-side with FFmpeg from the sequence document.
  The browser never renders the final video.

## Free-first providers

Every external capability sits behind an interface with a free/local default:

| Capability     | Default (free/local)                | Optional |
|----------------|-------------------------------------|----------|
| Transcription  | faster-whisper (local Python)       | cloud STT adapters |
| Scene detect   | FFmpeg scene-change filter          | PySceneDetect |
| Clip scoring   | Heuristic engine (transcript-based) | Ollama (local LLM) |
| AI assistant   | Rule-based intent parser            | Ollama (`OLLAMA_URL`) |
| Storage        | Local filesystem                    | S3/R2 provider |
| Rendering      | FFmpeg                              | — |

No paid API is required to run the editor.

## Long-video handling

Uploads are streamed to disk (never buffered in memory). Preview uses a
downscaled proxy; analysis works on extracted 16 kHz mono audio; the original
file is only read again at final render time.
