import { resolve } from "node:path";
import { eq, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/auth.js";
import { InMemoryAuthEmailSender } from "../../src/auth/email.js";
import {
  assertSafeTestDatabaseUrl,
  parseEnv,
  requireDatabaseUrl,
  resolveAuthRuntimeConfig,
} from "../../src/config/env.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { products } from "../../src/db/schema/commerce.js";

// The storefront compares saved cart ids against GET /api/v1/products and drops any line that is
// not in the response (src/lib/cart-reconcile.ts). That is only safe while the endpoint returns
// EVERY active product. If this test fails because pagination or a limit was added, the cart
// reconciliation must be changed to resolve the specific cart ids before this test is updated, or
// shoppers' valid cart lines will be silently removed.

const env = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(env);
assertSafeTestDatabaseUrl(databaseUrl, env.NODE_ENV);

const KEY_PREFIX = "pin-list-";
// Larger than any page size a future change is likely to pick (10, 20, 25, 50, 100).
const EXTRA_ACTIVE_PRODUCTS = 150;

let app: FastifyInstance;
let database: DatabaseClient;

beforeAll(async () => {
  database = createDatabaseClient(databaseUrl);
  await migrate(database.db, { migrationsFolder: resolve("src/db/migrations") });
  const runtime = resolveAuthRuntimeConfig(env);
  const auth = createAuthService({
    database,
    emailSender: new InMemoryAuthEmailSender(),
    runtime,
  });
  app = await buildApp({
    database,
    auth,
    authRuntime: runtime,
    allowedOrigins: runtime.trustedOrigins,
  });
});

afterEach(async () => {
  await database.db.delete(products).where(like(products.catalogKey, `${KEY_PREFIX}%`));
});

afterAll(async () => {
  await app.close();
});

function fixture(index: number, isActive: boolean) {
  const label = String(index).padStart(3, "0");
  return {
    catalogKey: `${KEY_PREFIX}${label}`,
    slug: `${KEY_PREFIX}slug-${label}`,
    name: `Pagination pin product ${label}`,
    category: "Laptops",
    description: "Fixture row for the products-list completeness test.",
    priceMinor: 100_000n,
    currency: "KES",
    source: "PLATFORM" as const,
    isActive,
    isPurchasable: true,
    sortOrder: 10_000 + index,
  };
}

async function listProducts() {
  const response = await app.inject({ method: "GET", url: "/api/v1/products" });
  expect(response.statusCode).toBe(200);
  return response.json<{ products: { id: string }[] }>();
}

describe("GET /api/v1/products completeness", () => {
  it("returns every active product with no limit or pagination", async () => {
    await database.db
      .insert(products)
      .values([
        ...Array.from({ length: EXTRA_ACTIVE_PRODUCTS }, (_, index) => fixture(index, true)),
        fixture(EXTRA_ACTIVE_PRODUCTS, false),
      ]);

    const activeKeys = (
      await database.db
        .select({ catalogKey: products.catalogKey })
        .from(products)
        .where(eq(products.isActive, true))
    )
      .map((row) => row.catalogKey)
      .sort();
    // Guards the test itself: the table must hold more active rows than any plausible page size.
    expect(activeKeys.length).toBeGreaterThanOrEqual(EXTRA_ACTIVE_PRODUCTS);

    const body = await listProducts();
    const returnedIds = body.products.map((product) => product.id);

    expect(new Set(returnedIds).size).toBe(returnedIds.length);
    expect([...returnedIds].sort()).toEqual(activeKeys);
  });

  it("excludes inactive products, which cart reconciliation relies on to drop them", async () => {
    await database.db.insert(products).values([fixture(0, true), fixture(1, false)]);

    const returnedIds = (await listProducts()).products.map((product) => product.id);

    expect(returnedIds).toContain(`${KEY_PREFIX}000`);
    expect(returnedIds).not.toContain(`${KEY_PREFIX}001`);
  });

  it("has no pagination envelope: the body holds only the products array", async () => {
    await database.db.insert(products).values(fixture(0, true));

    const body = await listProducts();

    expect(Object.keys(body)).toEqual(["products"]);
  });

  it("rejects limit and pagination parameters instead of silently truncating", async () => {
    for (const query of ["limit=5", "page=2", "cursor=abc", "offset=10"]) {
      const response = await app.inject({ method: "GET", url: `/api/v1/products?${query}` });
      expect(response.statusCode, query).toBe(400);
    }
  });
});
