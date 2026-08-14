# Setup

## Prerequisites

- Node.js 22+
- FFmpeg + FFprobe on PATH (`sudo apt-get install -y ffmpeg` on Debian/Ubuntu)
- Python 3.10+ (optional — only needed for local transcription)

## Install & run

```bash
npm install
npm run db:setup        # creates SQLite DB (apps/api/data/dev.db)
npm run dev             # starts API (:4001) and web (:5173) together
```

Open http://localhost:5173.

## Optional: local transcription (free)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install faster-whisper
```

The API auto-detects it. Model configurable via `WHISPER_MODEL` (default `small`).
The first transcription downloads the model (~500 MB for `small`).

## Optional: local LLM (free)

Install [Ollama](https://ollama.com), pull a model (`ollama pull qwen2.5`),
and set `OLLAMA_URL=http://localhost:11434` (and optionally `OLLAMA_MODEL`)
in `apps/api/.env`. This upgrades clip titles/hooks and the AI assistant from
heuristics to a local LLM. Everything still works without it.

## Environment variables

See `apps/api/.env.example`. None are required for the basic editor.

## Tests

```bash
npm test                # editor-core engine tests (vitest)
npm run typecheck       # all workspaces
```
