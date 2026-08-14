import { randomUUID } from 'node:crypto';
import { validateCommands, type EditorCommand, type Sequence } from '@ave/editor-core';
import { prisma } from './db.js';
import { storage } from './storage.js';
import { detectSilence } from './ffmpeg.js';
import { findFillers, getTranscript } from './analysis.js';
import { ollamaEnabled, ollamaGenerate, parseJsonLoose } from './ollama.js';

export interface AssistantResult {
  commands: EditorCommand[];
  summary: string;
}

function trackOfKind(seq: Sequence, kind: string): string | null {
  return seq.tracks.find((t) => t.kind === kind)?.id ?? null;
}

/** First video-track clip's assetId — the "primary" asset of the sequence. */
function primaryAssetId(seq: Sequence): string | null {
  for (const t of seq.tracks) {
    if (t.kind !== 'video') continue;
    for (const c of t.clips) if (c.assetId) return c.assetId;
  }
  return null;
}

async function assetPath(assetId: string): Promise<string | null> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return null;
  return storage.absPath(asset.originalUrl.replace(/^\/media\//, ''));
}

async function rulesEngine(seq: Sequence, prompt: string, assetId?: string): Promise<AssistantResult> {
  const p = prompt.toLowerCase();
  const commands: EditorCommand[] = [];
  const targetAssetId = assetId ?? primaryAssetId(seq);

  // remove silence
  if (/(remove|cut|delete|trim).*(silence|silent|dead air|pauses)/.test(p)) {
    if (!targetAssetId) return { commands: [], summary: 'No media clip found in the sequence to analyze for silence.' };
    const abs = await assetPath(targetAssetId);
    if (!abs) return { commands: [], summary: 'Referenced asset not found.' };
    const sections = await detectSilence(abs, 0.6, -35);
    // Reverse order so ripple removals keep earlier ranges valid
    for (const s of [...sections].reverse()) {
      commands.push({ type: 'REMOVE_RANGE', start: Math.max(0, s.start + 0.1), end: s.end - 0.1, ripple: true });
    }
    return {
      commands,
      summary: sections.length
        ? `Found ${sections.length} silent section(s); removing them with ripple.`
        : 'No silent sections detected.',
    };
  }

  // remove fillers
  if (/(remove|cut|delete).*(filler|um|uh|crutch)/.test(p)) {
    if (!targetAssetId) return { commands: [], summary: 'No media clip found in the sequence.' };
    const doc = await getTranscript(targetAssetId);
    if (!doc) return { commands: [], summary: 'No transcript available. Transcribe the asset first.' };
    const fillers = findFillers(doc);
    for (const f of [...fillers].reverse()) {
      commands.push({
        type: 'REMOVE_RANGE',
        start: Math.max(0, f.start - 0.05),
        end: f.end + 0.05,
        ripple: true,
      });
    }
    return {
      commands,
      summary: fillers.length ? `Removing ${fillers.length} filler word(s).` : 'No filler words found.',
    };
  }

  // bigger captions (check before generic captions intent)
  if (/(bigger|larger|increase).*(caption|subtitle|text)/.test(p)) {
    const capTrack = seq.tracks.find((t) => t.kind === 'caption');
    const clips = capTrack?.clips ?? [];
    for (const c of clips) {
      commands.push({
        type: 'SET_TEXT',
        clipId: c.id,
        style: { fontSize: Math.round((c.textStyle?.fontSize ?? 64) * 1.4) },
      });
    }
    return {
      commands,
      summary: clips.length ? `Increased caption size for ${clips.length} caption clip(s).` : 'No caption clips to resize.',
    };
  }

  // add captions
  if (/caption|subtitle/.test(p)) {
    if (!targetAssetId) return { commands: [], summary: 'No media clip found in the sequence.' };
    const doc = await getTranscript(targetAssetId);
    if (!doc) return { commands: [], summary: 'No transcript available. Transcribe the asset first, then ask again.' };
    const trackId = trackOfKind(seq, 'caption');
    if (!trackId) return { commands: [], summary: 'Sequence has no caption track.' };
    for (const seg of doc.segments) {
      commands.push({
        type: 'ADD_CAPTION',
        trackId,
        clipId: `cap-${randomUUID().slice(0, 8)}`,
        text: seg.text,
        start: seg.start,
        duration: Math.max(0.5, seg.end - seg.start),
        words: seg.words.map((w) => ({ text: w.text, start: w.start - seg.start, end: w.end - seg.start })),
        style: 'bold',
      });
    }
    return { commands, summary: `Added ${commands.length} caption(s) from the transcript.` };
  }

  // create N reels/clips
  const reels = p.match(/(?:create|make|generate)\s+(\d+)?\s*(reels?|clips?|shorts?)/);
  if (reels) {
    return {
      commands: [],
      summary: `To generate ${reels[1] ?? 'multiple'} clips, use the clip generator (POST /assets/:id/clips) — it analyzes the transcript and proposes the best moments.`,
    };
  }

  const allClips = seq.tracks.flatMap((t) => t.clips);
  const mediaClips = seq.tracks.filter((t) => t.kind === 'video' || t.kind === 'audio').flatMap((t) => t.clips);

  // speed
  const speedMatch = p.match(/(\d+(?:\.\d+)?)\s*x\s*(?:speed)?|speed\s*(?:to|at|up|down)?\s*(\d+(?:\.\d+)?)/);
  if (/speed|faster|slower|slow down|speed up/.test(p)) {
    let speed = speedMatch ? parseFloat(speedMatch[1] ?? speedMatch[2] ?? '') : NaN;
    if (!Number.isFinite(speed)) speed = /slow/.test(p) ? 0.5 : 2;
    speed = Math.max(0.25, Math.min(4, speed));
    for (const c of mediaClips) commands.push({ type: 'CHANGE_SPEED', clipId: c.id, speed });
    return { commands, summary: commands.length ? `Set speed to ${speed}x on ${commands.length} clip(s).` : 'No media clips to change speed.' };
  }

  // aspect ratio
  const aspectMatch = p.match(/\b(16:9|9:16|1:1|4:5|4:3)\b/);
  if (aspectMatch || /vertical|portrait|square|landscape|aspect/.test(p)) {
    const aspect = (aspectMatch?.[1] ?? (/vertical|portrait/.test(p) ? '9:16' : /square/.test(p) ? '1:1' : '16:9')) as
      | '16:9' | '9:16' | '1:1' | '4:5' | '4:3';
    commands.push({ type: 'CHANGE_ASPECT_RATIO', aspect });
    return { commands, summary: `Changed aspect ratio to ${aspect}.` };
  }

  // volume / mute
  if (/mute|volume|quieter|louder/.test(p)) {
    const volMatch = p.match(/(\d+)\s*%/);
    const mute = /\bmute\b/.test(p);
    const volume = volMatch ? parseInt(volMatch[1]!, 10) / 100 : /louder/.test(p) ? 1.5 : /quieter/.test(p) ? 0.5 : 1;
    for (const c of mediaClips) {
      commands.push({ type: 'CHANGE_VOLUME', clipId: c.id, volume: mute ? 0 : volume, muted: mute });
    }
    return { commands, summary: commands.length ? (mute ? `Muted ${commands.length} clip(s).` : `Set volume to ${Math.round(volume * 100)}% on ${commands.length} clip(s).`) : 'No media clips found.' };
  }

  return {
    commands: [],
    summary:
      `I couldn't map that request to editing commands. Try: "remove silence", "remove filler words", "add captions", ` +
      `"make captions bigger", "2x speed", "make it vertical", or "mute the audio". (${allClips.length} clip(s) in sequence.)`,
  };
}

function sequenceSummaryForLlm(seq: Sequence): string {
  return JSON.stringify({
    width: seq.width,
    height: seq.height,
    fps: seq.fps,
    aspect: seq.aspect,
    tracks: seq.tracks.map((t) => ({
      id: t.id,
      kind: t.kind,
      clips: t.clips.map((c) => ({ id: c.id, kind: c.kind, start: c.start, duration: c.duration, assetId: c.assetId, text: c.text })),
    })),
  });
}

const COMMAND_SCHEMA_HINT = `EditorCommand is a discriminated union on "type". Available types and required fields:
REMOVE_RANGE {start,end,ripple:boolean}; DELETE_CLIP {clipId}; MOVE_CLIP {clipId,start}; TRIM_CLIP {clipId,start,duration};
SPLIT_CLIP {clipId,time,newClipId}; CHANGE_SPEED {clipId,speed}; CHANGE_VOLUME {clipId,volume,muted?};
SET_FADE {clipId,fadeIn?,fadeOut?}; CHANGE_TRANSFORM {clipId,transform:{x?,y?,scale?,rotation?,opacity?}};
SET_FILTERS {clipId,filters:{brightness?,contrast?,saturation?,blur?,grayscale?}}; SET_TEXT {clipId,text?,style?,animation?};
ADD_TEXT {trackId,clipId,text,start,duration,style?}; ADD_CAPTION {trackId,clipId,text,start,duration,words?,style?};
CHANGE_ASPECT_RATIO {aspect:'16:9'|'9:16'|'1:1'|'4:5'|'4:3'}; SET_TRACK_STATE {trackId,muted?,visible?,locked?}.
clipId/trackId MUST be ids that exist in the sequence. Times in seconds.`;

export async function runAssistant(seq: Sequence, prompt: string, assetId?: string): Promise<AssistantResult> {
  if (ollamaEnabled()) {
    const system =
      `You are a video editing assistant. Convert the user's request into editor commands.\n${COMMAND_SCHEMA_HINT}\n` +
      `Current sequence: ${sequenceSummaryForLlm(seq)}\n` +
      `Respond ONLY with JSON: {"commands": EditorCommand[], "summary": string}. If the request cannot be done, return {"commands":[],"summary":"..."}.`;
    const parsed = parseJsonLoose(await ollamaGenerate(prompt, system)) as { commands?: unknown[]; summary?: string } | null;
    if (parsed && Array.isArray(parsed.commands)) {
      const v = validateCommands(seq, parsed.commands);
      if (v.ok && parsed.commands.length > 0) {
        return { commands: parsed.commands as EditorCommand[], summary: typeof parsed.summary === 'string' ? parsed.summary : 'Applied AI-generated edits.' };
      }
    }
  }
  const result = await rulesEngine(seq, prompt, assetId);
  const v = validateCommands(seq, result.commands);
  if (!v.ok) {
    return { commands: [], summary: `Generated commands failed validation: ${v.errors.slice(0, 3).join('; ')}` };
  }
  return result;
}
