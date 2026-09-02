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
import { products } from "../../src/db/schema/commerce.js";
import { sellerProductSubmissions } from "../../src/db/schema/seller-products.js";
import {
  SELLER_PRODUCT_TERMS_VERSION,
  type SellerProductStatus,
} from "../../src/seller-products/model.js";
import {
  approveSellerProduct,
  rejectSellerProduct,
  startSellerProductReview,
} from "../../src/seller-products/review-service.js";
import { SELLER_TERMS_VERSION, type SellerApplicationStatus } from "../../src/sellers/model.js";
import {
  approveSellerApplication,
  rejectSellerApplication,
  startSellerApplicationReview,
} from "../../src/sellers/review-service.js";

const FRONTEND_ORIGIN = "http://localhost:8080";
const PASSWORD = "StrongPassword!42";
const env = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(env);
assertSafeTestDatabaseUrl(databaseUrl, env.NODE_ENV);

let app: FastifyInstance;
let database: DatabaseClient;
let requestCounter = 0;
const emailSender = new InMemoryAuthEmailSender();

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
    'truncate table "seller_product_submissions", "seller_applications", "verification", "session", "account", "user" cascade',
  );
  emailSender.messages.length = 0;
});

afterAll(async () => {
  await app.close();
});

describe("seller product authorization", () => {
  it("requires authentication", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/seller/products" });
    const create = await post("/api/v1/seller/products", productDraft());

    expect(list.statusCode).toBe(401);
    expect(create.statusCode).toBe(401);
  });

  it("returns SELLER_NOT_APPROVED when the active user has no application", async () => {
    const { cookie } = await sellerAccount("product-no-application@example.com");
    const response = await get("/api/v1/seller/products", cookie);

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("SELLER_NOT_APPROVED");
  });

  it.each(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "REJECTED", "WITHDRAWN"] as const)(
    "blocks a seller application in %s",
    async (status) => {
      const { cookie } = await sellerWithApplication(
        `product-unapproved-${status.toLowerCase()}@example.com`,
        status,
      );
      const response = await get("/api/v1/seller/products", cookie);

      expect(response.statusCode).toBe(403);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("SELLER_NOT_APPROVED");
    },
  );

  it.each(["SUSPENDED", "DISABLED"] as const)("blocks %s accounts", async (status) => {
    const email = `product-${status.toLowerCase()}@example.com`;
    const { cookie } = await sellerWithApplication(email, "APPROVED");
    await database.db.update(user).set({ status }).where(eq(user.email, email));

    const response = await get("/api/v1/seller/products", cookie);
    expect(response.statusCode).toBe(401);
  });

  it("creates a safe DRAFT from session-owned seller identity", async () => {
    const { cookie, applicationId } = await sellerWithApplication(
      "product-create@example.com",
      "APPROVED",
    );
    const response = await post("/api/v1/seller/products", productDraft(), { cookie });
    const body = response.json<ProductResponse>();
    const [row] = await database.db.select().from(sellerProductSubmissions);

    expect(response.statusCode).toBe(201);
    expect(body.termsVersion).toBe(SELLER_PRODUCT_TERMS_VERSION);
    expect(body.submission).toMatchObject({
      name: "Handcrafted Desk Lamp",
      category: "Home & Kitchen",
      description: "A carefully described lamp for a home workspace.",
      priceMinor: "289900",
      currency: "KES",
      status: "DRAFT",
      termsVersion: null,
    });
    expect(Object.keys(body.submission).sort()).toEqual(SAFE_RESPONSE_FIELDS);
    expect(body.submission).not.toHaveProperty("sellerApplicationId");
    expect(body.submission).not.toHaveProperty("kraPin");
    expect(body.submission).not.toHaveProperty("email");
    expect(row?.sellerApplicationId).toBe(applicationId);
  });

  it("rejects browser-owned identity, lifecycle, media, and inventory fields", async () => {
    const { cookie } = await sellerWithApplication("product-injection@example.com", "APPROVED");
    for (const field of [
      "userId",
      "sellerApplicationId",
      "status",
      "reviewReason",
      "reviewedAt",
      "termsAcceptedAt",
      "imageUrl",
      "stock",
      "payoutAccount",
    ]) {
      const response = await post(
        "/api/v1/seller/products",
        { ...productDraft(), [field]: field === "status" ? "APPROVED" : "injected" },
        { cookie },
      );
      expect(response.statusCode).toBe(400);
    }
    const rows = await database.db.select({ value: count() }).from(sellerProductSubmissions);
    expect(rows[0]?.value).toBe(0);
  });

  it("requires a trusted Origin on writes", async () => {
    const { cookie } = await sellerWithApplication("product-origin@example.com", "APPROVED");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/seller/products",
      headers: { cookie, "content-type": "application/json" },
      payload: productDraft(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("does not enumerate or mutate another seller's submission", async () => {
    const owner = await sellerWithApplication("product-owner@example.com", "APPROVED");
    const other = await sellerWithApplication("product-other@example.com", "APPROVED");
    const created = await createProduct(owner.cookie);
    const submissionId = created.submission.id;
    const foreignDetail = await get(`/api/v1/seller/products/${submissionId}`, other.cookie);
    const missingDetail = await get(
      "/api/v1/seller/products/00000000-0000-4000-8000-000000000001",
      other.cookie,
    );
    const foreignEdit = await post(`/api/v1/seller/products/${submissionId}/edit`, productDraft(), {
      cookie: other.cookie,
    });

    expect(foreignDetail.statusCode).toBe(404);
    expect(missingDetail.statusCode).toBe(404);
    const foreignError = foreignDetail.json<{ error: { code: string; message: string } }>().error;
    const missingError = missingDetail.json<{ error: { code: string; message: string } }>().error;
    expect({ code: foreignError.code, message: foreignError.message }).toEqual({
      code: missingError.code,
      message: missingError.message,
    });
    expect(foreignEdit.statusCode).toBe(404);
  });

  it("lists only the current seller's submissions in a bounded newest-first result", async () => {
    const owner = await sellerWithApplication("product-list-owner@example.com", "APPROVED");
    const other = await sellerWithApplication("product-list-other@example.com", "APPROVED");
    await database.db.insert(sellerProductSubmissions).values(
      Array.from({ length: 52 }, (_, index) => ({
        sellerApplicationId: owner.applicationId,
        ...storedProduct(`Owner Product ${index.toString().padStart(2, "0")}`),
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      })),
    );
    await database.db
      .insert(sellerProductSubmissions)
      .values({ sellerApplicationId: other.applicationId, ...storedProduct("Foreign Product") });

    const response = await get("/api/v1/seller/products", owner.cookie);
    const submissions = response.json<{ submissions: ProductSubmission[] }>().submissions;

    expect(response.statusCode).toBe(200);
    expect(submissions).toHaveLength(50);
    expect(submissions[0]?.name).toBe("Owner Product 51");
    expect(submissions.every((submission) => submission.name.startsWith("Owner Product"))).toBe(
      true,
    );
  });
});

describe("seller product applicant lifecycle", () => {
  it("edits only DRAFT submissions", async () => {
    const seller = await sellerWithApplication("product-edit@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    const edited = await editProduct(seller.cookie, created.submission.id, {
      ...productDraft(),
      name: "Updated Desk Lamp",
      priceMinor: "300000",
    });

    expect(edited.statusCode).toBe(200);
    expect(edited.json<ProductResponse>().submission).toMatchObject({
      status: "DRAFT",
      name: "Updated Desk Lamp",
      priceMinor: "300000",
    });
  });

  it("submits atomically and makes exact repeated submission idempotent", async () => {
    const seller = await sellerWithApplication("product-submit@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    const first = await submitProduct(seller.cookie, created.submission.id);
    const repeated = await submitProduct(seller.cookie, created.submission.id);
    const firstBody = first.json<ProductResponse>().submission;
    const repeatedBody = repeated.json<ProductResponse>().submission;

    expect(first.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(firstBody.status).toBe("SUBMITTED");
    expect(firstBody.termsVersion).toBe(SELLER_PRODUCT_TERMS_VERSION);
    expect(repeatedBody.submittedAt).toBe(firstBody.submittedAt);
    expect(repeatedBody.termsAcceptedAt).toBe(firstBody.termsAcceptedAt);
    expect(repeatedBody.updatedAt).toBe(firstBody.updatedAt);
  });

  it("rejects missing, false, old, and browser-extended consent", async () => {
    const seller = await sellerWithApplication("product-consent@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    const path = `/api/v1/seller/products/${created.submission.id}/submit`;
    const responses = await Promise.all([
      post(path, {}, { cookie: seller.cookie }),
      post(
        path,
        { termsAccepted: false, termsVersion: SELLER_PRODUCT_TERMS_VERSION },
        { cookie: seller.cookie },
      ),
      post(
        path,
        { termsAccepted: true, termsVersion: "seller-product-terms-v0" },
        { cookie: seller.cookie },
      ),
      post(
        path,
        {
          termsAccepted: true,
          termsVersion: SELLER_PRODUCT_TERMS_VERSION,
          status: "APPROVED",
        },
        { cookie: seller.cookie },
      ),
    ]);
    const detail = await get(`/api/v1/seller/products/${created.submission.id}`, seller.cookie);

    expect(responses.every((response) => response.statusCode === 400)).toBe(true);
    expect(detail.json<ProductResponse>().submission.status).toBe("DRAFT");
  });

  it("withdraws DRAFT or SUBMITTED and makes repeated withdrawal idempotent", async () => {
    const seller = await sellerWithApplication("product-withdraw@example.com", "APPROVED");
    const draft = await createProduct(seller.cookie);
    const draftWithdrawal = await withdrawProduct(seller.cookie, draft.submission.id);
    const repeated = await withdrawProduct(seller.cookie, draft.submission.id);
    const withdrawnEdit = await editProduct(seller.cookie, draft.submission.id);
    const withdrawnSubmit = await submitProduct(seller.cookie, draft.submission.id);
    const submitted = await createProduct(seller.cookie, {
      ...productDraft(),
      name: "Second Product Submission",
    });
    await submitProduct(seller.cookie, submitted.submission.id);
    const submittedWithdrawal = await withdrawProduct(seller.cookie, submitted.submission.id);

    expect(draftWithdrawal.json<ProductResponse>().submission.status).toBe("WITHDRAWN");
    expect(repeated.json<ProductResponse>().submission.updatedAt).toBe(
      draftWithdrawal.json<ProductResponse>().submission.updatedAt,
    );
    expect(withdrawnEdit.statusCode).toBe(409);
    expect(withdrawnSubmit.statusCode).toBe(409);
    expect(submittedWithdrawal.json<ProductResponse>().submission.status).toBe("WITHDRAWN");
  });

  it("keeps immutable states applicant-immutable and exposes only safe rejection reasons", async () => {
    const seller = await sellerWithApplication("product-review-state@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    await submitProduct(seller.cookie, created.submission.id);
    const submittedEdit = await editProduct(seller.cookie, created.submission.id);
    await startSellerProductReview(database, created.submission.id);
    const reviewEdit = await editProduct(seller.cookie, created.submission.id);
    const reviewSubmit = await submitProduct(seller.cookie, created.submission.id);
    const reviewWithdraw = await withdrawProduct(seller.cookie, created.submission.id);
    await rejectSellerProduct(database, created.submission.id, "Listing details need correction");
    const rejected = await get(`/api/v1/seller/products/${created.submission.id}`, seller.cookie);
    const rejectedEdit = await editProduct(seller.cookie, created.submission.id);
    const rejectedSubmit = await submitProduct(seller.cookie, created.submission.id);
    const rejectedWithdraw = await withdrawProduct(seller.cookie, created.submission.id);

    expect(submittedEdit.statusCode).toBe(409);
    expect(reviewEdit.statusCode).toBe(409);
    expect(reviewSubmit.statusCode).toBe(409);
    expect(reviewWithdraw.statusCode).toBe(409);
    expect(rejectedEdit.statusCode).toBe(409);
    expect(rejectedSubmit.statusCode).toBe(409);
    expect(rejectedWithdraw.statusCode).toBe(409);
    expect(rejected.json<ProductResponse>().submission).toMatchObject({
      status: "REJECTED",
      reviewReason: "Listing details need correction",
    });
    expect(Object.keys(rejected.json<ProductResponse>().submission).sort()).toEqual(
      SAFE_RESPONSE_FIELDS,
    );
  });

  it("preserves terminal history while allowing new independent drafts", async () => {
    const seller = await sellerWithApplication("product-history@example.com", "APPROVED");
    const withdrawn = await createProduct(seller.cookie);
    await withdrawProduct(seller.cookie, withdrawn.submission.id);
    const rejected = await createProduct(seller.cookie, {
      ...productDraft(),
      name: "Rejected Historical Product",
    });
    await submitProduct(seller.cookie, rejected.submission.id);
    await startSellerProductReview(database, rejected.submission.id);
    await rejectSellerProduct(database, rejected.submission.id, "Listing cannot be approved");
    const current = await createProduct(seller.cookie, {
      ...productDraft(),
      name: "New Independent Draft",
    });
    const list = await get("/api/v1/seller/products", seller.cookie);
    const statuses = list
      .json<{ submissions: ProductSubmission[] }>()
      .submissions.map((submission) => submission.status);

    expect(current.submission.status).toBe("DRAFT");
    expect(statuses).toEqual(expect.arrayContaining(["DRAFT", "REJECTED", "WITHDRAWN"]));
  });
});

describe("seller product review and concurrency", () => {
  it("supports internal-only review transitions without any reviewer HTTP route", async () => {
    const seller = await sellerWithApplication("product-approve@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    await submitProduct(seller.cookie, created.submission.id);
    await startSellerProductReview(database, created.submission.id);
    await approveSellerProduct(database, created.submission.id);
    const detail = await get(`/api/v1/seller/products/${created.submission.id}`, seller.cookie);
    const guessedAdminRoute = await post(
      `/api/v1/seller/products/${created.submission.id}/approve`,
      {},
      { cookie: seller.cookie },
    );

    expect(detail.json<ProductResponse>().submission).toMatchObject({
      status: "APPROVED",
      reviewReason: null,
    });
    expect(guessedAdminRoute.statusCode).toBe(404);
    expect(await editProduct(seller.cookie, created.submission.id)).toHaveProperty(
      "statusCode",
      409,
    );
    expect(await submitProduct(seller.cookie, created.submission.id)).toHaveProperty(
      "statusCode",
      409,
    );
    expect(await withdrawProduct(seller.cookie, created.submission.id)).toHaveProperty(
      "statusCode",
      409,
    );
  });

  it("allows only one of two simultaneous start-review operations", async () => {
    const seller = await sellerWithApplication("product-double-review@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    await submitProduct(seller.cookie, created.submission.id);
    const results = await Promise.allSettled([
      startSellerProductReview(database, created.submission.id),
      startSellerProductReview(database, created.submission.id),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const detail = await get(`/api/v1/seller/products/${created.submission.id}`, seller.cookie);
    expect(detail.json<ProductResponse>().submission.status).toBe("UNDER_REVIEW");
  });

  it("serializes edit racing submit", async () => {
    const seller = await sellerWithApplication("product-edit-submit@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    const [edit, submission] = await Promise.all([
      editProduct(seller.cookie, created.submission.id, {
        ...productDraft(),
        name: "Concurrently Updated Product",
      }),
      submitProduct(seller.cookie, created.submission.id),
    ]);
    const final = await get(`/api/v1/seller/products/${created.submission.id}`, seller.cookie);
    const product = final.json<ProductResponse>().submission;

    expect(submission.statusCode).toBe(200);
    expect([200, 409]).toContain(edit.statusCode);
    expect(product.status).toBe("SUBMITTED");
    expect(["Handcrafted Desk Lamp", "Concurrently Updated Product"]).toContain(product.name);
  });

  it("serializes two simultaneous submits without changing timestamps", async () => {
    const seller = await sellerWithApplication("product-double-submit@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    const responses = await Promise.all([
      submitProduct(seller.cookie, created.submission.id),
      submitProduct(seller.cookie, created.submission.id),
    ]);
    const submissions = responses.map((response) => response.json<ProductResponse>().submission);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(new Set(submissions.map((submission) => submission.submittedAt)).size).toBe(1);
    expect(new Set(submissions.map((submission) => submission.termsAcceptedAt)).size).toBe(1);
  });

  it("serializes submit racing withdraw into WITHDRAWN", async () => {
    const seller = await sellerWithApplication("product-submit-withdraw@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    const [submission, withdrawal] = await Promise.all([
      submitProduct(seller.cookie, created.submission.id),
      withdrawProduct(seller.cookie, created.submission.id),
    ]);
    const final = await get(`/api/v1/seller/products/${created.submission.id}`, seller.cookie);

    expect([200, 409]).toContain(submission.statusCode);
    expect(withdrawal.statusCode).toBe(200);
    expect(final.json<ProductResponse>().submission.status).toBe("WITHDRAWN");
  });

  it("serializes start-review racing withdrawal", async () => {
    const seller = await sellerWithApplication("product-review-withdraw@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    await submitProduct(seller.cookie, created.submission.id);
    const [review, withdrawal] = await Promise.allSettled([
      startSellerProductReview(database, created.submission.id),
      withdrawProduct(seller.cookie, created.submission.id),
    ]);
    const [row] = await database.db
      .select()
      .from(sellerProductSubmissions)
      .where(eq(sellerProductSubmissions.id, created.submission.id));

    expect(["UNDER_REVIEW", "WITHDRAWN"]).toContain(row?.status);
    if (row?.status === "UNDER_REVIEW") {
      expect(review.status).toBe("fulfilled");
      expect(withdrawal.status === "fulfilled" && withdrawal.value.statusCode).toBe(409);
    } else {
      expect(review.status).toBe("rejected");
      expect(withdrawal.status === "fulfilled" && withdrawal.value.statusCode).toBe(200);
    }
  });

  it("serializes approve racing reject into one final review result", async () => {
    const seller = await sellerWithApplication("product-approve-reject@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    await submitProduct(seller.cookie, created.submission.id);
    await startSellerProductReview(database, created.submission.id);
    const results = await Promise.allSettled([
      approveSellerProduct(database, created.submission.id),
      rejectSellerProduct(database, created.submission.id, "Applicant-safe rejection reason"),
    ]);
    const [row] = await database.db
      .select()
      .from(sellerProductSubmissions)
      .where(eq(sellerProductSubmissions.id, created.submission.id));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(["APPROVED", "REJECTED"]).toContain(row?.status);
  });

  it("allows only one of two simultaneous approvals", async () => {
    const seller = await sellerWithApplication("product-double-approve@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    await submitProduct(seller.cookie, created.submission.id);
    await startSellerProductReview(database, created.submission.id);
    const results = await Promise.allSettled([
      approveSellerProduct(database, created.submission.id),
      approveSellerProduct(database, created.submission.id),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const detail = await get(`/api/v1/seller/products/${created.submission.id}`, seller.cookie);
    expect(detail.json<ProductResponse>().submission.status).toBe("APPROVED");
  });
});

describe("public catalog isolation", () => {
  it("does not publish or make an approved seller submission orderable", async () => {
    const before = await app.inject({ method: "GET", url: "/api/v1/products" });
    const beforeProducts = before.json<{ products: unknown[] }>().products;
    const seller = await sellerWithApplication("product-public-isolation@example.com", "APPROVED");
    const created = await createProduct(seller.cookie);
    await submitProduct(seller.cookie, created.submission.id);
    await startSellerProductReview(database, created.submission.id);
    await approveSellerProduct(database, created.submission.id);

    const after = await app.inject({ method: "GET", url: "/api/v1/products" });
    const publicRows = await database.db.select({ value: count() }).from(products);
    const quote = await post(
      "/api/v1/checkout/quote",
      { items: [{ productId: created.submission.id, quantity: 1 }] },
      { cookie: seller.cookie },
    );
    const order = await post(
      "/api/v1/orders",
      { items: [{ productId: created.submission.id, quantity: 1 }] },
      { cookie: seller.cookie, idempotencyKey: "seller-product-isolation-0001" },
    );

    expect(after.json<{ products: unknown[] }>().products).toEqual(beforeProducts);
    expect(beforeProducts).toHaveLength(INITIAL_CATALOG.length);
    expect(publicRows[0]?.value).toBe(INITIAL_CATALOG.length);
    expect(quote.statusCode).toBe(400);
    expect(order.statusCode).toBe(400);
  });
});

const SAFE_RESPONSE_FIELDS = [
  "category",
  "createdAt",
  "currency",
  "description",
  "id",
  "name",
  "priceMinor",
  "reviewReason",
  "reviewStartedAt",
  "reviewedAt",
  "status",
  "submittedAt",
  "termsAcceptedAt",
  "termsVersion",
  "updatedAt",
].sort();

type ProductSubmission = {
  id: string;
  name: string;
  category: string;
  description: string;
  priceMinor: string;
  currency: string;
  status: SellerProductStatus;
  reviewReason: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  submittedAt: string | null;
  reviewStartedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProductResponse = {
  submission: ProductSubmission;
  termsVersion: string;
};

function productDraft(): Record<string, unknown> {
  return {
    name: "Handcrafted Desk Lamp",
    category: "Home & Kitchen",
    description: "A carefully described lamp for a home workspace.",
    priceMinor: "289900",
  };
}

function storedProduct(name: string) {
  return {
    name,
    category: "Home & Kitchen" as const,
    description: "A carefully described product for a home workspace.",
    priceMinor: 289_900n,
    currency: "KES",
  };
}

async function createProduct(
  cookie: string,
  payload: Record<string, unknown> = productDraft(),
): Promise<ProductResponse> {
  const response = await post("/api/v1/seller/products", payload, { cookie });
  expect(response.statusCode).toBe(201);
  return response.json<ProductResponse>();
}

function editProduct(
  cookie: string,
  submissionId: string,
  payload: Record<string, unknown> = productDraft(),
): Promise<InjectResponse> {
  return post(`/api/v1/seller/products/${submissionId}/edit`, payload, { cookie });
}

function submitProduct(cookie: string, submissionId: string): Promise<InjectResponse> {
  return post(
    `/api/v1/seller/products/${submissionId}/submit`,
    { termsAccepted: true, termsVersion: SELLER_PRODUCT_TERMS_VERSION },
    { cookie },
  );
}

function withdrawProduct(cookie: string, submissionId: string): Promise<InjectResponse> {
  return post(`/api/v1/seller/products/${submissionId}/withdraw`, {}, { cookie });
}

async function sellerWithApplication(
  email: string,
  status: SellerApplicationStatus,
): Promise<{ cookie: string; applicationId: string }> {
  const account = await sellerAccount(email);
  const created = await post(
    "/api/v1/seller/application",
    {
      sellerType: "COMPANY",
      legalName: "Example Seller Limited",
      registrationNumber: "PVT-SELLER/123",
      kraPin: "P123456789Z",
    },
    { cookie: account.cookie },
  );
  expect(created.statusCode).toBe(201);
  const applicationId = created.json<{ application: { id: string } }>().application.id;
  if (status === "DRAFT") return { ...account, applicationId };
  if (status === "WITHDRAWN") {
    const withdrawn = await post(
      "/api/v1/seller/application/withdraw",
      {},
      { cookie: account.cookie },
    );
    expect(withdrawn.statusCode).toBe(200);
    return { ...account, applicationId };
  }
  const submitted = await post(
    "/api/v1/seller/application/submit",
    { termsAccepted: true, termsVersion: SELLER_TERMS_VERSION },
    { cookie: account.cookie },
  );
  expect(submitted.statusCode).toBe(200);
  if (status === "SUBMITTED") return { ...account, applicationId };
  await startSellerApplicationReview(database, applicationId);
  if (status === "UNDER_REVIEW") return { ...account, applicationId };
  if (status === "APPROVED") await approveSellerApplication(database, applicationId);
  else await rejectSellerApplication(database, applicationId, "Applicant-safe seller reason");
  return { ...account, applicationId };
}

async function sellerAccount(email: string): Promise<{ cookie: string }> {
  const registration = await post("/api/auth/sign-up/email", {
    name: "Product Seller",
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
  return {
    cookie: cookies.find((value) => value.includes("session_token"))?.split(";", 1)[0] ?? "",
  };
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
      "x-real-ip": `192.0.2.${requestCounter % 250}`,
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    payload,
  });
}

function get(url: string, cookie: string): Promise<InjectResponse> {
  return app.inject({ method: "GET", url, headers: { cookie } });
}
