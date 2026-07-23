# AI Video Editor

A reusable, general-purpose workspace for AI-assisted video editing — built to be
used across every future video project, not a one-off pipeline.

The workspace is fully configured: FFmpeg, Python (MoviePy, Whisper, faster-whisper)
and Node/Remotion are installed and verified working end-to-end. See
[Setup](#setup) to get a fresh clone running, and [Environment](#environment) for
how the pieces fit together.

## Folder structure

```
ai-video-editor/
├── input/          # Source footage before it becomes output
├── output/         # Final rendered/exported videos
├── assets/         # Reusable creative assets shared across projects
├── captions/        # Generated/edited subtitle and caption data
├── scripts/         # Automation and processing code
├── templates/        # Reusable editing templates per output format
├── config/          # Project-wide configuration files
├── prompts/         # AI prompt templates (LLM/vision prompts for editing tasks)
├── logs/            # Run logs from scripts/pipelines
└── temp/            # Scratch space for intermediate/temporary files
```

### `input/`
Raw and in-progress source footage.
- `raw/` — Original, untouched footage as imported from camera/download. Never edit in place.
- `processed/` — Footage that has been trimmed, transcoded, or otherwise prepped for editing.
- `archive/` — Older source footage kept for reference, moved out of the active working set.

### `output/`
Final, rendered deliverables, organized by destination format.
- `reels/` — Vertical short-form output for Instagram/Facebook Reels.
- `youtube/` — Long-form horizontal output for YouTube.
- `shorts/` — Vertical short-form output for YouTube Shorts/TikTok.
- `drafts/` — Work-in-progress renders not yet ready for publishing.

### `assets/`
Reusable creative building blocks shared across every video project.
- `intros/` — Intro video clips/sequences.
- `outros/` — Outro video clips/sequences.
- `logos/` — Brand logos and watermark image files.
- `music/` — Background music tracks.
- `sfx/` — Sound effects.
- `fonts/` — Font files used for captions/titles/overlays.

### `captions/`
Generated and edited caption/subtitle data.
- `srt/` — Plain `.srt` subtitle files (e.g., from Whisper transcription).
- `json/` — Raw structured transcription/caption data (timestamps, word-level data, etc.).
- `styled/` — Caption data with styling metadata applied, ready for burn-in/rendering.

### `scripts/`
All automation and processing code, grouped by tool/language.
- `ffmpeg/` — FFmpeg command scripts/wrappers for encoding, trimming, concatenation, etc.
- `python/` — Python automation scripts (e.g., MoviePy-based editing, pipeline glue code).
- `remotion/` — Remotion (React-based video generation) projects/components.
- `whisper/` — Whisper-based transcription/captioning scripts.

### `templates/`
Reusable editing templates per output format, so new videos can start from a known-good base.
- `reel/` — Templates for Reels-style vertical short-form edits.
- `youtube/` — Templates for long-form YouTube edits.
- `podcast/` — Templates for podcast-style video edits.
- `ad/` — Templates for advertisement-style edits.

### `config/`
Project-wide configuration files (e.g., pipeline settings, tool configs, presets).

### `prompts/`
Prompt templates used to drive AI/LLM steps in the editing pipeline (e.g., script generation,
caption styling instructions, scene selection).

### `logs/`
Log output from scripts and pipeline runs, useful for debugging and auditing past runs.

### `temp/`
Scratch space for intermediate/temporary files generated during processing. Safe to clear.

## Environment

| Tool | Purpose | Where |
|---|---|---|
| **FFmpeg / FFprobe** | Core encode/decode/trim/concat engine used by every other tool | system install (`apt`), also vendored via `imageio-ffmpeg` in the venv |
| **Python 3.11 (.venv)** | MoviePy edits, Whisper transcription, pipeline scripting | `requirements.txt` |
| **MoviePy** | Programmatic video editing (cut, overlay, compose) | `requirements.txt` |
| **openai-whisper / faster-whisper** | Speech-to-text transcription for captions | `requirements.txt` |
| **Node.js 22 + Remotion** | Programmatic, React-based video/caption rendering | `package.json` |

## Setup

Prerequisites: Python 3.11+, Node.js 22+, and (on Debian/Ubuntu) the ability to
`apt-get install ffmpeg` — or have FFmpeg already on your `PATH`.

```bash
# 1. FFmpeg (skip if already installed — check with `ffmpeg -version`)
sudo apt-get update && sudo apt-get install -y ffmpeg

# 2. Python environment
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 3. Node / Remotion
npm install

# 4. Environment variables
cp .env.example .env
# then fill in any API keys / overrides you need
```

### Verify the install

```bash
source .venv/bin/activate
ffmpeg -version
python -c "import moviepy, whisper, faster_whisper; print('python deps OK')"
whisper --help >/dev/null && echo "whisper CLI OK"
npx tsc --noEmit && echo "remotion project typechecks OK"
```

### Remotion notes

- `scripts/remotion/src/` holds the Remotion project (`Root.tsx` registers
  compositions, `index.ts` is the entry point). Add new compositions there.
- `npm run remotion:studio` — open the Remotion Studio preview UI.
- `npm run remotion:render` — render the default composition from the CLI.
- In sandboxed/offline environments, Remotion's normal auto-download of headless
  Chrome may be blocked by network policy. If so, set `BROWSER_EXECUTABLE` in
  `.env` (or pass `--browser-executable`) to point at a local Chrome/Chromium
  binary. On a normal machine with open network access this is not needed —
  Remotion downloads and caches its own browser automatically on first run.

### Whisper notes

- Model size and device are configured in `config/whisper.json` (also
  overridable via `WHISPER_MODEL` / `WHISPER_DEVICE` in `.env`). `tiny`/`base`
  run fast on CPU; `medium`/`large` are far more accurate but slower and
  memory-hungry, and benefit from a CUDA GPU (`WHISPER_DEVICE=cuda`).
- Whisper downloads model weights to a local cache on first use (`.cache/whisper/`,
  git-ignored) — this requires network access the first time a given model size
  is used.

## Configuration

- `config/paths.json` — canonical input/output/asset/caption directory map.
- `config/whisper.json` — default transcription model/device/output settings.
- `config/export_presets.json` — per-destination render presets (resolution,
  fps, codec, quality) for reels/shorts/youtube/drafts.
- `.env` (from `.env.example`) — secrets and machine-specific overrides; never
  committed.
- `remotion.config.ts` — Remotion CLI/bundler configuration.
- `tsconfig.json` — TypeScript config for the Remotion project.

## Status

- [x] Project structure created
- [x] Dependencies installed and verified (FFmpeg, Whisper, MoviePy, Remotion)
- [ ] Editing scripts/workflows implemented (next step)

## Notes

- `input/`, `output/`, `captions/`, `logs/`, and `temp/` working data are git-ignored by default
  (see `.gitignore`) — only the folder structure (`.gitkeep`) is tracked. Assets like music,
  fonts, and logos are tracked since they're reusable across projects.
- `.venv/` and `node_modules/` are git-ignored — reinstall with the Setup steps above on a
  fresh clone.
