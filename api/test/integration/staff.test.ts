import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { base32 } from "@better-auth/utils/base32";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService, type AuthService } from "../../src/auth/auth.js";
import { InMemoryAuthEmailSender } from "../../src/auth/email.js";
import {
  assertSafeTestDatabaseUrl,
  parseEnv,
  requireDatabaseUrl,
  resolveAuthRuntimeConfig,
} from "../../src/config/env.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { session, user } from "../../src/db/schema/auth.js";
import { products } from "../../src/db/schema/commerce.js";
import { sellerProductSubmissions } from "../../src/db/schema/seller-products.js";
import { sellerApplications } from "../../src/db/schema/sellers.js";
import {
  staffAuditEvents,
  staffMemberships,
  staffPermissionGrants,
  type StaffPermission,
  type StaffRole,
} from "../../src/db/schema/staff.js";
import {
  bootstrapStaffMembership,
  revokeStaffPermission,
} from "../../src/staff/bootstrap-service.js";

const ORIGIN = "http://localhost:8080";
const PASSWORD = "StrongPassword!42";
const env = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(env);
assertSafeTestDatabaseUrl(databaseUrl, env.NODE_ENV);

let app: FastifyInstance;
let disabledApp: FastifyInstance;
let database: DatabaseClient;
let disabledDatabase: DatabaseClient;
let auth: AuthService;
let requestCounter = 0;
const emailSender = new InMemoryAuthEmailSender();

beforeAll(async () => {
  database = createDatabaseClient(databaseUrl);
  await migrate(database.db, { migrationsFolder: resolve("src/db/migrations") });
  const runtime = resolveAuthRuntimeConfig(env);
  auth = createAuthService({ database, emailSender, runtime });
  app = await buildApp({
    database,
    auth,
    authRuntime: runtime,
    allowedOrigins: runtime.trustedOrigins,
    staffReviewEnabled: true,
  });

  disabledDatabase = createDatabaseClient(databaseUrl);
  const disabledAuth = createAuthService({ database: disabledDatabase, emailSender, runtime });
  disabledApp = await buildApp({
    database: disabledDatabase,
    auth: disabledAuth,
    authRuntime: runtime,
    allowedOrigins: runtime.trustedOrigins,
    staffReviewEnabled: false,
  });
});

beforeEach(async () => {
  await database.pool.query(
    'truncate table "staff_audit_events", "staff_permission_grants", "staff_memberships", "seller_product_submissions", "seller_applications", "payment_events", "payment_attempts", "order_items", "orders", "verification", "two_factor", "session", "account", "user" cascade',
  );
  emailSender.messages.length = 0;
});

afterAll(async () => {
  await disabledApp.close();
  await app.close();
});

describe("staff authorization and privacy", () => {
  it("requires authentication and returns one safe denial for nonstaff", async () => {
    const anonymous = await get("/api/v1/staff/me");
    const normalCookie = await createVerifiedSession("normal-user@example.com");
    const normal = await get("/api/v1/staff/me", normalCookie);

    expect(anonymous.statusCode).toBe(401);
    expect(normal.statusCode).toBe(403);
    expect(normal.json<{ error: { code: string } }>().error.code).toBe("STAFF_PERMISSION_REQUIRED");
  });

  it("returns only safe capability data from staff/me", async () => {
    const staff = await createStaff("staff-me@example.com", ["SELLER_REVIEW", "PRODUCT_REVIEW"]);
    const response = await get("/api/v1/staff/me", staff.cookie);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      staff: {
        role: "STAFF",
        permissions: ["SELLER_REVIEW", "PRODUCT_REVIEW"],
        mfaEnabled: true,
        reviewEnabled: true,
      },
    });
    expect(response.body).not.toMatch(/email|phone|grant|session|token/i);
    const bootstrapAudits = await database.db
      .select({
        actorType: staffAuditEvents.actorType,
        actorUserId: staffAuditEvents.actorUserId,
        action: staffAuditEvents.action,
      })
      .from(staffAuditEvents);
    expect(bootstrapAudits).toHaveLength(3);
    expect(bootstrapAudits.every((event) => event.actorType === "SYSTEM_BOOTSTRAP")).toBe(true);
    expect(bootstrapAudits.every((event) => event.actorUserId === null)).toBe(true);
    expect((await post("/api/v1/staff/provision", {}, staff.cookie)).statusCode).toBe(404);
  });

  it("revokes every pre-bootstrap session before staff data can be read", async () => {
    const staff = await createStaff("pre-bootstrap-session@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("SUBMITTED");
    const responses = await Promise.all([
      get("/api/v1/staff/me", staff.preMembershipCookie),
      get("/api/v1/staff/seller-applications", staff.preMembershipCookie),
      get(`/api/v1/staff/seller-applications/${target.id}`, staff.preMembershipCookie),
      post(
        `/api/v1/staff/seller-applications/${target.id}/start-review`,
        {},
        staff.preMembershipCookie,
      ),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401]);
    expect((await applicationStatus(target.id)).status).toBe("SUBMITTED");
  });

  it("requires a fresh MFA sign-in after bootstrap before staff reads and writes", async () => {
    const email = "post-bootstrap-mfa@example.com";
    const identity = await createVerifiedIdentity(email);
    const enabled = await post(
      "/api/auth/two-factor/enable",
      { password: PASSWORD },
      identity.cookie,
    );
    const secret = totpSecretFromURI(enabled.json<{ totpURI: string }>().totpURI);
    const enrollmentCode = (await auth.api.generateTOTP({ body: { secret } })).code;
    const enrolled = await post(
      "/api/auth/two-factor/verify-totp",
      { code: enrollmentCode },
      identity.cookie,
    );
    const preBootstrapCookie = sessionCookie(enrolled);

    await bootstrapStaffMembership(database, {
      userId: identity.userId,
      role: "STAFF",
      permissions: ["SELLER_REVIEW"],
      requestId: `test-bootstrap-${randomUUID()}`,
    });
    const [remainingSessions] = await database.db
      .select({ value: count() })
      .from(session)
      .where(eq(session.userId, identity.userId));
    expect(remainingSessions?.value).toBe(0);
    expect((await get("/api/v1/staff/me", preBootstrapCookie)).statusCode).toBe(401);

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
    const challenged = await post("/api/auth/sign-in/email", { email, password: PASSWORD });
    const challengeCookies = cookieValues(challenged);
    expect(challenged.json()).toMatchObject({
      twoFactorRedirect: true,
      twoFactorMethods: ["totp"],
    });
    expect(challengeCookies.some((cookie) => cookie.includes("session_token"))).toBe(false);
    expect((await get("/api/v1/users/me", challengeCookies.join("; "))).statusCode).toBe(401);

    const signInCode = (await auth.api.generateTOTP({ body: { secret } })).code;
    const completed = await post(
      "/api/auth/two-factor/verify-totp",
      { code: signInCode },
      challengeCookies.join("; "),
    );
    const staffCookie = sessionCookie(completed);
    const [newSession] = await database.db
      .select({ createdAt: session.createdAt })
      .from(session)
      .where(eq(session.userId, identity.userId));
    const [membership] = await database.db
      .select({ createdAt: staffMemberships.createdAt })
      .from(staffMemberships)
      .where(eq(staffMemberships.userId, identity.userId));
    expect(newSession!.createdAt.getTime()).toBeGreaterThan(membership!.createdAt.getTime());

    const target = await insertSellerApplication("SUBMITTED");
    expect((await get("/api/v1/staff/seller-applications", staffCookie)).statusCode).toBe(200);
    expect(
      (await post(`/api/v1/staff/seller-applications/${target.id}/start-review`, {}, staffCookie))
        .statusCode,
    ).toBe(200);
  });

  it("requires post-membership provenance for staff profile, queues, details, and writes", async () => {
    const staff = await createStaff("staff-session-provenance@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("SUBMITTED");
    const [membership] = await database.db
      .select({ createdAt: staffMemberships.createdAt })
      .from(staffMemberships)
      .where(eq(staffMemberships.userId, staff.userId));
    await database.db
      .update(session)
      .set({ createdAt: membership!.createdAt })
      .where(eq(session.userId, staff.userId));

    const responses = await Promise.all([
      get("/api/v1/staff/me", staff.cookie),
      get("/api/v1/staff/seller-applications", staff.cookie),
      get(`/api/v1/staff/seller-applications/${target.id}`, staff.cookie),
      post(`/api/v1/staff/seller-applications/${target.id}/start-review`, {}, staff.cookie),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403]);
    for (const response of responses) {
      expect(response.json<{ error: { code: string } }>().error.code).toBe("STAFF_REAUTH_REQUIRED");
    }
    expect((await applicationStatus(target.id)).status).toBe("SUBMITTED");
  });

  it.each(["SUSPENDED", "REVOKED"] as const)(
    "denies a %s staff membership without target disclosure",
    async (status) => {
      const staff = await createStaff(`membership-${status.toLowerCase()}@example.com`, [
        "SELLER_REVIEW",
      ]);
      await database.db
        .update(staffMemberships)
        .set({ status, revokedAt: status === "REVOKED" ? new Date() : null })
        .where(eq(staffMemberships.userId, staff.userId));
      const response = await get(
        "/api/v1/staff/seller-applications/00000000-0000-4000-8000-000000000001",
        staff.cookie,
      );

      expect(response.statusCode).toBe(403);
      expect(response.json<{ error: { code: string } }>().error.code).toBe(
        "STAFF_PERMISSION_REQUIRED",
      );
    },
  );

  it.each(["SUSPENDED", "DISABLED"] as const)("denies a %s account", async (status) => {
    const staff = await createStaff(`account-${status.toLowerCase()}@example.com`, [
      "SELLER_REVIEW",
    ]);
    await database.db.update(user).set({ status }).where(eq(user.id, staff.userId));
    const response = await get("/api/v1/staff/seller-applications", staff.cookie);
    expect(response.statusCode).toBe(403);
  });

  it("denies unverified, non-MFA, revoked-grant, wrong-grant, and ungranted ADMIN access", async () => {
    const staff = await createStaff("staff-denials@example.com", ["SELLER_REVIEW"]);
    await database.db.update(user).set({ emailVerified: false }).where(eq(user.id, staff.userId));
    expect((await get("/api/v1/staff/seller-applications", staff.cookie)).statusCode).toBe(403);

    await database.db
      .update(user)
      .set({ emailVerified: true, twoFactorEnabled: false })
      .where(eq(user.id, staff.userId));
    expect((await get("/api/v1/staff/seller-applications", staff.cookie)).statusCode).toBe(403);

    await database.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, staff.userId));
    const [grant] = await database.db
      .select({ id: staffPermissionGrants.id })
      .from(staffPermissionGrants)
      .where(eq(staffPermissionGrants.staffUserId, staff.userId));
    await database.db
      .update(staffPermissionGrants)
      .set({ revokedAt: new Date(), revokedByUserId: staff.userId })
      .where(eq(staffPermissionGrants.id, grant!.id));
    expect((await get("/api/v1/staff/seller-applications", staff.cookie)).statusCode).toBe(403);

    const productOnly = await createStaff("product-only@example.com", ["PRODUCT_REVIEW"]);
    expect((await get("/api/v1/staff/seller-applications", productOnly.cookie)).statusCode).toBe(
      403,
    );

    const admin = await createStaff("admin-explicit-grant@example.com", ["SELLER_REVIEW"], "ADMIN");
    expect((await get("/api/v1/staff/seller-products", admin.cookie)).statusCode).toBe(403);
  });

  it("denies every staff endpoint immediately after official two-factor disable", async () => {
    const staff = await createStaff("mfa-disable@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("SUBMITTED");

    expect(
      (await post("/api/auth/two-factor/disable", { password: "wrong-password" }, staff.cookie))
        .statusCode,
    ).toBe(400);
    const disabled = await post(
      "/api/auth/two-factor/disable",
      { password: PASSWORD },
      staff.cookie,
    );
    const normalCookie = sessionCookie(disabled);
    const normalUser = await get("/api/v1/users/me", normalCookie);
    const responses = await Promise.all([
      get("/api/v1/staff/me", normalCookie),
      get("/api/v1/staff/seller-applications", normalCookie),
      get(`/api/v1/staff/seller-applications/${target.id}`, normalCookie),
      post(`/api/v1/staff/seller-applications/${target.id}/start-review`, {}, normalCookie),
    ]);

    expect(disabled.statusCode).toBe(200);
    expect(normalUser.statusCode).toBe(200);
    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403]);
    expect((await applicationStatus(target.id)).status).toBe("SUBMITTED");
  });

  it("minimizes seller queues and withholds business identifiers from product reviewers", async () => {
    const sellerStaff = await createStaff("seller-reviewer@example.com", ["SELLER_REVIEW"]);
    const productStaff = await createStaff("product-reviewer@example.com", ["PRODUCT_REVIEW"]);
    const application = await insertSellerApplication("SUBMITTED");
    const approved = await insertSellerApplication("APPROVED");
    const product = await insertSellerProduct(approved.id, "SUBMITTED");

    const sellerList = await get("/api/v1/staff/seller-applications", sellerStaff.cookie);
    const sellerDetail = await get(
      `/api/v1/staff/seller-applications/${application.id}`,
      sellerStaff.cookie,
    );
    const productDetail = await get(
      `/api/v1/staff/seller-products/${product.id}`,
      productStaff.cookie,
    );

    expect(sellerList.body).not.toMatch(/kraPin|registrationNumber|email|phone/);
    expect(sellerDetail.json<{ application: Record<string, unknown> }>().application).toMatchObject(
      {
        kraPin: "P123456789Z",
        registrationNumber: "PVT-TEST/123",
      },
    );
    expect(productDetail.body).not.toMatch(/kraPin|registrationNumber|email|phone/);
    expect(productDetail.json()).toMatchObject({
      submission: { seller: { status: "APPROVED" } },
    });
  });

  it("validates bounded queue inputs", async () => {
    const staff = await createStaff("pagination@example.com", ["SELLER_REVIEW"]);
    expect((await get("/api/v1/staff/seller-applications?limit=51", staff.cookie)).statusCode).toBe(
      400,
    );
    expect(
      (await get("/api/v1/staff/seller-applications?status=UNKNOWN", staff.cookie)).statusCode,
    ).toBe(400);
  });
});

describe("staff review trust boundary", () => {
  it("requires a post-membership session no older than 30 minutes", async () => {
    const staff = await createStaff("recent-session@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("SUBMITTED");
    const [membership] = await database.db
      .select({ createdAt: staffMemberships.createdAt })
      .from(staffMemberships)
      .where(eq(staffMemberships.userId, staff.userId));
    await database.db
      .update(session)
      .set({ createdAt: membership!.createdAt })
      .where(eq(session.userId, staff.userId));
    const preMembership = await post(
      `/api/v1/staff/seller-applications/${target.id}/start-review`,
      {},
      staff.cookie,
    );
    expect(preMembership.statusCode).toBe(403);
    expect(preMembership.json<{ error: { code: string } }>().error.code).toBe(
      "STAFF_REAUTH_REQUIRED",
    );

    await database.db
      .update(staffMemberships)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1_000) })
      .where(eq(staffMemberships.userId, staff.userId));
    await database.db
      .update(session)
      .set({ createdAt: new Date(Date.now() - 31 * 60 * 1_000) })
      .where(eq(session.userId, staff.userId));
    const stale = await post(
      `/api/v1/staff/seller-applications/${target.id}/start-review`,
      {},
      staff.cookie,
    );

    expect(stale.statusCode).toBe(403);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe("STAFF_RECENT_AUTH_REQUIRED");
    expect((await applicationStatus(target.id)).status).toBe("SUBMITTED");
  });

  it("atomically transitions and writes a privacy-minimized audit event", async () => {
    const staff = await createStaff("audit-reviewer@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("SUBMITTED");
    const response = await post(
      `/api/v1/staff/seller-applications/${target.id}/start-review`,
      {},
      staff.cookie,
    );
    const [audit] = await database.db
      .select()
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.action, "SELLER_APPLICATION_REVIEW_STARTED"));

    expect(response.statusCode).toBe(200);
    expect((await applicationStatus(target.id)).status).toBe("UNDER_REVIEW");
    expect(audit).toMatchObject({
      actorType: "STAFF",
      actorUserId: staff.userId,
      actorRole: "STAFF",
      permission: "SELLER_REVIEW",
      sellerApplicationId: target.id,
      previousStatus: "SUBMITTED",
      resultingStatus: "UNDER_REVIEW",
    });
    expect(audit?.requestId).toBeTruthy();
    expect(audit?.createdAt).toBeInstanceOf(Date);
    expect(Object.keys(audit ?? {})).not.toEqual(
      expect.arrayContaining(["email", "phone", "kraPin", "password", "token", "requestBody"]),
    );
  });

  it("rolls back the status transition if the audit insert fails", async () => {
    const staff = await createStaff("audit-failure@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("SUBMITTED");
    await database.pool.query(`
      create function fail_staff_audit_insert() returns trigger language plpgsql as $$
      begin raise exception 'test audit failure'; end $$;
      create trigger fail_staff_audit before insert on staff_audit_events
      for each row execute function fail_staff_audit_insert();
    `);
    try {
      const response = await post(
        `/api/v1/staff/seller-applications/${target.id}/start-review`,
        {},
        staff.cookie,
      );
      expect(response.statusCode).toBe(500);
      expect((await applicationStatus(target.id)).status).toBe("SUBMITTED");
    } finally {
      await database.pool.query("drop trigger fail_staff_audit on staff_audit_events");
      await database.pool.query("drop function fail_staff_audit_insert()");
    }
  });

  it("keeps reads available but blocks all writes when the kill switch is off", async () => {
    const staff = await createStaff("disabled-review@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("SUBMITTED");
    const read = await disabledApp.inject({
      method: "GET",
      url: "/api/v1/staff/seller-applications",
      headers: { cookie: staff.cookie },
    });
    const mutation = await injectPost(
      disabledApp,
      `/api/v1/staff/seller-applications/${target.id}/start-review`,
      {},
      staff.cookie,
    );
    const reviewAudits = await database.db
      .select({ value: count() })
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.action, "SELLER_APPLICATION_REVIEW_STARTED"));

    expect(read.statusCode).toBe(200);
    expect(mutation.statusCode).toBe(503);
    expect(mutation.json<{ error: { code: string } }>().error.code).toBe("STAFF_REVIEW_DISABLED");
    expect((await applicationStatus(target.id)).status).toBe("SUBMITTED");
    expect(reviewAudits[0]?.value).toBe(0);
  });

  it("rejects arbitrary fields and permits only named transitions", async () => {
    const staff = await createStaff("strict-actions@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("SUBMITTED");
    const injected = await post(
      `/api/v1/staff/seller-applications/${target.id}/start-review`,
      { status: "APPROVED" },
      staff.cookie,
    );
    const skipped = await post(
      `/api/v1/staff/seller-applications/${target.id}/approve`,
      {},
      staff.cookie,
    );
    expect(injected.statusCode).toBe(400);
    expect(skipped.statusCode).toBe(409);
    expect((await applicationStatus(target.id)).status).toBe("SUBMITTED");
  });

  it("serializes two reviewers starting the same review", async () => {
    const first = await createStaff("reviewer-one@example.com", ["SELLER_REVIEW"]);
    const second = await createStaff("reviewer-two@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("SUBMITTED");
    const responses = await Promise.all([
      post(`/api/v1/staff/seller-applications/${target.id}/start-review`, {}, first.cookie),
      post(`/api/v1/staff/seller-applications/${target.id}/start-review`, {}, second.cookie),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect((await applicationStatus(target.id)).status).toBe("UNDER_REVIEW");
  });

  it("serializes approve versus reject and prevents duplicate approve", async () => {
    const first = await createStaff("decision-one@example.com", ["SELLER_REVIEW"]);
    const second = await createStaff("decision-two@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("UNDER_REVIEW");
    const responses = await Promise.all([
      post(`/api/v1/staff/seller-applications/${target.id}/approve`, {}, first.cookie),
      post(
        `/api/v1/staff/seller-applications/${target.id}/reject`,
        { reason: "The submitted registration details require correction." },
        second.cookie,
      ),
    ]);
    const final = await applicationStatus(target.id);
    const duplicate = await post(
      `/api/v1/staff/seller-applications/${target.id}/approve`,
      {},
      first.cookie,
    );

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(["APPROVED", "REJECTED"]).toContain(final.status);
    expect(duplicate.statusCode).toBe(409);
  });

  it("serializes permission revocation against approval", async () => {
    const staff = await createStaff("revocation-race@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("UNDER_REVIEW");
    const [reviewResult] = await Promise.allSettled([
      post(`/api/v1/staff/seller-applications/${target.id}/approve`, {}, staff.cookie),
      revokeStaffPermission(database, staff.userId, "SELLER_REVIEW", staff.userId),
    ]);
    const final = await applicationStatus(target.id);
    const [reviewAuditCount] = await database.db
      .select({ value: count() })
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.action, "SELLER_APPLICATION_APPROVED"));

    expect(reviewResult.status).toBe("fulfilled");
    const response = (reviewResult as PromiseFulfilledResult<InjectResponse>).value;
    if (response.statusCode === 200) {
      expect(final.status).toBe("APPROVED");
      expect(reviewAuditCount?.value).toBe(1);
    } else {
      expect(response.statusCode).toBe(403);
      expect(final.status).toBe("UNDER_REVIEW");
      expect(reviewAuditCount?.value).toBe(0);
    }
  });

  it("serializes permission revocation against rejection", async () => {
    const staff = await createStaff("revocation-reject-race@example.com", ["SELLER_REVIEW"]);
    const target = await insertSellerApplication("UNDER_REVIEW");
    const [reviewResult] = await Promise.allSettled([
      post(
        `/api/v1/staff/seller-applications/${target.id}/reject`,
        { reason: "The submitted registration details require correction." },
        staff.cookie,
      ),
      revokeStaffPermission(database, staff.userId, "SELLER_REVIEW", staff.userId),
    ]);
    const final = await applicationStatus(target.id);
    const [reviewAuditCount] = await database.db
      .select({ value: count() })
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.action, "SELLER_APPLICATION_REJECTED"));
    const response = (reviewResult as PromiseFulfilledResult<InjectResponse>).value;

    if (response.statusCode === 200) {
      expect(final.status).toBe("REJECTED");
      expect(reviewAuditCount?.value).toBe(1);
    } else {
      expect(response.statusCode).toBe(403);
      expect(final.status).toBe("UNDER_REVIEW");
      expect(reviewAuditCount?.value).toBe(0);
    }
  });
});

describe("seller-product isolation and applicant privacy", () => {
  it("reviews a product without publishing it or changing checkout resolution", async () => {
    const staff = await createStaff("product-review@example.com", ["PRODUCT_REVIEW"]);
    const application = await insertSellerApplication("APPROVED");
    const submission = await insertSellerProduct(application.id, "SUBMITTED");
    const [before] = await database.db.select({ value: count() }).from(products);

    expect(
      (await post(`/api/v1/staff/seller-products/${submission.id}/start-review`, {}, staff.cookie))
        .statusCode,
    ).toBe(200);
    expect(
      (await post(`/api/v1/staff/seller-products/${submission.id}/approve`, {}, staff.cookie))
        .statusCode,
    ).toBe(200);
    const [after] = await database.db.select({ value: count() }).from(products);
    const publicMatch = await database.db
      .select()
      .from(products)
      .where(eq(products.id, submission.id));
    const quote = await post(
      "/api/v1/checkout/quote",
      { items: [{ productId: submission.id, quantity: 1 }] },
      staff.cookie,
    );

    expect(after?.value).toBe(before?.value);
    expect(publicMatch).toHaveLength(0);
    expect(quote.statusCode).toBe(400);
    expect(quote.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_ERROR");
  });

  it("does not add staff or audit data to applicant responses", async () => {
    const applicant = await createVerifiedIdentity("applicant-privacy@example.com");
    const application = await insertSellerApplication("APPROVED", applicant.userId);
    await insertSellerProduct(application.id, "REJECTED");
    const sellerResponse = await get("/api/v1/seller/application", applicant.cookie);
    const productResponse = await get("/api/v1/seller/products", applicant.cookie);

    for (const body of [sellerResponse.body, productResponse.body]) {
      expect(body).not.toMatch(/actorUserId|permission|audit|staffComment|reviewer/i);
    }
  });
});

async function createStaff(
  email: string,
  permissions: StaffPermission[],
  role: StaffRole = "STAFF",
) {
  const identity = await createVerifiedIdentity(email);
  const enabled = await post(
    "/api/auth/two-factor/enable",
    { password: PASSWORD },
    identity.cookie,
  );
  const totpURI = enabled.json<{ totpURI: string }>().totpURI;
  const secret = totpSecretFromURI(totpURI);
  const enrollmentCode = (await auth.api.generateTOTP({ body: { secret } })).code;
  const verified = await post(
    "/api/auth/two-factor/verify-totp",
    { code: enrollmentCode },
    identity.cookie,
  );
  const enrolledCookie = sessionCookie(verified);
  await bootstrapStaffMembership(database, {
    userId: identity.userId,
    role,
    permissions,
    requestId: `test-bootstrap-${randomUUID()}`,
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));

  const login = await post("/api/auth/sign-in/email", { email, password: PASSWORD });
  expect(login.json()).toMatchObject({ twoFactorRedirect: true });
  const challengeCookie = cookieValues(login).join("; ");
  const signInCode = (await auth.api.generateTOTP({ body: { secret } })).code;
  const completed = await post(
    "/api/auth/two-factor/verify-totp",
    { code: signInCode },
    challengeCookie,
  );
  return {
    userId: identity.userId,
    cookie: sessionCookie(completed),
    preMembershipCookie: enrolledCookie,
    secret,
  };
}

async function createVerifiedIdentity(email: string) {
  const cookie = await createVerifiedSession(email);
  const [profile] = await database.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  return { userId: profile!.id, cookie };
}

async function createVerifiedSession(email: string): Promise<string> {
  const registration = await post("/api/auth/sign-up/email", {
    name: "Phase Seven Test User",
    email,
    phone: "0712345678",
    password: PASSWORD,
    callbackURL: `${ORIGIN}/verify-email`,
  });
  expect(registration.statusCode).toBe(200);
  const message = emailSender.messages.find((entry) => entry.recipient === email);
  const token = new URLSearchParams(new URL(message?.url ?? "").hash.slice(1)).get("token") ?? "";
  expect((await post("/api/v1/auth/verify-email", { token })).statusCode).toBe(200);
  const login = await post("/api/auth/sign-in/email", { email, password: PASSWORD });
  expect(login.statusCode).toBe(200);
  return sessionCookie(login);
}

async function insertSellerApplication(
  status: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED",
  ownerId?: string,
) {
  const userId = ownerId ?? (await insertApplicant());
  const now = new Date();
  const [application] = await database.db
    .insert(sellerApplications)
    .values({
      userId,
      sellerType: "COMPANY",
      legalName: "Phase Seven Test Seller Limited",
      tradingName: "Phase Seven Test Seller",
      registrationNumber: "PVT-TEST/123",
      kraPin: "P123456789Z",
      status,
      termsVersion: "seller-terms-v1",
      termsAcceptedAt: now,
      submittedAt: now,
      reviewedAt: status === "APPROVED" ? now : null,
    })
    .returning();
  return application!;
}

async function insertSellerProduct(applicationId: string, status: "SUBMITTED" | "REJECTED") {
  const now = new Date();
  const [submission] = await database.db
    .insert(sellerProductSubmissions)
    .values({
      sellerApplicationId: applicationId,
      name: "Phase Seven Product Review Test",
      category: "Accessories",
      description: "Controlled Phase Seven product review test submission.",
      priceMinor: 1_000n,
      currency: "KES",
      status,
      termsVersion: "seller-product-terms-v1",
      termsAcceptedAt: now,
      submittedAt: now,
      reviewStartedAt: status === "REJECTED" ? now : null,
      reviewedAt: status === "REJECTED" ? now : null,
      reviewReason: status === "REJECTED" ? "Applicant-safe test reason" : null,
    })
    .returning();
  return submission!;
}

async function insertApplicant(): Promise<string> {
  const id = randomUUID();
  await database.db.insert(user).values({
    id,
    name: "Seller Applicant",
    email: `${id}@example.com`,
    phone: "0712345678",
    emailVerified: true,
  });
  return id;
}

async function applicationStatus(id: string) {
  const [row] = await database.db
    .select({ status: sellerApplications.status })
    .from(sellerApplications)
    .where(eq(sellerApplications.id, id));
  return row!;
}

function post(url: string, payload: Record<string, unknown>, cookie?: string) {
  return injectPost(app, url, payload, cookie);
}

function injectPost(
  target: FastifyInstance,
  url: string,
  payload: Record<string, unknown>,
  cookie?: string,
) {
  requestCounter += 1;
  return target.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-real-ip": `198.51.100.${requestCounter % 250}`,
      ...(cookie ? { cookie } : {}),
    },
    payload,
  });
}

function get(url: string, cookie?: string) {
  return app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
}

function cookieValues(response: InjectResponse): string[] {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  return values
    .filter((value) => !value.includes("Max-Age=0"))
    .map((value) => value.split(";", 1)[0] ?? "")
    .filter(Boolean);
}

function sessionCookie(response: InjectResponse): string {
  const value = cookieValues(response).find((cookie) => cookie.includes("session_token"));
  expect(value).toBeDefined();
  return value ?? "";
}

function totpSecretFromURI(uri: string): string {
  const encoded = new URL(uri).searchParams.get("secret") ?? "";
  return new TextDecoder().decode(base32.decode(encoded));
}
