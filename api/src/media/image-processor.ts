import sharp from "sharp";
import {
  MAX_MEDIA_CHANNELS,
  MAX_MEDIA_HEIGHT,
  MAX_MEDIA_INPUT_PIXELS,
  MAX_MEDIA_WIDTH,
  MEDIA_VARIANT_MAX_WIDTH,
  MIN_MEDIA_HEIGHT,
  MIN_MEDIA_WIDTH,
  type MediaVariant,
} from "./model.js";
import { sha256Hex } from "./storage.js";

export class MediaProcessingError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable = false) {
    super("Media processing failed safely");
    this.name = "MediaProcessingError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type ProcessedMediaVariant = {
  variant: MediaVariant;
  body: Buffer;
  mime: "image/webp";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};

export type ProcessedMedia = {
  detectedMime: "image/jpeg" | "image/png" | "image/webp";
  inputSha256: string;
  inputWidth: number;
  inputHeight: number;
  variants: ProcessedMediaVariant[];
};

const FORMAT_TO_MIME = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export async function processProductImage(input: Buffer): Promise<ProcessedMedia> {
  try {
    const metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_MEDIA_INPUT_PIXELS,
      limitInputChannels: MAX_MEDIA_CHANNELS,
      pages: 1,
      animated: false,
      unlimited: false,
      sequentialRead: true,
    }).metadata();
    const detectedMime = metadata.format
      ? FORMAT_TO_MIME[metadata.format as keyof typeof FORMAT_TO_MIME]
      : undefined;
    if (!detectedMime) throw new MediaProcessingError("UNSUPPORTED_FORMAT");
    if ((metadata.pages ?? 1) !== 1) throw new MediaProcessingError("MULTI_FRAME_IMAGE");
    if (!metadata.width || !metadata.height) throw new MediaProcessingError("INVALID_DIMENSIONS");
    if ((metadata.channels ?? MAX_MEDIA_CHANNELS + 1) > MAX_MEDIA_CHANNELS) {
      throw new MediaProcessingError("TOO_MANY_CHANNELS");
    }
    const rotated = (metadata.orientation ?? 1) >= 5;
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    if (
      width < MIN_MEDIA_WIDTH ||
      height < MIN_MEDIA_HEIGHT ||
      width > MAX_MEDIA_WIDTH ||
      height > MAX_MEDIA_HEIGHT ||
      width * height > MAX_MEDIA_INPUT_PIXELS
    ) {
      throw new MediaProcessingError("DIMENSIONS_OUT_OF_RANGE");
    }

    const variants: ProcessedMediaVariant[] = [];
    for (const variant of Object.keys(MEDIA_VARIANT_MAX_WIDTH) as MediaVariant[]) {
      const { data, info } = await sharp(input, {
        failOn: "error",
        limitInputPixels: MAX_MEDIA_INPUT_PIXELS,
        limitInputChannels: MAX_MEDIA_CHANNELS,
        pages: 1,
        animated: false,
        unlimited: false,
        sequentialRead: true,
      })
        .autoOrient()
        .toColourspace("srgb")
        .resize({
          width: MEDIA_VARIANT_MAX_WIDTH[variant],
          height: MEDIA_VARIANT_MAX_WIDTH[variant],
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82, alphaQuality: 90, effort: 4, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
      variants.push({
        variant,
        body: data,
        mime: "image/webp",
        width: info.width,
        height: info.height,
        byteSize: data.byteLength,
        sha256: sha256Hex(data),
      });
    }
    return {
      detectedMime,
      inputSha256: sha256Hex(input),
      inputWidth: width,
      inputHeight: height,
      variants,
    };
  } catch (error) {
    if (error instanceof MediaProcessingError) throw error;
    throw new MediaProcessingError("INVALID_IMAGE");
  }
}
