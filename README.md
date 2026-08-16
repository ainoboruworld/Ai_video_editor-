# Reelframe — your video editing assistant

Upload a talking-head recording and get it edited in a fraction of the time.
Reelframe reads the audio, gets you a transcript, finds the filler words and the
dead air, proposes the cuts, smooths the joins, adds music that ducks under your
voice, suggests B-roll for what you actually said, captions it, and exports a
file.

It is not a video generator. There is no prompt box and no "make me a video"
button. You already have the footage; this shortens the part where you sit in a
timeline deleting "um" four hundred times. Every cut is a suggestion you approve
— you stay the editor.

Built with Next.js (App Router) and TypeScript end to end — no Python anywhere —
deployable to Vercel as-is, and **free to run**: every external service it uses
has a genuinely free tier, and none of them is required.

```
upload → analyse → transcript → fillers → pauses → review → apply cuts
       → smooth → music → B-roll → captions → preview → export
```

Every step after the upload is optional and reversible, and you can go back to
any of them at any time.

## What is actually here

| Area | Status |
| --- | --- |
| Guided edit workflow, each step reading its state off the real project | Working |
| Multi-track timeline (drag, trim, split, snap, zoom, lock/mute/hide) | Working |
| Canvas compositor: crop, cover-fit, scale, rotate, opacity, filters, transitions, text, captions | Working |
| Real playback with A/V sync and a Web Audio mix (clip volume, fades, mute/solo) | Working |
| Undo/redo over a command engine, keyboard shortcuts, autosave + crash recovery | Working |
| Several clips edited as one continuous video, drag to reorder | Working, no key needed |
| Transcript from a local model, a hosted provider, or pasted by hand | Working (manual paste needs nothing) |
| Transcript ↔ timeline sync: click a line, the playhead goes there | Working |
| Context-aware filler detection, highlighted in place, accept or reject each one | Working, no key needed |
| Unnecessary-line detection: repeats, false starts, corrections, rambling, tangents | Working, no key needed |
| Pause trimming that leaves a beat behind, on a natural-to-aggressive slider | Working, no key needed |
| Cut review before anything is applied, as one undoable edit | Working |
| Cut smoothing: a short cross-dissolve built from the footage each cut removed | Working |
| Reference video analysed for its editing style, applied at low/medium/high | Working, no key needed |
| Background music with automatic ducking under detected speech | Working, no key needed |
| B-roll suggested from what the speaker said, added only when you add it | Working (needs a free Pexels or Pixabay key) |
| Captions built from the final transcript, no second transcription request | Working |
| Caption colours — text, highlight, outline and box, on top of any preset | Working, no key needed |
| Infographics drawn on the frame — stats, lists and pull-quotes, suggested from the transcript | Working, no key needed |
| News citations for the claims you make — headline, publisher and date, drawn on the frame | Working, no key needed |
| Export in the browser (canvas + audio → downloadable file) | Working, no external service |
| Cloud render with Remotion (frame-accurate H.264) | Working, needs a worker host (`RENDER_WORKER_URL`) |
| Uploads straight to object storage | Working, needs S3-compatible storage |

Everything degrades honestly: with an empty environment the editor still opens,
edits, previews and exports — features that need a key say so instead of failing
silently or faking a result. Cutting fillers and pauses, smoothing, ducking and
captions all run entirely in your browser.

## Quick start

```bash
npm install
cp .env.example .env.local     # optional — see below
npm run dev                    # http://localhost:3000
```

Then: **Edit My Video** on the home screen → upload your recording →
**Analyse video** → get a transcript (paste one if you have no key) → tick the
fillers you agree with → **Apply cuts** → **Export**. Music, B-roll and captions
are there when you want them and skippable when you do not.

Useful commands:

```bash
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # unit tests (engine, ranking, assembly, compositor)
npm run render       # render a saved project locally with Remotion
npm run render:worker # run the Remotion render worker
```

## Environment

Every variable is optional; each one switches on a real capability.
See [`.env.example`](.env.example) for the annotated list and
[docs/SETUP.md](docs/SETUP.md) for where to get each key.

- **B-roll**: `PEXELS_API_KEY` (free, start here), `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`
- **AI**: any of `GROQ_API_KEY`, `OPENROUTER_API_KEY` (free Qwen), `CLOUDFLARE_*`, `HF_TOKEN`, `OLLAMA_BASE_URL` (self-hosted) or `GEMINI_API_KEY` — all free; a per-task picker appears when several are set
- **Captions & auto-edit**: `GROQ_API_KEY` (word-level Whisper timings), `GEMINI_API_KEY` (sentence-level), or **no key at all** — Whisper also runs in the browser
- **Database**: `DATABASE_URL` (Postgres) — otherwise filesystem storage
- **Object storage**: `STORAGE_*` — otherwise uploads stay in the browser tab
- **Cloud render**: `RENDER_WORKER_URL`, `RENDER_WORKER_TOKEN`

API keys are read server-side only and never reach the browser: the client
talks to `/api/media/search`, `/api/ai/*` and friends.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit together
- [docs/SETUP.md](docs/SETUP.md) — local setup and API keys
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deploying to Vercel (and the render worker)
- [docs/EDITOR_ENGINE.md](docs/EDITOR_ENGINE.md) — the document model and command engine
- [docs/AI_ENGINE.md](docs/AI_ENGINE.md) — AI + B-roll pipeline
- [docs/RENDERING.md](docs/RENDERING.md) — browser export and Remotion rendering
- [docs/API.md](docs/API.md) — HTTP API reference

## Cost

The editor is designed to run at zero spend: Pexels, Pixabay and Unsplash are
free stock APIs, Groq and Gemini have free tiers that cover hosted transcription
and the optional AI passes, export runs in the browser using Web APIs, and both
the database and object storage are optional. The core edit — transcript,
fillers, pauses, cuts, smoothing, ducking, captions, export — needs no key at
all. Paid services (OpenAI, hosted Postgres, S3,
a render host) are supported as upgrades, never as requirements.

## Licensing of the media you use

Stock assets keep their provider, creator, source URL and licence, and the
editor's **Project credits** panel turns that into a copyable attribution block.
Pexels and Pixabay allow commercial use; Unsplash's API terms require
attribution. No copyrighted music is bundled — the audio panel links to freely
licensed libraries instead.
