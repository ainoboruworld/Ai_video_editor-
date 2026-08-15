# AI and B-roll pipeline

```
prompt
  └─► /api/ai/script      → storyboard (hook, scenes, script, on-screen text,
                            visual description, B-roll queries, CTA)
        └─► /api/ai/broll  → queries per scene → Pexels / Pixabay / Unsplash
                             → ranked recommendations (never auto-inserted)
              └─► user approves → /api/assets/import → project asset
                    └─► assemble → editor commands → timeline
                          └─► /api/ai/captions or /api/captions/transcribe
```

## Providers

`src/lib/ai` exposes one interface with three implementations — `GeminiProvider`,
`GroqProvider` and `OpenAiProvider` — all forced into JSON mode. Provider choice
is `AI_PROVIDER`, else the first configured key in free-first order (Gemini,
Groq, then OpenAI), so a working setup never requires a paid account. Every response is parsed with a zod
schema (`src/lib/ai/schemas.ts`) before it can touch a project: free-form text
parsing is not used anywhere.

## Offline draft mode

With no AI key, `src/lib/ai/offline.ts` produces a deterministic storyboard: real
beats (hook → context → proof → detail → payoff → CTA), durations distributed to
the requested length, and stock queries derived from the subject. It is labelled
`provider: "offline"` in the API and shown as **draft mode** in the UI. It is a
structural starting point, not a pretend language model.

## Query generation and ranking

A scene's visual description becomes 2–4 search phrases, either from the model or
derived locally (`deriveQueries`: specific phrase → key tokens → single terms).
Each query is run against every configured provider in parallel; results are
merged, de-duplicated and scored by:

```
relevance 46%  ·  framing 28%  ·  duration fit 16%  ·  resolution 10%
```

Framing is why a 9:16 project surfaces vertical footage first, and duration fit is
why a 3-second clip ranks below a 12-second one for a 6-second scene. The score
is shown on each result as a match percentage.

## Auto-fit

When a scene's footage lands on the timeline (`features/broll/assemble.ts`):

- longer than the scene → trimmed;
- slightly shorter → slowed (never below 0.6×) instead of leaving a gap;
- much shorter → repeated to cover the scene;
- images → held for the scene;
- framing → cover-fit and cropped, never stretched;
- the scene's transition is applied to the first segment.

Everything stays a normal clip afterwards: trim it, move it, restyle it.

## Captions

Two real routes to captions:

1. **From the script** — `/api/ai/captions` splits narration into timed cues.
2. **From the audio** — the browser renders the timeline's audio to 16 kHz mono
   WAV (`features/captions/extractAudio.ts`), posts it to
   `/api/captions/transcribe`, and the provider returns word-level timings that
   drive karaoke-style highlighting. Transcription providers share one
   OpenAI-compatible implementation; Groq's free Whisper tier is tried first,
   OpenAI second. No Python and no local model is involved.

Both produce caption clips on the caption track, editable like any other clip.

## Editing footage the user already has

The second workflow — "edit my video" rather than "make me a video" — lives in
`features/analysis`, `features/ai/autoEdit.ts` and `/api/ai/edit`. It is layered
so each step works with whatever is configured:

| Step | Needs | What happens |
| --- | --- | --- |
| Cut dead air | nothing | The browser decodes the audio, measures RMS loudness per 20 ms window and finds stretches below a threshold *relative to the recording's own peak*, so quiet and loud recordings both work untuned. Cuts are ripple deletes, padded so they do not clip word onsets. |
| Transcript | nothing, or a free key | Three interchangeable sources — see below. |
| AI edit | an AI provider | The model sees only the transcript with timings and returns which segments to keep, where a cutaway would help, and short on-screen callouts. |

### The transcript is the hinge

Captions, the AI recut and Smart Auto-Cut all read from one transcript, and it
can come from any of three places. They normalise to the same
`TranscriptSegment[]`, so nothing downstream knows or cares which was used:

| Source | Needs | Notes |
| --- | --- | --- |
| **Manual** | nothing | Paste a transcript. Accepts `00:00 - 00:04` ranges, SRT/VTT, one timestamp per line, or plain prose. Untimed pastes are spread by sentence length and flagged as estimated rather than given invented precision. |
| **Local Whisper** | nothing | Runs in the browser; the model downloads once. |
| **Hosted** | a free `GROQ_API_KEY` | Fastest, and the only source with word-level timings for karaoke captions. |

Manual mode exists so that neither a model download nor an API quota can block
editing: a transcript obtained anywhere — including pasting the video into a
chat assistant — makes the whole downstream workflow available immediately.

Gemini is deliberately **not** a transcription provider: its audio is billed as
tokens from the same small allowance the script and recut calls use, so
transcribing a real recording exhausted the quota the rest of the workflow
depends on. It remains a reasoning provider.

### Recuts are proposals, not edits

Both the AI recut and Smart Auto-Cut return the same shape — spans to keep and
spans to remove, each with a reason — and the editor shows the whole plan before
anything happens. The timeline changes only when the user clicks **Apply Recut**,
as one undoable step.

`Smart Auto-Cut` is the no-key path and is never called AI: it removes long
pauses found in the audio, filler-only segments (`um`, `so`), very short
fragments and obvious hedging phrases, and keeps everything else.

### Transitions at the joins

A cut leaves the two surviving halves butt-joined, which reads as a jump cut.
The proposal carries a transition choice — hard cut, fade, dip to black, flash,
blur, slide or zoom, with a length — and the seams are decorated in the same
undoable batch as the cuts themselves, so undo takes both back together.

The seams are found by replaying the cut commands against a throwaway copy of
the sequence, then matching each cut's post-ripple position to the clips that
actually survive; a cut running off either end of the timeline has only one side
and is left alone, and a transition never takes more than 40% of the clip it
sits on.

Cross-dissolve is deliberately **not** offered here. Both sides of a recut seam
come from the same source file and the media pool holds one element per asset,
so there is no second decode to blend against — a "cross-dissolve" would be a
dip wearing the wrong name. The kinds that are offered each do what they say:
the opacity ramp applies to fades and dips, while slide, zoom and blur stay
fully opaque and carry their own motion.

Two safeguards matter here:

- **The model cannot invent footage.** It returns timestamps into existing
  media; every one is clamped to the real duration server-side before the client
  converts it to commands, so a hallucinated timestamp cannot reach the timeline.
- **Source time is not timeline time.** A clip may be trimmed or sped up, so
  `sourceToTimeline` maps analysis results through the clip's `sourceIn` and
  `speed` before anything is cut, and cuts are applied last-to-first so a ripple
  delete never invalidates the timestamps still queued behind it.

Every step is one undoable command batch, and B-roll cutaways are only inserted
after the user picks one.

## Other AI features

- `/api/ai/suggest` — editing notes on the current timeline (pacing, coverage,
  captions, levels). Requires a provider; returns 503 with an explanation if none.
  Any free key satisfies it.
- `/api/ai/titles` — titles, description and hashtags for the finished video.
