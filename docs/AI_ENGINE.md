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
              └─► /api/news → claims made → GDELT → headline + publisher +
                    date → citation graphic, never a publisher image
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

Colour is separate from preset. The preset decides the shape — size, weight,
position, whether it shouts — and `captionColors` decides text, highlight,
outline and box on top of it. Keeping them apart means recolouring never moves
anything and swapping preset never loses a colour choice. `undefined` there
means "not overridden" and `null` means "off", which is why removing an outline
survives instead of falling back to the preset's.

## Infographics

The number a talking head describes is one the viewer cannot see.
`features/edit/graphics.ts` reads the transcript for concrete figures
(percentages, money, multipliers, counted nouns), explicit enumerations
("three things…", with the items taken from the sentences that follow) and
sentences the speaker flagged as their own takeaway — and proposes a stat, list
or pull-quote timed to that sentence.

It proposes and never places: a graphic over a sentence that did not need one is
the same clutter as B-roll over an abstract point. Detection is deliberately
narrow for the same reason.

Graphics are drawn by the compositor rather than composited from an image, so
they stay sharp at any export size and remain editable as text in the Inspector.
They live on the text track and refuse to stack — two at the same moment would
draw over each other and only one could be selected.

## News as a resource

Stock footage answers "what should the viewer look at while I say this". A news
article answers a different question — "who says so" — so it arrives as a
citation rather than as pictures.

`features/edit/news.ts` reads the transcript for sentences that make a
*checkable* claim: a percentage, a year, a money figure, a study, an
acquisition, an analyst forecast. Opinion and narration are skipped, because a
source under every sentence is the same clutter as B-roll over every sentence.
Each claim becomes a short query — proper nouns first, since they are what
identifies a claim, content words otherwise — and `/api/news` runs it against
GDELT's Document API, which is free, needs no key and no account.

Only metadata comes back: headline, publisher, date, link. **The article's image
is deliberately not used.** Publisher photography is copyrighted and a
stock-media pipeline is the wrong place to launder it, so an approved article
becomes a `citation` graphic the compositor draws — accent rule, publisher and
date as the label, the headline as the value, the domain underneath. Imagery
still comes from Pexels, Pixabay and Unsplash, which license it for this.

Headlines are stripped of the publisher suffix newsrooms staple on ("… |
The Guardian"), matched by squashing punctuation so `theguardian.com` lines up
with "The Guardian", and results are capped at two per outlet — six articles
from one paper is a worse resource than six papers. Nothing is placed until the
user clicks **Cite at 0:00**, and a citation is a normal clip afterwards: retime
it, restyle it, delete it.

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
| **Local Whisper** | nothing | Runs in the browser; the model downloads once. Cannot be asked for verbatim text — see below. |
| **Hosted** | a free `GROQ_API_KEY` | Fastest, the only source with word-level timings for karaoke captions, and the only one asked for a verbatim transcript. |

Manual mode exists so that neither a model download nor an API quota can block
editing: a transcript obtained anywhere — including pasting the video into a
chat assistant — makes the whole downstream workflow available immediately.

#### A tidy transcript has no fillers to cut

Whisper is trained to produce a *readable* transcript, which means it quietly
drops the disfluencies this editor exists to remove. A transcript that has
already tidied them away leaves filler detection with nothing to find — which
looks exactly like the feature being broken.

The API fixes this: `prompt` conditions the model as though it were the text
immediately preceding the audio, so a prompt written in the style we want back —
every hesitation spelled out — pulls the transcription toward verbatim. It is
sent with `temperature: 0`, because the fallback temperatures Whisper uses on a
low-confidence pass are where it is most likely to paraphrase a hesitation away.

The in-browser model has no equivalent. `@huggingface/transformers` does not
implement Whisper's `prompt_ids`, so the local path cannot be conditioned and
its transcripts stay tidy. Rather than pretend otherwise, the Transcript panel
says so at the point of choosing, and the fillers step explains an empty result
in terms of the source that produced the transcript — local, hosted or pasted —
so "none found" points at a fix instead of a dead end.

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

### Making the cut invisible

Three separate things make an edit noticeable, and only the third is a
transition at all.

**The picture used to go black at every cut.** A ripple delete makes the video
element jump to a different part of the file, and a `<video>` asked for a new
position mid-playback has no frame to give until it has decoded. Measured on a
real recording, the canvas was empty for ~280 ms at every join — far more
visible than any transition choice, and the actual cause of the "clips are
jumping" complaint. The playback engine now keeps the last decoded frame per
element and hands that to the compositor while the element seeks, and points an
upcoming clip's element at its first frame ~0.7 s before it is needed. Holding a
frame for two or three ticks is invisible; dropping to black is the most visible
thing in the whole edit.

**The click.** Severing the waveform mid-cycle is audible. 45 ms of fade on each
side removes it and is itself inaudible.

**The head jump.** The speaker is in a different position across the cut, and
the only thing that hides it is a short cross-dissolve. An earlier version of
this file used a small change of framing instead, on the theory that it would
read as a second camera angle; a few percent of scale is too little to read as
an angle and too much to go unnoticed, so it added a visible pop in the name of
hiding one. It is gone.

The dissolve is built from the footage the cut removed. Both halves of a recut
seam come from one file, so a dissolve needs frames from either side of the join
at the same instant — which is exactly what the deleted filler word or pause
provides. The outgoing clip is extended forward into that removed material and
the incoming clip fades up over it, so the blend happens across footage nobody
wanted, no kept speech is lost, and nothing downstream moves. A volume envelope
closes the extension at the original cut point, so the removed "um" is briefly
seen under a fading picture and never heard.

That needs two frames of one file on screen at once, which the media pool could
not do — it held one element per asset and the two clips fought over
`currentTime`. Elements are now keyed by asset *and slot*, with clips of the
same asset alternating between two slots in track order, so any two neighbours
always hold different elements. A second element is only created when a clip
actually needs one.

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
