import { describe, expect, it } from "vitest";
import {
  sniffImageFormat,
  validateImageFile,
  type ImageDecoder,
  type ImageFileLike,
} from "../../../src/lib/media-validation.js";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52];
const WEBP = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP"), 0x56, 0x50, 0x38, 0x20];
const HEIC = [0, 0, 0, 0x18, ...Buffer.from("ftypheic"), 0, 0, 0, 0, ...Buffer.from("mif1")];

function file(overrides: Partial<ImageFileLike> = {}): ImageFileLike {
  return { name: "photo.jpg", size: 500_000, type: "image/jpeg", ...overrides };
}

function decoder(
  head: number[],
  size: { width: number; height: number } | null | "throws",
): ImageDecoder<ImageFileLike> {
  return {
    readHead: () => Promise.resolve(Uint8Array.from(head)),
    decode: () =>
      size === "throws" ? Promise.reject(new Error("decode failed")) : Promise.resolve(size),
  };
}

describe("sniffImageFormat", () => {
  it("recognises JPEG, PNG, WebP and HEIC by magic bytes", () => {
    expect(sniffImageFormat(Uint8Array.from(JPEG))).toBe("image/jpeg");
    expect(sniffImageFormat(Uint8Array.from(PNG))).toBe("image/png");
    expect(sniffImageFormat(Uint8Array.from(WEBP))).toBe("image/webp");
    expect(sniffImageFormat(Uint8Array.from(HEIC))).toBe("heic");
  });

  it("returns null for anything else, including a short head", () => {
    expect(sniffImageFormat(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(0))).toBeNull();
  });
});

describe("validateImageFile", () => {
  it("accepts a valid image and reports the detected type and size", async () => {
    await expect(
      validateImageFile(file(), decoder(JPEG, { width: 1200, height: 900 })),
    ).resolves.toEqual({ ok: true, mime: "image/jpeg", width: 1200, height: 900 });
  });

  it("trusts the bytes, not file.type, so an empty type from a mobile browser still passes", async () => {
    const result = await validateImageFile(
      file({ type: "" }),
      decoder(PNG, { width: 800, height: 800 }),
    );
    expect(result).toMatchObject({ ok: true, mime: "image/png" });
  });

  it("rejects a missing file", async () => {
    const result = await validateImageFile(null, decoder(JPEG, null));
    expect(result).toMatchObject({ ok: false, code: "NO_FILE" });
  });

  it("rejects an empty file", async () => {
    const result = await validateImageFile(file({ size: 0 }), decoder(JPEG, null));
    expect(result).toMatchObject({ ok: false, code: "EMPTY_FILE" });
  });

  it("rejects a file over 8 MB with the real size and limit in the message", async () => {
    const result = await validateImageFile(
      file({ size: 11.2 * 1024 * 1024 }),
      decoder(JPEG, { width: 2000, height: 2000 }),
    );
    expect(result).toMatchObject({ ok: false, code: "FILE_TOO_LARGE" });
    if (!result.ok) expect(result.message).toBe("This file is 11.2 MB. The maximum is 8 MB.");
  });

  it("accepts a file of exactly 8 MB", async () => {
    const result = await validateImageFile(
      file({ size: 8 * 1024 * 1024 }),
      decoder(JPEG, { width: 2000, height: 2000 }),
    );
    expect(result.ok).toBe(true);
  });

  it("explains HEIC and says how to get a JPEG", async () => {
    const result = await validateImageFile(
      file({ name: "IMG_1.HEIC", type: "image/heic" }),
      decoder(HEIC, { width: 3000, height: 3000 }),
    );
    expect(result).toMatchObject({ ok: false, code: "HEIC_UNSUPPORTED" });
    if (!result.ok) expect(result.hint).toMatch(/Most Compatible|JPEG/);
  });

  it("rejects a renamed non-image even when file.type claims JPEG", async () => {
    const result = await validateImageFile(
      file(),
      decoder([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], { width: 1000, height: 1000 }),
    );
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
  });

  it("rejects an image that cannot be decoded, whether decode returns null or throws", async () => {
    for (const outcome of [null, "throws"] as const) {
      const result = await validateImageFile(file(), decoder(JPEG, outcome));
      expect(result).toMatchObject({ ok: false, code: "UNREADABLE_IMAGE" });
    }
  });

  it("rejects when the head cannot be read", async () => {
    const result = await validateImageFile(file(), {
      readHead: () => Promise.reject(new Error("read failed")),
      decode: () => Promise.resolve({ width: 1000, height: 1000 }),
    });
    expect(result).toMatchObject({ ok: false, code: "UNREADABLE_IMAGE" });
  });

  describe("dimensions", () => {
    it("rejects 354×281 with the WhatsApp hint (the reported case)", async () => {
      const result = await validateImageFile(file(), decoder(JPEG, { width: 354, height: 281 }));
      expect(result).toMatchObject({ ok: false, code: "DIMENSIONS_TOO_SMALL" });
      if (!result.ok) {
        expect(result.message).toBe("This image is 354×281 pixels. The minimum is 600×600.");
        expect(result.hint).toContain("WhatsApp");
        expect(result.hint).toContain("original photo");
      }
    });

    it("rejects when only one side is under the minimum", async () => {
      for (const size of [
        { width: 599, height: 2000 },
        { width: 2000, height: 599 },
      ]) {
        const result = await validateImageFile(file(), decoder(JPEG, size));
        expect(result).toMatchObject({ ok: false, code: "DIMENSIONS_TOO_SMALL" });
      }
    });

    it("accepts exactly 600×600 and exactly 6000 on a side within the pixel cap", async () => {
      expect((await validateImageFile(file(), decoder(JPEG, { width: 600, height: 600 }))).ok).toBe(
        true,
      );
      expect(
        (await validateImageFile(file(), decoder(JPEG, { width: 6000, height: 4000 }))).ok,
      ).toBe(true);
    });

    it("rejects a side over 6000", async () => {
      const result = await validateImageFile(file(), decoder(JPEG, { width: 6001, height: 1000 }));
      expect(result).toMatchObject({ ok: false, code: "DIMENSIONS_TOO_LARGE" });
    });

    it("rejects more than 25 megapixels even when each side is within 6000", async () => {
      const result = await validateImageFile(file(), decoder(JPEG, { width: 5100, height: 5000 }));
      expect(result).toMatchObject({ ok: false, code: "TOO_MANY_PIXELS" });
    });

    it("accepts exactly 25 megapixels", async () => {
      const result = await validateImageFile(file(), decoder(JPEG, { width: 5000, height: 5000 }));
      expect(result.ok).toBe(true);
    });
  });
});
