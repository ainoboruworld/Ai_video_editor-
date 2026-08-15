import 'server-only';
import { env } from '@/lib/env';
import { ApiError } from '@/lib/http';
import type { CaptionCue } from '@/types';

/**
 * Speech-to-text provider abstraction for automatic captions.
 *
 * The only implementation today is OpenAI's transcription endpoint (Whisper),
 * which returns word-level timestamps — exactly what karaoke-style captions
 * need. Adding Deepgram/AssemblyAI/Groq means adding one more class here; the
 * caption pipeline is unchanged.
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

export class OpenAiTranscription implements TranscriptionProvider {
  readonly name = 'openai-whisper';

  isConfigured(): boolean {
    return Boolean(env.OPENAI_API_KEY);
  }

  async transcribe(audio: Blob, filename: string, language?: string): Promise<CaptionCue[]> {
    const key = env.OPENAI_API_KEY;
    if (!key) throw new ApiError(400, 'Transcription needs OPENAI_API_KEY', 'no_transcription_provider');

    const form = new FormData();
    form.append('file', audio, filename);
    form.append('model', env.OPENAI_TRANSCRIBE_MODEL);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (language) form.append('language', language);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new ApiError(res.status === 401 ? 401 : 502, `Transcription failed: ${detail.slice(0, 300)}`, 'transcription_failed');
    }

    const body = (await res.json()) as { words?: WhisperWord[]; segments?: WhisperSegment[]; text?: string };
    return toCues(body);
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

const transcriptionProviders: TranscriptionProvider[] = [new OpenAiTranscription()];

export function activeTranscriptionProvider(): TranscriptionProvider | null {
  return transcriptionProviders.find((p) => p.isConfigured()) ?? null;
}
