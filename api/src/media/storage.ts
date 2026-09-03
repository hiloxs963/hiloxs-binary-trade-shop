import { createHash } from "node:crypto";
import { MediaStorageUnavailableError } from "../lib/errors.js";
import type { AllowedMediaMime } from "./model.js";

export type UploadGrant = {
  method: "POST";
  url: string;
  fields: Record<string, string>;
  expiresAt: Date;
};

export type StoredObjectMetadata = {
  byteSize: number;
  etag: string;
  contentType?: string;
  sha256?: string;
  mediaId?: string;
};

export type StoredObject = StoredObjectMetadata & {
  body: AsyncIterable<Uint8Array>;
};

export interface MediaStorage {
  createUploadGrant(input: {
    objectKey: string;
    declaredMime: AllowedMediaMime;
    exactByteSize: number;
    mediaId: string;
    expiresAt: Date;
  }): Promise<UploadGrant>;
  head(objectKey: string): Promise<StoredObjectMetadata | null>;
  get(objectKey: string, options?: { ifMatch?: string }): Promise<StoredObject>;
  putImmutable(input: {
    objectKey: string;
    body: Uint8Array;
    contentType: "image/webp";
    sha256: string;
  }): Promise<void>;
  deleteQuarantine(objectKey: string): Promise<void>;
}

export function assertQuarantineObjectKey(objectKey: string): void {
  const segments = objectKey.split("/");
  if (
    segments[0] !== "quarantine" ||
    segments.length < 3 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new MediaStorageUnavailableError();
  }
}

export class StoredObjectChangedError extends Error {
  constructor() {
    super("The stored object no longer matches its captured version");
    this.name = "StoredObjectChangedError";
  }
}

export async function readStoredObject(
  object: StoredObject,
  maximumBytes: number,
): Promise<Buffer> {
  if (object.byteSize <= 0 || object.byteSize > maximumBytes) {
    throw new MediaStorageUnavailableError();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of object.body) {
      const buffer = Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maximumBytes) throw new MediaStorageUnavailableError();
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof MediaStorageUnavailableError) throw error;
    throw new MediaStorageUnavailableError(error);
  }
  if (total !== object.byteSize) throw new MediaStorageUnavailableError();
  return Buffer.concat(chunks, total);
}

export function sha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
