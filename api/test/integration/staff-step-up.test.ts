import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { base32 } from "@better-auth/utils/base32";
import { eq } from "drizzle-orm";
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
import { session, twoFactor, user } from "../../src/db/schema/auth.js";
import { authSecurityEvents } from "../../src/db/schema/email-otp.js";
import { StaffStepUpRequiredError } from "../../src/lib/errors.js";
import { requireStaffPermission } from "../../src/staff/authorization.js";
import { bootstrapStaffMembership } from "../../src/staff/bootstrap-service.js";
import { lockAuthorizedActor } from "../../src/staff/review-service.js";

const ORIGIN = "http://localhost:8080";
const PASSWORD = "StrongPassword!42";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const env = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(env);
assertSafeTestDatabaseUrl(databaseUrl, env.NODE_ENV);

let app: FastifyInstance;
let database: DatabaseClient;
let auth: AuthService;
let counter = 0;
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
});

beforeEach(async () => {
  await database.pool.query(
    'truncate table "security_rate_limit_windows", "verification", "session", "account", "user" cascade',
  );
  emailSender.messages.length = 0;
});

afterAll(async () => {
  await app.close();
});

type Staff = {
  userId: string;
  cookie: string;
  secret: string;
  backupCodes: string[];
  sessionId: string;
};

const MISSING_APPLICATION =
  "/api/v1/staff/seller-applications/00000000-0000-4000-8000-000000000001";

describe("staff step-up windows", () => {
  it("opens the window at sign-in with a TOTP and records how", async () => {
    const staff = await createStaff("window-open@example.com");
    const [row] = await sessionRow(staff);

    expect(row?.mfaMethod).toBe("totp");
    expect(row?.lastMfaVerifiedAt).toBeInstanceOf(Date);
    expect(Date.now() - (row?.lastMfaVerifiedAt?.getTime() ?? 0)).toBeLessThan(MINUTE);
    expect((await get("/api/v1/staff/seller-applications", staff.cookie)).statusCode).toBe(200);
  });

  it("gates reads and start-review with the 8 hour window", async () => {
    const staff = await createStaff("normal-window@example.com");

    await setVerifiedAgo(staff, 7 * HOUR + 59 * MINUTE);
    expect((await get("/api/v1/staff/seller-applications", staff.cookie)).statusCode).toBe(200);
    expect((await post(`${MISSING_APPLICATION}/start-review`, {}, staff.cookie)).statusCode).toBe(
      404,
    );

    await setVerifiedAgo(staff, 8 * HOUR + MINUTE);
    const read = await get("/api/v1/staff/seller-applications", staff.cookie);
    const start = await post(`${MISSING_APPLICATION}/start-review`, {}, staff.cookie);

    expect(read.statusCode).toBe(403);
    expect(errorCode(read)).toBe("STAFF_STEP_UP_REQUIRED");
    expect(errorCode(start)).toBe("STAFF_STEP_UP_REQUIRED");
  });

  it("gates approvals and every rejection with the 30 minute window", async () => {
    const staff = await createStaff("high-window@example.com");
    const approve = `${MISSING_APPLICATION}/approve`;
    const reject = `${MISSING_APPLICATION}/reject`;

    await setVerifiedAgo(staff, 29 * MINUTE);
    // Authorization passes, so the request reaches the (missing) target and is a 404.
    expect((await post(approve, {}, staff.cookie)).statusCode).toBe(404);
    expect((await post(reject, { reason: "Not enough detail" }, staff.cookie)).statusCode).toBe(
      404,
    );

    await setVerifiedAgo(staff, 31 * MINUTE);
    expect(errorCode(await post(approve, {}, staff.cookie))).toBe("STAFF_STEP_UP_REQUIRED");
    expect(errorCode(await post(reject, { reason: "Not enough detail" }, staff.cookie))).toBe(
      "STAFF_STEP_UP_REQUIRED",
    );
    // The same 31 minute old verification still allows normal-tier work.
    expect((await get("/api/v1/staff/seller-applications", staff.cookie)).statusCode).toBe(200);
    expect((await post(`${MISSING_APPLICATION}/start-review`, {}, staff.cookie)).statusCode).toBe(
      404,
    );
  });

  it("treats a session that never verified a second factor as needing a step-up", async () => {
    const staff = await createStaff("never-verified@example.com");
    await database.db
      .update(session)
      .set({ lastMfaVerifiedAt: null, mfaMethod: "none" })
      .where(eq(session.id, staff.sessionId));

    const response = await get("/api/v1/staff/seller-applications", staff.cookie);

    expect(errorCode(response)).toBe("STAFF_STEP_UP_REQUIRED");
  });

  it("re-checks the tier inside the write transaction", async () => {
    const staff = await createStaff("in-transaction@example.com");
    const authorization = await requireStaffPermission(
      auth,
      database,
      { cookie: staff.cookie },
      "SELLER_REVIEW",
      { stepUp: "high" },
    );
    await setVerifiedAgo(staff, 40 * MINUTE);

    await expect(
      database.db.transaction((transaction) =>
        lockAuthorizedActor(transaction, authorization, "SELLER_REVIEW"),
      ),
    ).rejects.toBeInstanceOf(StaffStepUpRequiredError);
    await expect(
      database.db.transaction((transaction) =>
        lockAuthorizedActor(
          transaction,
          { ...authorization, stepUpTier: "normal" },
          "SELLER_REVIEW",
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("reports window ends on staff/me without gating it", async () => {
    const staff = await createStaff("me-windows@example.com");
    await setVerifiedAgo(staff, 10 * HOUR);

    const response = await get("/api/v1/staff/me", staff.cookie);

    expect(response.statusCode).toBe(200);
    expect(response.json<{ staff: { stepUp: unknown } }>().staff.stepUp).toEqual({
      normalValidUntil: null,
      highValidUntil: null,
    });
  });
});

describe("staff step-up endpoint", () => {
  it("re-verifies a TOTP on the same session with no password and no new session", async () => {
    const staff = await createStaff("stepup-totp@example.com");
    await setVerifiedAgo(staff, 9 * HOUR);
    const before = await sessionsFor(staff.userId);

    const response = await post(
      "/api/v1/staff/step-up",
      { method: "totp", code: await totpCode(staff.secret) },
      staff.cookie,
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(await sessionsFor(staff.userId)).toEqual(before);
    const [row] = await sessionRow(staff);
    expect(Date.now() - (row?.lastMfaVerifiedAt?.getTime() ?? 0)).toBeLessThan(MINUTE);
    expect(row?.stepUpFailures).toBe(0);
    expect((await get("/api/v1/staff/seller-applications", staff.cookie)).statusCode).toBe(200);
    expect(await eventTypes()).toContain("STAFF_STEP_UP_SUCCEEDED");
  });

  it("lets a legacy session that never recorded a verification step up", async () => {
    const staff = await createStaff("stepup-legacy@example.com");
    await database.db
      .update(session)
      .set({ lastMfaVerifiedAt: null, mfaMethod: "none" })
      .where(eq(session.id, staff.sessionId));

    const response = await post(
      "/api/v1/staff/step-up",
      { method: "totp", code: await totpCode(staff.secret) },
      staff.cookie,
    );

    expect(response.statusCode).toBe(200);
    expect((await get("/api/v1/staff/seller-applications", staff.cookie)).statusCode).toBe(200);
  });

  it("counts a wrong TOTP against the session and the account, and resets on success", async () => {
    const staff = await createStaff("stepup-wrong@example.com");
    await setVerifiedAgo(staff, 9 * HOUR);

    const wrong = await post(
      "/api/v1/staff/step-up",
      { method: "totp", code: "000000" },
      staff.cookie,
    );

    expect(wrong.statusCode).toBe(401);
    expect(errorCode(wrong)).toBe("INVALID_SECOND_FACTOR_CODE");
    const [row] = await sessionRow(staff);
    expect(row?.stepUpFailures).toBe(1);
    expect(await accountFailures(staff.userId)).toBe(1);
    // Still stale: the failure did not open the window.
    expect(errorCode(await get("/api/v1/staff/seller-applications", staff.cookie))).toBe(
      "STAFF_STEP_UP_REQUIRED",
    );
    expect(await eventTypes()).toContain("STAFF_STEP_UP_FAILED");

    await post(
      "/api/v1/staff/step-up",
      { method: "totp", code: await totpCode(staff.secret) },
      staff.cookie,
    );
    expect((await sessionRow(staff))[0]?.stepUpFailures).toBe(0);
    expect(await accountFailures(staff.userId)).toBe(0);
  });

  it("revokes the session after five consecutive failures", async () => {
    const staff = await createStaff("stepup-revoke@example.com");
    await setVerifiedAgo(staff, 9 * HOUR);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await post(
        "/api/v1/staff/step-up",
        { method: "totp", code: "000000" },
        staff.cookie,
      );
      expect(wrong.statusCode).toBe(401);
    }

    expect(await sessionRow(staff)).toHaveLength(0);
    expect((await get("/api/v1/staff/me", staff.cookie)).statusCode).toBe(401);
    const events = await eventTypes();
    expect(events.filter((type) => type === "STAFF_STEP_UP_FAILED")).toHaveLength(5);
    expect(events).toContain("STAFF_STEP_UP_SESSION_REVOKED");
  });

  it("locks out while the shared account lock is active, without checking the code", async () => {
    const staff = await createStaff("stepup-locked@example.com");
    await setVerifiedAgo(staff, 9 * HOUR);
    await database.db
      .update(twoFactor)
      .set({ lockedUntil: new Date(Date.now() + 10 * MINUTE) })
      .where(eq(twoFactor.userId, staff.userId));

    const response = await post(
      "/api/v1/staff/step-up",
      { method: "totp", code: await totpCode(staff.secret) },
      staff.cookie,
    );

    expect(response.statusCode).toBe(429);
    expect((await sessionRow(staff))[0]?.stepUpFailures).toBe(0);
    expect(errorCode(await get("/api/v1/staff/seller-applications", staff.cookie))).toBe(
      "STAFF_STEP_UP_REQUIRED",
    );
  });

  it("locks the account when failures reach the shared budget", async () => {
    const staff = await createStaff("stepup-budget@example.com");
    await database.db
      .update(twoFactor)
      .set({ failedVerificationCount: 9 })
      .where(eq(twoFactor.userId, staff.userId));

    await post("/api/v1/staff/step-up", { method: "totp", code: "000000" }, staff.cookie);

    const [factor] = await database.db
      .select({ lockedUntil: twoFactor.lockedUntil })
      .from(twoFactor)
      .where(eq(twoFactor.userId, staff.userId));
    expect(factor?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it("rate limits attempts per user", async () => {
    const staff = await createStaff("stepup-rate@example.com");
    let last = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      // A fresh valid code each time keeps the session alive so only the limiter can refuse.
      last = (
        await post(
          "/api/v1/staff/step-up",
          { method: "totp", code: await totpCode(staff.secret) },
          staff.cookie,
        )
      ).statusCode;
    }

    expect(last).toBe(429);
  });

  it("consumes a backup code exactly once in session mode and creates no session", async () => {
    const staff = await createStaff("stepup-backup@example.com");
    await setVerifiedAgo(staff, 9 * HOUR);
    const sessionsBefore = await sessionsFor(staff.userId);
    const [factorBefore] = await database.db
      .select({ backupCodes: twoFactor.backupCodes })
      .from(twoFactor)
      .where(eq(twoFactor.userId, staff.userId));
    const code = staff.backupCodes[0] ?? "";

    const first = await post(
      "/api/v1/staff/step-up",
      { method: "backup-code", code },
      staff.cookie,
    );

    expect(first.statusCode).toBe(200);
    expect(first.headers["set-cookie"]).toBeUndefined();
    expect(await sessionsFor(staff.userId)).toEqual(sessionsBefore);
    const [factorAfter] = await database.db
      .select({ backupCodes: twoFactor.backupCodes })
      .from(twoFactor)
      .where(eq(twoFactor.userId, staff.userId));
    expect(factorAfter?.backupCodes).not.toBe(factorBefore?.backupCodes);
    expect((await get("/api/v1/staff/seller-applications", staff.cookie)).statusCode).toBe(200);

    await setVerifiedAgo(staff, 9 * HOUR);
    const replay = await post(
      "/api/v1/staff/step-up",
      { method: "backup-code", code },
      staff.cookie,
    );

    expect(replay.statusCode).toBe(401);
    expect((await sessionRow(staff))[0]?.stepUpFailures).toBe(1);
    // A different unused code still works.
    const other = await post(
      "/api/v1/staff/step-up",
      { method: "backup-code", code: staff.backupCodes[1] ?? "" },
      staff.cookie,
    );
    expect(other.statusCode).toBe(200);
  });

  it("does not record a backup-code step-up as a login success or failure", async () => {
    const staff = await createStaff("stepup-backup-audit@example.com");
    await setVerifiedAgo(staff, 9 * HOUR);
    const before = (await eventTypes()).filter((type) => type.startsWith("BACKUP_CODE_LOGIN"));

    await post(
      "/api/v1/staff/step-up",
      { method: "backup-code", code: staff.backupCodes[0] ?? "" },
      staff.cookie,
    );

    const after = (await eventTypes()).filter((type) => type.startsWith("BACKUP_CODE_LOGIN"));
    expect(after).toEqual(before);
  });

  it("writes audit rows without codes or raw addresses", async () => {
    const staff = await createStaff("stepup-audit@example.com");
    await setVerifiedAgo(staff, 9 * HOUR);
    const code = await totpCode(staff.secret);
    await post("/api/v1/staff/step-up", { method: "totp", code: "000000" }, staff.cookie);
    await post("/api/v1/staff/step-up", { method: "totp", code }, staff.cookie);

    const rows = await database.db
      .select()
      .from(authSecurityEvents)
      .where(eq(authSecurityEvents.userId, staff.userId));
    const stepUp = rows.filter((row) => row.eventType.startsWith("STAFF_STEP_UP"));

    expect(stepUp.map((row) => row.eventType)).toEqual(
      expect.arrayContaining(["STAFF_STEP_UP_FAILED", "STAFF_STEP_UP_SUCCEEDED"]),
    );
    const serialized = JSON.stringify(stepUp);
    expect(serialized).not.toContain(code);
    expect(serialized).not.toContain("000000");
    expect(serialized).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    for (const row of stepUp) expect(row.ipDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses email-otp sessions, sessions older than the membership, and non-staff users", async () => {
    const emailSession = await createStaff("stepup-emailotp@example.com");
    await database.db
      .update(session)
      .set({ mfaMethod: "email-otp", lastMfaVerifiedAt: null })
      .where(eq(session.id, emailSession.sessionId));
    const viaEmail = await post(
      "/api/v1/staff/step-up",
      { method: "totp", code: await totpCode(emailSession.secret) },
      emailSession.cookie,
    );
    expect(errorCode(viaEmail)).toBe("STAFF_REAUTH_REQUIRED");
    expect(errorCode(await get("/api/v1/staff/seller-applications", emailSession.cookie))).toBe(
      "STAFF_REAUTH_REQUIRED",
    );

    const old = await createStaff("stepup-oldsession@example.com");
    await database.db
      .update(session)
      .set({ createdAt: new Date(Date.now() - 10 * HOUR), lastMfaVerifiedAt: null })
      .where(eq(session.id, old.sessionId));
    const viaOld = await post(
      "/api/v1/staff/step-up",
      { method: "totp", code: await totpCode(old.secret) },
      old.cookie,
    );
    expect(errorCode(viaOld)).toBe("STAFF_REAUTH_REQUIRED");

    const plain = await createPlainTotpUser("stepup-plain@example.com");
    const viaPlain = await post(
      "/api/v1/staff/step-up",
      { method: "totp", code: await totpCode(plain.secret) },
      plain.cookie,
    );
    expect(viaPlain.statusCode).toBe(403);
    expect(errorCode(viaPlain)).toBe("STAFF_PERMISSION_REQUIRED");
    expect((await eventTypes()).filter((type) => type === "STAFF_STEP_UP_REFUSED")).toHaveLength(3);
  });

  it("requires a session and a well-formed body", async () => {
    const staff = await createStaff("stepup-validation@example.com");

    expect(
      (await post("/api/v1/staff/step-up", { method: "totp", code: "123456" })).statusCode,
    ).toBe(401);
    for (const body of [
      {},
      { method: "totp", code: "12345" },
      { method: "totp", code: "abcdef" },
      { method: "password", code: "123456" },
      { method: "totp", code: "123456", password: "x" },
      { method: "backup-code", code: "" },
    ]) {
      const response = await post("/api/v1/staff/step-up", body, staff.cookie);
      expect(response.statusCode).toBe(400);
    }
  });
});

describe("sign-in provenance", () => {
  it("keeps email-otp sessions from ever opening a window", async () => {
    const staff = await createStaff("signin-email@example.com");
    await database.db
      .update(session)
      .set({ mfaMethod: "email-otp", lastMfaVerifiedAt: null })
      .where(eq(session.id, staff.sessionId));

    await expect(
      requireStaffPermission(auth, database, { cookie: staff.cookie }, "SELLER_REVIEW"),
    ).rejects.toMatchObject({ code: "STAFF_REAUTH_REQUIRED" });
  });
});

// --- helpers -------------------------------------------------------------------------------

function errorCode(response: InjectResponse): string | undefined {
  return response.json<{ error?: { code?: string } }>().error?.code;
}

async function totpCode(secret: string): Promise<string> {
  return (await auth.api.generateTOTP({ body: { secret } })).code;
}

async function setVerifiedAgo(staff: Staff, ms: number): Promise<void> {
  await database.db
    .update(session)
    .set({ lastMfaVerifiedAt: new Date(Date.now() - ms) })
    .where(eq(session.id, staff.sessionId));
}

function sessionRow(staff: Staff) {
  return database.db.select().from(session).where(eq(session.id, staff.sessionId));
}

async function sessionsFor(userId: string) {
  return (
    await database.db
      .select({ id: session.id, token: session.token })
      .from(session)
      .where(eq(session.userId, userId))
  ).sort((left, right) => left.id.localeCompare(right.id));
}

async function accountFailures(userId: string): Promise<number> {
  const [factor] = await database.db
    .select({ failures: twoFactor.failedVerificationCount })
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId));
  return factor?.failures ?? -1;
}

async function eventTypes(): Promise<string[]> {
  const rows = await database.db
    .select({ eventType: authSecurityEvents.eventType })
    .from(authSecurityEvents)
    .orderBy(authSecurityEvents.createdAt);
  return rows.map((row) => row.eventType);
}

async function request(
  method: "GET" | "POST",
  url: string,
  payload: Record<string, unknown> | undefined,
  cookie?: string,
): Promise<InjectResponse> {
  counter += 1;
  return app.inject({
    method,
    url,
    headers: {
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      origin: ORIGIN,
      "x-real-ip": `198.51.100.${counter % 250}`,
      ...(cookie ? { cookie } : {}),
    },
    ...(payload ? { payload } : {}),
  });
}

function post(url: string, payload: Record<string, unknown>, cookie?: string) {
  return request("POST", url, payload, cookie);
}

function get(url: string, cookie?: string) {
  return request("GET", url, undefined, cookie);
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

async function createPlainTotpUser(email: string) {
  const registration = await post("/api/auth/sign-up/email", {
    name: "Step Up Test User",
    email,
    phone: "0712345678",
    password: PASSWORD,
    termsAccepted: true,
    callbackURL: `${ORIGIN}/verify-email`,
  });
  expect(registration.statusCode).toBe(200);
  const message = emailSender.messages.find(
    (entry) => entry.kind === "verification" && entry.recipient === email,
  );
  const token = new URLSearchParams(new URL(message?.url ?? "").hash.slice(1)).get("token") ?? "";
  expect((await post("/api/v1/auth/verify-email", { token })).statusCode).toBe(200);
  const login = await post("/api/auth/sign-in/email", { email, password: PASSWORD });
  const initial = sessionCookie(login);
  const enabled = await post("/api/auth/two-factor/enable", { password: PASSWORD }, initial);
  const body = enabled.json<{ totpURI: string; backupCodes: string[] }>();
  const secret = new TextDecoder().decode(
    base32.decode(new URL(body.totpURI).searchParams.get("secret") ?? ""),
  );
  const verified = await post(
    "/api/auth/two-factor/verify-totp",
    { code: await totpCode(secret) },
    initial,
  );
  expect(verified.statusCode).toBe(200);
  const [profile] = await database.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  return {
    userId: profile?.id ?? "",
    secret,
    backupCodes: body.backupCodes,
    cookie: sessionCookie(verified),
  };
}

/** A real staff member: registered, TOTP-enrolled, bootstrapped, then signed in with password + TOTP. */
async function createStaff(email: string): Promise<Staff> {
  const plain = await createPlainTotpUser(email);
  await bootstrapStaffMembership(database, {
    userId: plain.userId,
    role: "STAFF",
    permissions: ["SELLER_REVIEW", "PRODUCT_REVIEW"],
    requestId: `test-${randomUUID()}`,
  });
  await new Promise((settle) => setTimeout(settle, 5));
  const login = await post("/api/auth/sign-in/email", { email, password: PASSWORD });
  expect(login.json()).toMatchObject({ twoFactorRedirect: true });
  const completed = await post(
    "/api/auth/two-factor/verify-totp",
    { code: await totpCode(plain.secret) },
    cookieValues(login).join("; "),
  );
  expect(completed.statusCode).toBe(200);
  const cookie = sessionCookie(completed);
  // Bootstrapping deleted every earlier session, so the sign-in above created the only one.
  const [current] = await database.db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, plain.userId));
  return {
    userId: plain.userId,
    cookie,
    secret: plain.secret,
    backupCodes: plain.backupCodes,
    sessionId: current?.id ?? "",
  };
}
