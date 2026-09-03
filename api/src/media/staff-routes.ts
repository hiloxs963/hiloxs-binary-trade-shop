import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import {
  activateSellerProduct,
  deactivateSellerProduct,
  getActivationReadiness,
} from "../catalog/activation-service.js";
import type { DatabaseClient } from "../db/client.js";
import { sellerProductMedia, sellerProductMediaVariants } from "../db/schema/media.js";
import { sellerProductSubmissions } from "../db/schema/seller-products.js";
import {
  CatalogActivationDisabledError,
  NotFoundError,
  StaffReviewDisabledError,
} from "../lib/errors.js";
import { SellerProductIdSchema } from "../seller-products/validation.js";
import { requireStaffPermission } from "../staff/authorization.js";
import { sendMediaVariant } from "./delivery.js";
import type { MediaStorage } from "./storage.js";
import { reviewSellerProductMedia } from "./staff-review-service.js";
import {
  EmptyMediaBodySchema,
  MediaIdSchema,
  MediaRejectSchema,
  PublicMediaVariantSchema,
} from "./validation.js";

export function registerStaffMediaRoutes(
  app: FastifyInstance,
  options: {
    auth: AuthService;
    database: DatabaseClient;
    storage?: MediaStorage;
    staffReviewEnabled: boolean;
    catalogActivationEnabled: boolean;
  },
): void {
  app.get("/api/v1/staff/seller-products/:submissionId/media", async (request) => {
    await requireStaffPermission(options.auth, options.database, request.headers, "PRODUCT_REVIEW");
    const submissionId = submissionIdFrom(request.params);
    const [submission] = await options.database.db
      .select({ id: sellerProductSubmissions.id })
      .from(sellerProductSubmissions)
      .where(eq(sellerProductSubmissions.id, submissionId))
      .limit(1);
    if (!submission) throw new NotFoundError();
    const rows = await options.database.db
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.sellerProductSubmissionId, submissionId))
      .orderBy(asc(sellerProductMedia.sortOrder), asc(sellerProductMedia.id));
    return {
      media: rows.map((media) => ({
        id: media.id,
        status: media.status,
        detectedMime: media.detectedMime,
        width: media.width,
        height: media.height,
        sortOrder: media.sortOrder,
        selectedForActivation: media.selectedForActivation,
        processedAt: media.processedAt?.toISOString() ?? null,
        reviewedAt: media.reviewedAt?.toISOString() ?? null,
        reviewReason: media.status === "REJECTED" ? media.reviewReason : null,
      })),
      reviewEnabled: options.staffReviewEnabled,
    };
  });

  app.get(
    "/api/v1/staff/seller-products/:submissionId/media/:mediaId/preview/:variant",
    async (request, reply) => {
      await requireStaffPermission(
        options.auth,
        options.database,
        request.headers,
        "PRODUCT_REVIEW",
      );
      const { submissionId, mediaId, variant } = mediaParams(request.params);
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
        .where(
          and(
            eq(sellerProductMedia.id, mediaId),
            eq(sellerProductMedia.sellerProductSubmissionId, submissionId),
            inArray(sellerProductMedia.status, ["READY_FOR_REVIEW", "APPROVED", "REJECTED"]),
            eq(sellerProductMediaVariants.variant, variant),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundError();
      return sendMediaVariant(reply, options.storage, row, "private");
    },
  );

  for (const action of ["approve", "reject"] as const) {
    app.post(`/api/v1/staff/seller-product-media/:mediaId/${action}`, async (request) => {
      const authorization = await requireStaffPermission(
        options.auth,
        options.database,
        request.headers,
        "PRODUCT_REVIEW",
        { recent: true },
      );
      if (!options.staffReviewEnabled) throw new StaffReviewDisabledError();
      const mediaId = MediaIdSchema.parse((request.params as { mediaId?: unknown }).mediaId);
      const reason =
        action === "reject"
          ? MediaRejectSchema.parse(request.body).reason
          : (EmptyMediaBodySchema.parse(request.body ?? {}), undefined);
      const media = await reviewSellerProductMedia(
        options.database,
        authorization,
        mediaId,
        action,
        request.id,
        reason,
      );
      return { media: { id: media.id, status: media.status, reviewReason: media.reviewReason } };
    });
  }

  app.get("/api/v1/staff/seller-products/:submissionId/activation-readiness", async (request) => {
    await requireStaffPermission(
      options.auth,
      options.database,
      request.headers,
      "CATALOG_ACTIVATE",
    );
    const readiness = await getActivationReadiness(
      options.database,
      submissionIdFrom(request.params),
      Boolean(options.storage),
    );
    return { readiness, activationEnabled: options.catalogActivationEnabled };
  });

  app.post("/api/v1/staff/seller-products/:submissionId/activate", async (request, reply) => {
    const authorization = await requireStaffPermission(
      options.auth,
      options.database,
      request.headers,
      "CATALOG_ACTIVATE",
      { recent: true },
    );
    EmptyMediaBodySchema.parse(request.body ?? {});
    if (!options.catalogActivationEnabled) throw new CatalogActivationDisabledError();
    if (!options.storage) throw new CatalogActivationDisabledError();
    const result = await activateSellerProduct(
      options.database,
      authorization,
      submissionIdFrom(request.params),
      request.id,
    );
    return reply.status(result.created ? 201 : 200).send(result);
  });

  app.post("/api/v1/staff/seller-products/:submissionId/deactivate", async (request) => {
    const authorization = await requireStaffPermission(
      options.auth,
      options.database,
      request.headers,
      "CATALOG_ACTIVATE",
      { recent: true },
    );
    EmptyMediaBodySchema.parse(request.body ?? {});
    if (!options.catalogActivationEnabled) throw new CatalogActivationDisabledError();
    return deactivateSellerProduct(
      options.database,
      authorization,
      submissionIdFrom(request.params),
      request.id,
    );
  });
}

function submissionIdFrom(params: unknown): string {
  return SellerProductIdSchema.parse((params as { submissionId?: unknown }).submissionId);
}

function mediaParams(params: unknown) {
  const value = params as { submissionId?: unknown; mediaId?: unknown; variant?: unknown };
  return {
    submissionId: SellerProductIdSchema.parse(value.submissionId),
    mediaId: MediaIdSchema.parse(value.mediaId),
    variant: PublicMediaVariantSchema.parse(value.variant),
  };
}
