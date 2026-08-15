import { NextResponse } from 'next/server';
import { activeTranscriptionProvider } from '@/lib/ai/transcribe';
import { ApiError, handle, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

/**
 * Automatic captions from real audio.
 *
 * The browser extracts the timeline's audio, downmixes it to 16 kHz mono WAV
 * (roughly 32 kB/s, so minutes of speech fit inside a serverless request) and
 * posts it here. The provider returns word-level timings which become caption
 * clips on the timeline.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const provider = activeTranscriptionProvider();
    if (!provider) {
      throw new ApiError(
        503,
        'Automatic captions need a transcription provider. Set OPENAI_API_KEY, or write captions manually.',
        'no_transcription_provider',
      );
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('audio');
    if (!(file instanceof Blob)) throw new ApiError(400, 'Missing audio file', 'invalid_request');
    if (file.size === 0) throw new ApiError(400, 'Audio file is empty', 'invalid_request');
    if (file.size > MAX_AUDIO_BYTES) {
      throw new ApiError(413, 'Audio is too long for a single request. Caption in shorter sections.', 'too_large');
    }

    const language = typeof form?.get('language') === 'string' ? String(form.get('language')) : undefined;
    const cues = await provider.transcribe(file, 'audio.wav', language);
    return ok({ cues, provider: provider.name });
  });
}
