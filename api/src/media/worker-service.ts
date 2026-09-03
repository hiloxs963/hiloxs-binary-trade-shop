import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import type { Database, DatabaseClient } from "../db/client.js";
import { sellerProductMedia, sellerProductMediaVariants } from "../db/schema/media.js";
import {
  MAX_MEDIA_INPUT_BYTES,
  MAX_MEDIA_PROCESSING_ATTEMPTS,
  MEDIA_PROCESSING_LEASE_MS,
  MEDIA_PROCESSING_RETRY_BASE_MS,
  QUARANTINE_RETENTION_MS,
} from "./model.js";
import { MediaProcessingError, processProductImage } from "./image-processor.js";
import type { MediaStorage } from "./storage.js";
import { readStoredObject, StoredObjectChangedError } from "./storage.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function processNextMedia(
  database: DatabaseClient,
  storage: MediaStorage,
  now = new Date(),
): Promise<string | null> {
  const claimed = await claimMedia(database, now);
  if (!claimed) return cleanupNextQuarantine(database, storage, now);
  if (!claimed.processingLeaseUntil) {
    throw new MediaProcessingError("PROCESSING_LEASE_MISSING");
  }
  const claimedLeaseUntil = claimed.processingLeaseUntil;
  try {
    if (!claimed.quarantineEtag || claimed.inputByteSize === null) {
      throw new MediaProcessingError("MISSING_FINALIZATION_DATA");
    }
    const object = await storage.get(claimed.quarantineObjectKey, {
      ifMatch: claimed.quarantineEtag,
    });
    if (
      object.etag !== claimed.quarantineEtag ||
      object.byteSize !== claimed.inputByteSize ||
      object.byteSize > MAX_MEDIA_INPUT_BYTES
    ) {
      throw new MediaProcessingError("QUARANTINE_CHANGED");
    }
    const input = await readStoredObject(object, MAX_MEDIA_INPUT_BYTES);
    const processed = await processProductImage(input);
    const keyPrefix = `canonical/v1/${claimed.id}/${processed.inputSha256}`;
    for (const variant of processed.variants) {
      await storage.putImmutable({
        objectKey: `${keyPrefix}/${variant.variant.toLowerCase()}.webp`,
        body: variant.body,
        contentType: variant.mime,
        sha256: variant.sha256,
      });
    }

    const completed = await database.db.transaction(async (transaction) => {
      const current = await lockMedia(transaction, claimed.id);
      if (
        current.status !== "PROCESSING" ||
        current.processingLeaseUntil?.getTime() !== claimedLeaseUntil.getTime()
      ) {
        return false;
      }
      await transaction
        .delete(sellerProductMediaVariants)
        .where(eq(sellerProductMediaVariants.sellerMediaId, claimed.id));
      await transaction.insert(sellerProductMediaVariants).values(
        processed.variants.map((variant) => ({
          sellerMediaId: claimed.id,
          variant: variant.variant,
          objectKey: `${keyPrefix}/${variant.variant.toLowerCase()}.webp`,
          mime: variant.mime,
          width: variant.width,
          height: variant.height,
          byteSize: variant.byteSize,
          sha256: variant.sha256,
        })),
      );
      const master = processed.variants.find((variant) => variant.variant === "MASTER");
      if (!master) throw new MediaProcessingError("MASTER_MISSING");
      const completedAt = new Date();
      await transaction
        .update(sellerProductMedia)
        .set({
          status: "READY_FOR_REVIEW",
          detectedMime: processed.detectedMime,
          canonicalMime: master.mime,
          canonicalObjectKey: `${keyPrefix}/master.webp`,
          canonicalByteSize: master.byteSize,
          width: processed.inputWidth,
          height: processed.inputHeight,
          sha256: processed.inputSha256,
          processingLeaseUntil: null,
          lastProcessingErrorCode: null,
          processedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(sellerProductMedia.id, claimed.id));
      return true;
    });

    if (completed) {
      try {
        await storage.deleteQuarantine(claimed.quarantineObjectKey);
      } catch {
        await database.db
          .update(sellerProductMedia)
          .set({ quarantineDeletePending: true, updatedAt: new Date() })
          .where(eq(sellerProductMedia.id, claimed.id));
      }
    }
    return claimed.id;
  } catch (error) {
    const processingError =
      error instanceof MediaProcessingError
        ? error
        : error instanceof StoredObjectChangedError
          ? new MediaProcessingError("QUARANTINE_CHANGED")
          : new MediaProcessingError("STORAGE_OR_PROCESSING_FAILURE", true);
    await database.db
      .update(sellerProductMedia)
      .set({
        status: "PROCESSING_FAILED",
        processingAttempts: processingError.retryable
          ? claimed.processingAttempts
          : MAX_MEDIA_PROCESSING_ATTEMPTS,
        processingLeaseUntil: processingError.retryable
          ? new Date(
              now.getTime() +
                MEDIA_PROCESSING_RETRY_BASE_MS * 2 ** (claimed.processingAttempts - 1),
            )
          : null,
        lastProcessingErrorCode: processingError.code,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sellerProductMedia.id, claimed.id),
          eq(sellerProductMedia.status, "PROCESSING"),
          eq(sellerProductMedia.processingLeaseUntil, claimedLeaseUntil),
        ),
      );
    return claimed.id;
  }
}

async function claimMedia(database: DatabaseClient, now: Date) {
  return database.db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(sellerProductMedia)
      .where(
        and(
          lt(sellerProductMedia.processingAttempts, MAX_MEDIA_PROCESSING_ATTEMPTS),
          or(
            eq(sellerProductMedia.status, "UPLOADED"),
            and(
              eq(sellerProductMedia.status, "PROCESSING"),
              lt(sellerProductMedia.processingLeaseUntil, now),
            ),
            and(
              eq(sellerProductMedia.status, "PROCESSING_FAILED"),
              or(
                isNull(sellerProductMedia.processingLeaseUntil),
                lt(sellerProductMedia.processingLeaseUntil, now),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(sellerProductMedia.uploadedAt), asc(sellerProductMedia.id))
      .for("update", { skipLocked: true })
      .limit(1);
    if (!candidate) return null;
    const [claimed] = await transaction
      .update(sellerProductMedia)
      .set({
        status: "PROCESSING",
        processingAttempts: candidate.processingAttempts + 1,
        processingLeaseUntil: new Date(now.getTime() + MEDIA_PROCESSING_LEASE_MS),
        processingStartedAt: candidate.processingStartedAt ?? now,
        lastProcessingErrorCode: null,
        updatedAt: now,
      })
      .where(eq(sellerProductMedia.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

async function cleanupNextQuarantine(
  database: DatabaseClient,
  storage: MediaStorage,
  now: Date,
): Promise<string | null> {
  const target = await database.db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(sellerProductMedia)
      .where(
        or(
          and(
            eq(sellerProductMedia.status, "PENDING_UPLOAD"),
            lt(sellerProductMedia.createdAt, new Date(now.getTime() - QUARANTINE_RETENTION_MS)),
          ),
          eq(sellerProductMedia.quarantineDeletePending, true),
        ),
      )
      .orderBy(asc(sellerProductMedia.uploadExpiresAt), asc(sellerProductMedia.id))
      .for("update", { skipLocked: true })
      .limit(1);
    if (!candidate) return null;
    await transaction
      .update(sellerProductMedia)
      .set({
        status: candidate.status === "PENDING_UPLOAD" ? "ABANDONED" : candidate.status,
        quarantineDeletePending: true,
        updatedAt: now,
      })
      .where(eq(sellerProductMedia.id, candidate.id));
    return candidate;
  });
  if (!target) return null;
  try {
    await storage.deleteQuarantine(target.quarantineObjectKey);
    await database.db
      .update(sellerProductMedia)
      .set({ quarantineDeletePending: false, updatedAt: new Date() })
      .where(eq(sellerProductMedia.id, target.id));
  } catch {
    // The private quarantine object remains inaccessible and will be retried later.
  }
  return target.id;
}

async function lockMedia(transaction: Transaction, mediaId: string) {
  const [media] = await transaction
    .select()
    .from(sellerProductMedia)
    .where(eq(sellerProductMedia.id, mediaId))
    .for("update")
    .limit(1);
  if (!media) throw new MediaProcessingError("MEDIA_RECORD_MISSING");
  return media;
}
