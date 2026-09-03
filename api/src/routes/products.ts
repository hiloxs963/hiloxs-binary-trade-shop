import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ProductListQuerySchema, ProductSlugSchema } from "../commerce/validation.js";
import type { DatabaseClient } from "../db/client.js";
import { products } from "../db/schema/commerce.js";
import { productMedia, productMediaVariants } from "../db/schema/media.js";
import { NotFoundError } from "../lib/errors.js";
import { sendMediaVariant } from "../media/delivery.js";
import type { MediaStorage } from "../media/storage.js";
import { MediaIdSchema, PublicMediaVariantSchema } from "../media/validation.js";

export function registerProductRoutes(
  app: FastifyInstance,
  database: DatabaseClient,
  storage?: MediaStorage,
): void {
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
    const media = await publicMediaForProducts(
      database,
      rows.map((row) => row.databaseId),
    );
    return {
      products: rows.map((product) =>
        serializeProduct(product, media.get(product.databaseId) ?? []),
      ),
    };
  });

  app.get("/api/v1/products/:slug", async (request) => {
    const slug = ProductSlugSchema.parse((request.params as { slug?: unknown }).slug);
    const [product] = await database.db
      .select(publicProductSelection)
      .from(products)
      .where(and(eq(products.slug, slug), eq(products.isActive, true)))
      .limit(1);
    if (!product) throw new NotFoundError();
    const media = await publicMediaForProducts(database, [product.databaseId]);
    return { product: serializeProduct(product, media.get(product.databaseId) ?? []) };
  });

  app.get("/api/v1/products/:slug/media/:mediaId/:variant", async (request, reply) => {
    const params = request.params as { slug?: unknown; mediaId?: unknown; variant?: unknown };
    const slug = ProductSlugSchema.parse(params.slug);
    const mediaId = MediaIdSchema.parse(params.mediaId);
    const variant = PublicMediaVariantSchema.parse(params.variant);
    const [row] = await database.db
      .select({
        objectKey: productMediaVariants.objectKey,
        mime: productMediaVariants.mime,
        byteSize: productMediaVariants.byteSize,
        sha256: productMediaVariants.sha256,
      })
      .from(productMediaVariants)
      .innerJoin(productMedia, eq(productMedia.id, productMediaVariants.productMediaId))
      .innerJoin(products, eq(products.id, productMedia.productId))
      .where(
        and(
          eq(products.slug, slug),
          eq(products.isActive, true),
          eq(productMedia.id, mediaId),
          eq(productMediaVariants.variant, variant),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError();
    return sendMediaVariant(reply, storage, row, "public");
  });
}

const publicProductSelection = {
  databaseId: products.id,
  id: products.catalogKey,
  slug: products.slug,
  name: products.name,
  category: products.category,
  description: products.description,
  priceMinor: products.priceMinor,
  currency: products.currency,
  isPurchasable: products.isPurchasable,
};

type PublicProductRow = {
  databaseId: string;
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  priceMinor: bigint;
  currency: string;
  isPurchasable: boolean;
};

type PublicMediaRow = {
  productId: string;
  mediaId: string;
  sortOrder: number;
  variant: string;
  width: number;
  height: number;
};

function serializeProduct(product: PublicProductRow, mediaRows: PublicMediaRow[]) {
  const grouped = new Map<
    string,
    {
      id: string;
      sortOrder: number;
      variants: Record<string, { path: string; width: number; height: number }>;
    }
  >();
  for (const row of mediaRows) {
    const item = grouped.get(row.mediaId) ?? {
      id: row.mediaId,
      sortOrder: row.sortOrder,
      variants: {},
    };
    item.variants[row.variant] = {
      path: `/api/v1/products/${encodeURIComponent(product.slug)}/media/${row.mediaId}/${row.variant}`,
      width: row.width,
      height: row.height,
    };
    grouped.set(row.mediaId, item);
  }
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    description: product.description,
    currency: product.currency,
    isPurchasable: product.isPurchasable,
    priceMinor: product.priceMinor.toString(),
    media: [...grouped.values()].sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

async function publicMediaForProducts(database: DatabaseClient, productIds: string[]) {
  const grouped = new Map<string, PublicMediaRow[]>();
  if (productIds.length === 0) return grouped;
  const rows = await database.db
    .select({
      productId: productMedia.productId,
      mediaId: productMedia.id,
      sortOrder: productMedia.sortOrder,
      variant: productMediaVariants.variant,
      width: productMediaVariants.width,
      height: productMediaVariants.height,
    })
    .from(productMedia)
    .innerJoin(productMediaVariants, eq(productMediaVariants.productMediaId, productMedia.id))
    .where(inArray(productMedia.productId, productIds))
    .orderBy(asc(productMedia.sortOrder));
  for (const row of rows) {
    const list = grouped.get(row.productId) ?? [];
    list.push(row);
    grouped.set(row.productId, list);
  }
  return grouped;
}
