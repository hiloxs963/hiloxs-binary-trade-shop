import { resolve } from "node:path";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { restoreInitialCatalog } from "./helpers.js";
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
import { user } from "../../src/db/schema/auth.js";
import { sellerApplications } from "../../src/db/schema/sellers.js";
import { SELLER_TERMS_VERSION } from "../../src/sellers/model.js";
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
    'truncate table "seller_applications", "verification", "session", "account", "user" cascade',
  );
  await restoreInitialCatalog(database);
  emailSender.messages.length = 0;
});

afterAll(async () => {
  await app.close();
});

describe("seller application authorization and state", () => {
  it("requires an active authenticated account", async () => {
    const anonymousRead = await app.inject({ method: "GET", url: "/api/v1/seller/application" });
    const anonymousCreate = await post("/api/v1/seller/application", companyDraft());

    expect(anonymousRead.statusCode).toBe(401);
    expect(anonymousCreate.statusCode).toBe(401);
  });

  it.each(["SUSPENDED", "DISABLED"] as const)("denies %s accounts", async (status) => {
    const email = `seller-${status.toLowerCase()}@example.com`;
    const cookie = await createVerifiedSession(email);
    await database.db.update(user).set({ status }).where(eq(user.email, email));

    const read = await get("/api/v1/seller/application", cookie);
    const create = await post("/api/v1/seller/application", companyDraft(), { cookie });

    expect(read.statusCode).toBe(401);
    expect(create.statusCode).toBe(401);
  });

  it("creates one safe DRAFT from authenticated identity only", async () => {
    const cookie = await createVerifiedSession("seller-create@example.com");
    const response = await post("/api/v1/seller/application", companyDraft(), { cookie });
    const body = response.json<{ application: SellerApplicationResponse }>().application;
    const rows = await database.db.select().from(sellerApplications);

    expect(response.statusCode).toBe(201);
    expect(body).toMatchObject({
      status: "DRAFT",
      sellerType: "COMPANY",
      legalName: "Example Holdings Limited",
      registrationNumber: "PVT-ABC/123",
      kraPin: "P123456789Z",
      termsVersion: null,
      submittedAt: null,
    });
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("phone");
    expect(body).not.toHaveProperty("reviewerId");
    expect(Object.keys(body).sort()).toEqual(
      [
        "createdAt",
        "id",
        "kraPin",
        "legalName",
        "registrationNumber",
        "reviewReason",
        "reviewedAt",
        "sellerType",
        "status",
        "submittedAt",
        "termsAcceptedAt",
        "termsVersion",
        "tradingName",
        "updatedAt",
      ].sort(),
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects browser-owned and unknown application fields", async () => {
    const cookie = await createVerifiedSession("seller-injection@example.com");
    for (const field of ["userId", "status", "reviewReason", "reviewedAt"]) {
      const response = await post(
        "/api/v1/seller/application",
        { ...companyDraft(), [field]: field === "status" ? "APPROVED" : "injected" },
        { cookie },
      );
      expect(response.statusCode).toBe(400);
    }
    const rows = await database.db.select({ value: count() }).from(sellerApplications);
    expect(rows[0]?.value).toBe(0);
  });

  it("uses database uniqueness to allow one logical application during concurrent creation", async () => {
    const cookie = await createVerifiedSession("seller-concurrent-create@example.com");
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        post("/api/v1/seller/application", companyDraft(), { cookie }),
      ),
    );
    const rows = await database.db.select({ value: count() }).from(sellerApplications);

    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(4);
    expect(rows[0]?.value).toBe(1);
  });

  it("does not expose or mutate another user's application", async () => {
    const ownerCookie = await createVerifiedSession("seller-owner@example.com");
    const otherCookie = await createVerifiedSession("seller-other@example.com");
    await post("/api/v1/seller/application", companyDraft(), { cookie: ownerCookie });

    const otherRead = await get("/api/v1/seller/application", otherCookie);
    const otherEdit = await post("/api/v1/seller/application/edit", companyDraft(), {
      cookie: otherCookie,
    });
    const injectedId = await post(
      "/api/v1/seller/application/edit",
      { ...companyDraft(), applicationId: "00000000-0000-4000-8000-000000000001" },
      { cookie: otherCookie },
    );

    expect(otherRead.statusCode).toBe(200);
    expect(otherRead.json()).toEqual({
      application: null,
      termsVersion: SELLER_TERMS_VERSION,
    });
    expect(otherEdit.statusCode).toBe(404);
    expect(injectedId.statusCode).toBe(400);
  });

  it("requires a trusted Origin on every write", async () => {
    const cookie = await createVerifiedSession("seller-origin@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/seller/application",
      headers: { cookie, "content-type": "application/json" },
      payload: companyDraft(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("edits only DRAFT applications", async () => {
    const cookie = await createVerifiedSession("seller-edit@example.com");
    await post("/api/v1/seller/application", companyDraft(), { cookie });
    const edited = await post(
      "/api/v1/seller/application/edit",
      { ...companyDraft(), legalName: "Updated Holdings Limited", tradingName: "Updated Market" },
      { cookie },
    );

    expect(edited.statusCode).toBe(200);
    expect(edited.json<{ application: SellerApplicationResponse }>().application).toMatchObject({
      status: "DRAFT",
      legalName: "Updated Holdings Limited",
      tradingName: "Updated Market",
    });
  });

  it("atomically submits a complete DRAFT and treats exact repeated submission predictably", async () => {
    const cookie = await createVerifiedSession("seller-submit@example.com");
    await post("/api/v1/seller/application", companyDraft(), { cookie });
    const first = await submit(cookie);
    const repeated = await submit(cookie);
    const edit = await post("/api/v1/seller/application/edit", companyDraft(), { cookie });
    const firstBody = first.json<{ application: SellerApplicationResponse }>().application;
    const repeatedBody = repeated.json<{ application: SellerApplicationResponse }>().application;

    expect(first.statusCode).toBe(200);
    expect(firstBody.status).toBe("SUBMITTED");
    expect(firstBody.termsVersion).toBe(SELLER_TERMS_VERSION);
    expect(firstBody.termsAcceptedAt).toBeTruthy();
    expect(firstBody.submittedAt).toBeTruthy();
    expect(repeated.statusCode).toBe(200);
    expect(repeatedBody.termsAcceptedAt).toBe(firstBody.termsAcceptedAt);
    expect(edit.statusCode).toBe(409);
  });

  it("rejects incomplete submission, missing consent, old terms, and extra fields", async () => {
    const cookie = await createVerifiedSession("seller-submit-validation@example.com");
    await post(
      "/api/v1/seller/application",
      { sellerType: "COMPANY", legalName: "Incomplete Limited" },
      { cookie },
    );

    const incomplete = await submit(cookie);
    const missingConsent = await post(
      "/api/v1/seller/application/submit",
      { termsVersion: SELLER_TERMS_VERSION },
      { cookie },
    );
    const oldTerms = await post(
      "/api/v1/seller/application/submit",
      { termsAccepted: true, termsVersion: "seller-terms-v0" },
      { cookie },
    );
    const injected = await post(
      "/api/v1/seller/application/submit",
      { termsAccepted: true, termsVersion: SELLER_TERMS_VERSION, status: "APPROVED" },
      { cookie },
    );
    const stored = await get("/api/v1/seller/application", cookie);

    expect(incomplete.statusCode).toBe(400);
    expect(missingConsent.statusCode).toBe(400);
    expect(oldTerms.statusCode).toBe(400);
    expect(injected.statusCode).toBe(400);
    expect(stored.json<{ application: SellerApplicationResponse }>().application.status).toBe(
      "DRAFT",
    );
  });

  it("serializes simultaneous submissions into one unchanged submission", async () => {
    const cookie = await createVerifiedSession("seller-concurrent-submit@example.com");
    await post("/api/v1/seller/application", companyDraft(), { cookie });

    const responses = await Promise.all([submit(cookie), submit(cookie)]);
    const applications = responses.map(
      (response) => response.json<{ application: SellerApplicationResponse }>().application,
    );
    const rows = await database.db.select().from(sellerApplications);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(new Set(applications.map((application) => application.submittedAt)).size).toBe(1);
    expect(new Set(applications.map((application) => application.termsAcceptedAt)).size).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("SUBMITTED");
  });

  it("withdraws DRAFT or SUBMITTED applications and makes withdrawal idempotent", async () => {
    const draftCookie = await createVerifiedSession("seller-withdraw-draft@example.com");
    await post("/api/v1/seller/application", companyDraft(), { cookie: draftCookie });
    const draftWithdrawal = await withdraw(draftCookie);
    const repeated = await withdraw(draftCookie);

    const submittedCookie = await createVerifiedSession("seller-withdraw-submitted@example.com");
    await post("/api/v1/seller/application", companyDraft(), { cookie: submittedCookie });
    await submit(submittedCookie);
    const submittedWithdrawal = await withdraw(submittedCookie);

    expect(
      draftWithdrawal.json<{ application: SellerApplicationResponse }>().application.status,
    ).toBe("WITHDRAWN");
    expect(repeated.statusCode).toBe(200);
    expect(
      submittedWithdrawal.json<{ application: SellerApplicationResponse }>().application.status,
    ).toBe("WITHDRAWN");
  });

  it("keeps review authority internal and APPROVED applications immutable to applicants", async () => {
    const cookie = await createVerifiedSession("seller-approved@example.com");
    const created = await post("/api/v1/seller/application", companyDraft(), { cookie });
    const applicationId = created.json<{ application: SellerApplicationResponse }>().application.id;
    await submit(cookie);
    await startSellerApplicationReview(database, applicationId);
    const underReviewEdit = await post("/api/v1/seller/application/edit", companyDraft(), {
      cookie,
    });
    const underReviewWithdrawal = await withdraw(cookie);
    await approveSellerApplication(database, applicationId);

    const read = await get("/api/v1/seller/application", cookie);
    const edit = await post("/api/v1/seller/application/edit", companyDraft(), { cookie });
    const withdrawal = await withdraw(cookie);
    const profileTable = await database.pool.query<{ name: string | null }>(
      "select to_regclass('public.seller_profiles')::text as name",
    );

    expect(read.json<{ application: SellerApplicationResponse }>().application).toMatchObject({
      status: "APPROVED",
      reviewReason: null,
    });
    expect(underReviewEdit.statusCode).toBe(409);
    expect(underReviewWithdrawal.statusCode).toBe(409);
    expect(edit.statusCode).toBe(409);
    expect(withdrawal.statusCode).toBe(409);
    expect(profileTable.rows[0]?.name).toBeNull();
  });

  it("returns only a safe rejection reason and keeps REJECTED immutable", async () => {
    const cookie = await createVerifiedSession("seller-rejected@example.com");
    const created = await post("/api/v1/seller/application", companyDraft(), { cookie });
    const applicationId = created.json<{ application: SellerApplicationResponse }>().application.id;
    await submit(cookie);
    await startSellerApplicationReview(database, applicationId);
    await rejectSellerApplication(database, applicationId, "Registration details need correction");

    const read = await get("/api/v1/seller/application", cookie);
    const edit = await post("/api/v1/seller/application/edit", companyDraft(), { cookie });
    const withdrawal = await withdraw(cookie);

    expect(read.json<{ application: SellerApplicationResponse }>().application).toMatchObject({
      status: "REJECTED",
      reviewReason: "Registration details need correction",
    });
    expect(read.body).not.toContain("reviewerId");
    expect(edit.statusCode).toBe(409);
    expect(withdrawal.statusCode).toBe(409);
  });

  it("serializes concurrent edit and submit without producing an invalid state", async () => {
    const cookie = await createVerifiedSession("seller-submit-edit-race@example.com");
    await post("/api/v1/seller/application", companyDraft(), { cookie });

    const [edit, submission] = await Promise.all([
      post(
        "/api/v1/seller/application/edit",
        { ...companyDraft(), legalName: "Concurrent Updated Limited" },
        { cookie },
      ),
      submit(cookie),
    ]);
    const final = await get("/api/v1/seller/application", cookie);
    const application = final.json<{ application: SellerApplicationResponse }>().application;

    expect(submission.statusCode).toBe(200);
    expect([200, 409]).toContain(edit.statusCode);
    expect(application.status).toBe("SUBMITTED");
    expect(application.termsAcceptedAt).toBeTruthy();
    expect(application.submittedAt).toBeTruthy();
    expect(["Example Holdings Limited", "Concurrent Updated Limited"]).toContain(
      application.legalName,
    );
  });

  it("serializes withdrawal racing submission into a valid terminal state", async () => {
    const cookie = await createVerifiedSession("seller-submit-withdraw-race@example.com");
    await post("/api/v1/seller/application", companyDraft(), { cookie });

    const [submission, withdrawal] = await Promise.all([submit(cookie), withdraw(cookie)]);
    const final = await get("/api/v1/seller/application", cookie);
    const application = final.json<{ application: SellerApplicationResponse }>().application;

    expect([200, 409]).toContain(submission.statusCode);
    expect(withdrawal.statusCode).toBe(200);
    expect(application.status).toBe("WITHDRAWN");
    expect([null, SELLER_TERMS_VERSION]).toContain(application.termsVersion);
    if (application.termsVersion === null) {
      expect(application.termsAcceptedAt).toBeNull();
      expect(application.submittedAt).toBeNull();
    } else {
      expect(application.termsAcceptedAt).toBeTruthy();
      expect(application.submittedAt).toBeTruthy();
    }
  });
});

type SellerApplicationResponse = {
  id: string;
  sellerType: string;
  legalName: string;
  tradingName: string | null;
  registrationNumber: string | null;
  kraPin: string | null;
  status: string;
  reviewReason: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function companyDraft(): Record<string, unknown> {
  return {
    sellerType: "COMPANY",
    legalName: "Example Holdings Limited",
    tradingName: "Example Market",
    registrationNumber: "PVT-ABC/123",
    kraPin: "P123456789Z",
  };
}

function submit(cookie: string): Promise<InjectResponse> {
  return post(
    "/api/v1/seller/application/submit",
    { termsAccepted: true, termsVersion: SELLER_TERMS_VERSION },
    { cookie },
  );
}

function withdraw(cookie: string): Promise<InjectResponse> {
  return post("/api/v1/seller/application/withdraw", {}, { cookie });
}

async function createVerifiedSession(email: string): Promise<string> {
  const registration = await post("/api/auth/sign-up/email", {
    name: "Seller Applicant",
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
  options: { cookie?: string } = {},
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
    },
    payload,
  });
}

function get(url: string, cookie: string): Promise<InjectResponse> {
  return app.inject({ method: "GET", url, headers: { cookie } });
}
