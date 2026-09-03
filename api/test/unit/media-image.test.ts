import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MediaProcessingError, processProductImage } from "../../src/media/image-processor.js";
import {
  MAX_MEDIA_HEIGHT,
  MAX_MEDIA_INPUT_PIXELS,
  MAX_MEDIA_WIDTH,
  MEDIA_VARIANT_MAX_WIDTH,
} from "../../src/media/model.js";

describe("seller media image processing", () => {
  it.each([
    ["plain text named jpg", Buffer.from("not a jpeg")],
    ["HTML named jpg", Buffer.from("<!doctype html><script>alert(1)</script>")],
    ["SVG renamed png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')],
    ["truncated JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
  ])("rejects %s by decoded bytes", async (_label, input) => {
    await expect(processProductImage(input)).rejects.toBeInstanceOf(MediaProcessingError);
  });

  it("rejects dimensions above the per-axis limit", async () => {
    const input = await sharp({
      create: { width: MAX_MEDIA_WIDTH + 1, height: 600, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();

    await expect(processProductImage(input)).rejects.toMatchObject({
      code: "DIMENSIONS_OUT_OF_RANGE",
    });
  });

  it("rejects decoded images above the pixel limit", async () => {
    const side = Math.floor(Math.sqrt(MAX_MEDIA_INPUT_PIXELS)) + 1;
    expect(side).toBeLessThanOrEqual(Math.min(MAX_MEDIA_WIDTH, MAX_MEDIA_HEIGHT));
    const input = await sharp({
      create: { width: side, height: side, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();

    await expect(processProductImage(input)).rejects.toBeInstanceOf(MediaProcessingError);
  });

  it("rejects animated WebP", async () => {
    const animatedGif = Buffer.from(
      "47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b",
      "hex",
    );
    const input = await sharp(animatedGif, { animated: true }).webp().toBuffer();

    await expect(processProductImage(input)).rejects.toBeInstanceOf(MediaProcessingError);
  });

  it("auto-orients, strips metadata, and emits bounded WebP variants", async () => {
    const input = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#159957" },
    })
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: {
          IFD0: { Artist: "fixture-author" },
          GPSIFD: { GPSLatitudeRef: "N", GPSLatitude: "1/1 2/1 3/1" },
        } as never,
      })
      .toBuffer();
    const processed = await processProductImage(input);

    expect(processed).toMatchObject({
      detectedMime: "image/jpeg",
      inputWidth: 600,
      inputHeight: 800,
    });
    expect(processed.variants.map((variant) => variant.variant).sort()).toEqual(
      Object.keys(MEDIA_VARIANT_MAX_WIDTH).sort(),
    );
    for (const variant of processed.variants) {
      const metadata = await sharp(variant.body).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
      expect(variant.width).toBeLessThanOrEqual(MEDIA_VARIANT_MAX_WIDTH[variant.variant]);
      expect(variant.height).toBeLessThanOrEqual(MEDIA_VARIANT_MAX_WIDTH[variant.variant]);
      expect(variant.body.includes(Buffer.from("fixture-author"))).toBe(false);
      expect(variant.body.includes(Buffer.from("GPSLatitude"))).toBe(false);
    }
  });

  it("re-encodes an accepted image polyglot without trailing payload", async () => {
    const image = await sharp({
      create: { width: 700, height: 700, channels: 3, background: "#2457c5" },
    })
      .jpeg()
      .toBuffer();
    const marker = Buffer.from("<script>polyglot-marker</script>");
    const processed = await processProductImage(Buffer.concat([image, marker]));

    expect(processed.variants).toHaveLength(4);
    for (const variant of processed.variants) {
      expect(variant.body.includes(marker)).toBe(false);
      expect((await sharp(variant.body).metadata()).format).toBe("webp");
    }
  });
});
