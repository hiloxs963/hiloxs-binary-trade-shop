import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { MediaRuntimeConfig } from "../config/env.js";
import { MediaStorageUnavailableError } from "../lib/errors.js";
import {
  StoredObjectChangedError,
  assertQuarantineObjectKey,
  type MediaStorage,
  type StoredObject,
  type StoredObjectMetadata,
  type UploadGrant,
} from "./storage.js";

type S3StorageConfig = NonNullable<MediaRuntimeConfig["storage"]>;

export class S3MediaStorage implements MediaStorage {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(config: S3StorageConfig) {
    this.#bucket = config.bucket;
    this.#client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
      },
    });
  }

  async createUploadGrant(input: {
    objectKey: string;
    declaredMime: "image/jpeg" | "image/png" | "image/webp";
    exactByteSize: number;
    mediaId: string;
    expiresAt: Date;
  }): Promise<UploadGrant> {
    const expires = Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1_000));
    try {
      const grant = await createPresignedPost(this.#client, {
        Bucket: this.#bucket,
        Key: input.objectKey,
        Expires: expires,
        Fields: {
          key: input.objectKey,
          "Content-Type": input.declaredMime,
          "x-amz-meta-hiloxs-media-id": input.mediaId,
        },
        Conditions: [
          ["eq", "$key", input.objectKey],
          ["eq", "$Content-Type", input.declaredMime],
          ["eq", "$x-amz-meta-hiloxs-media-id", input.mediaId],
          ["content-length-range", input.exactByteSize, input.exactByteSize],
        ],
      });
      return { method: "POST", url: grant.url, fields: grant.fields, expiresAt: input.expiresAt };
    } catch (error) {
      throw new MediaStorageUnavailableError(error);
    }
  }

  async head(objectKey: string): Promise<StoredObjectMetadata | null> {
    try {
      const result = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: objectKey }),
      );
      if (result.ContentLength === undefined || !result.ETag) {
        throw new MediaStorageUnavailableError();
      }
      return {
        byteSize: result.ContentLength,
        etag: result.ETag,
        ...(result.ContentType ? { contentType: result.ContentType } : {}),
        ...(result.Metadata?.["sha256"] ? { sha256: result.Metadata["sha256"] } : {}),
        ...(result.Metadata?.["hiloxs-media-id"]
          ? { mediaId: result.Metadata["hiloxs-media-id"] }
          : {}),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      if (error instanceof MediaStorageUnavailableError) throw error;
      throw new MediaStorageUnavailableError(error);
    }
  }

  async get(objectKey: string, options: { ifMatch?: string } = {}): Promise<StoredObject> {
    try {
      const result = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: objectKey,
          ...(options.ifMatch ? { IfMatch: options.ifMatch } : {}),
        }),
      );
      if (!result.Body || result.ContentLength === undefined || !result.ETag) {
        throw new MediaStorageUnavailableError();
      }
      return {
        body: result.Body as AsyncIterable<Uint8Array>,
        byteSize: result.ContentLength,
        etag: result.ETag,
        ...(result.ContentType ? { contentType: result.ContentType } : {}),
        ...(result.Metadata?.["sha256"] ? { sha256: result.Metadata["sha256"] } : {}),
        ...(result.Metadata?.["hiloxs-media-id"]
          ? { mediaId: result.Metadata["hiloxs-media-id"] }
          : {}),
      };
    } catch (error) {
      if (isPreconditionFailed(error)) throw new StoredObjectChangedError();
      if (error instanceof MediaStorageUnavailableError) throw error;
      if (error instanceof StoredObjectChangedError) throw error;
      throw new MediaStorageUnavailableError(error);
    }
  }

  async putImmutable(input: {
    objectKey: string;
    body: Uint8Array;
    contentType: "image/webp";
    sha256: string;
  }): Promise<void> {
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: input.objectKey,
          Body: input.body,
          ContentType: input.contentType,
          CacheControl: "private, no-store",
          Metadata: { sha256: input.sha256 },
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (isPreconditionFailed(error)) {
        const existing = await this.head(input.objectKey);
        if (
          existing?.sha256 === input.sha256 &&
          existing.byteSize === input.body.byteLength &&
          existing.contentType === input.contentType
        ) {
          return;
        }
      }
      throw new MediaStorageUnavailableError(error);
    }
  }

  async deleteQuarantine(objectKey: string): Promise<void> {
    assertQuarantineObjectKey(objectKey);
    try {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: objectKey }));
    } catch (error) {
      throw new MediaStorageUnavailableError(error);
    }
  }
}

function isNotFound(error: unknown): boolean {
  return statusCodeFor(error) === 404 || errorNameFor(error) === "NotFound";
}

function isPreconditionFailed(error: unknown): boolean {
  return statusCodeFor(error) === 412 || errorNameFor(error) === "PreconditionFailed";
}

function statusCodeFor(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("$metadata" in error)) return undefined;
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
}

function errorNameFor(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("name" in error)) return undefined;
  return typeof error.name === "string" ? error.name : undefined;
}
