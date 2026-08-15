import { NextResponse } from 'next/server';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';

/** Error type carrying an HTTP status, so route handlers stay small. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}

export function fail(status: number, message: string, code = 'error', details?: unknown): NextResponse {
  return NextResponse.json({ error: message, code, details }, { status });
}

/** Wraps a handler so thrown errors become clean JSON instead of a 500 HTML page. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.status, error.message, error.code, error.details);
    }
    if (error instanceof ZodError) {
      return fail(400, 'Invalid request body', 'invalid_request', error.flatten());
    }
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    console.error('[api]', error);
    return fail(500, message, 'internal_error');
  }
}

export async function parseBody<T>(request: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON', 'invalid_json');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, 'Invalid request body', 'invalid_request', result.error.flatten());
  }
  return result.data;
}

export function parseQuery<T>(request: Request, schema: ZodType<T, ZodTypeDef, unknown>): T {
  const url = new URL(request.url);
  const obj: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    obj[key] = value;
  });
  const result = schema.safeParse(obj);
  if (!result.success) {
    throw new ApiError(400, 'Invalid query parameters', 'invalid_request', result.error.flatten());
  }
  return result.data;
}

/** Statuses worth retrying: rate limits and transient upstream failures. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * fetch with a timeout and bounded retries.
 *
 * Free AI tiers return 429/503 routinely under load — a single attempt would
 * drop the user to the offline draft for what is a two-second hiccup. Retries
 * are capped and honour `Retry-After` so we never hammer a provider.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; attempts?: number } = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(url, init, options.timeoutMs);
      if (!RETRYABLE.has(response.status) || attempt === attempts) return response;

      const retryAfter = Number(response.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** (attempt - 1);
      await delay(Math.min(4000, backoff));
    } catch (error) {
      // A timeout on the last attempt is the caller's problem; earlier ones retry.
      lastError = error;
      if (attempt === attempts) throw error;
      await delay(400 * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new ApiError(502, 'Upstream request failed', 'upstream_error');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fetch with a timeout so a slow upstream provider cannot hang a function. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(504, `Upstream request timed out after ${timeoutMs}ms`, 'upstream_timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
