import { and, eq, sql } from "drizzle-orm";
import type { Database, DatabaseClient } from "../db/client.js";
import {
  products,
  SELLER_FULFILLMENT_TERMS_VERSION,
  sellerFulfillmentConfigs,
} from "../db/schema/commerce.js";
import { productInventory, productMedia, sellerProductActivations } from "../db/schema/media.js";
import { sellerApplications } from "../db/schema/sellers.js";
import { staffAuditEvents } from "../db/schema/staff.js";
import { ConflictError, NotFoundError, SellerCommerceDisabledError } from "../lib/errors.js";
import type { StaffAuthorization } from "../staff/model.js";
import { lockAuthorizedActor } from "../staff/review-service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type CommerceReadiness = {
  ready: boolean;
  commerceEnabled: boolean;
  checks: {
    sellerProduct: boolean;
    productActive: boolean;
    activated: boolean;
    sellerApproved: boolean;
    publicMedia: boolean;
    inventoryConfigured: boolean;
    inventoryAvailable: boolean;
    fulfillmentConfigured: boolean;
    notAlreadyEnabled: boolean;
  };
};

export async function getCommerceReadiness(
  database: DatabaseClient,
  productId: string,
  commerceEnabled: boolean,
): Promise<CommerceReadiness> {
  return readReadiness(database.db, productId, commerceEnabled);
}

export async function setSellerCommerce(
  database: DatabaseClient,
  authorization: StaffAuthorization,
  productId: string,
  enabled: boolean,
  commerceEnabled: boolean,
  requestId: string,
) {
  return database.db.transaction(async (transaction) => {
    await lockAuthorizedActor(transaction, authorization, "SELLER_COMMERCE_ACTIVATE");
    const [product] = await transaction
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.source, "SELLER")))
      .for("update")
      .limit(1);
    if (!product) throw new NotFoundError();
    const readiness = await readReadiness(transaction, productId, commerceEnabled);
    if (enabled && !commerceEnabled) throw new SellerCommerceDisabledError();
    if (enabled && !readiness.ready) {
      throw new ConflictError("The seller product is not ready for commerce");
    }
    if (product.isPurchasable === enabled) return product;
    const now = new Date();
    const [updated] = await transaction
      .update(products)
      .set({ isPurchasable: enabled, updatedAt: now })
      .where(eq(products.id, product.id))
      .returning();
    if (!updated) throw new ConflictError("The commerce state could not be changed safely");
    await transaction.insert(staffAuditEvents).values({
      actorType: "STAFF",
      actorUserId: authorization.actor.userId,
      actorRole: authorization.actor.role,
      permission: "SELLER_COMMERCE_ACTIVATE",
      action: enabled ? "SELLER_COMMERCE_ENABLED" : "SELLER_COMMERCE_DISABLED",
      productId,
      previousStatus: String(product.isPurchasable),
      resultingStatus: String(enabled),
      requestId,
      createdAt: now,
    });
    return updated;
  });
}

async function readReadiness(
  executor: Database | Transaction,
  productId: string,
  commerceEnabled: boolean,
): Promise<CommerceReadiness> {
  const productQuery = executor
    .select({
      source: products.source,
      active: products.isActive,
      purchasable: products.isPurchasable,
      sellerStatus: sellerApplications.status,
      activationId: sellerProductActivations.id,
      quantityOnHand: productInventory.quantityOnHand,
      termsVersion: sellerFulfillmentConfigs.termsVersion,
      termsAcceptedAt: sellerFulfillmentConfigs.termsAcceptedAt,
    })
    .from(products)
    .leftJoin(sellerApplications, eq(sellerApplications.id, products.sellerApplicationId))
    .leftJoin(sellerProductActivations, eq(sellerProductActivations.productId, products.id))
    .leftJoin(productInventory, eq(productInventory.productId, products.id))
    .leftJoin(
      sellerFulfillmentConfigs,
      eq(sellerFulfillmentConfigs.sellerApplicationId, products.sellerApplicationId),
    )
    .where(eq(products.id, productId));
  const rows = await productQuery.limit(1);
  const product = rows[0];
  if (!product) throw new NotFoundError();
  const [media] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(productMedia)
    .where(eq(productMedia.productId, productId));
  const checks = {
    sellerProduct: product.source === "SELLER",
    productActive: product.active,
    activated: Boolean(product.activationId),
    sellerApproved: product.sellerStatus === "APPROVED",
    publicMedia: (media?.count ?? 0) > 0,
    inventoryConfigured: product.quantityOnHand !== null,
    inventoryAvailable: (product.quantityOnHand ?? 0) > 0,
    fulfillmentConfigured:
      product.termsVersion === SELLER_FULFILLMENT_TERMS_VERSION && product.termsAcceptedAt !== null,
    notAlreadyEnabled: !product.purchasable,
  };
  return {
    ready: Object.values(checks).every(Boolean),
    commerceEnabled,
    checks,
  };
}
