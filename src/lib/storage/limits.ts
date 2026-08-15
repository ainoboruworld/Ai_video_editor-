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
