import {
  MAX_MEDIA_HEIGHT,
  MAX_MEDIA_INPUT_BYTES,
  MAX_MEDIA_INPUT_PIXELS,
  MAX_MEDIA_WIDTH,
  MIN_MEDIA_HEIGHT,
  MIN_MEDIA_WIDTH,
  type AllowedMediaMime,
} from "./media-limits.js";

// Structural stand-in for File so this module stays free of DOM types and runs under Node tests.
export type ImageFileLike = { name: string; size: number; type: string };

export type ImageDecoder<F extends ImageFileLike> = {
  /** First bytes of the file, enough to recognise the format (at least 16). */
  readHead: (file: F) => Promise<Uint8Array>;
  /** Pixel size, or null when the browser cannot decode the file. */
  decode: (file: F) => Promise<{ width: number; height: number } | null>;
};

export type MediaValidationCode =
  | "NO_FILE"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "HEIC_UNSUPPORTED"
  | "UNSUPPORTED_TYPE"
  | "UNREADABLE_IMAGE"
  | "DIMENSIONS_TOO_SMALL"
  | "DIMENSIONS_TOO_LARGE"
  | "TOO_MANY_PIXELS";

export type MediaValidationResult =
  | { ok: true; mime: AllowedMediaMime; width: number; height: number }
  | { ok: false; code: MediaValidationCode; message: string; hint: string };

const MAX_MEGABYTES = MAX_MEDIA_INPUT_BYTES / (1024 * 1024);

function fail(code: MediaValidationCode, message: string, hint: string): MediaValidationResult {
  return { ok: false, code, message, hint };
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/**
 * Identifies the real format from magic bytes. file.type is unreliable on mobile: some Android
 * browsers report an empty string and a renamed file keeps its old extension.
 */
export function sniffImageFormat(bytes: Uint8Array): AllowedMediaMime | "heic" | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (
    ascii(bytes, 4, 8) === "ftyp" &&
    /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(bytes, 8, 12))
  ) {
    return "heic";
  }
  return null;
}

export async function validateImageFile<F extends ImageFileLike>(
  file: F | null | undefined,
  decoder: ImageDecoder<F>,
): Promise<MediaValidationResult> {
  if (!file) {
    return fail("NO_FILE", "Choose an image to upload.", "JPEG, PNG or WebP, up to 8 MB.");
  }
  if (file.size === 0) {
    return fail(
      "EMPTY_FILE",
      "This file is empty.",
      "Pick the photo again from your gallery or files, not from a share or cloud link.",
    );
  }
  if (file.size > MAX_MEDIA_INPUT_BYTES) {
    const megabytes = (file.size / (1024 * 1024)).toFixed(1);
    return fail(
      "FILE_TOO_LARGE",
      `This file is ${megabytes} MB. The maximum is ${MAX_MEGABYTES} MB.`,
      "Export a smaller JPEG or WebP, or lower the camera resolution.",
    );
  }

  let format: ReturnType<typeof sniffImageFormat>;
  try {
    format = sniffImageFormat(await decoder.readHead(file));
  } catch {
    return fail(
      "UNREADABLE_IMAGE",
      "This file could not be read.",
      "Pick the photo again, or save a copy to your device first.",
    );
  }
  if (format === "heic") {
    return fail(
      "HEIC_UNSUPPORTED",
      "HEIC/HEIF photos are not supported.",
      "Set your camera to Most Compatible, or share or export the photo as JPEG.",
    );
  }
  if (!format) {
    return fail(
      "UNSUPPORTED_TYPE",
      "Only JPEG, PNG and WebP images are supported.",
      "Choose a different file, or export this one as JPEG.",
    );
  }

  const size = await decoder.decode(file).catch(() => null);
  if (!size || size.width <= 0 || size.height <= 0) {
    return fail(
      "UNREADABLE_IMAGE",
      "This image could not be read and may be corrupt.",
      "Try the original photo, or export it again as JPEG.",
    );
  }
  const { width, height } = size;
  if (width < MIN_MEDIA_WIDTH || height < MIN_MEDIA_HEIGHT) {
    return fail(
      "DIMENSIONS_TOO_SMALL",
      `This image is ${width}×${height} pixels. The minimum is ${MIN_MEDIA_WIDTH}×${MIN_MEDIA_HEIGHT}.`,
      "Images sent through WhatsApp are compressed and shrunk. Use the original photo from your gallery or camera instead.",
    );
  }
  if (width > MAX_MEDIA_WIDTH || height > MAX_MEDIA_HEIGHT) {
    return fail(
      "DIMENSIONS_TOO_LARGE",
      `This image is ${width}×${height} pixels. The maximum is ${MAX_MEDIA_WIDTH}×${MAX_MEDIA_HEIGHT}.`,
      "Resize the image, or lower the camera resolution, then choose it again.",
    );
  }
  if (width * height > MAX_MEDIA_INPUT_PIXELS) {
    const megapixels = Math.round(MAX_MEDIA_INPUT_PIXELS / 1_000_000);
    return fail(
      "TOO_MANY_PIXELS",
      `This image has ${((width * height) / 1_000_000).toFixed(1)} megapixels. The maximum is ${megapixels}.`,
      "Resize the image, or lower the camera resolution, then choose it again.",
    );
  }
  return { ok: true, mime: format, width, height };
}
