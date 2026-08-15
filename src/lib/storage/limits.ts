/** Upload policy shared by the sign route, the direct upload route and the UI. */

export const ACCEPTED_TYPES: Record<string, 'video' | 'image' | 'audio'> = {
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'video/x-m4v': 'video',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/mp4': 'audio',
  'audio/ogg': 'audio',
};

/** Ceiling for direct-to-storage uploads. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** Ceiling when the file has to pass through a serverless function. */
export const MAX_PROXY_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Ceiling for a poster data URI stored on an asset.
 *
 * Posters are generated in the browser and travel inside the project document,
 * so they are bounded on both sides: the encoder shrinks until it fits, and the
 * schema rejects anything larger. A 240px JPEG comfortably clears this; without
 * a limit a few hundred assets would make a project too big to save.
 */
export const MAX_THUMBNAIL_CHARS = 64_000;
