import 'server-only';
import { z } from 'zod';
import { env } from '@/lib/env';
import { GROQ_BASE } from './groq';
import { cloudflareBase } from './cloudflare';
import { HF_BASE } from './huggingface';
import { extractJson } from './types';
import { ApiError, fetchWithRetry } from '@/lib/http';
import type { CaptionCue } from '@/types';

/**
 * Speech-to-text provider abstraction for automatic captions.
 *
 * Both implementations speak the same OpenAI-compatible endpoint and return
 * word-level timestamps — exactly what karaoke-style captions need. Groq is
 * tried first because its Whisper endpoint has a free tier, so automatic
 * captions do not require a paid account. Adding Deepgram or AssemblyAI means
 * adding one more class here; the caption pipeline is unchanged.
 */
/**
 * Turns an upstream transcription failure into a message the user can act on.
 *
 * Free tiers fail in specific, fixable ways — an exhausted daily quota, a short
 * rate limit, audio that is too long — and each has a different next step.
 * Relaying the provider's raw JSON tells the user nothing they can use.
 */
export function transcriptionError(provider: string, status: number, detail: string): ApiError {
  const quota = /quota|billing|exceeded your current/i.test(detail);

  if (status === 429 && quota) {
    return new ApiError(
      429,
      provider.startsWith('gemini')
        ? 'Gemini free-tier quota is used up for now. Add a free GROQ_API_KEY — its Whisper tier handles long audio far better — or wait for the quota to reset.'
        : `${provider} quota is used up for now. Wait for it to reset, or configure another transcription provider.`,
      'quota_exhausted',
    );
  }
  if (status === 429) {
    return new ApiError(429, `${provider} is rate limiting requests. Wait a moment and try again.`, 'rate_limited');
  }
  if (status === 401 || status === 403) {
    return new ApiError(status, `${provider} rejected the API key. Check it is valid and enabled.`, 'unauthorized');
  }
  if (status === 413) {
    return new ApiError(413, 'This audio is too long for the provider. Caption it in shorter sections.', 'too_large');
  }
  return new ApiError(502, `${provider} could not transcribe this audio (${status}).`, 'transcription_failed');
}

export interface TranscriptionProvider {
  readonly name: string;
  isConfigured(): boolean;
  transcribe(audio: Blob, filename: string, language?: string): Promise<CaptionCue[]>;
}

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperSegment {
  text: string;
  start: number;
  end: number;
}

/** Shared implementation for the OpenAI-compatible `/audio/transcriptions` API. */
abstract class WhisperCompatibleTranscription implements TranscriptionProvider {
  abstract readonly name: string;
  protected abstract get baseUrl(): string;
  protected abstract get apiKey(): string | null;
  protected abstract get model(): string;

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async transcribe(audio: Blob, filename: string, language?: string): Promise<CaptionCue[]> {
    const key = this.apiKey;
    if (!key) throw new ApiError(400, `${this.name} is not configured`, 'no_transcription_provider');

    const form = new FormData();
    form.append('file', audio, filename);
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (language) form.append('language', language);

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw transcriptionError(this.name, res.status, detail);
    }

    const body = (await res.json()) as { words?: WhisperWord[]; segments?: WhisperSegment[]; text?: string };
    return toCues(body);
  }
}

/** Groq's free-tier Whisper — the zero-cost automatic caption path. */
export class GroqTranscription extends WhisperCompatibleTranscription {
  readonly name = 'groq-whisper';
  protected get baseUrl() {
    return GROQ_BASE;
  }
  protected get apiKey() {
    return env.GROQ_API_KEY;
  }
  protected get model() {
    return env.GROQ_TRANSCRIBE_MODEL;
  }
}

/** Cloudflare Workers AI Whisper — free daily allowance, no card. */
export class CloudflareTranscription extends WhisperCompatibleTranscription {
  readonly name = 'cloudflare-whisper';
  protected get baseUrl() {
    // Cloudflare exposes an OpenAI-compatible surface for audio models.
    return `${cloudflareBase() ?? ''}/${env.CLOUDFLARE_TRANSCRIBE_MODEL}/v1`;
  }
  protected get apiKey() {
    return cloudflareBase() ? env.CLOUDFLARE_API_TOKEN : null;
  }
  protected get model() {
    return env.CLOUDFLARE_TRANSCRIBE_MODEL;
  }
}

/** Hugging Face Inference Whisper — free tier. */
export class HuggingFaceTranscription extends WhisperCompatibleTranscription {
  readonly name = 'huggingface-whisper';
  protected get baseUrl() {
    return HF_BASE;
  }
  protected get apiKey() {
    return env.HF_TOKEN;
  }
  protected get model() {
    return env.HF_TRANSCRIBE_MODEL;
  }
}

/** OpenAI Whisper — supported, but optional and never required. */
export class OpenAiTranscription extends WhisperCompatibleTranscription {
  readonly name = 'openai-whisper';
  protected get baseUrl() {
    return 'https://api.openai.com/v1';
  }
  protected get apiKey() {
    return env.OPENAI_API_KEY;
  }
  protected get model() {
    return env.OPENAI_TRANSCRIBE_MODEL;
  }
}

/** Groups word timings into short, readable caption cues. */
export function toCues(body: { words?: WhisperWord[]; segments?: WhisperSegment[]; text?: string }, maxWords = 5): CaptionCue[] {
  const words = body.words ?? [];
  if (words.length > 0) {
    const cues: CaptionCue[] = [];
    for (let i = 0; i < words.length; i += maxWords) {
      const group = words.slice(i, i + maxWords);
      const first = group[0]!;
      const last = group[group.length - 1]!;
      cues.push({
        text: group.map((w) => w.word.trim()).join(' '),
        start: first.start,
        end: last.end,
        words: group.map((w) => ({ text: w.word.trim(), start: w.start, end: w.end })),
      });
    }
    return cues;
  }

  return (body.segments ?? []).map((segment) => ({
    text: segment.text.trim(),
    start: segment.start,
    end: segment.end,
    words: [],
  }));
}

// Free tier first.
/**
 * Gemini can transcribe audio directly, which matters because it is the one
 * free key that also drives scripts and editing — a user with only
 * GEMINI_API_KEY still gets captions and AI editing.
 *
 * It returns sentence-level timings rather than Whisper's word-level ones, so
 * it sits last: karaoke highlighting degrades to per-cue highlighting.
 */
export class GeminiTranscription implements TranscriptionProvider {
  readonly name = 'gemini-audio';

  isConfigured(): boolean {
    return Boolean(env.GEMINI_API_KEY);
  }

  async transcribe(audio: Blob, _filename: string, language?: string): Promise<CaptionCue[]> {
    const key = env.GEMINI_API_KEY;
    if (!key) throw new ApiError(400, 'GEMINI_API_KEY is not configured', 'no_transcription_provider');

    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (bytes.byteLength > 18 * 1024 * 1024) {
      throw new ApiError(
        413,
        'This audio is too long for Gemini transcription. Caption in shorter sections, or set a free GROQ_API_KEY.',
        'too_large',
      );
    }

    const instruction = [
      'Transcribe this audio verbatim.',
      'Split it into caption cues of at most 8 words each.',
      'Timestamps are seconds from the start of the audio, as numbers.',
      'Cues must be in order and must not overlap.',
      language ? `The audio is in ${language}.` : '',
      'Return ONLY JSON: { "cues": [{ "text": string, "start": number, "end": number }] }',
    ]
      .filter(Boolean)
      .join(' ');

    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        env.GEMINI_MODEL,
      )}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: instruction },
                { inlineData: { mimeType: audio.type || 'audio/wav', data: toBase64(bytes) } },
              ],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: 8000, responseMimeType: 'application/json' },
        }),
      },
      { timeoutMs: 55_000, attempts: 2 },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw transcriptionError(this.name, res.status, detail);
    }

    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    const parsed = geminiCuesSchema.safeParse(extractJson(text));
    if (!parsed.success) throw new ApiError(502, 'Gemini returned an unusable transcript', 'transcription_failed');

    return parsed.data.cues
      .filter((cue) => cue.end > cue.start && cue.text.trim().length > 0)
      .map((cue) => ({ text: cue.text.trim(), start: cue.start, end: cue.end, words: [] }));
  }
}

const geminiCuesSchema = z.object({
  cues: z.array(z.object({ text: z.string().max(400), start: z.number().min(0), end: z.number().min(0) })).max(2000),
});

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Whisper backends first: they give word-level timings and are billed per
 * audio second, so long recordings stay cheap. Gemini is last because its audio
 * is billed as tokens from the same small allowance the script calls use.
 *
 * Note that none of these is required — the Auto-edit panel can run Whisper in
 * the browser with no provider at all.
 */
const transcriptionProviders: TranscriptionProvider[] = [
  new GroqTranscription(),
  new CloudflareTranscription(),
  new HuggingFaceTranscription(),
  new OpenAiTranscription(),
  new GeminiTranscription(),
];

/** All transcription providers that are configured right now. */
export function availableTranscriptionProviders(): string[] {
  return transcriptionProviders.filter((provider) => provider.isConfigured()).map((provider) => provider.name);
}

export function activeTranscriptionProvider(): TranscriptionProvider | null {
  return transcriptionProviders.find((p) => p.isConfigured()) ?? null;
}
