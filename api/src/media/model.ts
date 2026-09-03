export const MEDIA_STATUSES = [
  "PENDING_UPLOAD",
  "UPLOADED",
  "PROCESSING",
  "READY_FOR_REVIEW",
  "APPROVED",
  "REJECTED",
  "PROCESSING_FAILED",
  "ABANDONED",
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const MEDIA_VARIANTS = ["MASTER", "THUMBNAIL", "MEDIUM", "LARGE"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];
export const PUBLIC_MEDIA_VARIANTS = ["THUMBNAIL", "MEDIUM", "LARGE"] as const;
export type PublicMediaVariant = (typeof PUBLIC_MEDIA_VARIANTS)[number];

export const ALLOWED_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedMediaMime = (typeof ALLOWED_MEDIA_MIME_TYPES)[number];

export const SELLER_MEDIA_RIGHTS_VERSION = "seller-media-rights-v1";
export const MAX_MEDIA_INPUT_BYTES = 8 * 1024 * 1024;
export const MIN_MEDIA_WIDTH = 600;
export const MIN_MEDIA_HEIGHT = 600;
export const MAX_MEDIA_WIDTH = 6_000;
export const MAX_MEDIA_HEIGHT = 6_000;
export const MAX_MEDIA_INPUT_PIXELS = 25_000_000;
export const MAX_MEDIA_CHANNELS = 4;
export const MAX_ACTIVE_MEDIA_PER_SUBMISSION = 6;
export const MAX_INVENTORY_QUANTITY = 1_000_000;
export const QUARANTINE_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const UPLOAD_GRANT_TTL_SECONDS = 5 * 60;
export const MEDIA_PROCESSING_LEASE_MS = 5 * 60 * 1_000;
export const MEDIA_PROCESSING_RETRY_BASE_MS = 30 * 1_000;
export const MAX_MEDIA_PROCESSING_ATTEMPTS = 3;
export const PUBLIC_MEDIA_CACHE_SECONDS = 10 * 60;

export const MEDIA_VARIANT_MAX_WIDTH = {
  MASTER: 2_400,
  THUMBNAIL: 320,
  MEDIUM: 960,
  LARGE: 1_600,
} as const satisfies Record<MediaVariant, number>;
