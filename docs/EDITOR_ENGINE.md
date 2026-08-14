# Editor Engine (`@ave/editor-core`)

Pure TypeScript. No React, no DOM, no Node APIs. This is deliberate: the same
engine executes manual edits in the browser and AI edits validated on the
server, and it is trivially unit-testable.

## Model

- `Sequence` — width/height/fps/aspect, `Track[]`, `Marker[]`
- `Track` — kind (`video | audio | text | caption`), `Clip[]`, lock/visible/mute/solo
- `Clip` — timeline `start`/`duration`, source mapping (`sourceIn`, `speed`),
  audio (volume/fades), `Transform`, `Crop`, `Filters`, keyframes, transitions,
  text/caption payloads, B-roll mode.

Time is in seconds. Source consumed by a clip = `duration * speed`.

## Commands

All mutations are `EditorCommand` objects (see `commands.ts`), e.g.
`ADD_CLIP`, `TRIM_CLIP`, `SPLIT_CLIP`, `REMOVE_RANGE` (ripple or lift),
`CHANGE_SPEED`, `ADD_CAPTION`, `ADD_BROLL`, `CHANGE_ASPECT_RATIO`,
`SET_KEYFRAMES`, …

`applyCommand(seq, cmd)` is a pure function returning a new structurally
shared `Sequence`. Notable semantics:

- **TRIM_CLIP** — moving the left edge adjusts `sourceIn` by `delta * speed`.
- **SPLIT_CLIP** — preserves source mapping, splits keyframes and caption
  words across both halves.
- **REMOVE_RANGE** — removes a timeline interval across tracks; with
  `ripple: true` downstream clips shift left. Spanning clips are split.
  This one command implements silence removal, filler removal, and
  transcript-based deletion.
- **CHANGE_SPEED** — keeps the source range fixed and rescales duration.

## History

`EditorHistory` records snapshot undo entries (cheap — sequences are
immutable and structurally shared). `apply(seq, commands, label)` executes a
batch atomically with one undo entry, which is how multi-command AI edits
stay recoverable with a single Ctrl+Z.

## Validation

`validateCommand(s)` checks untrusted (AI-produced) commands against the
actual sequence — unknown types, dangling clip/track ids, non-finite numbers,
inverted ranges — before they reach the engine.

## Snapping & keyframes

`snapTargets`/`snapTime` implement snapping to clip boundaries, markers,
playhead and sequence bounds. `interpolate` performs linear keyframe
interpolation (easing can be added behind the same signature).
