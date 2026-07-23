# AI Video Editor

A reusable, general-purpose workspace for AI-assisted video editing — built to be
used across every future video project, not a one-off pipeline.

This repository only defines the project *structure* for now. No dependencies are
installed and no editing scripts exist yet — those come in the next step (FFmpeg,
Whisper, MoviePy, Remotion, etc.).

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

## Status

- [x] Project structure created
- [ ] Dependencies installed (FFmpeg, Whisper, MoviePy, Remotion, etc.)
- [ ] Editing scripts implemented

## Notes

- `input/`, `output/`, `captions/`, `logs/`, and `temp/` working data are git-ignored by default
  (see `.gitignore`) — only the folder structure (`.gitkeep`) is tracked. Assets like music,
  fonts, and logos are tracked since they're reusable across projects.
