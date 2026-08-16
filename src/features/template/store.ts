'use client';

/**
 * Saved templates.
 *
 * A style profile is a few hundred bytes of numbers, so it lives in
 * localStorage: no account, no server, no cost, and available across every
 * project in this browser. That is the whole point of saving one — measure a
 * reference once, apply its style to everything you make afterwards.
 */
import type { StyleProfile } from './profile';

const KEY = 'ave:templates';
const MAX_TEMPLATES = 24;

export function listTemplates(): StyleProfile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isProfile).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function saveTemplate(profile: StyleProfile): StyleProfile[] {
  const existing = listTemplates().filter((entry) => entry.id !== profile.id);
  const next = [profile, ...existing].slice(0, MAX_TEMPLATES);
  write(next);
  return next;
}

export function deleteTemplate(id: string): StyleProfile[] {
  const next = listTemplates().filter((entry) => entry.id !== id);
  write(next);
  return next;
}

export function renameTemplate(id: string, name: string): StyleProfile[] {
  const next = listTemplates().map((entry) => (entry.id === id ? { ...entry, name } : entry));
  write(next);
  return next;
}

function write(profiles: StyleProfile[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(profiles));
  } catch {
    // Storage full or blocked. The template is still usable this session; it
    // just will not survive a reload, which is better than losing the analysis.
  }
}

/**
 * Guards against a stored shape from an older build.
 *
 * Only the fields the UI reads are checked, and anything that fails is dropped
 * rather than repaired: a half-valid profile applied to a timeline is worse
 * than a missing one.
 */
function isProfile(value: unknown): value is StyleProfile {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<StyleProfile>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.createdAt === 'string' &&
    typeof entry.pacing?.averageShotSeconds === 'number' &&
    typeof entry.transitions?.style === 'string' &&
    typeof entry.captions?.present === 'boolean' &&
    typeof entry.music?.present === 'boolean'
  );
}
