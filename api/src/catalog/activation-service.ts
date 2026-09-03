import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DatabaseClient } from "../db/client.js";
import { user } from "../db/schema/auth.js";
import { products } from "../db/schema/commerce.js";
import {
  productInventory,
  productMedia,
  productMediaVariants,
  sellerProductActivations,
  sellerProductInventory,
  sellerProductMedia,
  sellerProductMediaVariants,
} from "../db/schema/media.js";
import { sellerProductSubmissions } from "../db/schema/seller-products.js";
import { sellerApplications } from "../db/schema/sellers.js";
import { staffAuditEvents } from "../db/schema/staff.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { PUBLIC_MEDIA_VARIANTS, SELLER_MEDIA_RIGHTS_VERSION } from "../media/model.js";
import { SellerProductDraftSchema, SellerProductIdSchema } from "../seller-products/validation.js";
import type { StaffAuthorization } from "../staff/model.js";
import { lockAuthorizedActor } from "../staff/review-service.js";

export type ActivationReadiness = {
  ready: boolean;
  activation: { productId: string; slug: string; active: boolean } | null;
  checks: {
    sellerApproved: boolean;
    submissionApproved: boolean;
    inventoryConfigured: boolean;
    approvedSelectedMedia: boolean;
    completeVariants: boolean;
    mediaRightsRecorded: boolean;
    storageConfigured: boolean;
    notPreviouslyActivated: boolean;
  };
};

export async function getActivationReadiness(
  database: DatabaseClient,
  submissionIdInput: string,
  storageConfigured: boolean,
): Promise<ActivationReadiness> {
  const submissionId = SellerProductIdSchema.parse(submissionIdInput);
  const [submission] = await database.db
    .select({
      id: sellerProductSubmissions.id,
      submissionStatus: sellerProductSubmissions.status,
      sellerStatus: sellerApplications.status,
      sellerUserStatus: user.status,
    })
    .from(sellerProductSubmissions)
    .innerJoin(
      sellerApplications,
      eq(sellerApplications.id, sellerProductSubmissions.sellerApplicationId),
    )
    .innerJoin(user, eq(user.id, sellerApplications.userId))
    .where(eq(sellerProductSubmissions.id, submissionId))
    .limit(1);
  if (!submission) throw new NotFoundError();
  const [activation] = await database.db
    .select({ productId: products.id, slug: products.slug, active: products.isActive })
    .from(sellerProductActivations)
    .innerJoin(products, eq(products.id, sellerProductActivations.productId))
    .where(eq(sellerProductActivations.sellerProductSubmissionId, submissionId))
    .limit(1);
  const [inventory] = await database.db
    .select({ id: sellerProductInventory.sellerProductSubmissionId })
    .from(sellerProductInventory)
    .where(eq(sellerProductInventory.sellerProductSubmissionId, submissionId))
    .limit(1);
  const mediaRows = await selectedApprovedMediaWithVariants(database, submissionId);
  const selectedIds = [...new Set(mediaRows.map((row) => row.mediaId))];
  const completeVariants = selectedIds.every((id) => {
    const variants = new Set(
      mediaRows.filter((row) => row.mediaId === id).map((row) => row.variant),
    );
    return PUBLIC_MEDIA_VARIANTS.every((variant) => variants.has(variant));
  });
  const rightsRecorded =
    selectedIds.length > 0 &&
    mediaRows.every(
      (row) =>
        row.rightsTermsVersion === SELLER_MEDIA_RIGHTS_VERSION && row.rightsAcceptedAt !== null,
    );
  const checks = {
    sellerApproved:
      submission.sellerStatus === "APPROVED" && submission.sellerUserStatus === "ACTIVE",
    submissionApproved: submission.submissionStatus === "APPROVED",
    inventoryConfigured: Boolean(inventory),
    approvedSelectedMedia: selectedIds.length > 0,
    completeVariants: selectedIds.length > 0 && completeVariants,
    mediaRightsRecorded: rightsRecorded,
    storageConfigured,
    notPreviouslyActivated: !activation,
  };
  return {
    ready: Object.values(checks).every(Boolean),
    activation: activation ?? null,
    checks,
  };
}

export async function activateSellerProduct(
  database: DatabaseClient,
  authorization: StaffAuthorization,
  submissionIdInput: string,
  requestId: string,
) {
  const submissionId = SellerProductIdSchema.parse(submissionIdInput);
  return database.db.transaction(async (transaction) => {
    await lockAuthorizedActor(transaction, authorization, "CATALOG_ACTIVATE");
    const [submission] = await transaction
      .select()
      .from(sellerProductSubmissions)
      .where(eq(sellerProductSubmissions.id, submissionId))
      .for("update")
      .limit(1);
    if (!submission) throw new NotFoundError();
    const [seller] = await transaction
      .select({ status: sellerApplications.status, userStatus: user.status })
      .from(sellerApplications)
      .innerJoin(user, eq(user.id, sellerApplications.userId))
      .where(eq(sellerApplications.id, submission.sellerApplicationId))
      .for("update")
      .limit(1);
    if (!seller) throw new NotFoundError();

    const [existing] = await transaction
      .select({ id: products.id, slug: products.slug, active: products.isActive })
      .from(sellerProductActivations)
      .innerJoin(products, eq(products.id, sellerProductActivations.productId))
      .where(eq(sellerProductActivations.sellerProductSubmissionId, submissionId))
      .limit(1);
    if (existing) return { created: false, product: existing };
    if (
      submission.status !== "APPROVED" ||
      seller.status !== "APPROVED" ||
      seller.userStatus !== "ACTIVE"
    ) {
      throw new ConflictError("The seller product is not eligible for catalog activation");
    }
    SellerProductDraftSchema.parse({
      name: submission.name,
      category: submission.category,
      description: submission.description,
      priceMinor: submission.priceMinor.toString(),
    });

    const [inventory] = await transaction
      .select()
      .from(sellerProductInventory)
      .where(eq(sellerProductInventory.sellerProductSubmissionId, submissionId))
      .for("update")
      .limit(1);
    if (!inventory) throw new ConflictError("Inventory must be configured before activation");
    const media = await transaction
      .select()
      .from(sellerProductMedia)
      .where(
        and(
          eq(sellerProductMedia.sellerProductSubmissionId, submissionId),
          eq(sellerProductMedia.status, "APPROVED"),
          eq(sellerProductMedia.selectedForActivation, true),
        ),
      )
      .orderBy(asc(sellerProductMedia.id))
      .for("update");
    if (media.length === 0) {
      throw new ConflictError("At least one approved image must be selected before activation");
    }
    if (
      media.some(
        (item) =>
          item.rightsTermsVersion !== SELLER_MEDIA_RIGHTS_VERSION ||
          !item.rightsAcceptedAt ||
          !item.canonicalObjectKey,
      )
    ) {
      throw new ConflictError("Selected media is incomplete");
    }
    const variants = await transaction
      .select()
      .from(sellerProductMediaVariants)
      .where(
        inArray(
          sellerProductMediaVariants.sellerMediaId,
          media.map((item) => item.id),
        ),
      )
      .orderBy(asc(sellerProductMediaVariants.sellerMediaId));
    assertCompletePublicVariants(
      media.map((item) => item.id),
      variants,
    );

    const productId = randomUUID();
    const slug = sellerProductSlug(submission.name, productId);
    const catalogKey = `seller-${productId}`;
    const [product] = await transaction
      .insert(products)
      .values({
        id: productId,
        catalogKey,
        slug,
        name: submission.name,
        category: submission.category,
        description: submission.description,
        priceMinor: submission.priceMinor,
        currency: submission.currency,
        source: "SELLER",
        isActive: true,
        isPurchasable: false,
        sellerApplicationId: submission.sellerApplicationId,
        sellerProductSubmissionId: submission.id,
      })
      .returning({ id: products.id, slug: products.slug, active: products.isActive });
    if (!product) throw new ConflictError("The public product could not be created safely");

    for (const [sortOrder, source] of media
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .entries()) {
      const [snapshot] = await transaction
        .insert(productMedia)
        .values({ productId, sourceSellerMediaId: source.id, sortOrder })
        .returning({ id: productMedia.id });
      if (!snapshot) throw new ConflictError("The public media snapshot failed safely");
      await transaction.insert(productMediaVariants).values(
        variants
          .filter(
            (variant) =>
              variant.sellerMediaId === source.id &&
              PUBLIC_MEDIA_VARIANTS.includes(
                variant.variant as (typeof PUBLIC_MEDIA_VARIANTS)[number],
              ),
          )
          .map((variant) => ({
            productMediaId: snapshot.id,
            variant: variant.variant,
            objectKey: variant.objectKey,
            mime: variant.mime,
            width: variant.width,
            height: variant.height,
            byteSize: variant.byteSize,
            sha256: variant.sha256,
          })),
      );
    }
    await transaction.insert(productInventory).values({
      productId,
      quantityAvailable: inventory.quantityAvailable,
    });
    await transaction.insert(sellerProductActivations).values({
      sellerProductSubmissionId: submission.id,
      productId,
      activatedByStaffUserId: authorization.actor.userId,
      requestId,
    });
    await transaction.insert(staffAuditEvents).values({
      actorType: "STAFF",
      actorUserId: authorization.actor.userId,
      actorRole: authorization.actor.role,
      permission: "CATALOG_ACTIVATE",
      action: "CATALOG_ACTIVATED",
      sellerProductSubmissionId: submission.id,
      productId,
      previousStatus: "APPROVED",
      resultingStatus: "ACTIVE",
      requestId,
    });
    return { created: true, product };
  });
}

export async function deactivateSellerProduct(
  database: DatabaseClient,
  authorization: StaffAuthorization,
  submissionIdInput: string,
  requestId: string,
) {
  const submissionId = SellerProductIdSchema.parse(submissionIdInput);
  return database.db.transaction(async (transaction) => {
    await lockAuthorizedActor(transaction, authorization, "CATALOG_ACTIVATE");
    const [submission] = await transaction
      .select({ id: sellerProductSubmissions.id })
      .from(sellerProductSubmissions)
      .where(eq(sellerProductSubmissions.id, submissionId))
      .for("update")
      .limit(1);
    if (!submission) throw new NotFoundError();
    const [activation] = await transaction
      .select({ productId: sellerProductActivations.productId })
      .from(sellerProductActivations)
      .where(eq(sellerProductActivations.sellerProductSubmissionId, submissionId))
      .limit(1);
    if (!activation) throw new NotFoundError();
    const [product] = await transaction
      .select({
        id: products.id,
        slug: products.slug,
        source: products.source,
        active: products.isActive,
      })
      .from(products)
      .where(eq(products.id, activation.productId))
      .for("update")
      .limit(1);
    if (!product || product.source !== "SELLER") throw new NotFoundError();
    if (!product.active) return { changed: false, product };
    await transaction
      .update(products)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(products.id, product.id));
    await transaction.insert(staffAuditEvents).values({
      actorType: "STAFF",
      actorUserId: authorization.actor.userId,
      actorRole: authorization.actor.role,
      permission: "CATALOG_ACTIVATE",
      action: "CATALOG_DEACTIVATED",
      sellerProductSubmissionId: submissionId,
      productId: product.id,
      previousStatus: "ACTIVE",
      resultingStatus: "INACTIVE",
      requestId,
    });
    return { changed: true, product: { ...product, active: false } };
  });
}

async function selectedApprovedMediaWithVariants(database: DatabaseClient, submissionId: string) {
  return database.db
    .select({
      mediaId: sellerProductMedia.id,
      rightsTermsVersion: sellerProductMedia.rightsTermsVersion,
      rightsAcceptedAt: sellerProductMedia.rightsAcceptedAt,
      variant: sellerProductMediaVariants.variant,
    })
    .from(sellerProductMedia)
    .leftJoin(
      sellerProductMediaVariants,
      eq(sellerProductMediaVariants.sellerMediaId, sellerProductMedia.id),
    )
    .where(
      and(
        eq(sellerProductMedia.sellerProductSubmissionId, submissionId),
        eq(sellerProductMedia.status, "APPROVED"),
        eq(sellerProductMedia.selectedForActivation, true),
      ),
    );
}

function assertCompletePublicVariants(
  mediaIds: string[],
  variants: (typeof sellerProductMediaVariants.$inferSelect)[],
) {
  for (const mediaId of mediaIds) {
    const names = new Set(
      variants
        .filter((variant) => variant.sellerMediaId === mediaId)
        .map((variant) => variant.variant),
    );
    if (!PUBLIC_MEDIA_VARIANTS.every((variant) => names.has(variant))) {
      throw new ConflictError("Selected media variants are incomplete");
    }
  }
}

function sellerProductSlug(name: string, productId: string): string {
  const stem = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return `${stem || "seller-product"}-${productId.replaceAll("-", "")}`;
}
