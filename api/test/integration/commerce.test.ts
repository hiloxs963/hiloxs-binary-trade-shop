import { resolve } from "node:path";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/auth.js";
import { InMemoryAuthEmailSender } from "../../src/auth/email.js";
import { INITIAL_CATALOG } from "../../src/catalog/initial-catalog.js";
import {
  assertSafeTestDatabaseUrl,
  parseEnv,
  requireDatabaseUrl,
  resolveAuthRuntimeConfig,
} from "../../src/config/env.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { user } from "../../src/db/schema/auth.js";
import { orderItems, orders, products } from "../../src/db/schema/commerce.js";

const FRONTEND_ORIGIN = "http://localhost:8080";
const PASSWORD = "StrongPassword!42";
const env = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(env);
assertSafeTestDatabaseUrl(databaseUrl, env.NODE_ENV);

let app: FastifyInstance;
let database: DatabaseClient;
let requestCounter = 0;
const emailSender = new InMemoryAuthEmailSender();
const approvedLaptop = INITIAL_CATALOG[0];
const secondApprovedLaptop = INITIAL_CATALOG[1];

beforeAll(async () => {
  database = createDatabaseClient(databaseUrl);
  await migrate(database.db, { migrationsFolder: resolve("src/db/migrations") });
  const runtime = resolveAuthRuntimeConfig(env);
  const auth = createAuthService({ database, emailSender, runtime });
  app = await buildApp({
    database,
    auth,
    authRuntime: runtime,
    allowedOrigins: runtime.trustedOrigins,
  });
});

beforeEach(async () => {
  await database.pool.query(
    'truncate table "order_items", "orders", "verification", "session", "account", "user" cascade',
  );
  await database.db
    .update(products)
    .set({
      name: approvedLaptop.name,
      priceMinor: approvedLaptop.priceMinor,
      isActive: true,
      updatedAt: new Date(),
    })
    .where(eq(products.catalogKey, approvedLaptop.catalogKey));
  emailSender.messages.length = 0;
});

afterAll(async () => {
  await app.close();
});

describe("server-authoritative commerce", () => {
  it("lists the seeded catalog deterministically and returns safe slug detail", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/products" });
    const body = list.json<{ products: Array<Record<string, unknown>> }>();
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/products/${approvedLaptop.slug}`,
    });

    expect(list.statusCode).toBe(200);
    expect(body.products).toHaveLength(44);
    expect(body.products.map((product) => product["id"])).toEqual(
      INITIAL_CATALOG.map((product) => product.catalogKey),
    );
    expect(body.products[0]).toEqual({
      id: approvedLaptop.catalogKey,
      slug: approvedLaptop.slug,
      name: approvedLaptop.name,
      category: approvedLaptop.category,
      description: approvedLaptop.description,
      priceMinor: approvedLaptop.priceMinor.toString(),
      currency: "KES",
    });
    expect(body.products[0]).not.toHaveProperty("stock");
    expect(body.products[0]).not.toHaveProperty("seller");
    expect(body.products[0]).not.toHaveProperty("reviews");
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual({ product: body.products[0] });
  });

  it("filters categories and never returns inactive products", async () => {
    await database.db
      .update(products)
      .set({ isActive: false })
      .where(eq(products.catalogKey, approvedLaptop.catalogKey));
    const filtered = await app.inject({
      method: "GET",
      url: `/api/v1/products?category=${encodeURIComponent("Laptops")}`,
    });
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/products/${approvedLaptop.slug}`,
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json<{ products: Array<{ id: string }> }>().products).toHaveLength(3);
    expect(filtered.body).not.toContain(approvedLaptop.catalogKey);
    expect(detail.statusCode).toBe(404);
  });

  it("requires authentication for quotes and uses current PostgreSQL prices", async () => {
    const anonymous = await post("/api/v1/checkout/quote", cart());
    const cookie = await createVerifiedSession("quote@example.com");
    await database.db
      .update(products)
      .set({ priceMinor: 8_000_000n })
      .where(eq(products.catalogKey, approvedLaptop.catalogKey));
    const quoted = await post("/api/v1/checkout/quote", cart(2), { cookie });

    expect(anonymous.statusCode).toBe(401);
    expect(quoted.statusCode).toBe(200);
    expect(quoted.json()).toEqual({
      quote: {
        currency: "KES",
        subtotalMinor: "16000000",
        totalMinor: "16000000",
        items: [
          {
            productId: approvedLaptop.catalogKey,
            name: approvedLaptop.name,
            slug: approvedLaptop.slug,
            unitPriceMinor: "8000000",
            quantity: 2,
            lineTotalMinor: "16000000",
          },
        ],
      },
    });
  });

  it("rejects unavailable products, malformed quantities, and browser-authoritative fields", async () => {
    const cookie = await createVerifiedSession("validation@example.com");
    const unknown = await post(
      "/api/v1/checkout/quote",
      { items: [{ productId: "missing-product", quantity: 1 }] },
      { cookie },
    );
    await database.db
      .update(products)
      .set({ isActive: false })
      .where(eq(products.catalogKey, approvedLaptop.catalogKey));
    const inactive = await post("/api/v1/checkout/quote", cart(), { cookie });
    const fractional = await post(
      "/api/v1/checkout/quote",
      { items: [{ productId: approvedLaptop.catalogKey, quantity: 1.5 }] },
      { cookie },
    );
    const injected = await post(
      "/api/v1/checkout/quote",
      { ...cart(), total: 1, currency: "USD", userId: "other-user" },
      { cookie },
    );

    expect(unknown.statusCode).toBe(400);
    expect(inactive.statusCode).toBe(400);
    expect(fractional.statusCode).toBe(400);
    expect(injected.statusCode).toBe(400);
  });

  it("creates a pending order atomically with immutable item snapshots and correct totals", async () => {
    const cookie = await createVerifiedSession("order@example.com");
    const response = await createPendingOrder(cookie, "order-create-key-0001", 2);
    const created = response.json<{ order: CommerceOrder }>().order;
    await database.db
      .update(products)
      .set({ name: "Future renamed product", priceMinor: 1n })
      .where(eq(products.catalogKey, approvedLaptop.catalogKey));
    const detail = await get(`/api/v1/orders/${created.id}`, cookie);
    const stored = detail.json<{ order: CommerceOrder }>().order;

    expect(response.statusCode).toBe(201);
    expect(created.status).toBe("PENDING_PAYMENT");
    expect(created.currency).toBe("KES");
    expect(created.totalMinor).toBe((approvedLaptop.priceMinor * 2n).toString());
    expect(created.itemCount).toBe(2);
    expect(stored.items[0]).toMatchObject({
      productName: approvedLaptop.name,
      productSlug: approvedLaptop.slug,
      unitPriceMinor: approvedLaptop.priceMinor.toString(),
      quantity: 2,
      lineTotalMinor: (approvedLaptop.priceMinor * 2n).toString(),
    });
  });

  it("returns the same order for retries and concurrent duplicate requests", async () => {
    const cookie = await createVerifiedSession("idempotent@example.com");
    const retryKey = "idempotent-retry-key-0001";
    const first = await createPendingOrder(cookie, retryKey);
    const retry = await createPendingOrder(cookie, retryKey);
    const concurrentKey = "concurrent-order-key-0001";
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => createPendingOrder(cookie, concurrentKey)),
    );
    const rows = await database.db.select({ value: count() }).from(orders);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json<{ order: CommerceOrder }>().order.id).toBe(
      first.json<{ order: CommerceOrder }>().order.id,
    );
    expect(
      new Set(concurrent.map((response) => response.json<{ order: CommerceOrder }>().order.id))
        .size,
    ).toBe(1);
    expect(concurrent.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(rows[0]?.value).toBe(2);
  });

  it("rejects sequential reuse of an idempotency key for a different cart", async () => {
    const cookie = await createVerifiedSession("idempotency-conflict@example.com");
    const first = await post("/api/v1/orders", cartFor(approvedLaptop.catalogKey, 1), {
      cookie,
      idempotencyKey: "abc123",
    });
    const conflicting = await post("/api/v1/orders", cartFor(secondApprovedLaptop.catalogKey, 2), {
      cookie,
      idempotencyKey: "abc123",
    });
    const rows = await database.db.select({ value: count() }).from(orders);

    expect(first.statusCode).toBe(201);
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json<{ error: { code: string } }>().error.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
    expect(rows[0]?.value).toBe(1);
  });

  it("allows reordered exact retries and rejects concurrent conflicting payloads", async () => {
    const cookie = await createVerifiedSession("idempotency-race@example.com");
    const reorderedKey = "reordered-cart-key-0001";
    const firstCart = {
      items: [
        { productId: approvedLaptop.catalogKey, quantity: 1 },
        { productId: secondApprovedLaptop.catalogKey, quantity: 2 },
      ],
    };
    const reordered = { items: [...firstCart.items].reverse() };
    const first = await post("/api/v1/orders", firstCart, {
      cookie,
      idempotencyKey: reorderedKey,
    });
    const retry = await post("/api/v1/orders", reordered, {
      cookie,
      idempotencyKey: reorderedKey,
    });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json<{ order: CommerceOrder }>().order.id).toBe(
      first.json<{ order: CommerceOrder }>().order.id,
    );

    const concurrentKey = "conflicting-race-key-0001";
    const concurrent = await Promise.all([
      post("/api/v1/orders", cartFor(approvedLaptop.catalogKey, 1), {
        cookie,
        idempotencyKey: concurrentKey,
      }),
      post("/api/v1/orders", cartFor(secondApprovedLaptop.catalogKey, 2), {
        cookie,
        idempotencyKey: concurrentKey,
      }),
    ]);
    const statuses = concurrent.map((response) => response.statusCode).sort();
    const conflict = concurrent.find((response) => response.statusCode === 409);
    const rows = await database.db.select({ value: count() }).from(orders);

    expect(statuses).toEqual([201, 409]);
    expect(conflict?.json<{ error: { code: string } }>().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(rows[0]?.value).toBe(2);
  });

  it("re-prices an order after a quote and returns the stored current total", async () => {
    const cookie = await createVerifiedSession("repriced-order@example.com");
    const quote = await post("/api/v1/checkout/quote", cart(2), { cookie });
    await database.db
      .update(products)
      .set({ priceMinor: 8_000_000n })
      .where(eq(products.catalogKey, approvedLaptop.catalogKey));
    const created = await createPendingOrder(cookie, "repriced-order-key-0001", 2);

    expect(quote.json<{ quote: { totalMinor: string } }>().quote.totalMinor).toBe(
      (approvedLaptop.priceMinor * 2n).toString(),
    );
    expect(created.statusCode).toBe(201);
    expect(created.json<{ order: CommerceOrder }>().order.totalMinor).toBe("16000000");
  });

  it("preserves money invariants for a very large PostgreSQL bigint total", async () => {
    const cookie = await createVerifiedSession("large-total@example.com");
    const unitPriceMinor = 400_000_000_000_000_000n;
    await database.db
      .update(products)
      .set({ priceMinor: unitPriceMinor })
      .where(eq(products.catalogKey, approvedLaptop.catalogKey));
    const created = await createPendingOrder(cookie, "large-total-order-key-0001", 20);
    const order = created.json<{ order: CommerceOrder }>().order;
    const expectedTotal = unitPriceMinor * 20n;

    expect(created.statusCode).toBe(201);
    expect(order.totalMinor).toBe(expectedTotal.toString());
    expect(order.items[0]).toMatchObject({
      unitPriceMinor: unitPriceMinor.toString(),
      quantity: 20,
      lineTotalMinor: expectedTotal.toString(),
    });
  });

  it("scopes idempotency and order reads to the authenticated owner", async () => {
    const firstCookie = await createVerifiedSession("owner@example.com");
    const secondCookie = await createVerifiedSession("other@example.com");
    const sharedKey = "same-key-different-users-0001";
    const first = await createPendingOrder(firstCookie, sharedKey);
    const second = await createPendingOrder(secondCookie, sharedKey);
    const firstOrder = first.json<{ order: CommerceOrder }>().order;
    const foreignDetail = await get(`/api/v1/orders/${firstOrder.id}`, secondCookie);
    const foreignCancel = await post(
      `/api/v1/orders/${firstOrder.id}/cancel`,
      {},
      { cookie: secondCookie },
    );
    const firstList = await get("/api/v1/orders", firstCookie);
    const secondList = await get("/api/v1/orders", secondCookie);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json<{ order: CommerceOrder }>().order.id).not.toBe(firstOrder.id);
    expect(foreignDetail.statusCode).toBe(404);
    expect(foreignCancel.statusCode).toBe(404);
    expect(firstList.body).toContain(firstOrder.orderNumber);
    expect(firstList.body).not.toContain(second.json<{ order: CommerceOrder }>().order.orderNumber);
    expect(secondList.body).not.toContain(firstOrder.orderNumber);
  });

  it("rejects user ID injection on order creation", async () => {
    const cookie = await createVerifiedSession("injection@example.com");
    const response = await post(
      "/api/v1/orders",
      { ...cart(), userId: "another-user" },
      { cookie, idempotencyKey: "user-injection-key-0001" },
    );
    const rows = await database.db.select({ value: count() }).from(orders);

    expect(response.statusCode).toBe(400);
    expect(rows[0]?.value).toBe(0);
  });

  it("cancels only pending orders and treats repeated cancellation idempotently", async () => {
    const cookie = await createVerifiedSession("cancel@example.com");
    const created = await createPendingOrder(cookie, "cancel-order-key-0001");
    const order = created.json<{ order: CommerceOrder }>().order;
    const injected = await post(
      `/api/v1/orders/${order.id}/cancel`,
      { status: "PAID" },
      { cookie },
    );
    const stillPending = await get(`/api/v1/orders/${order.id}`, cookie);
    const first = await post(`/api/v1/orders/${order.id}/cancel`, {}, { cookie });
    const repeated = await post(`/api/v1/orders/${order.id}/cancel`, {}, { cookie });

    expect(injected.statusCode).toBe(400);
    expect(stillPending.json<{ order: CommerceOrder }>().order.status).toBe("PENDING_PAYMENT");
    expect(first.statusCode).toBe(200);
    expect(first.json<{ order: CommerceOrder }>().order.status).toBe("CANCELLED");
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json<{ order: CommerceOrder }>().order.status).toBe("CANCELLED");

    await database.db.update(orders).set({ status: "PAID" }).where(eq(orders.id, order.id));
    const invalidTransition = await post(`/api/v1/orders/${order.id}/cancel`, {}, { cookie });
    expect(invalidTransition.statusCode).toBe(409);
  });

  it.each(["SUSPENDED", "DISABLED"] as const)("denies %s accounts", async (status) => {
    const email = `${status.toLowerCase()}@example.com`;
    const cookie = await createVerifiedSession(email);
    await database.db.update(user).set({ status }).where(eq(user.email, email));
    const quote = await post("/api/v1/checkout/quote", cart(), { cookie });
    const create = await post("/api/v1/orders", cart(), {
      cookie,
      idempotencyKey: `${status.toLowerCase()}-order-key-0001`,
    });

    expect(quote.statusCode).toBe(401);
    expect(create.statusCode).toBe(401);
  });

  it("rolls back the order when item insertion fails", async () => {
    const cookie = await createVerifiedSession("rollback@example.com");
    await database.pool.query(`
      create function phase3_reject_order_item() returns trigger language plpgsql as $$
      begin raise exception 'forced item failure'; end $$;
      create trigger phase3_reject_order_item before insert on order_items
      for each row execute function phase3_reject_order_item();
    `);
    try {
      const response = await createPendingOrder(cookie, "rollback-order-key-0001");
      const orderRows = await database.db.select({ value: count() }).from(orders);
      const itemRows = await database.db.select({ value: count() }).from(orderItems);

      expect(response.statusCode).toBe(500);
      expect(orderRows[0]?.value).toBe(0);
      expect(itemRows[0]?.value).toBe(0);
    } finally {
      await database.pool.query("drop trigger if exists phase3_reject_order_item on order_items");
      await database.pool.query("drop function if exists phase3_reject_order_item()");
    }
  });
});

type CommerceOrder = {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  totalMinor: string;
  itemCount: number;
  items: Array<{
    productName: string;
    productSlug: string;
    unitPriceMinor: string;
    quantity: number;
    lineTotalMinor: string;
  }>;
};

function cart(quantity = 1): Record<string, unknown> {
  return cartFor(approvedLaptop.catalogKey, quantity);
}

function cartFor(productId: string, quantity: number): Record<string, unknown> {
  return { items: [{ productId, quantity }] };
}

async function createPendingOrder(
  cookie: string,
  idempotencyKey: string,
  quantity = 1,
): Promise<InjectResponse> {
  return post("/api/v1/orders", cart(quantity), { cookie, idempotencyKey });
}

async function createVerifiedSession(email: string): Promise<string> {
  const registration = await post("/api/auth/sign-up/email", {
    name: "Commerce Customer",
    email,
    phone: "0712345678",
    password: PASSWORD,
    callbackURL: `${FRONTEND_ORIGIN}/verify-email`,
  });
  expect(registration.statusCode).toBe(200);
  const message = emailSender.messages.find(
    (candidate) => candidate.kind === "verification" && candidate.recipient === email,
  );
  const token = new URLSearchParams(new URL(message?.url ?? "").hash.slice(1)).get("token") ?? "";
  const verified = await post("/api/v1/auth/verify-email", { token });
  expect(verified.statusCode).toBe(200);
  const login = await post("/api/auth/sign-in/email", { email, password: PASSWORD });
  expect(login.statusCode).toBe(200);
  const setCookie = login.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return cookies.find((value) => value.includes("session_token"))?.split(";", 1)[0] ?? "";
}

function post(
  url: string,
  payload: Record<string, unknown>,
  options: { cookie?: string; idempotencyKey?: string } = {},
): Promise<InjectResponse> {
  requestCounter += 1;
  return app.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/json",
      origin: FRONTEND_ORIGIN,
      "x-real-ip": `198.51.100.${requestCounter % 250}`,
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    payload,
  });
}

function get(url: string, cookie: string): Promise<InjectResponse> {
  return app.inject({ method: "GET", url, headers: { cookie } });
}
