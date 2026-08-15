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
