import { resolve } from "node:path";
import { and, count, eq, inArray } from "drizzle-orm";
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
  type MpesaRuntimeConfig,
} from "../../src/config/env.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { user } from "../../src/db/schema/auth.js";
import { orders, products } from "../../src/db/schema/commerce.js";
import { paymentAttempts, paymentEvents } from "../../src/db/schema/payments.js";
import {
  MpesaProviderError,
  type MpesaInitiationInput,
  type MpesaProvider,
  type MpesaQueryResult,
} from "../../src/payments/provider.js";
import { ACTIVE_PAYMENT_STATUSES } from "../../src/payments/state.js";

const FRONTEND_ORIGIN = "http://localhost:8080";
const PASSWORD = "StrongPassword!42";
const env = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(env);
assertSafeTestDatabaseUrl(databaseUrl, env.NODE_ENV);

let app: FastifyInstance;
let database: DatabaseClient;
let provider: FakeMpesaProvider;
let requestCounter = 0;
const emailSender = new InMemoryAuthEmailSender();
const approvedProduct = INITIAL_CATALOG[0];
const mpesaConfig: MpesaRuntimeConfig = {
  environment: "sandbox",
  baseURL: "https://sandbox.safaricom.co.ke",
  consumerKey: "test-consumer-key",
  consumerSecret: "test-consumer-secret",
  shortcode: "174379",
  passkey: "test-passkey",
  transactionType: "CustomerPayBillOnline",
  partyB: "174379",
  callbackBaseURL: "https://api.example.test",
  maxAmountKes: 100_000n,
  requestTimeoutMs: 10_000,
};

beforeAll(async () => {
  provider = new FakeMpesaProvider();
  database = createDatabaseClient(databaseUrl);
  await migrate(database.db, { migrationsFolder: resolve("src/db/migrations") });
  const runtime = resolveAuthRuntimeConfig(env);
  const auth = createAuthService({ database, emailSender, runtime });
  app = await buildApp({
    database,
    auth,
    authRuntime: runtime,
    allowedOrigins: runtime.trustedOrigins,
    mpesa: { provider, config: mpesaConfig },
  });
});

beforeEach(async () => {
  await database.pool.query(
    'truncate table "payment_events", "payment_attempts", "order_items", "orders", "verification", "session", "account", "user" cascade',
  );
  await database.db
    .update(products)
    .set({ priceMinor: approvedProduct.priceMinor, isActive: true, updatedAt: new Date() })
    .where(eq(products.catalogKey, approvedProduct.catalogKey));
  emailSender.messages.length = 0;
  provider.reset();
});

afterAll(async () => {
  await app.close();
});

describe("M-Pesa payment initiation", () => {
  it("uses the stored order amount and returns no provider secrets or identifiers", async () => {
    const owner = await ownerWithOrder("payment@example.com");
    const response = await initiate(owner.cookie, owner.orderId, "payment-key-0001");

    expect(response.statusCode).toBe(202);
    expect(provider.initiations).toHaveLength(1);
    expect(provider.initiations[0]).toMatchObject({
      amountKes: approvedProduct.priceMinor / 100n,
      phoneE164: "+254712345678",
    });
    expect(provider.initiations[0]?.callbackURL).toMatch(
      /^https:\/\/api\.example\.test\/api\/v1\/payments\/mpesa\/callback\/[A-Za-z0-9_-]{43}$/,
    );
    expect(response.body).not.toContain("checkout-");
    expect(response.body).not.toContain("merchant-");
    expect(response.body).not.toContain("callback");
    expect(response.body).not.toContain("+254");
  });

  it("binds idempotency to order and normalized phone", async () => {
    const owner = await ownerWithOrder("payment-idempotency@example.com");
    const first = await initiate(owner.cookie, owner.orderId, "abc123", "0712 345 678");
    const retry = await initiate(owner.cookie, owner.orderId, "abc123", "+254712345678");
    const conflict = await initiate(owner.cookie, owner.orderId, "abc123", "0712 345 679");
    const rows = await database.db.select({ value: count() }).from(paymentAttempts);

    expect(first.statusCode).toBe(202);
    expect(retry.statusCode).toBe(200);
    expect(retry.json<{ payment: { paymentAttemptId: string } }>().payment.paymentAttemptId).toBe(
      first.json<{ payment: { paymentAttemptId: string } }>().payment.paymentAttemptId,
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ error: { code: string } }>().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(provider.initiations).toHaveLength(1);
    expect(rows[0]?.value).toBe(1);
  });

  it("allows a retry after definitive failure but blocks UNKNOWN and active attempts", async () => {
    const failedOwner = await ownerWithOrder("payment-failed@example.com");
    provider.initiationError = new MpesaProviderError("rejected", {
      ambiguous: false,
      providerCode: "400.002.02",
    });
    const failed = await initiate(failedOwner.cookie, failedOwner.orderId, "failed-key-0001");
    provider.initiationError = undefined;
    const retried = await initiate(failedOwner.cookie, failedOwner.orderId, "failed-key-0002");

    const unknownOwner = await ownerWithOrder("payment-unknown@example.com");
    provider.initiationError = new MpesaProviderError("timeout", { ambiguous: true });
    const unknown = await initiate(unknownOwner.cookie, unknownOwner.orderId, "unknown-key-0001");
    provider.initiationError = undefined;
    const blocked = await initiate(unknownOwner.cookie, unknownOwner.orderId, "unknown-key-0002");

    expect(failed.statusCode).toBe(503);
    expect(retried.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(unknown.json<{ payment: { paymentStatus: string } }>().payment.paymentStatus).toBe(
      "UNKNOWN",
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe(
      "PAYMENT_ALREADY_IN_PROGRESS",
    );
  });

  it("enforces one active attempt under concurrent requests", async () => {
    const owner = await ownerWithOrder("payment-concurrent@example.com");
    const gate = deferred<void>();
    provider.initiationGate = gate.promise;
    const firstPromise = initiate(owner.cookie, owner.orderId, "concurrent-key-0001");
    await provider.initiationStarted.promise;
    const second = await initiate(owner.cookie, owner.orderId, "concurrent-key-0002");
    gate.resolve();
    const first = await firstPromise;
    const active = await database.db
      .select({ value: count() })
      .from(paymentAttempts)
      .where(inArray(paymentAttempts.status, ACTIVE_PAYMENT_STATUSES));

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(409);
    expect(provider.initiations).toHaveLength(1);
    expect(active[0]?.value).toBe(1);
  });

  it("rejects unauthenticated, inactive, foreign, and injected authority", async () => {
    const owner = await ownerWithOrder("payment-owner@example.com");
    const foreignCookie = await createVerifiedSession("payment-foreign@example.com");
    const anonymous = await initiate("", owner.orderId, "anonymous-key-0001");
    const foreign = await initiate(foreignCookie, owner.orderId, "foreign-key-0001");
    const injected = await post(
      `/api/v1/orders/${owner.orderId}/payments/mpesa`,
      {
        phone: "0712345678",
        amount: 1,
        total: 1,
        currency: "USD",
        userId: "other-user",
        status: "PAID",
        CheckoutRequestID: "forged",
        receipt: "forged",
      },
      { cookie: owner.cookie, idempotencyKey: "injected-key-0001" },
    );
    await database.db
      .update(user)
      .set({ status: "SUSPENDED" })
      .where(eq(user.email, "payment-owner@example.com"));
    const suspended = await initiate(owner.cookie, owner.orderId, "suspended-key-0001");

    expect(anonymous.statusCode).toBe(401);
    expect(foreign.statusCode).toBe(404);
    expect(injected.statusCode).toBe(400);
    expect(suspended.statusCode).toBe(401);
    expect(provider.initiations).toHaveLength(0);
  });

  it.each(["SUSPENDED", "DISABLED"] as const)("rejects a %s account", async (status) => {
    const email = `payment-${status.toLowerCase()}@example.com`;
    const owner = await ownerWithOrder(email);
    await database.db.update(user).set({ status }).where(eq(user.email, email));

    const response = await initiate(owner.cookie, owner.orderId, `${status.toLowerCase()}-key`);

    expect(response.statusCode).toBe(401);
    expect(provider.initiations).toHaveLength(0);
  });

  it("rejects non-whole, zero, and over-limit server totals", async () => {
    const owner = await ownerWithOrder("payment-money@example.com");
    for (const [totalMinor, key] of [
      [0n, "zero-total-key-0001"],
      [101n, "fraction-total-key-0001"],
      [10_000_100n, "over-limit-key-0001"],
    ] as const) {
      await database.db
        .update(orders)
        .set({ totalMinor, subtotalMinor: totalMinor })
        .where(eq(orders.id, owner.orderId));
      const response = await initiate(owner.cookie, owner.orderId, key);
      expect(response.statusCode).toBe(400);
    }
    expect(provider.initiations).toHaveLength(0);
  });
});

describe("M-Pesa callbacks and reconciliation", () => {
  it("durably records, deduplicates, and reconciles a reordered success callback", async () => {
    const owner = await ownerWithOrder("payment-callback@example.com");
    await initiate(owner.cookie, owner.orderId, "callback-key-0001");
    const callbackURL = provider.initiations[0]?.callbackURL ?? "";
    const payload = successCallback(provider.lastCheckoutRequestId, [
      { Name: "PhoneNumber", Value: 254712345678 },
      { Name: "TransactionDate", Value: 20260831200506 },
      { Name: "MpesaReceiptNumber", Value: "TESTREC001" },
      { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
    ]);
    const first = await callback(callbackURL, payload);
    const replay = await callback(callbackURL, {
      Body: {
        stkCallback: {
          ...payload.Body.stkCallback,
          CallbackMetadata: { Item: [...payload.Body.stkCallback.CallbackMetadata.Item].reverse() },
        },
      },
    });
    const beforeQuery = await getPayment(owner.cookie, owner.orderId);
    const events = await database.db.select({ value: count() }).from(paymentEvents);
    expect(provider.queries).toHaveLength(0);
    provider.queryResult = queryResult(provider.lastCheckoutRequestId, 0);
    const refreshed = await refresh(owner.cookie, owner.orderId);

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(events[0]?.value).toBe(1);
    expect(
      beforeQuery.json<{ payment: { orderStatus: string; paymentStatus: string } }>().payment,
    ).toMatchObject({ orderStatus: "PENDING_PAYMENT", paymentStatus: "CONFIRMING" });
    expect(
      refreshed.json<{
        payment: { orderStatus: string; paymentStatus: string; receiptNumber: string };
      }>().payment,
    ).toMatchObject({
      orderStatus: "PAID",
      paymentStatus: "SUCCEEDED",
      receiptNumber: "TESTREC001",
    });
  });

  it("correlates a callback after an ambiguous immediate response", async () => {
    const owner = await ownerWithOrder("payment-lost-response@example.com");
    provider.initiationError = new MpesaProviderError("response lost", { ambiguous: true });
    const initiated = await initiate(owner.cookie, owner.orderId, "lost-response-key-0001");
    const callbackURL = provider.initiations[0]?.callbackURL ?? "";
    const received = await callback(
      callbackURL,
      successCallback("checkout-recovered", [
        { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
      ]),
    );
    const status = await getPayment(owner.cookie, owner.orderId);

    expect(initiated.json<{ payment: { paymentStatus: string } }>().payment.paymentStatus).toBe(
      "UNKNOWN",
    );
    expect(received.statusCode).toBe(200);
    expect(status.json<{ payment: { paymentStatus: string } }>().payment.paymentStatus).toBe(
      "CONFIRMING",
    );
  });

  it("does not overwrite a callback state when the initiation response arrives later", async () => {
    const owner = await ownerWithOrder("payment-fast-callback@example.com");
    const gate = deferred<void>();
    provider.initiationGate = gate.promise;
    const initiation = initiate(owner.cookie, owner.orderId, "fast-callback-key-0001");
    await provider.initiationStarted.promise;

    const callbackResponse = await callback(
      provider.initiations[0]?.callbackURL ?? "",
      successCallback(provider.lastCheckoutRequestId, [
        { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
      ]),
    );
    gate.resolve();
    const initiationResponse = await initiation;
    const status = await getPayment(owner.cookie, owner.orderId);

    expect(callbackResponse.statusCode).toBe(200);
    expect(
      initiationResponse.json<{ payment: { paymentStatus: string } }>().payment.paymentStatus,
    ).toBe("CONFIRMING");
    expect(status.json<{ payment: { paymentStatus: string } }>().payment.paymentStatus).toBe(
      "CONFIRMING",
    );
  });

  it("does not overwrite callback review when the initiation response arrives later", async () => {
    const owner = await ownerWithOrder("payment-fast-review@example.com");
    const gate = deferred<void>();
    provider.initiationGate = gate.promise;
    const initiation = initiate(owner.cookie, owner.orderId, "fast-review-key-0001");
    await provider.initiationStarted.promise;

    const callbackResponse = await callback(
      provider.initiations[0]?.callbackURL ?? "",
      successCallback("checkout-conflict", [
        { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
      ]),
    );
    gate.resolve();
    const initiationResponse = await initiation;

    expect(callbackResponse.statusCode).toBe(200);
    expect(
      initiationResponse.json<{ payment: { paymentStatus: string } }>().payment.paymentStatus,
    ).toBe("REVIEW_REQUIRED");
  });

  it("persists a public failure callback without unlocking a retry", async () => {
    const owner = await ownerWithOrder("payment-failure-callback@example.com");
    await initiate(owner.cookie, owner.orderId, "failure-callback-key-0001");
    const callbackURL = provider.initiations[0]?.callbackURL ?? "";
    const failed = await callback(callbackURL, failureCallback(provider.lastCheckoutRequestId));
    const status = await getPayment(owner.cookie, owner.orderId);
    const retry = await initiate(owner.cookie, owner.orderId, "failure-callback-key-0002");

    expect(failed.statusCode).toBe(200);
    expect(
      status.json<{ payment: { orderStatus: string; paymentStatus: string } }>().payment,
    ).toMatchObject({ orderStatus: "PENDING_PAYMENT", paymentStatus: "CONFIRMING" });
    expect(retry.statusCode).toBe(409);
  });

  it("rejects malformed and unknown-token callbacks without revealing an order", async () => {
    const owner = await ownerWithOrder("payment-invalid-callback@example.com");
    await initiate(owner.cookie, owner.orderId, "invalid-callback-key-0001");
    const callbackURL = provider.initiations[0]?.callbackURL ?? "";
    const malformed = await callback(callbackURL, { Body: {} });
    const malformedJson = await app.inject({
      method: "POST",
      url: new URL(callbackURL).pathname,
      headers: { "content-type": "application/json" },
      payload: '{"Body":',
    });
    const unknown = await callback(
      `https://api.example.test/api/v1/payments/mpesa/callback/${"x".repeat(43)}`,
      failureCallback("checkout-missing"),
    );

    expect(malformed.statusCode).toBe(400);
    expect(malformedJson.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<{ error: { code: string } }>().error.code).toBe("NOT_FOUND");
  });

  it.each(["amount", "checkout"] as const)(
    "moves a mismatched %s callback to review",
    async (kind) => {
      const owner = await ownerWithOrder(`payment-mismatch-${kind}@example.com`);
      await initiate(owner.cookie, owner.orderId, `mismatch-${kind}-key-0001`);
      const payload = successCallback(
        kind === "checkout" ? "checkout-conflict" : provider.lastCheckoutRequestId,
        [
          {
            Name: "Amount",
            Value: kind === "amount" ? 1 : Number(approvedProduct.priceMinor / 100n),
          },
        ],
      );
      await callback(provider.initiations[0]?.callbackURL ?? "", payload);
      const status = await getPayment(owner.cookie, owner.orderId);
      const retry = await initiate(owner.cookie, owner.orderId, `mismatch-${kind}-key-0002`);

      expect(status.json<{ payment: { paymentStatus: string } }>().payment.paymentStatus).toBe(
        "REVIEW_REQUIRED",
      );
      expect(retry.statusCode).toBe(409);
    },
  );

  it("serializes concurrent duplicate receipts into one stored receipt and one review", async () => {
    const first = await ownerWithOrder("payment-receipt-first@example.com");
    await initiate(first.cookie, first.orderId, "receipt-first-key-0001");
    const firstCall = provider.initiations[0];
    const firstCheckout = provider.lastCheckoutRequestId;
    const firstMerchant = provider.lastMerchantRequestId;

    const second = await ownerWithOrder("payment-receipt-second@example.com");
    await initiate(second.cookie, second.orderId, "receipt-second-key-0001");
    const secondCall = provider.initiations[1];
    const secondCheckout = provider.lastCheckoutRequestId;
    const secondMerchant = provider.lastMerchantRequestId;
    const responses = await Promise.all([
      callback(
        firstCall?.callbackURL ?? "",
        successCallback(
          firstCheckout,
          [
            { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
            { Name: "MpesaReceiptNumber", Value: "DUPLICATE01" },
          ],
          firstMerchant,
        ),
      ),
      callback(
        secondCall?.callbackURL ?? "",
        successCallback(
          secondCheckout,
          [
            { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
            { Name: "MpesaReceiptNumber", Value: "DUPLICATE01" },
          ],
          secondMerchant,
        ),
      ),
    ]);
    const attempts = await database.db
      .select({ status: paymentAttempts.status, receipt: paymentAttempts.mpesaReceiptNumber })
      .from(paymentAttempts);
    const events = await database.db.select({ value: count() }).from(paymentEvents);

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([
      "CONFIRMING",
      "REVIEW_REQUIRED",
    ]);
    expect(attempts.filter((attempt) => attempt.receipt === "DUPLICATE01")).toHaveLength(1);
    expect(events[0]?.value).toBe(2);
  });

  it("applies one successful transition under simultaneous callback and reconciliation", async () => {
    const owner = await ownerWithOrder("payment-simultaneous@example.com");
    await initiate(owner.cookie, owner.orderId, "simultaneous-key-0001");
    provider.queryResult = queryResult(provider.lastCheckoutRequestId, 0);
    const results = await Promise.all([
      callback(
        provider.initiations[0]?.callbackURL ?? "",
        successCallback(provider.lastCheckoutRequestId, [
          { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
          { Name: "MpesaReceiptNumber", Value: "SIMULTANEOUS01" },
        ]),
      ),
      refresh(owner.cookie, owner.orderId),
    ]);
    const [storedOrder] = await database.db
      .select()
      .from(orders)
      .where(eq(orders.id, owner.orderId));
    const succeeded = await database.db
      .select({ value: count() })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.status, "SUCCEEDED"));
    const events = await database.db.select({ value: count() }).from(paymentEvents);
    const [attempt] = await database.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, owner.orderId));

    expect(results.every((result) => result.statusCode === 200)).toBe(true);
    expect(storedOrder?.status).toBe("PAID");
    expect(succeeded[0]?.value).toBe(1);
    expect(events[0]?.value).toBe(1);
    expect(attempt?.mpesaReceiptNumber).toBe("SIMULTANEOUS01");
  });

  it("does not move a paid order backwards when a callback arrives after success", async () => {
    const owner = await ownerWithOrder("payment-terminal-callback@example.com");
    await initiate(owner.cookie, owner.orderId, "terminal-callback-key-0001");
    provider.queryResult = queryResult(provider.lastCheckoutRequestId, 0);
    await refresh(owner.cookie, owner.orderId);

    const callbackURL = provider.initiations[0]?.callbackURL ?? "";
    const payload = successCallback(provider.lastCheckoutRequestId, [
      { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
      { Name: "MpesaReceiptNumber", Value: "LATECALLBACK01" },
    ]);
    const received = await callback(callbackURL, payload);
    const replay = await callback(callbackURL, payload);
    const beforeConflict = await getPayment(owner.cookie, owner.orderId);
    const conflictingReceipt = await callback(
      callbackURL,
      successCallback(provider.lastCheckoutRequestId, [
        { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
        { Name: "MpesaReceiptNumber", Value: "CONFLICTING01" },
      ]),
    );
    const status = await getPayment(owner.cookie, owner.orderId);
    const events = await database.db.select({ value: count() }).from(paymentEvents);

    expect(received.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(conflictingReceipt.statusCode).toBe(200);
    expect(
      beforeConflict.json<{
        payment: { orderStatus: string; paymentStatus: string; receiptNumber: string };
      }>().payment,
    ).toMatchObject({
      orderStatus: "PAID",
      paymentStatus: "SUCCEEDED",
      receiptNumber: "LATECALLBACK01",
    });
    expect(
      status.json<{ payment: { orderStatus: string; paymentStatus: string } }>().payment,
    ).toMatchObject({ orderStatus: "PAID", paymentStatus: "REVIEW_REQUIRED" });
    expect(events[0]?.value).toBe(2);
  });

  it("keeps a paid order paid when a late failure callback requires review", async () => {
    const owner = await ownerWithOrder("payment-late-failure@example.com");
    await initiate(owner.cookie, owner.orderId, "late-failure-key-0001");
    provider.queryResult = queryResult(provider.lastCheckoutRequestId, 0);
    await refresh(owner.cookie, owner.orderId);

    const received = await callback(
      provider.initiations[0]?.callbackURL ?? "",
      failureCallback(provider.lastCheckoutRequestId),
    );
    const status = await getPayment(owner.cookie, owner.orderId);

    expect(received.statusCode).toBe(200);
    expect(
      status.json<{ payment: { orderStatus: string; paymentStatus: string } }>().payment,
    ).toMatchObject({ orderStatus: "PAID", paymentStatus: "REVIEW_REQUIRED" });
  });
});

describe("payment/order authority and races", () => {
  it("blocks cancellation while payment is active and never leaves cancelled plus active", async () => {
    const owner = await ownerWithOrder("payment-cancel-race@example.com");
    const [payment, cancellation] = await Promise.all([
      initiate(owner.cookie, owner.orderId, "cancel-race-key-0001"),
      post(`/api/v1/orders/${owner.orderId}/cancel`, {}, { cookie: owner.cookie }),
    ]);
    const [order] = await database.db.select().from(orders).where(eq(orders.id, owner.orderId));
    const [active] = await database.db
      .select({ value: count() })
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.orderId, owner.orderId),
          inArray(paymentAttempts.status, ACTIVE_PAYMENT_STATUSES),
        ),
      );

    const outcomes = [payment.statusCode, cancellation.statusCode].sort(
      (left, right) => left - right,
    );
    expect([
      [200, 400],
      [202, 409],
    ]).toContainEqual(outcomes);
    if (order?.status === "CANCELLED") expect(active?.value).toBe(0);
    else {
      expect(order?.status).toBe("PENDING_PAYMENT");
      expect(active?.value).toBe(1);
    }
  });

  it("serializes a success callback racing with cancellation", async () => {
    const owner = await ownerWithOrder("payment-callback-cancel@example.com");
    await initiate(owner.cookie, owner.orderId, "callback-cancel-key-0001");
    const [callbackResponse, cancellation] = await Promise.all([
      callback(
        provider.initiations[0]?.callbackURL ?? "",
        successCallback(provider.lastCheckoutRequestId, [
          { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
        ]),
      ),
      post(`/api/v1/orders/${owner.orderId}/cancel`, {}, { cookie: owner.cookie }),
    ]);
    const [order] = await database.db.select().from(orders).where(eq(orders.id, owner.orderId));
    const [attempt] = await database.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, owner.orderId));

    expect(callbackResponse.statusCode).toBe(200);
    expect(cancellation.statusCode).toBe(409);
    expect(attempt?.status).not.toBe("SUCCEEDED");
    expect(order?.status).toBe("PENDING_PAYMENT");
    expect(attempt?.status).toBe("CONFIRMING");
  });

  it("blocks cancellation while a successful provider query is in flight", async () => {
    const owner = await ownerWithOrder("payment-query-cancel@example.com");
    await initiate(owner.cookie, owner.orderId, "query-cancel-key-0001");
    provider.queryResult = queryResult(provider.lastCheckoutRequestId, 0);
    const gate = deferred<void>();
    provider.queryGate = gate.promise;
    const reconciliation = refresh(owner.cookie, owner.orderId);
    await provider.queryStarted.promise;

    const cancellation = await post(
      `/api/v1/orders/${owner.orderId}/cancel`,
      {},
      {
        cookie: owner.cookie,
      },
    );
    gate.resolve();
    const reconciled = await reconciliation;
    const [order] = await database.db.select().from(orders).where(eq(orders.id, owner.orderId));
    const [attempt] = await database.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, owner.orderId));

    expect(cancellation.statusCode).toBe(409);
    expect(reconciled.statusCode).toBe(200);
    expect(order?.status).toBe("PAID");
    expect(attempt?.status).toBe("SUCCEEDED");
  });

  it("flags late success evidence after a later attempt without creating two successes", async () => {
    const owner = await ownerWithOrder("payment-late-success@example.com");
    provider.initiationError = new MpesaProviderError("rejected", { ambiguous: false });
    const first = await initiate(owner.cookie, owner.orderId, "late-success-key-0001");
    const firstCall = provider.initiations[0];
    const firstCheckout = provider.lastCheckoutRequestId;
    const firstMerchant = provider.lastMerchantRequestId;
    provider.initiationError = undefined;
    const second = await initiate(owner.cookie, owner.orderId, "late-success-key-0002");

    const evidence = await callback(
      firstCall?.callbackURL ?? "",
      successCallback(
        firstCheckout,
        [
          { Name: "Amount", Value: Number(approvedProduct.priceMinor / 100n) },
          { Name: "MpesaReceiptNumber", Value: "LATESUCCESS01" },
        ],
        firstMerchant,
      ),
    );
    const attempts = await database.db
      .select({ status: paymentAttempts.status, resultCode: paymentAttempts.providerResultCode })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, owner.orderId));
    const [order] = await database.db.select().from(orders).where(eq(orders.id, owner.orderId));
    const retry = await initiate(owner.cookie, owner.orderId, "late-success-key-0003");

    expect(first.statusCode).toBe(503);
    expect(second.statusCode).toBe(202);
    expect(evidence.statusCode).toBe(200);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["FAILED", "REVIEW_REQUIRED"]);
    expect(attempts.filter((attempt) => attempt.resultCode === "0")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "SUCCEEDED")).toHaveLength(0);
    expect(order?.status).toBe("PENDING_PAYMENT");
    expect(retry.statusCode).toBe(409);
  });

  it("rejects foreign payment status/reconciliation and arbitrary refresh fields", async () => {
    const owner = await ownerWithOrder("payment-status-owner@example.com");
    const foreignCookie = await createVerifiedSession("payment-status-foreign@example.com");
    await initiate(owner.cookie, owner.orderId, "payment-status-key-0001");
    const foreignStatus = await getPayment(foreignCookie, owner.orderId);
    const foreignRefresh = await refresh(foreignCookie, owner.orderId);
    const injectedRefresh = await post(
      `/api/v1/orders/${owner.orderId}/payments/mpesa/refresh`,
      { status: "PAID", CheckoutRequestID: provider.lastCheckoutRequestId },
      { cookie: owner.cookie },
    );

    expect(foreignStatus.statusCode).toBe(404);
    expect(foreignRefresh.statusCode).toBe(404);
    expect(injectedRefresh.statusCode).toBe(400);
  });

  it("requires query identifiers to match the stored server-created identifier", async () => {
    const owner = await ownerWithOrder("payment-query-identifier@example.com");
    await initiate(owner.cookie, owner.orderId, "query-identifier-key-0001");
    const storedCheckout = provider.lastCheckoutRequestId;
    provider.queryResult = {
      merchantRequestId: "merchant-conflict",
      checkoutRequestId: "checkout-conflict",
      resultCode: 0,
      resultDescription: "Processed successfully",
    };

    const response = await refresh(owner.cookie, owner.orderId);

    expect(provider.queries).toEqual([storedCheckout]);
    expect(
      response.json<{ payment: { orderStatus: string; paymentStatus: string } }>().payment,
    ).toMatchObject({ orderStatus: "PENDING_PAYMENT", paymentStatus: "REVIEW_REQUIRED" });
  });

  it("keeps transport-ambiguous queries blocking and non-successful", async () => {
    const owner = await ownerWithOrder("payment-query-timeout@example.com");
    await initiate(owner.cookie, owner.orderId, "query-timeout-key-0001");
    provider.queryError = new MpesaProviderError("timeout", { ambiguous: true });

    const response = await refresh(owner.cookie, owner.orderId);
    const retry = await initiate(owner.cookie, owner.orderId, "query-timeout-key-0002");

    expect(
      response.json<{ payment: { orderStatus: string; paymentStatus: string } }>().payment,
    ).toMatchObject({ orderStatus: "PENDING_PAYMENT", paymentStatus: "UNKNOWN" });
    expect(retry.statusCode).toBe(409);
  });

  it("marks PAID only after a successful stored-ID provider query and rejects a second payment", async () => {
    const owner = await ownerWithOrder("payment-paid@example.com");
    await initiate(owner.cookie, owner.orderId, "paid-key-0001");
    provider.queryResult = queryResult(provider.lastCheckoutRequestId, 0);
    const refreshed = await refresh(owner.cookie, owner.orderId);
    const second = await initiate(owner.cookie, owner.orderId, "paid-key-0002");
    const forgedCancel = await post(
      `/api/v1/orders/${owner.orderId}/cancel`,
      { status: "PENDING_PAYMENT" },
      { cookie: owner.cookie },
    );

    expect(refreshed.json<{ payment: { orderStatus: string } }>().payment.orderStatus).toBe("PAID");
    expect(second.statusCode).toBe(400);
    expect(forgedCancel.statusCode).toBe(400);
  });

  it("keeps the order pending and blocks blind retry after an unknown non-success query", async () => {
    const owner = await ownerWithOrder("payment-query-failed@example.com");
    await initiate(owner.cookie, owner.orderId, "query-failed-key-0001");
    provider.queryResult = queryResult(provider.lastCheckoutRequestId, 1032);
    const refreshed = await refresh(owner.cookie, owner.orderId);

    expect(
      refreshed.json<{ payment: { orderStatus: string; paymentStatus: string } }>().payment,
    ).toMatchObject({ orderStatus: "PENDING_PAYMENT", paymentStatus: "UNKNOWN" });
    const retry = await initiate(owner.cookie, owner.orderId, "query-failed-key-0002");
    expect(retry.statusCode).toBe(409);
  });

  it("maintains paid, succeeded, and cancelled database invariants", async () => {
    const paid = await ownerWithOrder("payment-invariant-paid@example.com");
    await initiate(paid.cookie, paid.orderId, "invariant-paid-key-0001");
    provider.queryResult = queryResult(provider.lastCheckoutRequestId, 0);
    await refresh(paid.cookie, paid.orderId);

    const cancelled = await ownerWithOrder("payment-invariant-cancelled@example.com");
    const cancellation = await post(
      `/api/v1/orders/${cancelled.orderId}/cancel`,
      {},
      {
        cookie: cancelled.cookie,
      },
    );
    const invariants = await database.pool.query<{
      paid_is_valid: boolean;
      succeeded_is_valid: boolean;
      cancelled_is_valid: boolean;
    }>(`
      select
        not exists (
          select 1 from orders o
          where o.status = 'PAID'
            and (select count(*) from payment_attempts p where p.order_id = o.id and p.status = 'SUCCEEDED') <> 1
        ) as paid_is_valid,
        not exists (
          select 1 from payment_attempts p
          join orders o on o.id = p.order_id
          where p.status = 'SUCCEEDED' and o.status <> 'PAID'
        ) as succeeded_is_valid,
        not exists (
          select 1 from orders o
          join payment_attempts p on p.order_id = o.id
          where o.status = 'CANCELLED' and p.status = 'SUCCEEDED'
        ) as cancelled_is_valid
    `);

    expect(cancellation.statusCode).toBe(200);
    expect(invariants.rows[0]).toEqual({
      paid_is_valid: true,
      succeeded_is_valid: true,
      cancelled_is_valid: true,
    });
  });
});

class FakeMpesaProvider implements MpesaProvider {
  initiations: MpesaInitiationInput[] = [];
  queries: string[] = [];
  initiationError: MpesaProviderError | undefined;
  initiationGate: Promise<void> | undefined;
  initiationStarted = deferred<void>();
  queryResult: MpesaQueryResult = queryResult("checkout-1", 0);
  queryError: MpesaProviderError | undefined;
  queryGate: Promise<void> | undefined;
  queryStarted = deferred<void>();
  lastCheckoutRequestId = "";
  lastMerchantRequestId = "";

  reset(): void {
    this.initiations = [];
    this.queries = [];
    this.initiationError = undefined;
    this.initiationGate = undefined;
    this.initiationStarted = deferred<void>();
    this.queryResult = queryResult("checkout-1", 0);
    this.queryError = undefined;
    this.queryGate = undefined;
    this.queryStarted = deferred<void>();
    this.lastCheckoutRequestId = "";
    this.lastMerchantRequestId = "";
  }

  async initiate(input: MpesaInitiationInput) {
    this.initiations.push(input);
    const index = this.initiations.length;
    this.lastCheckoutRequestId = `checkout-${index}-${requestCounter}`;
    this.lastMerchantRequestId = `merchant-${index}-${requestCounter}`;
    this.initiationStarted.resolve();
    await this.initiationGate;
    if (this.initiationError) throw this.initiationError;
    return {
      merchantRequestId: this.lastMerchantRequestId,
      checkoutRequestId: this.lastCheckoutRequestId,
      responseCode: "0",
      responseDescription: "Accepted",
    };
  }

  async query(checkoutRequestId: string): Promise<MpesaQueryResult> {
    this.queries.push(checkoutRequestId);
    this.queryStarted.resolve();
    await this.queryGate;
    if (this.queryError) throw this.queryError;
    return { ...this.queryResult };
  }
}

async function ownerWithOrder(email: string) {
  const cookie = await createVerifiedSession(email);
  const response = await post(
    "/api/v1/orders",
    { items: [{ productId: approvedProduct.catalogKey, quantity: 1 }] },
    { cookie, idempotencyKey: `order-${email.replace(/[^a-z0-9]/gi, "-")}` },
  );
  expect(response.statusCode).toBe(201);
  return { cookie, orderId: response.json<{ order: { id: string } }>().order.id };
}

async function createVerifiedSession(email: string): Promise<string> {
  const registration = await post("/api/auth/sign-up/email", {
    name: "Payment Customer",
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

function initiate(
  cookie: string,
  orderId: string,
  idempotencyKey: string,
  phone = "0712345678",
): Promise<InjectResponse> {
  return post(`/api/v1/orders/${orderId}/payments/mpesa`, { phone }, { cookie, idempotencyKey });
}

function getPayment(cookie: string, orderId: string): Promise<InjectResponse> {
  return app.inject({
    method: "GET",
    url: `/api/v1/orders/${orderId}/payment`,
    headers: { cookie },
  });
}

function refresh(cookie: string, orderId: string): Promise<InjectResponse> {
  return post(`/api/v1/orders/${orderId}/payments/mpesa/refresh`, {}, { cookie });
}

function callback(url: string, payload: Record<string, unknown>): Promise<InjectResponse> {
  return app.inject({ method: "POST", url: new URL(url).pathname, payload });
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
      "x-real-ip": `203.0.113.${requestCounter % 250}`,
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    payload,
  });
}

function successCallback(
  checkoutRequestId: string,
  items: Array<{ Name: string; Value: string | number }>,
  merchantRequestId = providerMerchantId(),
) {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: { Item: items },
      },
    },
  };
}

function failureCallback(checkoutRequestId: string, merchantRequestId = providerMerchantId()) {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResultCode: 1032,
        ResultDesc: "Request cancelled by user",
      },
    },
  };
}

function providerMerchantId(): string {
  return provider.lastMerchantRequestId;
}

function queryResult(checkoutRequestId: string, resultCode: number): MpesaQueryResult {
  return {
    checkoutRequestId,
    resultCode,
    resultDescription: resultCode === 0 ? "Processed successfully" : "Not successful",
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
}
