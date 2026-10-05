// Client copy of the product-image limits enforced by the API and media worker. The API ships from
// its own build context and cannot import from src/, so api/test/unit/media-limits.test.ts fails
// when these values drift from api/src/media/model.ts. The server and worker stay authoritative.
export const ALLOWED_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedMediaMime = (typeof ALLOWED_MEDIA_MIME_TYPES)[number];

export const MAX_MEDIA_INPUT_BYTES = 8 * 1024 * 1024;
export const MIN_MEDIA_WIDTH = 600;
export const MIN_MEDIA_HEIGHT = 600;
export const MAX_MEDIA_WIDTH = 6_000;
export const MAX_MEDIA_HEIGHT = 6_000;
export const MAX_MEDIA_INPUT_PIXELS = 25_000_000;
