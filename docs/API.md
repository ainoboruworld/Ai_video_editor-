# API Contract

Base URL: `http://localhost:4001/api`. All bodies JSON unless noted. All IDs are cuid strings.
Media files served at `http://localhost:4001/media/<storagePath>`.

## Projects
- `GET /projects` → `Project[]`
- `POST /projects` `{name}` → `Project`
- `GET /projects/:id` → `Project` (includes `sequences: SequenceRow[]`, `assets: Asset[]`)
- `PATCH /projects/:id` `{name?}` → `Project`
- `DELETE /projects/:id` → `{ok:true}`
- `POST /projects/:id/duplicate` → `Project`

`Project = {id, name, createdAt, updatedAt, thumbnailUrl: string|null}`

## Sequences
Sequence documents are the `Sequence` JSON from `@ave/editor-core`, stored whole.
- `GET /sequences/:id` → `{id, projectId, name, doc: Sequence, version, updatedAt}`
- `POST /projects/:id/sequences` `{name, aspect?}` → sequence row (server creates doc via `makeSequence`)
- `PUT /sequences/:id` `{doc, version}` → `{version}` (optimistic; bumps version, snapshots previous doc into SequenceVersion)
- `GET /sequences/:id/versions` → `{version, createdAt}[]`
- `POST /sequences/:id/restore` `{version}` → sequence row

## Assets (media library)
- `POST /projects/:id/assets` — multipart upload, field `file`. Creates asset with `status:'processing'`, kicks background pipeline (ffprobe → thumbnail → waveform → proxy for videos > 720p). Returns asset immediately.
- `GET /projects/:id/assets` → `Asset[]`
- `GET /assets/:id` → `Asset`
- `DELETE /assets/:id`

```
Asset = {
  id, projectId, kind: 'video'|'audio'|'image', name, status: 'processing'|'ready'|'error',
  originalUrl, proxyUrl: string|null, thumbnailUrl: string|null, waveformUrl: string|null,
  duration: number|null, width: number|null, height: number|null, fps: number|null, sizeBytes: number,
  error: string|null
}
```
Waveform is a JSON file: `{peaks: number[], samplesPerSecond: number}` (0..1 amplitudes).

## Analysis
- `POST /assets/:id/transcribe` → `{jobId}` — runs faster-whisper (python) if available; job status via `/jobs/:id`.
- `GET /assets/:id/transcript` → `{segments: {id,start,end,text,words:{text,start,end,confidence}[]}[]} | null`
- `POST /assets/:id/silence` `{minDuration?=0.6, noiseDb?=-35}` → `{sections: {start,end,duration}[]}` (ffmpeg silencedetect, synchronous)
- `GET /assets/:id/fillers` → `{words: {text,start,end,segmentId}[]}` (from transcript)
- `POST /assets/:id/scenes` → `{jobId}` — scene detection (ffmpeg scdet). `GET /assets/:id/scenes` → `{scenes:{id,start,end,thumbnailUrl}[]}`
- `POST /assets/:id/analyze` → `{jobId}` — full pipeline: transcribe → scenes → clip suggestions. Job `progress` has named steps.
- `GET /assets/:id/suggestions?kind=clip|broll|chapter|hook` → suggestions list

```
Suggestion = {id, assetId, kind, start, end, title, description, score: number|null, payload: any}
```

- `POST /assets/:id/clips` `{count, minDuration, maxDuration, platform?, style?}` → `{jobId}`; results as suggestions kind='clip'. Uses local heuristics + optional Ollama (`OLLAMA_URL`).
- `POST /assets/:id/hooks` `{start,end}` → `{hooks: string[]}` (heuristic or Ollama)

## AI assistant
- `POST /sequences/:id/ai` `{prompt, assetId?}` → `{commands: EditorCommand[], summary: string}` — commands are validated server-side with `validateCommands` before returning; the client previews and applies them through the command engine.

## Jobs
- `GET /jobs/:id` → `{id, type, status: 'queued'|'running'|'done'|'error', progress: number, step: string|null, error: string|null, result: any}`

## Rendering
- `POST /sequences/:id/render` `{resolution: '720p'|'1080p'|'4k', fps: 24|25|30|60, quality: 'draft'|'standard'|'high'|'maximum'}` → `{jobId}`
- Job result: `{outputUrl}` — downloadable MP4 (H.264/AAC).
- `POST /jobs/:id/cancel` → `{ok:true}`
