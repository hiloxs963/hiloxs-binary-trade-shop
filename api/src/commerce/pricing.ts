import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { products } from "../db/schema/commerce.js";
import { productInventory } from "../db/schema/media.js";
import { ValidationError } from "../lib/errors.js";
import type { CartInput } from "./validation.js";

type SelectExecutor = Pick<Database, "select">;

export type PricedLine = {
  productId: string;
  productDatabaseId: string;
  name: string;
  slug: string;
  unitPriceMinor: bigint;
  quantity: number;
  lineTotalMinor: bigint;
  productSource: "PLATFORM" | "SELLER";
  sellerApplicationId: string | null;
};

export type PricedCart = {
  currency: "KES";
  subtotalMinor: bigint;
  totalMinor: bigint;
  items: PricedLine[];
  hasSellerItems: boolean;
};

export async function priceCart(
  executor: SelectExecutor,
  input: CartInput,
  options: { sellerCommerceEnabled?: boolean } = {},
): Promise<PricedCart> {
  const productIds = input.items.map((item) => item.productId);
  const rows = await executor
    .select({
      id: products.id,
      catalogKey: products.catalogKey,
      slug: products.slug,
      name: products.name,
      priceMinor: products.priceMinor,
      currency: products.currency,
      source: products.source,
      isPurchasable: products.isPurchasable,
      sellerApplicationId: products.sellerApplicationId,
      quantityOnHand: productInventory.quantityOnHand,
      quantityReserved: productInventory.quantityReserved,
    })
    .from(products)
    .leftJoin(productInventory, eq(productInventory.productId, products.id))
    .where(
      and(
        inArray(products.catalogKey, productIds),
        eq(products.isActive, true),
        eq(products.isPurchasable, true),
      ),
    );
  const byCatalogKey = new Map(rows.map((row) => [row.catalogKey, row]));

  if (rows.length !== productIds.length) {
    throw new ValidationError("One or more products are unavailable");
  }

  const items = input.items.map((item) => {
    const product = byCatalogKey.get(item.productId);
    const sellerAvailable =
      product?.source !== "SELLER" ||
      (options.sellerCommerceEnabled === true &&
        product.sellerApplicationId !== null &&
        product.quantityOnHand !== null &&
        product.quantityReserved !== null &&
        product.quantityOnHand - product.quantityReserved >= item.quantity);
    if (!product || product.currency !== "KES" || !sellerAvailable) {
      throw new ValidationError("One or more products are unavailable");
    }
    const lineTotalMinor = product.priceMinor * BigInt(item.quantity);
    return {
      productId: product.catalogKey,
      productDatabaseId: product.id,
      name: product.name,
      slug: product.slug,
      unitPriceMinor: product.priceMinor,
      quantity: item.quantity,
      lineTotalMinor,
      productSource: product.source,
      sellerApplicationId: product.sellerApplicationId,
    };
  });
  const subtotalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0n);

  return {
    currency: "KES",
    subtotalMinor,
    totalMinor: subtotalMinor,
    items,
    hasSellerItems: items.some((item) => item.productSource === "SELLER"),
  };
}

export function serializePricedCart(cart: PricedCart) {
  const serialized = {
    currency: cart.currency,
    subtotalMinor: cart.subtotalMinor.toString(),
    totalMinor: cart.totalMinor.toString(),
    items: cart.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      slug: item.slug,
      unitPriceMinor: item.unitPriceMinor.toString(),
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor.toString(),
    })),
  };
  return cart.hasSellerItems ? { ...serialized, deliveryRequired: true } : serialized;
}
