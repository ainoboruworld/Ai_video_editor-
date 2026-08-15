# Editor engine

`src/lib/engine` is the editing core: pure TypeScript, no React, no DOM, no Node
APIs. It is the only place that knows how a timeline changes, which is why the
same code path serves the UI, keyboard shortcuts, AI assembly and validation.

## Document model

```ts
Project {
  id, ownerId, name, aspect, width, height, fps,
  sequence: Sequence,      // tracks and clips
  assets: Asset[],         // media library with licence/attribution
  storyboard: Storyboard | null,
  settings, createdAt, updatedAt, version
}

Sequence { id, name, width, height, fps, aspect, tracks: Track[], markers: Marker[] }

Track  { id, kind: 'video'|'audio'|'text'|'caption',
         role: 'video'|'broll'|'overlay'|'text'|'caption'|'audio'|'music'|'voiceover',
         name, clips: Clip[], locked, visible, muted, solo }

Clip   { id, kind, name, assetId, start, duration, sourceIn, speed,
         volume, muted, fadeIn, fadeOut,
         transform, crop, filters, keyframes,
         transitionIn, transitionOut,
         text, textStyle, textAnimation, captionStyle, captionWords, brollMode }
```

`kind` drives behaviour (how a clip plays and composites); `role` drives track
routing and the timeline UI, so "put this B-roll on the B-roll track" is a data
lookup rather than a hard-coded index.

## Commands

Every mutation is a serialisable command applied by `applyCommand`:

```
ADD_CLIP  DELETE_CLIP  MOVE_CLIP  TRIM_CLIP  SPLIT_CLIP  REMOVE_RANGE
DUPLICATE_CLIP  CHANGE_SPEED  CHANGE_VOLUME  SET_FADE  CHANGE_TRANSFORM
SET_FILTERS  SET_CROP  SET_TEXT  ADD_TEXT  ADD_CAPTION  SET_CAPTION_STYLE
ADD_BROLL  ADD_TRANSITION  SET_BROLL_MODE  RENAME_CLIP  CHANGE_ASPECT_RATIO
SET_KEYFRAMES  SET_TRACK_STATE  ADD_MARKER  DELETE_MARKER  RENAME_SEQUENCE
```

Sequences are immutable and structurally shared, so `EditorHistory` can snapshot
before each command cheaply. Undo/redo therefore covers AI batch edits (a whole
storyboard assembly is one entry) exactly as it covers a single drag.

`validateCommand` checks untrusted commands (ids exist, numbers finite, ranges
sane) before they reach the engine — model output is never executed directly.

## Editing operations

`src/features/timeline/operations.ts` composes commands into the operations the
UI exposes: split at playhead, delete/duplicate selection, add media to the right
track at the next free slot, add text, and snapping (clip edges, markers,
playhead, within a pixel threshold that scales with zoom).

## Playback

`src/features/timeline/playback.ts` owns the clock. Each frame it seeks every
active media element to `sourceIn + local × speed`, re-seeking only past a drift
tolerance, applies the audio mix through per-clip gain nodes, and paints the
frame with the compositor.

## Persistence

The editor autosaves (debounced) to `PUT /api/projects/:id`, writing a
localStorage snapshot first. If the tab crashes, the server is unreachable, or
the deployment uses an ephemeral store, the newer local snapshot is restored on
next load. Saves carry a `version` for optimistic concurrency across tabs.
