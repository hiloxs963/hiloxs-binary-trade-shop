import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { products } from "../db/schema/commerce.js";
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
};

export type PricedCart = {
  currency: "KES";
  subtotalMinor: bigint;
  totalMinor: bigint;
  items: PricedLine[];
};

export async function priceCart(executor: SelectExecutor, input: CartInput): Promise<PricedCart> {
  const productIds = input.items.map((item) => item.productId);
  const rows = await executor
    .select({
      id: products.id,
      catalogKey: products.catalogKey,
      slug: products.slug,
      name: products.name,
      priceMinor: products.priceMinor,
      currency: products.currency,
    })
    .from(products)
    .where(and(inArray(products.catalogKey, productIds), eq(products.isActive, true)));
  const byCatalogKey = new Map(rows.map((row) => [row.catalogKey, row]));

  if (rows.length !== productIds.length) {
    throw new ValidationError("One or more products are unavailable");
  }

  const items = input.items.map((item) => {
    const product = byCatalogKey.get(item.productId);
    if (!product || product.currency !== "KES") {
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
    };
  });
  const subtotalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0n);

  return { currency: "KES", subtotalMinor, totalMinor: subtotalMinor, items };
}

export function serializePricedCart(cart: PricedCart) {
  return {
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
}
