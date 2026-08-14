import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './db.js';
import { storage } from './storage.js';
import { detectScenes } from './ffmpeg.js';
import { extractAudioWav, extractThumbnailAt } from './pipeline.js';
import { run } from './ffmpeg.js';
import type { JobContext } from './queue.js';
import { ollamaEnabled, ollamaGenerate, parseJsonLoose } from './ollama.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSCRIBE_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'transcribe.py');

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
}
export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}
export interface TranscriptDoc {
  segments: TranscriptSegment[];
}

async function getAssetOrThrow(assetId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');
  return asset;
}

function assetAbsPath(originalUrl: string): string {
  return storage.absPath(originalUrl.replace(/^\/media\//, ''));
}

export async function getTranscript(assetId: string): Promise<TranscriptDoc | null> {
  const row = await prisma.transcript.findUnique({ where: { assetId } });
  if (!row) return null;
  return JSON.parse(row.json) as TranscriptDoc;
}

// ---------------------------------------------------------------- transcription

export async function transcribeAsset(assetId: string, ctx: JobContext): Promise<{ segments: number }> {
  const asset = await getAssetOrThrow(assetId);
  if (asset.kind === 'image') throw new Error('Cannot transcribe an image');
  const src = assetAbsPath(asset.originalUrl);
  const dir = path.dirname(src);
  const wav = path.join(dir, `${path.basename(src)}.16k.wav`);
  const outJson = path.join(dir, `${path.basename(src)}.transcript.json`);
  try {
    await ctx.setProgress(0.1, 'Extracting audio');
    await extractAudioWav(src, wav, ctx.registerChild);
    await ctx.setProgress(0.3, 'Transcribing');
    const model = process.env.WHISPER_MODEL || 'small';
    const r = await run('python3', [TRANSCRIBE_SCRIPT, wav, outJson, '--model', model], {
      onChild: ctx.registerChild,
    });
    if (ctx.isCancelled()) throw new Error('Cancelled');
    if (r.code !== 0) {
      const stderr = r.stderr.trim();
      if (r.code === 3 || /faster-whisper is not installed|No module named/i.test(stderr)) {
        throw new Error('Transcription requires faster-whisper. Install it with: pip install faster-whisper');
      }
      if (/python3.*not found|ENOENT/i.test(stderr)) {
        throw new Error('python3 not found. Install Python 3 and run: pip install faster-whisper');
      }
      throw new Error(`Transcription failed: ${stderr.slice(-1000) || `exit code ${r.code}`}`);
    }
    const json = await fs.promises.readFile(outJson, 'utf8');
    const doc = JSON.parse(json) as TranscriptDoc;
    await prisma.transcript.upsert({
      where: { assetId },
      create: { assetId, json },
      update: { json },
    });
    await ctx.setProgress(1, 'Done');
    return { segments: doc.segments.length };
  } finally {
    await fs.promises.rm(wav, { force: true });
    await fs.promises.rm(outJson, { force: true });
  }
}

// ---------------------------------------------------------------- fillers

const ALWAYS_FILLERS = new Set(['um', 'uh', 'erm', 'hmm', 'basically', 'literally']);
const CONDITIONAL_FILLERS = new Set(['like', 'actually']);

function normWord(t: string): string {
  return t.toLowerCase().replace(/[^a-z']/g, '');
}

export interface FillerWord {
  text: string;
  start: number;
  end: number;
  segmentId: string;
}

export function findFillers(doc: TranscriptDoc): FillerWord[] {
  const out: FillerWord[] = [];
  for (const seg of doc.segments) {
    const words = seg.words;
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const n = normWord(w.text);
      const prev = words[i - 1];
      const next = words[i + 1];
      // "you know" bigram
      if (n === 'you' && next && normWord(next.text) === 'know') {
        out.push({ text: 'you know', start: w.start, end: next.end, segmentId: seg.id });
        i++;
        continue;
      }
      if (ALWAYS_FILLERS.has(n)) {
        out.push({ text: w.text, start: w.start, end: w.end, segmentId: seg.id });
        continue;
      }
      if (CONDITIONAL_FILLERS.has(n)) {
        const pauseBefore = !prev || w.start - prev.end > 0.25;
        const pauseAfter = !next || next.start - w.end > 0.25;
        const repeated =
          (prev && normWord(prev.text) === n) || (next && normWord(next.text) === n);
        if ((pauseBefore && pauseAfter) || repeated) {
          out.push({ text: w.text, start: w.start, end: w.end, segmentId: seg.id });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- scenes

export async function detectAssetScenes(assetId: string, ctx: JobContext): Promise<{ scenes: number }> {
  const asset = await getAssetOrThrow(assetId);
  if (asset.kind !== 'video') throw new Error('Scene detection requires a video asset');
  const src = assetAbsPath(asset.originalUrl);
  await ctx.setProgress(0.1, 'Detecting scene changes');
  const cuts = await detectScenes(src, 0.4, ctx.registerChild);
  if (ctx.isCancelled()) throw new Error('Cancelled');
  const duration = asset.duration ?? (cuts.length ? cuts[cuts.length - 1]! + 1 : 0);
  const boundaries = [0, ...cuts.filter((t) => t > 0.1 && t < duration - 0.1), duration];
  await prisma.scene.deleteMany({ where: { assetId } });
  const dirRel = path.dirname(asset.originalUrl.replace(/^\/media\//, ''));
  const dirAbs = path.dirname(src);
  await ctx.setProgress(0.5, 'Generating scene thumbnails');
  let count = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    if (end - start < 0.2) continue;
    const thumbName = `scene-${assetId}-${i}.jpg`;
    const thumbAbs = path.join(dirAbs, thumbName);
    const ok = await extractThumbnailAt(src, start + Math.min(0.5, (end - start) / 2), thumbAbs);
    await prisma.scene.create({
      data: {
        assetId,
        start,
        end,
        index: i,
        thumbnailUrl: ok ? storage.url(path.join(dirRel, thumbName)) : null,
      },
    });
    count++;
    await ctx.setProgress(0.5 + 0.5 * ((i + 1) / (boundaries.length - 1)), 'Generating scene thumbnails');
  }
  return { scenes: count };
}

// ---------------------------------------------------------------- clip suggestions

const HOOK_PATTERNS: Array<{ re: RegExp; label: string; weight: number }> = [
  { re: /\?/, label: 'question hook', weight: 12 },
  { re: /\b\d+([.,]\d+)?%?\b/, label: 'contains numbers', weight: 8 },
  { re: /\b(why|how)\b/i, label: 'why/how framing', weight: 10 },
  { re: /\b(secret|mistake|never|most people|nobody|truth|wrong|stop|warning)\b/i, label: 'curiosity trigger', weight: 12 },
  { re: /\b(amazing|incredible|insane|crazy|love|hate|best|worst|shocking|unbelievable)\b/i, label: 'emotional language', weight: 6 },
];

const STOPWORDS = new Set(
  'a an the and or but if then else for of on in to from with without at by as is are was were be been being do does did doing have has had having i you he she it we they me him her us them my your his its our their this that these those there here not no yes so just very really can could will would should may might must about into over under again further once more most other some such only own same than too s t don now what which who whom when where all any both each few'.split(' '),
);

interface Sentence {
  text: string;
  start: number;
  end: number;
}

export function splitSentences(doc: TranscriptDoc): Sentence[] {
  const sentences: Sentence[] = [];
  let cur: { words: TranscriptWord[]; text: string[] } = { words: [], text: [] };
  const flush = () => {
    if (cur.words.length) {
      sentences.push({
        text: cur.text.join(' ').trim(),
        start: cur.words[0]!.start,
        end: cur.words[cur.words.length - 1]!.end,
      });
    }
    cur = { words: [], text: [] };
  };
  for (const seg of doc.segments) {
    const words = seg.words.length ? seg.words : [{ text: seg.text, start: seg.start, end: seg.end, confidence: 1 }];
    for (const w of words) {
      cur.words.push(w);
      cur.text.push(w.text);
      if (/[.!?]$/.test(w.text.trim())) flush();
    }
    // Segment boundary with a real pause also ends a sentence
    flush();
  }
  flush();
  return sentences.filter((s) => s.text.length > 0);
}

export interface ClipCandidate {
  start: number;
  end: number;
  title: string;
  description: string;
  score: number;
  hook: string;
}

export function suggestClips(
  doc: TranscriptDoc,
  opts: { count: number; minDuration: number; maxDuration: number },
): ClipCandidate[] {
  const sentences = splitSentences(doc);
  if (sentences.length === 0) return [];
  const candidates: ClipCandidate[] = [];
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i; j < sentences.length; j++) {
      const start = sentences[i]!.start;
      const end = sentences[j]!.end;
      const dur = end - start;
      if (dur < opts.minDuration) continue;
      if (dur > opts.maxDuration) break;
      const text = sentences.slice(i, j + 1).map((s) => s.text).join(' ');
      const first = sentences[i]!.text;
      let score = 40;
      const reasons: string[] = [];
      let hook = '';
      for (const p of HOOK_PATTERNS) {
        if (p.re.test(first)) {
          score += p.weight;
          reasons.push(p.label);
          if (!hook) hook = p.label;
        }
      }
      // Information density: unique content words per second
      const tokens = text.toLowerCase().split(/\s+/).map(normWord).filter((t) => t.length > 2 && !STOPWORDS.has(t));
      const density = new Set(tokens).size / Math.max(1, dur);
      score += Math.min(15, density * 8);
      if (density > 1) reasons.push('information dense');
      // Completeness: sentence aligned already; bonus for full stop ending
      if (/[.!?]$/.test(sentences[j]!.text)) score += 5;
      candidates.push({
        start,
        end,
        title: first.replace(/[.!?]+$/, '').slice(0, 80) || 'Clip',
        description: reasons.length ? `Strong candidate: ${reasons.join(', ')}` : 'Complete self-contained segment',
        score: Math.max(0, Math.min(100, Math.round(score))),
        hook: hook || 'complete thought',
      });
    }
  }
  // Rank + position diversity: greedily pick non-overlapping, spaced-out winners
  candidates.sort((a, b) => b.score - a.score);
  const picked: ClipCandidate[] = [];
  for (const c of candidates) {
    if (picked.length >= opts.count) break;
    if (picked.some((p) => c.start < p.end && c.end > p.start)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start);
}

export async function clipSuggestionsJob(
  assetId: string,
  opts: { count: number; minDuration: number; maxDuration: number; platform?: string; style?: string },
  ctx: JobContext,
): Promise<{ suggestions: number }> {
  await getAssetOrThrow(assetId);
  const doc = await getTranscript(assetId);
  if (!doc) throw new Error('No transcript available. Run transcription first.');
  await ctx.setProgress(0.3, 'Scoring candidate clips');
  let clips = suggestClips(doc, opts);

  if (ollamaEnabled() && clips.length) {
    await ctx.setProgress(0.6, 'Refining titles with Ollama');
    const prompt =
      `You are refining social clip titles. For each clip return an improved short punchy title and a one-line hook. ` +
      `Respond ONLY with JSON: {"clips":[{"title":string,"hook":string}]} in the same order.\n` +
      JSON.stringify(clips.map((c) => ({ title: c.title, text: c.description })));
    const parsed = parseJsonLoose(await ollamaGenerate(prompt)) as { clips?: Array<{ title?: string; hook?: string }> } | null;
    if (parsed?.clips && Array.isArray(parsed.clips)) {
      clips = clips.map((c, i) => ({
        ...c,
        title: typeof parsed.clips![i]?.title === 'string' ? parsed.clips![i]!.title!.slice(0, 100) : c.title,
        hook: typeof parsed.clips![i]?.hook === 'string' ? parsed.clips![i]!.hook! : c.hook,
      }));
    }
  }

  await ctx.setProgress(0.9, 'Saving suggestions');
  await prisma.suggestion.deleteMany({ where: { assetId, kind: 'clip' } });
  for (const c of clips) {
    await prisma.suggestion.create({
      data: {
        assetId,
        kind: 'clip',
        start: c.start,
        end: c.end,
        title: c.title,
        description: c.description,
        score: c.score,
        payload: JSON.stringify({ hook: c.hook, platform: opts.platform ?? 'tiktok', style: opts.style ?? 'default' }),
      },
    });
  }
  return { suggestions: clips.length };
}

// ---------------------------------------------------------------- hooks

export async function generateHooks(assetId: string, start: number, end: number): Promise<string[]> {
  const doc = await getTranscript(assetId);
  let text = '';
  if (doc) {
    text = doc.segments
      .filter((s) => s.end > start && s.start < end)
      .map((s) => s.text)
      .join(' ')
      .trim();
  }
  const topic = text.split(/[.!?]/)[0]?.trim().slice(0, 60) || 'this';
  const hooks = [
    `Wait until you see what happens with ${topic.toLowerCase() || 'this'}...`,
    `Most people get this completely wrong.`,
    `Here's the one thing nobody tells you about ${topic.toLowerCase() || 'this'}.`,
    `Stop scrolling — this will change how you think about it.`,
    `I made this mistake so you don't have to.`,
  ];
  if (ollamaEnabled() && text) {
    const parsed = parseJsonLoose(
      await ollamaGenerate(
        `Write 5 short scroll-stopping hooks (max 12 words each) for a social clip with this transcript: "${text.slice(0, 800)}". Respond ONLY with JSON {"hooks": string[]}.`,
      ),
    ) as { hooks?: unknown } | null;
    if (parsed && Array.isArray(parsed.hooks) && parsed.hooks.every((h) => typeof h === 'string') && parsed.hooks.length >= 3) {
      return (parsed.hooks as string[]).slice(0, 5);
    }
  }
  return hooks.slice(0, 5);
}

// ---------------------------------------------------------------- b-roll

export async function brollSuggestionsJob(assetId: string, ctx: JobContext): Promise<{ suggestions: number }> {
  const asset = await getAssetOrThrow(assetId);
  const doc = await getTranscript(assetId);
  if (!doc) throw new Error('No transcript available. Run transcription first.');
  await ctx.setProgress(0.3, 'Extracting keywords');

  // Global keyword frequency of content words
  const freq = new Map<string, number>();
  for (const seg of doc.segments) {
    for (const raw of seg.text.toLowerCase().split(/\s+/)) {
      const w = normWord(raw);
      if (w.length > 3 && !STOPWORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const topKeywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w);

  const projectAssets = await prisma.asset.findMany({
    where: { projectId: asset.projectId, id: { not: assetId }, kind: { in: ['video', 'image'] } },
  });

  await ctx.setProgress(0.6, 'Proposing b-roll windows');
  await prisma.suggestion.deleteMany({ where: { assetId, kind: 'broll' } });
  let count = 0;
  for (const seg of doc.segments) {
    const segWords = seg.text.toLowerCase().split(/\s+/).map(normWord);
    const keywords = topKeywords.filter((k) => segWords.includes(k));
    if (keywords.length === 0) continue;
    const matches = projectAssets
      .filter((a) => keywords.some((k) => a.name.toLowerCase().includes(k)))
      .map((a) => a.id);
    await prisma.suggestion.create({
      data: {
        assetId,
        kind: 'broll',
        start: seg.start,
        end: seg.end,
        title: `B-roll: ${keywords.slice(0, 3).join(', ')}`,
        description: keywords.join(', '),
        score: null,
        payload: JSON.stringify({ keywords, candidateAssetIds: matches }),
      },
    });
    count++;
    if (count >= 20) break;
  }
  return { suggestions: count };
}

// ---------------------------------------------------------------- chapters

export async function chapterSuggestions(assetId: string): Promise<number> {
  const doc = await getTranscript(assetId);
  if (!doc || doc.segments.length === 0) return 0;
  const groups: TranscriptSegment[][] = [];
  let cur: TranscriptSegment[] = [];
  for (const seg of doc.segments) {
    const last = cur[cur.length - 1];
    const groupStart = cur[0]?.start ?? seg.start;
    const gap = last ? seg.start - last.end : 0;
    const groupLen = last ? last.end - groupStart : 0;
    if (cur.length && (gap > 2 || groupLen > 240)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(seg);
  }
  if (cur.length) groups.push(cur);
  await prisma.suggestion.deleteMany({ where: { assetId, kind: 'chapter' } });
  for (const g of groups) {
    const firstSentence = g[0]!.text.split(/(?<=[.!?])\s/)[0] ?? g[0]!.text;
    await prisma.suggestion.create({
      data: {
        assetId,
        kind: 'chapter',
        start: g[0]!.start,
        end: g[g.length - 1]!.end,
        title: firstSentence.replace(/[.!?]+$/, '').slice(0, 60) || 'Chapter',
        description: `${g.length} segments`,
        score: null,
        payload: JSON.stringify({}),
      },
    });
  }
  return groups.length;
}

// ---------------------------------------------------------------- full analyze

export async function analyzeAsset(assetId: string, ctx: JobContext): Promise<Record<string, unknown>> {
  const asset = await getAssetOrThrow(assetId);
  const result: Record<string, unknown> = {};
  await ctx.setProgress(0.05, 'Transcribing');
  try {
    const t = await transcribeAsset(assetId, ctx);
    result.transcript = t;
  } catch (err) {
    if (ctx.isCancelled()) throw err;
    result.transcriptError = err instanceof Error ? err.message : String(err);
  }
  if (ctx.isCancelled()) throw new Error('Cancelled');
  if (asset.kind === 'video') {
    await ctx.setProgress(0.4, 'Detecting scenes');
    result.scenes = await detectAssetScenes(assetId, ctx);
  }
  if (ctx.isCancelled()) throw new Error('Cancelled');
  const hasTranscript = !!(await prisma.transcript.findUnique({ where: { assetId } }));
  if (hasTranscript) {
    await ctx.setProgress(0.65, 'Generating clip suggestions');
    result.clips = await clipSuggestionsJob(assetId, { count: 5, minDuration: 8, maxDuration: 60 }, ctx);
    await ctx.setProgress(0.8, 'Finding b-roll opportunities');
    result.broll = await brollSuggestionsJob(assetId, ctx);
    await ctx.setProgress(0.9, 'Building chapters');
    result.chapters = { chapters: await chapterSuggestions(assetId) };
  }
  await ctx.setProgress(1, 'Done');
  return result;
}
