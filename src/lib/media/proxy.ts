/**
 * Hosts we are willing to fetch on the user's behalf. This allowlist is what
 * keeps `/api/media/proxy` from being an open proxy (SSRF): an attacker cannot
 * point it at an internal address, because only these providers' CDNs pass.
 */
const ALLOWED_HOSTS = [
  'images.pexels.com',
  'videos.pexels.com',
  'player.vimeo.com',
  'cdn.pixabay.com',
  'pixabay.com',
  'images.unsplash.com',
  'plus.unsplash.com',
];

export function isAllowedMediaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

/**
 * Stock media is served through our own origin so the canvas compositor stays
 * un-tainted (browser export reads pixels back out of the canvas, which a
 * cross-origin frame would forbid).
 */
export function proxiedMediaUrl(raw: string): string {
  return `/api/media/proxy?src=${encodeURIComponent(raw)}`;
}

export { ALLOWED_HOSTS };
