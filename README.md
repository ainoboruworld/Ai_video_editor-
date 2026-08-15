# Reelframe — AI video editor

A browser-based AI video editor: write a prompt, get a script and storyboard,
match every scene with free stock B-roll, edit on a real multi-track timeline,
caption it, score it, preview it and export a file.

Built with Next.js (App Router) and TypeScript end to end — no Python anywhere —
deployable to Vercel as-is, and **free to run**: every external service it uses
has a genuinely free tier, and none of them is required.

Two ways in, both real editing rather than a preview of one:

```
generate:  prompt → AI script → storyboard → free B-roll → timeline → edit → captions → audio → export
auto-edit: your upload → silence + filler cuts → transcript → captions → AI recut → cutaway B-roll → export
```

## What is actually here

| Area | Status |
| --- | --- |
| Multi-track timeline (drag, trim, split, snap, zoom, lock/mute/hide) | Working |
| Canvas compositor: crop, cover-fit, scale, rotate, opacity, filters, transitions, text, captions | Working |
| Real playback with A/V sync and a Web Audio mix (clip volume, fades, mute/solo) | Working |
| Undo/redo over a command engine, keyboard shortcuts, autosave + crash recovery | Working |
| Prompt → script → storyboard, editable scene by scene | Working (free Gemini or Groq key for written scripts; otherwise a labelled draft) |
| Auto-edit an upload: cut silence and filler words, recut to a target length, suggest cutaways | Working (silence cutting needs no key at all) |
| B-roll search across Pexels / Pixabay / Unsplash, ranked for the project format | Working (needs at least one free API key) |
| Auto-fit B-roll to scene length, assemble storyboard onto the timeline | Working |
| Captions: from script, or transcribed from the real timeline audio | Working (free Groq Whisper or Gemini audio) |
| Export in the browser (canvas + audio → downloadable file) | Working, no external service |
| Cloud render with Remotion (frame-accurate H.264) | Working, needs a worker host (`RENDER_WORKER_URL`) |
| Uploads straight to object storage | Working, needs S3-compatible storage |

Everything degrades honestly: with an empty environment the editor still opens,
edits, previews and exports — features that need a key say so instead of failing
silently or faking a result.

## Quick start

```bash
npm install
cp .env.example .env.local     # optional — see below
npm run dev                    # http://localhost:3000
```

Then: type a brief on the home screen → **Generate video** → the storyboard
opens → **Find B-roll for all scenes** → approve clips → **Assemble on
timeline** → edit → **Export**.

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
- **AI**: `GEMINI_API_KEY` or `GROQ_API_KEY` — both free tiers (`OPENAI_API_KEY` is supported but never required)
- **Captions & auto-edit**: `GROQ_API_KEY` (word-level Whisper timings) or `GEMINI_API_KEY` (sentence-level)
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
free stock APIs, Gemini and Groq have free tiers that cover scripts, storyboards
and captions, export runs in the browser using Web APIs, and both the database
and object storage are optional. Paid services (OpenAI, hosted Postgres, S3,
a render host) are supported as upgrades, never as requirements.

## Licensing of generated videos

Stock assets keep their provider, creator, source URL and licence, and the
editor's **Project credits** panel turns that into a copyable attribution block.
Pexels and Pixabay allow commercial use; Unsplash's API terms require
attribution. No copyrighted music is bundled — the audio panel links to freely
licensed libraries instead.
