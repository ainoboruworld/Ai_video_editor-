import 'server-only';
import { env } from '@/lib/env';
import { GROQ_BASE } from './groq';
import { ApiError } from '@/lib/http';
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
      throw new ApiError(
        res.status === 401 ? 401 : 502,
        `Transcription failed: ${detail.slice(0, 300)}`,
        'transcription_failed',
      );
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
const transcriptionProviders: TranscriptionProvider[] = [new GroqTranscription(), new OpenAiTranscription()];

export function activeTranscriptionProvider(): TranscriptionProvider | null {
  return transcriptionProviders.find((p) => p.isConfigured()) ?? null;
}
