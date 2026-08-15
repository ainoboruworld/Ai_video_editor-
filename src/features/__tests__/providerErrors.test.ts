import { describe, expect, it } from 'vitest';
import { transcriptionError } from '@/lib/ai/transcribe';
import { describeAiError } from '@/lib/ai';
import { AiError } from '@/lib/ai/types';
import { providerError } from '@/lib/media/types';

const QUOTA_BODY = '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details."}}';

describe('transcriptionError', () => {
  it('tells a Gemini user how to stop burning their quota', () => {
    const error = transcriptionError('gemini-audio', 429, QUOTA_BODY);
    expect(error.code).toBe('quota_exhausted');
    expect(error.message).toContain('GROQ_API_KEY');
    expect(error.message).not.toContain('{');
  });

  it('separates a transient rate limit from an exhausted quota', () => {
    const limited = transcriptionError('groq-whisper', 429, 'Too many requests, slow down');
    expect(limited.code).toBe('rate_limited');
    expect(limited.message).toContain('Wait a moment');
  });

  it('names a bad key rather than reporting a generic failure', () => {
    expect(transcriptionError('groq-whisper', 401, 'invalid api key').code).toBe('unauthorized');
  });

  it('explains audio that is too long', () => {
    expect(transcriptionError('gemini-audio', 413, 'payload too large').code).toBe('too_large');
  });

  it('never leaks the raw provider body', () => {
    const error = transcriptionError('gemini-audio', 500, '{"internal":"stack trace here"}');
    expect(error.message).not.toContain('stack trace');
  });
});

describe('describeAiError', () => {
  it('explains an exhausted quota', () => {
    const message = describeAiError(new AiError(`Gemini request failed (429): ${QUOTA_BODY}`, 'gemini', 429));
    expect(message).toContain('quota is used up');
    expect(message).toContain('GROQ_API_KEY');
  });

  it('explains congestion separately from quota', () => {
    const message = describeAiError(new AiError('Gemini request failed (503): high demand', 'gemini', 503));
    expect(message).toContain('busy right now');
  });

  it('passes plain errors through', () => {
    expect(describeAiError(new Error('network down'))).toBe('network down');
  });
});

describe('providerError', () => {
  it('names the environment variable to check on an auth failure', () => {
    expect(providerError('Pexels', 'PEXELS_API_KEY', 403, 'video search').message).toContain('PEXELS_API_KEY');
    // A 403 is also what a proxy or network policy returns for a blocked
    // request, so the message must not send the user off to rotate a key that
    // was never actually presented.
    expect(providerError('Pexels', 'PEXELS_API_KEY', 403, 'video search').message).toMatch(/blocked the request/i);
    expect(providerError('Pexels', 'PEXELS_API_KEY', 401, 'video search').message).toMatch(/refused the key/i);
    expect(providerError('Pexels', 'PEXELS_API_KEY', 401, 'video search').message).not.toMatch(/blocked the request/i);
  });

  it('distinguishes rate limits and outages', () => {
    expect(providerError('Pexels', 'PEXELS_API_KEY', 429, 'search').message).toContain('rate limit');
    expect(providerError('Pexels', 'PEXELS_API_KEY', 502, 'search').message).toContain('temporarily unavailable');
  });

  it('passes on what the upstream actually said', () => {
    const message = providerError('Pexels', 'PEXELS_API_KEY', 403, 'search', 'Forbidden by gateway policy').message;
    expect(message).toContain('Forbidden by gateway policy');
  });
});
