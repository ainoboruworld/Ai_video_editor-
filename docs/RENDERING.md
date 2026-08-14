# Rendering

Final video rendering happens **server-side with FFmpeg** — never in the
browser. The browser preview is a lightweight DOM/`<video>` composition of
the same sequence document.

## Flow

```
Export dialog → POST /sequences/:id/render → Job (queued)
      → worker: build plan from Sequence doc
      → per-clip intermediates (trim, speed, scale, filters, fades)
      → concat base track (gaps become black)
      → overlay pass (B-roll, text via drawtext, captions, opacity)
      → audio mix (clip audio + music tracks, volume/fades)
      → H.264 + AAC MP4
      → Job result { outputUrl }
```

Progress is parsed from `ffmpeg -progress` and exposed through the job as
Preparing → Rendering → Encoding → Finalizing with a percentage; jobs can be
cancelled (the FFmpeg process is killed).

## Quality presets

| Preset   | CRF | Preset   |
|----------|-----|----------|
| draft    | 30  | veryfast |
| standard | 23  | medium   |
| high     | 20  | slow     |
| maximum  | 18  | slow     |

Resolutions 720p/1080p/4K are derived from the sequence aspect ratio; FPS
24/25/30/60.

## Safety

FFmpeg is always spawned with argument arrays (`shell: false`). Text for
`drawtext` is passed via temp text files, never interpolated into a filter
string, so user content cannot inject filter syntax or shell commands. All
file paths are resolved and verified inside the API's data directory.
