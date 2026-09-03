import { and, asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import type { DatabaseClient } from "../db/client.js";
import {
  products,
  SELLER_FULFILLMENT_TERMS_VERSION,
  sellerFulfillmentConfigs,
} from "../db/schema/commerce.js";
import { inventoryEvents, productInventory } from "../db/schema/media.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { requireApprovedSeller } from "../seller-products/authorization.js";
import {
  FulfillmentConfigInputSchema,
  LiveInventoryInputSchema,
  SellerCatalogProductIdSchema,
} from "./validation.js";

export const SELLER_FULFILLMENT_TERMS = [
  "Keep product inventory accurate.",
  "Fulfill only orders HILOXS shows as paid and ready.",
  "Protect customer delivery information and use it only to fulfill the HILOXS order.",
  "Do not request off-platform payment for listed goods.",
  "Update fulfillment status accurately and dispatch only after goods are actually dispatched.",
  "Report inability to fulfill truthfully.",
  "Include Marketplace v1 delivery costs in the listed seller product price.",
  "Order fulfillment does not create a seller payout promise.",
] as const;

export function registerSellerInventoryRoutes(
  app: FastifyInstance,
  options: {
    auth: AuthService;
    database: DatabaseClient;
    sellerCommerceEnabled: boolean;
  },
): void {
  app.get("/api/v1/seller/fulfillment-config", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const [config] = await options.database.db
      .select()
      .from(sellerFulfillmentConfigs)
      .where(eq(sellerFulfillmentConfigs.sellerApplicationId, seller.sellerApplicationId))
      .limit(1);
    return {
      termsVersion: SELLER_FULFILLMENT_TERMS_VERSION,
      terms: SELLER_FULFILLMENT_TERMS,
      config: config ? serializeConfig(config) : null,
    };
  });

  app.put("/api/v1/seller/fulfillment-config", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    FulfillmentConfigInputSchema.parse(request.body);
    const now = new Date();
    const [config] = await options.database.db
      .insert(sellerFulfillmentConfigs)
      .values({
        sellerApplicationId: seller.sellerApplicationId,
        termsVersion: SELLER_FULFILLMENT_TERMS_VERSION,
        termsAcceptedAt: now,
        configuredAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sellerFulfillmentConfigs.sellerApplicationId,
        set: {
          termsVersion: SELLER_FULFILLMENT_TERMS_VERSION,
          termsAcceptedAt: now,
          updatedAt: now,
        },
      })
      .returning();
    if (!config) throw new ConflictError("Fulfillment terms could not be accepted safely");
    return { config: serializeConfig(config) };
  });

  app.get("/api/v1/seller/catalog-products", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const rows = await options.database.db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        active: products.isActive,
        commerceEnabled: products.isPurchasable,
        quantityOnHand: productInventory.quantityOnHand,
        quantityReserved: productInventory.quantityReserved,
        version: productInventory.version,
      })
      .from(products)
      .innerJoin(productInventory, eq(productInventory.productId, products.id))
      .where(
        and(
          eq(products.source, "SELLER"),
          eq(products.sellerApplicationId, seller.sellerApplicationId),
        ),
      )
      .orderBy(asc(products.name), asc(products.id));
    return {
      products: rows.map((row) => ({
        ...row,
        quantityAvailable: row.quantityOnHand - row.quantityReserved,
        effectivePurchasable:
          row.active &&
          row.commerceEnabled &&
          options.sellerCommerceEnabled &&
          row.quantityOnHand - row.quantityReserved > 0,
      })),
    };
  });

  app.get("/api/v1/seller/catalog-products/:productId/inventory", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const productId = productIdFrom(request.params);
    const row = await ownedInventory(options.database, seller.sellerApplicationId, productId);
    if (!row) throw new NotFoundError();
    return { inventory: serializeInventory(row) };
  });

  app.post("/api/v1/seller/catalog-products/:productId/inventory", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const productId = productIdFrom(request.params);
    const input = LiveInventoryInputSchema.parse(request.body);
    const inventory = await options.database.db.transaction(async (transaction) => {
      const [product] = await transaction
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.id, productId),
            eq(products.source, "SELLER"),
            eq(products.sellerApplicationId, seller.sellerApplicationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!product) throw new NotFoundError();
      const [current] = await transaction
        .select()
        .from(productInventory)
        .where(eq(productInventory.productId, productId))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundError();
      if (input.quantityOnHand < current.quantityReserved) {
        throw new ConflictError("On-hand inventory cannot be lower than reserved inventory");
      }
      const now = new Date();
      const [updated] = await transaction
        .update(productInventory)
        .set({
          quantityOnHand: input.quantityOnHand,
          version: sql`${productInventory.version} + 1`,
          updatedAt: now,
        })
        .where(eq(productInventory.productId, productId))
        .returning();
      if (!updated) throw new ConflictError("Inventory could not be updated safely");
      await transaction.insert(inventoryEvents).values({
        productId,
        actorType: "SELLER",
        actorUserId: seller.userId,
        action: "SELLER_ON_HAND_CHANGED",
        quantityDelta: input.quantityOnHand - current.quantityOnHand,
        previousOnHand: current.quantityOnHand,
        resultingOnHand: updated.quantityOnHand,
        previousReserved: current.quantityReserved,
        resultingReserved: updated.quantityReserved,
        requestId: request.id,
        createdAt: now,
      });
      return updated;
    });
    return { inventory: serializeInventory(inventory) };
  });
}

async function ownedInventory(
  database: DatabaseClient,
  sellerApplicationId: string,
  productId: string,
) {
  const [row] = await database.db
    .select({
      productId: productInventory.productId,
      quantityOnHand: productInventory.quantityOnHand,
      quantityReserved: productInventory.quantityReserved,
      version: productInventory.version,
      updatedAt: productInventory.updatedAt,
    })
    .from(productInventory)
    .innerJoin(products, eq(products.id, productInventory.productId))
    .where(
      and(
        eq(products.id, productId),
        eq(products.source, "SELLER"),
        eq(products.sellerApplicationId, sellerApplicationId),
      ),
    )
    .limit(1);
  return row;
}

function serializeInventory(inventory: {
  productId: string;
  quantityOnHand: number;
  quantityReserved: number;
  version: number;
  updatedAt: Date;
}) {
  return {
    productId: inventory.productId,
    quantityOnHand: inventory.quantityOnHand,
    quantityReserved: inventory.quantityReserved,
    quantityAvailable: inventory.quantityOnHand - inventory.quantityReserved,
    version: inventory.version,
    updatedAt: inventory.updatedAt.toISOString(),
  };
}

function serializeConfig(config: typeof sellerFulfillmentConfigs.$inferSelect) {
  return {
    termsVersion: config.termsVersion,
    termsAcceptedAt: config.termsAcceptedAt.toISOString(),
    configuredAt: config.configuredAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  };
}

function productIdFrom(params: unknown): string {
  return SellerCatalogProductIdSchema.parse((params as { productId?: unknown }).productId);
}
