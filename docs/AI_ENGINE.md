# AI Engine

## Principles

1. **Free-first.** Every AI feature has a local/heuristic implementation that
   works with zero external services. Ollama (local LLM) is an optional
   upgrade; paid providers can be added as adapters later.
2. **AI proposes, the engine executes.** AI output is always structured
   `EditorCommand[]`, validated with `validateCommands` before it can touch a
   timeline, previewed to the user, applied through the same command engine
   as manual edits, and undoable in one step.

## Pipeline features

- **Transcription** — `faster-whisper` locally (word timestamps kept).
- **Silence detection** — FFmpeg `silencedetect`; sections become
  `REMOVE_RANGE` proposals.
- **Filler words** — transcript scan (um/uh/you know/…, with pause and
  repetition heuristics for ambiguous words like "like"); `REMOVE_RANGE`
  proposals with padding.
- **Scene detection** — FFmpeg scene-change scoring (PySceneDetect can be
  slotted in behind the same job).
- **Chapters** — transcript segmentation by pauses + duration.
- **Clip suggestions** — heuristic scorer over sentence-aligned windows:
  hook signals (questions, numbers, curiosity/contrast phrases), information
  density, completeness, positional diversity. Scores are recommendation
  scores, not virality guarantees.
- **Hooks** — template-based alternatives from segment text; LLM-refined when
  Ollama is configured.
- **B-roll opportunities** — keyword extraction from transcript segments,
  matched against the project's own asset library (plus user uploads); stock
  provider adapters (Pexels/Pixabay) are optional and never required.

## AI assistant

`POST /sequences/:id/ai` parses the request into commands:

- Rule-based intent parser (always available): remove silence, remove
  fillers, add captions, caption sizing, speed, aspect ratio, volume…
- Ollama path (optional): the LLM receives the command schema + a compact
  sequence summary and must emit JSON commands; output is schema-validated
  and falls back to rules on any failure.

The client shows the proposed change list with **Preview / Apply / Cancel**;
Apply routes through `EditorHistory` so the whole batch is one undo step.
