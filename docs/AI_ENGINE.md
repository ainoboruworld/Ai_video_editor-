# The editing assistant

AI here assists an edit; it does not make a video. There is no prompt-to-video
path, and the passes that matter most — filler detection, pause trimming, cut
smoothing, ducking, captions — run locally with no provider at all.

```
your recording
  └─► browser audio analysis   → loudness envelope, silences, speech ranges
        └─► transcript          → local Whisper | hosted Whisper | pasted by hand
              └─► filler + pause detection (local, no key)
                    └─► cut review → user approves → timeline commands
                          └─► /api/ai/broll → what was said → queries
                                → Pexels / Pixabay / Unsplash → ranked, never
                                  auto-inserted
```

The one optional model-driven edit is **AI Recut** (`/api/ai/edit`), which reads
the transcript and proposes keep/remove spans. It is a proposal like every other:
the timeline changes when the user clicks Apply.

## Providers

`src/lib/ai` exposes one interface with three implementations — `GeminiProvider`,
`GroqProvider` and `OpenAiProvider` — all forced into JSON mode. Provider choice
is `AI_PROVIDER`, else the first configured key in free-first order (Gemini,
Groq, then OpenAI), so a working setup never requires a paid account. Every response is parsed with a zod
schema (`src/lib/ai/schemas.ts`) before it can touch a project: free-form text
parsing is not used anywhere.

## What runs without a provider

Filler detection, pause trimming, cut smoothing, music ducking, captions from a
transcript and the whole export path need no key and make no network call. B-roll
search falls back to locally derived queries (`deriveQueries`) when no model is
configured, so the only thing a key buys there is a better phrasing of the search.
Nothing anywhere is labelled AI when it is a heuristic.

## Query generation and ranking

A spoken sentence becomes 2–4 search phrases, either from the model or
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

When approved B-roll lands on the timeline (`features/broll/assemble.ts`):

- longer than the moment → trimmed;
- slightly shorter → slowed (never below 0.6×) instead of leaving a gap;
- much shorter → repeated to cover it;
- images → held;
- framing → cover-fit and cropped, never stretched.

The speaker's audio keeps playing underneath, and everything stays a normal clip
afterwards: trim it, move it, restyle it, delete it.

## Captions

Two real routes to captions:

1. **From the transcript you already have** — no request of any kind; the
   segments become caption clips directly.
2. **From the audio** — the browser renders the timeline's audio to 16 kHz mono
   WAV (`features/captions/extractAudio.ts`), posts it to
   `/api/captions/transcribe`, and the provider returns word-level timings that
   drive karaoke-style highlighting. Transcription providers share one
   OpenAI-compatible implementation; Groq's free Whisper tier is tried first,
   OpenAI second. No Python and no local model is involved.

Both produce caption clips on the caption track, editable like any other clip.

## The edit itself

The workflow lives in `features/edit`, `features/analysis` and
`features/ai/autoEdit.ts`. It is layered so each step works with whatever is
configured:

| Step | Needs | What happens |
| --- | --- | --- |
| Cut dead air | nothing | The browser decodes the audio, measures RMS loudness per 20 ms window and finds stretches below a threshold *relative to the recording's own peak*, so quiet and loud recordings both work untuned. Cuts are ripple deletes, padded so they do not clip word onsets. |
| Transcript | nothing, or a free key | Three interchangeable sources — see below. |
| Fillers | a transcript | Context rules decide whether a word is filler in *this* position — see below. |
| Pause trimming | nothing | Long gaps are shortened, not deleted; a beat is always left behind. |
| AI recut | an AI provider | The model sees only the transcript with timings and returns which segments to keep. Optional. |

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
tokens from the same small allowance the recut calls use, so
transcribing a real recording exhausted the quota the rest of the workflow
depends on. It remains a reasoning provider.

### Filler detection has to understand context

Deleting every match of a filler word list ruins recordings. "Basically" opening
a sentence is usually the speaker's actual point; "basically" wedged between two
commas is throat-clearing. So `features/edit/fillers.ts` splits the list in two:

- **Hesitation sounds** (`um`, `uh`, `er`, `erm`, `ah`, `mm`) are filler
  anywhere, and arrive pre-ticked.
- **Real words** (`like`, `so`, `basically`, `actually`, `you know`, `I mean`,
  `kind of`, `sort of`, `right`) each carry the test that decides. "It looks like
  a duck" and "I like this" keep their `like`; "it was, like, different" does not.
  "You know that we shipped" keeps its `you know`. These arrive unticked, with the
  reason shown, for the user to accept one at a time.

Every candidate also needs a real span of recording, because cutting text out of
a transcript does nothing to the video. Word timings are used when the transcript
has them. Without them the span is interpolated across the segment and — when the
audio has been analysed — pulled out to the quiet either side, since a filler is
nearly always bracketed by a breath. Interpolated spans are labelled estimated in
the UI rather than presented as measurements.

### Pauses are shortened, not removed

Closing every gap to zero is what makes auto-edited video sound robotic.
`features/edit/pauses.ts` only touches pauses past a threshold, takes the cut out
of the *middle* so both phrases keep air around them, and always leaves a beat.
The slider runs from "cuts pauses over 2.0s, leaving 0.45s" to "over 0.28s,
leaving 0.08s", and defaults near the conservative end.

### Smoothing is audio first

A jump cut fails in two ways and they need different fixes. The audible failure
is a click, from severing the waveform mid-cycle; a few frames of fade on each
side removes it and is itself inaudible. The visible failure is the speaker's
head snapping position, and the standard fix is not a transition — it is a small
change of framing across the cut, so the edit reads as a second camera angle.

So the default (`features/edit/smoothing.ts`) is a 45 ms audio fade on both sides
of every join plus an alternating ~3.5% reframe on the picture. No spins, no
flashes, no big zooms. "Soft dip" and "audio only" are there for the cases that
want them.

### Music ducks under speech

`features/edit/ducking.ts` writes a volume envelope onto the music clip from the
speech ranges the analysis found: a bed of 0.28 in the gaps, 0.09 under a voice,
with an attack shorter than the release so it does not pump. Phrases a breath
apart stay ducked through the breath. The envelope is `keyframes.volume` on the
clip, which the playback engine's gain graph reads — and the export captures that
same graph, so preview and file cannot disagree.

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

## What is deliberately absent

There is no prompt-to-video route, no storyboard generator and no "write me a
script" endpoint. They were removed rather than hidden: the product's job is to
shorten the edit of footage that already exists, and an interface that also
offers to invent footage teaches the wrong thing about what it does.
