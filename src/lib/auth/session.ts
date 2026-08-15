import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isProduction } from '@/lib/env';

export const OWNER_COOKIE = 'ave_uid';
const MAX_AGE = 60 * 60 * 24 * 365;

export interface Session {
  ownerId: string;
  /** True when this request minted a new identity that must be persisted in a cookie. */
  isNew: boolean;
  /** Set once a real auth provider is wired in. */
  authenticated: boolean;
}

function newOwnerId(): string {
  return `u_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * Resolves the owner of the current request.
 *
 * Today every browser gets a stable anonymous identity in an http-only cookie,
 * and every store query is scoped by it — so one visitor can never read another
 * visitor's projects. To add real accounts, implement `authenticatedUserId()`
 * (NextAuth/Clerk/Supabase session lookup) and return that id: nothing else in
 * the app changes, because all data access already goes through `Session`.
 */
export async function getSession(): Promise<Session> {
  const authenticated = await authenticatedUserId();
  if (authenticated) return { ownerId: authenticated, isNew: false, authenticated: true };

  const jar = await cookies();
  const existing = jar.get(OWNER_COOKIE)?.value;
  if (existing && /^u_[a-z0-9]{6,40}$/i.test(existing)) {
    return { ownerId: existing, isNew: false, authenticated: false };
  }
  return { ownerId: newOwnerId(), isNew: true, authenticated: false };
}

/** Placeholder for a real auth provider. Returns null while auth is not configured. */
async function authenticatedUserId(): Promise<string | null> {
  return null;
}

/** Attaches the anonymous identity cookie when the session was just created. */
export function withSessionCookie(response: NextResponse, session: Session): NextResponse {
  if (!session.isNew || session.authenticated) return response;
  response.cookies.set(OWNER_COOKIE, session.ownerId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: MAX_AGE,
  });
  return response;
}
