import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ProductListQuerySchema, ProductSlugSchema } from "../commerce/validation.js";
import type { DatabaseClient } from "../db/client.js";
import { products } from "../db/schema/commerce.js";
import { NotFoundError } from "../lib/errors.js";

export function registerProductRoutes(app: FastifyInstance, database: DatabaseClient): void {
  app.get("/api/v1/products", async (request) => {
    const { category } = ProductListQuerySchema.parse(request.query);
    const rows = await database.db
      .select(publicProductSelection)
      .from(products)
      .where(
        category
          ? and(eq(products.isActive, true), eq(products.category, category))
          : eq(products.isActive, true),
      )
      .orderBy(asc(products.sortOrder));
    return { products: rows.map(serializeProduct) };
  });

  app.get("/api/v1/products/:slug", async (request) => {
    const slug = ProductSlugSchema.parse((request.params as { slug?: unknown }).slug);
    const [product] = await database.db
      .select(publicProductSelection)
      .from(products)
      .where(and(eq(products.slug, slug), eq(products.isActive, true)))
      .limit(1);
    if (!product) throw new NotFoundError();
    return { product: serializeProduct(product) };
  });
}

const publicProductSelection = {
  id: products.catalogKey,
  slug: products.slug,
  name: products.name,
  category: products.category,
  description: products.description,
  priceMinor: products.priceMinor,
  currency: products.currency,
};

type PublicProductRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  priceMinor: bigint;
  currency: string;
};

function serializeProduct(product: PublicProductRow) {
  return { ...product, priceMinor: product.priceMinor.toString() };
}
