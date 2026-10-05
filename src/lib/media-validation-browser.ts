import type { ImageDecoder, ImageFileLike } from "./media-validation.js";

// Browser adapter for validateImageFile. Not imported by the Node tests: it needs Blob, Image and
// createImageBitmap.
const HEAD_BYTES = 16;

export const browserImageDecoder: ImageDecoder<File & ImageFileLike> = {
  async readHead(file) {
    return new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  },
  async decode(file) {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
      } catch {
        // Fall through to an <img> decode; some browsers lack createImageBitmap for a format.
      }
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise<{ width: number; height: number } | null>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve(null);
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};
