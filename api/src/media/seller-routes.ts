import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, max, notInArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import type { Database, DatabaseClient } from "../db/client.js";
import {
  sellerProductActivations,
  sellerProductInventory,
  sellerProductMedia,
  sellerProductMediaVariants,
} from "../db/schema/media.js";
import { sellerProductSubmissions } from "../db/schema/seller-products.js";
import {
  ConflictError,
  MediaStorageUnavailableError,
  MediaUploadDisabledError,
  NotFoundError,
} from "../lib/errors.js";
import { requireApprovedSeller } from "../seller-products/authorization.js";
import { SellerProductIdSchema } from "../seller-products/validation.js";
import {
  MAX_ACTIVE_MEDIA_PER_SUBMISSION,
  MAX_MEDIA_INPUT_BYTES,
  SELLER_MEDIA_RIGHTS_VERSION,
  UPLOAD_GRANT_TTL_SECONDS,
} from "./model.js";
import { sendMediaVariant } from "./delivery.js";
import type { MediaStorage } from "./storage.js";
import {
  EmptyMediaBodySchema,
  InventoryInputSchema,
  MediaArrangementSchema,
  MediaIdSchema,
  PublicMediaVariantSchema,
  UploadIntentSchema,
} from "./validation.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function registerSellerMediaRoutes(
  app: FastifyInstance,
  options: {
    auth: AuthService;
    database: DatabaseClient;
    storage?: MediaStorage;
    uploadEnabled: boolean;
  },
): void {
  app.get("/api/v1/seller/products/:submissionId/media", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const submissionId = submissionIdFrom(request.params);
    await requireOwnedApprovedSubmission(
      options.database.db,
      seller.sellerApplicationId,
      submissionId,
    );
    return mediaResponse(options.database, submissionId);
  });

  app.post("/api/v1/seller/products/:submissionId/media/upload-intents", async (request, reply) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    if (!options.uploadEnabled) throw new MediaUploadDisabledError();
    if (!options.storage) throw new MediaStorageUnavailableError();
    const submissionId = submissionIdFrom(request.params);
    const input = UploadIntentSchema.parse(request.body);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + UPLOAD_GRANT_TTL_SECONDS * 1_000);
    const mediaId = randomUUID();
    const quarantineObjectKey = `quarantine/${submissionId}/${mediaId}/${randomBytes(24).toString("hex")}`;

    const created = await options.database.db.transaction(async (transaction) => {
      await lockOwnedApprovedSubmission(transaction, seller.sellerApplicationId, submissionId);
      await requireNotActivated(transaction, submissionId);
      const [active] = await transaction
        .select({ value: count() })
        .from(sellerProductMedia)
        .where(
          and(
            eq(sellerProductMedia.sellerProductSubmissionId, submissionId),
            notInArray(sellerProductMedia.status, ["REJECTED", "PROCESSING_FAILED", "ABANDONED"]),
          ),
        );
      if ((active?.value ?? 0) >= MAX_ACTIVE_MEDIA_PER_SUBMISSION) {
        throw new ConflictError("This product already has the maximum number of active images");
      }
      const [highest] = await transaction
        .select({ value: max(sellerProductMedia.sortOrder) })
        .from(sellerProductMedia)
        .where(eq(sellerProductMedia.sellerProductSubmissionId, submissionId));
      const [row] = await transaction
        .insert(sellerProductMedia)
        .values({
          id: mediaId,
          sellerProductSubmissionId: submissionId,
          quarantineObjectKey,
          declaredMime: input.declaredMime,
          declaredByteSize: input.declaredSize,
          sortOrder: (highest?.value ?? -1) + 1,
          rightsTermsVersion: SELLER_MEDIA_RIGHTS_VERSION,
          rightsAcceptedAt: now,
          uploadExpiresAt: expiresAt,
        })
        .returning();
      if (!row) throw new ConflictError("The upload intent could not be created safely");
      return row;
    });

    try {
      const grant = await options.storage.createUploadGrant({
        objectKey: quarantineObjectKey,
        declaredMime: input.declaredMime,
        exactByteSize: input.declaredSize,
        mediaId,
        expiresAt,
      });
      return reply.status(201).send({
        media: serializeSellerMedia(created),
        upload: {
          method: grant.method,
          url: grant.url,
          fields: grant.fields,
          expiresAt: grant.expiresAt.toISOString(),
        },
        rightsTermsVersion: SELLER_MEDIA_RIGHTS_VERSION,
      });
    } catch (error) {
      await options.database.db
        .update(sellerProductMedia)
        .set({ status: "ABANDONED", quarantineDeletePending: true, updatedAt: new Date() })
        .where(eq(sellerProductMedia.id, mediaId));
      throw error;
    }
  });

  app.post("/api/v1/seller/products/:submissionId/media/:mediaId/finalize", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    if (!options.uploadEnabled) throw new MediaUploadDisabledError();
    if (!options.storage) throw new MediaStorageUnavailableError();
    EmptyMediaBodySchema.parse(request.body ?? {});
    const { submissionId, mediaId } = mediaParams(request.params);
    const existing = await findOwnedMedia(
      options.database,
      seller.sellerApplicationId,
      submissionId,
      mediaId,
    );
    if (!existing) throw new NotFoundError();
    if (existing.status !== "PENDING_UPLOAD") return { media: serializeSellerMedia(existing) };
    if (existing.uploadExpiresAt.getTime() < Date.now()) {
      await abandonMedia(options.database, existing.id);
      throw new ConflictError("The upload intent has expired");
    }
    const object = await options.storage.head(existing.quarantineObjectKey);
    if (!object) throw new ConflictError("The uploaded object was not found");
    if (
      object.byteSize > MAX_MEDIA_INPUT_BYTES ||
      object.byteSize !== existing.declaredByteSize ||
      object.contentType !== existing.declaredMime ||
      object.mediaId !== existing.id
    ) {
      await abandonMedia(options.database, existing.id);
      throw new ConflictError("The uploaded object does not match the upload intent");
    }
    const updated = await options.database.db.transaction(async (transaction) => {
      await lockOwnedApprovedSubmission(transaction, seller.sellerApplicationId, submissionId);
      await requireNotActivated(transaction, submissionId);
      const media = await lockOwnedMedia(transaction, submissionId, mediaId);
      if (media.status !== "PENDING_UPLOAD") return media;
      if (media.uploadExpiresAt.getTime() < Date.now()) {
        throw new ConflictError("The upload intent has expired");
      }
      const now = new Date();
      const [row] = await transaction
        .update(sellerProductMedia)
        .set({
          status: "UPLOADED",
          quarantineEtag: object.etag,
          inputByteSize: object.byteSize,
          uploadedAt: now,
          updatedAt: now,
        })
        .where(eq(sellerProductMedia.id, media.id))
        .returning();
      if (!row) throw new ConflictError("The upload could not be finalized safely");
      return row;
    });
    return { media: serializeSellerMedia(updated) };
  });

  app.post("/api/v1/seller/products/:submissionId/media/:mediaId/abandon", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    EmptyMediaBodySchema.parse(request.body ?? {});
    const { submissionId, mediaId } = mediaParams(request.params);
    const media = await options.database.db.transaction(async (transaction) => {
      await lockOwnedApprovedSubmission(transaction, seller.sellerApplicationId, submissionId);
      await requireNotActivated(transaction, submissionId);
      const current = await lockOwnedMedia(transaction, submissionId, mediaId);
      if (current.status === "ABANDONED") return current;
      if (current.status !== "PENDING_UPLOAD") {
        throw new ConflictError("Only an unfinished upload can be abandoned");
      }
      const [updated] = await transaction
        .update(sellerProductMedia)
        .set({ status: "ABANDONED", quarantineDeletePending: true, updatedAt: new Date() })
        .where(eq(sellerProductMedia.id, current.id))
        .returning();
      if (!updated) throw new ConflictError("The media could not be abandoned safely");
      return updated;
    });
    await deleteQuarantineSafely(options.database, options.storage, media);
    return { media: serializeSellerMedia(media) };
  });

  app.post("/api/v1/seller/products/:submissionId/media/arrange", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const submissionId = submissionIdFrom(request.params);
    const input = MediaArrangementSchema.parse(request.body);
    await options.database.db.transaction(async (transaction) => {
      await lockOwnedApprovedSubmission(transaction, seller.sellerApplicationId, submissionId);
      await requireNotActivated(transaction, submissionId);
      const rows = await transaction
        .select({ id: sellerProductMedia.id, status: sellerProductMedia.status })
        .from(sellerProductMedia)
        .where(
          and(
            eq(sellerProductMedia.sellerProductSubmissionId, submissionId),
            eq(sellerProductMedia.status, "APPROVED"),
          ),
        )
        .for("update");
      const ordered = new Set(input.orderedMediaIds);
      if (
        rows.length !== input.orderedMediaIds.length ||
        rows.some((row) => !ordered.has(row.id))
      ) {
        throw new ConflictError(
          "The media ordering must contain every approved image exactly once",
        );
      }
      const selected = new Set(input.selectedMediaIds);
      for (const [sortOrder, mediaId] of input.orderedMediaIds.entries()) {
        await transaction
          .update(sellerProductMedia)
          .set({
            sortOrder,
            selectedForActivation: selected.has(mediaId),
            updatedAt: new Date(),
          })
          .where(eq(sellerProductMedia.id, mediaId));
      }
    });
    return mediaResponse(options.database, submissionId);
  });

  app.get("/api/v1/seller/products/:submissionId/inventory", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const submissionId = submissionIdFrom(request.params);
    await requireOwnedApprovedSubmission(
      options.database.db,
      seller.sellerApplicationId,
      submissionId,
    );
    return inventoryResponse(options.database, submissionId);
  });

  app.put("/api/v1/seller/products/:submissionId/inventory", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const submissionId = submissionIdFrom(request.params);
    const input = InventoryInputSchema.parse(request.body);
    const inventory = await options.database.db.transaction(async (transaction) => {
      await lockOwnedApprovedSubmission(transaction, seller.sellerApplicationId, submissionId);
      await requireNotActivated(transaction, submissionId);
      const now = new Date();
      const [row] = await transaction
        .insert(sellerProductInventory)
        .values({
          sellerProductSubmissionId: submissionId,
          ...input,
          configuredAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: sellerProductInventory.sellerProductSubmissionId,
          set: {
            quantityAvailable: input.quantityAvailable,
            version: sqlIncrement(sellerProductInventory.version),
            updatedAt: now,
          },
        })
        .returning();
      if (!row) throw new ConflictError("Inventory could not be saved safely");
      return row;
    });
    return { inventory: serializeInventory(inventory) };
  });

  app.get(
    "/api/v1/seller/products/:submissionId/media/:mediaId/preview/:variant",
    async (request, reply) => {
      const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
      const { submissionId, mediaId } = mediaParams(request.params);
      const variant = variantFrom(request.params);
      const [row] = await options.database.db
        .select({
          objectKey: sellerProductMediaVariants.objectKey,
          mime: sellerProductMediaVariants.mime,
          byteSize: sellerProductMediaVariants.byteSize,
          sha256: sellerProductMediaVariants.sha256,
        })
        .from(sellerProductMediaVariants)
        .innerJoin(
          sellerProductMedia,
          eq(sellerProductMedia.id, sellerProductMediaVariants.sellerMediaId),
        )
        .innerJoin(
          sellerProductSubmissions,
          eq(sellerProductSubmissions.id, sellerProductMedia.sellerProductSubmissionId),
        )
        .where(
          and(
            eq(sellerProductSubmissions.sellerApplicationId, seller.sellerApplicationId),
            eq(sellerProductSubmissions.id, submissionId),
            eq(sellerProductMedia.id, mediaId),
            inArray(sellerProductMedia.status, ["READY_FOR_REVIEW", "APPROVED", "REJECTED"]),
            eq(sellerProductMediaVariants.variant, variant),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundError();
      return sendMediaVariant(reply, options.storage, row, "private");
    },
  );
}

async function mediaResponse(database: DatabaseClient, submissionId: string) {
  const rows = await database.db
    .select()
    .from(sellerProductMedia)
    .where(eq(sellerProductMedia.sellerProductSubmissionId, submissionId))
    .orderBy(asc(sellerProductMedia.sortOrder), asc(sellerProductMedia.id));
  const [activation] = await database.db
    .select({ productId: sellerProductActivations.productId })
    .from(sellerProductActivations)
    .where(eq(sellerProductActivations.sellerProductSubmissionId, submissionId))
    .limit(1);
  return {
    media: rows.map(serializeSellerMedia),
    rightsTermsVersion: SELLER_MEDIA_RIGHTS_VERSION,
    activated: Boolean(activation),
  };
}

async function inventoryResponse(database: DatabaseClient, submissionId: string) {
  const [inventory] = await database.db
    .select()
    .from(sellerProductInventory)
    .where(eq(sellerProductInventory.sellerProductSubmissionId, submissionId))
    .limit(1);
  const [activation] = await database.db
    .select({ productId: sellerProductActivations.productId })
    .from(sellerProductActivations)
    .where(eq(sellerProductActivations.sellerProductSubmissionId, submissionId))
    .limit(1);
  return {
    inventory: inventory ? serializeInventory(inventory) : null,
    activated: Boolean(activation),
  };
}

function serializeSellerMedia(media: typeof sellerProductMedia.$inferSelect) {
  return {
    id: media.id,
    status: media.status,
    declaredMime: media.declaredMime,
    declaredSize: media.declaredByteSize,
    detectedMime: media.detectedMime,
    width: media.width,
    height: media.height,
    sortOrder: media.sortOrder,
    selectedForActivation: media.selectedForActivation,
    rightsTermsVersion: media.rightsTermsVersion,
    rightsAcceptedAt: media.rightsAcceptedAt.toISOString(),
    uploadExpiresAt: media.uploadExpiresAt.toISOString(),
    processedAt: media.processedAt?.toISOString() ?? null,
    reviewedAt: media.reviewedAt?.toISOString() ?? null,
    reviewReason: media.status === "REJECTED" ? media.reviewReason : null,
  };
}

function serializeInventory(inventory: typeof sellerProductInventory.$inferSelect) {
  return {
    quantityAvailable: inventory.quantityAvailable,
    version: inventory.version,
    configuredAt: inventory.configuredAt.toISOString(),
    updatedAt: inventory.updatedAt.toISOString(),
  };
}

async function requireOwnedApprovedSubmission(
  executor: Pick<Database, "select">,
  sellerApplicationId: string,
  submissionId: string,
) {
  const [submission] = await executor
    .select({ id: sellerProductSubmissions.id })
    .from(sellerProductSubmissions)
    .where(
      and(
        eq(sellerProductSubmissions.id, submissionId),
        eq(sellerProductSubmissions.sellerApplicationId, sellerApplicationId),
        eq(sellerProductSubmissions.status, "APPROVED"),
      ),
    )
    .limit(1);
  if (!submission) throw new NotFoundError();
  return submission;
}

async function lockOwnedApprovedSubmission(
  transaction: Transaction,
  sellerApplicationId: string,
  submissionId: string,
) {
  const [submission] = await transaction
    .select({ id: sellerProductSubmissions.id })
    .from(sellerProductSubmissions)
    .where(
      and(
        eq(sellerProductSubmissions.id, submissionId),
        eq(sellerProductSubmissions.sellerApplicationId, sellerApplicationId),
        eq(sellerProductSubmissions.status, "APPROVED"),
      ),
    )
    .for("update")
    .limit(1);
  if (!submission) throw new NotFoundError();
  return submission;
}

async function requireNotActivated(transaction: Transaction, submissionId: string) {
  const [activation] = await transaction
    .select({ id: sellerProductActivations.id })
    .from(sellerProductActivations)
    .where(eq(sellerProductActivations.sellerProductSubmissionId, submissionId))
    .limit(1);
  if (activation) throw new ConflictError("This product submission is already activated");
}

async function findOwnedMedia(
  database: DatabaseClient,
  sellerApplicationId: string,
  submissionId: string,
  mediaId: string,
) {
  const [media] = await database.db
    .select({ media: sellerProductMedia })
    .from(sellerProductMedia)
    .innerJoin(
      sellerProductSubmissions,
      eq(sellerProductSubmissions.id, sellerProductMedia.sellerProductSubmissionId),
    )
    .where(
      and(
        eq(sellerProductMedia.id, mediaId),
        eq(sellerProductMedia.sellerProductSubmissionId, submissionId),
        eq(sellerProductSubmissions.sellerApplicationId, sellerApplicationId),
        eq(sellerProductSubmissions.status, "APPROVED"),
      ),
    )
    .limit(1);
  return media?.media;
}

async function lockOwnedMedia(transaction: Transaction, submissionId: string, mediaId: string) {
  const [media] = await transaction
    .select()
    .from(sellerProductMedia)
    .where(
      and(
        eq(sellerProductMedia.id, mediaId),
        eq(sellerProductMedia.sellerProductSubmissionId, submissionId),
      ),
    )
    .for("update")
    .limit(1);
  if (!media) throw new NotFoundError();
  return media;
}

async function abandonMedia(database: DatabaseClient, mediaId: string) {
  await database.db
    .update(sellerProductMedia)
    .set({ status: "ABANDONED", quarantineDeletePending: true, updatedAt: new Date() })
    .where(
      and(eq(sellerProductMedia.id, mediaId), eq(sellerProductMedia.status, "PENDING_UPLOAD")),
    );
}

async function deleteQuarantineSafely(
  database: DatabaseClient,
  storage: MediaStorage | undefined,
  media: typeof sellerProductMedia.$inferSelect,
) {
  if (!storage) {
    await markDeletePending(database, media.id);
    return;
  }
  try {
    await storage.deleteQuarantine(media.quarantineObjectKey);
  } catch {
    await markDeletePending(database, media.id);
  }
}

async function markDeletePending(database: DatabaseClient, mediaId: string) {
  await database.db
    .update(sellerProductMedia)
    .set({ quarantineDeletePending: true, updatedAt: new Date() })
    .where(eq(sellerProductMedia.id, mediaId));
}

function submissionIdFrom(params: unknown): string {
  return SellerProductIdSchema.parse((params as { submissionId?: unknown }).submissionId);
}

function mediaParams(params: unknown) {
  const value = params as { submissionId?: unknown; mediaId?: unknown };
  return {
    submissionId: SellerProductIdSchema.parse(value.submissionId),
    mediaId: MediaIdSchema.parse(value.mediaId),
  };
}

function variantFrom(params: unknown) {
  return PublicMediaVariantSchema.parse((params as { variant?: unknown }).variant);
}

function sqlIncrement(column: typeof sellerProductInventory.version) {
  return sql`${column} + 1`;
}
