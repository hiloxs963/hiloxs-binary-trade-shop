import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { base32 } from "@better-auth/utils/base32";
import { and, count, eq } from "drizzle-orm";
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
import { session, twoFactor, user, verification } from "../../src/db/schema/auth.js";
import { authSecurityEvents } from "../../src/db/schema/email-otp.js";
import { bootstrapStaffMembership } from "../../src/staff/bootstrap-service.js";

const ORIGIN = "http://localhost:8080";
const PASSWORD = "StrongPassword!42";
const BASE = "/api/v1/account/security";
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
    'truncate table "security_rate_limit_windows", "auth_security_events", "staff_audit_events", "staff_permission_grants", "staff_memberships", "verification", "two_factor", "session", "account", "user" cascade',
  );
  emailSender.messages.length = 0;
});

afterAll(async () => {
  await app.close();
});

type Enrolled = {
  email: string;
  userId: string;
  cookie: string;
  secret: string;
  backupCodes: string[];
};

describe("replace authenticator", () => {
  it("swaps the secret only after the new app confirms, never leaving 2FA off", async () => {
    const account = await enroll("swap@example.com");
    const otherSession = await signInWithTotp(account.email, account.secret);
    expect(await sessionCount(account.userId)).toBe(2);
    const before = await factorRow(account.userId);

    const wrongPassword = await post(
      `${BASE}/authenticator/start`,
      { password: "WrongPassword!42", code: await totp(account.secret) },
      account.cookie,
    );
    const wrongCode = await post(
      `${BASE}/authenticator/start`,
      { password: PASSWORD, code: "000000" },
      account.cookie,
    );
    expect(wrongPassword.statusCode).toBe(403);
    expect(wrongCode.statusCode).toBe(403);
    expect(await factorRow(account.userId)).toEqual(before);
    expect(await pendingCount(account.userId)).toBe(0);

    const started = await post(
      `${BASE}/authenticator/start`,
      { password: PASSWORD, code: await totp(account.secret) },
      account.cookie,
    );
    expect(started.statusCode).toBe(200);
    const newSecret = secretFromUri(started.json<{ totpURI: string }>().totpURI);
    expect(newSecret).not.toBe(account.secret);
    // Starting changes nothing about the live factor.
    expect(await factorRow(account.userId)).toEqual(before);
    expect(await sessionCount(account.userId)).toBe(2);
    // The old authenticator still signs in while the swap is pending.
    expect(await signInWithTotp(account.email, account.secret)).toContain("session_token");

    const wrongNewCode = await post(
      `${BASE}/authenticator/confirm`,
      { code: "000000" },
      account.cookie,
    );
    const oldSecretCode = await post(
      `${BASE}/authenticator/confirm`,
      { code: await totp(account.secret) },
      account.cookie,
    );
    expect(wrongNewCode.statusCode).toBe(401);
    expect(oldSecretCode.statusCode).toBe(401);
    expect(await factorRow(account.userId)).toEqual(before);

    const watcher = watchFactorState(account.userId);
    const confirmed = await post(
      `${BASE}/authenticator/confirm`,
      { code: await totp(newSecret) },
      account.cookie,
    );
    const observed = await watcher.stop();
    expect(confirmed.statusCode).toBe(200);
    expect(observed.samples).toBeGreaterThan(0);
    expect(observed.everDisabled).toBe(false);

    const newCodes = confirmed.json<{ backupCodes: string[] }>().backupCodes;
    expect(newCodes).toHaveLength(10);
    const after = await factorRow(account.userId);
    expect(after).toMatchObject({ verified: true, enabled: true });
    expect(after.secret).not.toBe(before.secret);
    expect(after.backupCodes).not.toBe(before.backupCodes);
    expect(after.failures).toBe(0);
    expect(after.lockedUntil).toBeNull();

    // Only the session that confirmed survives.
    expect(await sessionCount(account.userId)).toBe(1);
    const stillSignedIn = await get("/api/v1/users/me", account.cookie);
    const revoked = await get("/api/v1/users/me", otherSession);
    expect(stillSignedIn.statusCode).toBe(200);
    expect(revoked.statusCode).toBe(401);

    // Old authenticator fails, new works.
    expect(await attemptTotpLogin(account.email, await totp(account.secret))).toBe(401);
    expect(await attemptTotpLogin(account.email, await totp(newSecret))).toBe(200);
    // Old backup codes are dead, new ones are single-use.
    expect(await attemptBackupLogin(account.email, account.backupCodes[0] ?? "")).toBe(401);
    expect(await attemptBackupLogin(account.email, newCodes[0] ?? "")).toBe(200);
    expect(await attemptBackupLogin(account.email, newCodes[0] ?? "")).toBe(401);

    // The pending secret is gone and cannot be confirmed twice.
    expect(await pendingCount(account.userId)).toBe(0);
    const replay = await post(
      `${BASE}/authenticator/confirm`,
      { code: await totp(newSecret) },
      account.cookie,
    );
    expect(replay.statusCode).toBe(409);

    expect(sentKinds(account.email)).toEqual(["authenticator-replaced"]);
    expect(await eventTypes(account.userId)).toEqual(
      expect.arrayContaining([
        "AUTHENTICATOR_REPLACE_FAILED",
        "AUTHENTICATOR_REPLACE_STARTED",
        "AUTHENTICATOR_REPLACED",
      ]),
    );
    expect(await eventCount(account.userId, "AUTHENTICATOR_REPLACE_FAILED")).toBe(4);
  });

  it("accepts a backup code instead of a TOTP code, and consumes it", async () => {
    const account = await enroll("swap-backup@example.com");
    const used = account.backupCodes[0] ?? "";

    const started = await post(
      `${BASE}/authenticator/start`,
      { password: PASSWORD, code: used },
      account.cookie,
    );

    expect(started.statusCode).toBe(200);
    expect((await get(BASE, account.cookie)).json()).toMatchObject({ backupCodesRemaining: 9 });
    const reused = await post(
      `${BASE}/authenticator/start`,
      { password: PASSWORD, code: used },
      account.cookie,
    );
    expect(reused.statusCode).toBe(403);
  });

  it("binds the pending change to the session that started it", async () => {
    const account = await enroll("swap-session@example.com");
    const other = await signInWithTotp(account.email, account.secret);
    const started = await post(
      `${BASE}/authenticator/start`,
      { password: PASSWORD, code: await totp(account.secret) },
      account.cookie,
    );
    const newSecret = secretFromUri(started.json<{ totpURI: string }>().totpURI);
    const before = await factorRow(account.userId);

    const fromOther = await post(
      `${BASE}/authenticator/confirm`,
      { code: await totp(newSecret) },
      other,
    );

    expect(fromOther.statusCode).toBe(409);
    expect(await factorRow(account.userId)).toEqual(before);
    expect(await pendingCount(account.userId)).toBe(1);
  });

  it("expires pending changes and caps wrong confirmation attempts", async () => {
    const account = await enroll("swap-expiry@example.com");
    const started = await post(
      `${BASE}/authenticator/start`,
      { password: PASSWORD, code: await totp(account.secret) },
      account.cookie,
    );
    const newSecret = secretFromUri(started.json<{ totpURI: string }>().totpURI);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await post(`${BASE}/authenticator/confirm`, { code: "000000" }, account.cookie);
      expect(wrong.statusCode).toBe(401);
    }
    const exhausted = await post(
      `${BASE}/authenticator/confirm`,
      { code: await totp(newSecret) },
      account.cookie,
    );
    expect(exhausted.statusCode).toBe(409);

    const restarted = await post(
      `${BASE}/authenticator/start`,
      { password: PASSWORD, code: await totp(account.secret) },
      account.cookie,
    );
    const restartedSecret = secretFromUri(restarted.json<{ totpURI: string }>().totpURI);
    await database.pool.query(
      `update "verification" set expires_at = now() - interval '1 minute' where identifier like 'authenticator-replace:%'`,
    );
    const expired = await post(
      `${BASE}/authenticator/confirm`,
      { code: await totp(restartedSecret) },
      account.cookie,
    );
    expect(expired.statusCode).toBe(409);
    expect((await factorRow(account.userId)).secret).toBeDefined();
    expect(await attemptTotpLogin(account.email, await totp(account.secret))).toBe(200);
  });

  it("keeps a staff account authorized before, during, and after the swap", async () => {
    const staff = await enroll("staff-swap@example.com");
    await bootstrapStaffMembership(database, {
      userId: staff.userId,
      role: "STAFF",
      permissions: ["SELLER_REVIEW"],
      requestId: `test-${randomUUID()}`,
    });
    await new Promise((settle) => setTimeout(settle, 5));
    const staffCookie = await signInWithTotp(staff.email, staff.secret);
    expect((await get("/api/v1/staff/me", staffCookie)).statusCode).toBe(200);

    const started = await post(
      `${BASE}/authenticator/start`,
      { password: PASSWORD, code: await totp(staff.secret) },
      staffCookie,
    );
    expect(started.statusCode).toBe(200);
    expect((await get("/api/v1/staff/me", staffCookie)).statusCode).toBe(200);
    expect(await factorRow(staff.userId)).toMatchObject({ verified: true, enabled: true });

    const newSecret = secretFromUri(started.json<{ totpURI: string }>().totpURI);
    const confirmed = await post(
      `${BASE}/authenticator/confirm`,
      { code: await totp(newSecret) },
      staffCookie,
    );
    expect(confirmed.statusCode).toBe(200);
    expect((await get("/api/v1/staff/me", staffCookie)).statusCode).toBe(200);
    expect(await factorRow(staff.userId)).toMatchObject({ verified: true, enabled: true });

    const freshCookie = await signInWithTotp(staff.email, newSecret);
    expect((await get("/api/v1/staff/me", freshCookie)).statusCode).toBe(200);
  });

  it("requires a session, an enrolled account, and well-formed input", async () => {
    const anonymous = await post(`${BASE}/authenticator/start`, {
      password: PASSWORD,
      code: "123456",
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await get(BASE)).statusCode).toBe(401);

    const plainCookie = await createVerifiedSession("plain@example.com");
    const notEnrolled = await post(
      `${BASE}/authenticator/start`,
      { password: PASSWORD, code: "123456" },
      plainCookie,
    );
    expect(notEnrolled.statusCode).toBe(409);
    expect((await get(BASE, plainCookie)).json()).toEqual({
      enrolled: false,
      backupCodesRemaining: 0,
    });

    const account = await enroll("input@example.com");
    const extra = await post(
      `${BASE}/authenticator/start`,
      { password: PASSWORD, code: "123456", disable: true },
      account.cookie,
    );
    const shortConfirm = await post(
      `${BASE}/authenticator/confirm`,
      { code: "12" },
      account.cookie,
    );
    expect(extra.statusCode).toBe(400);
    expect(shortConfirm.statusCode).toBe(400);
  });

  it("uses its own limiter and never touches the login lockout", async () => {
    const account = await enroll("limiter@example.com");
    const before = await factorRow(account.userId);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await post(
        `${BASE}/authenticator/start`,
        { password: PASSWORD, code: "000000" },
        account.cookie,
      );
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
    const after = await factorRow(account.userId);
    expect(after.failures).toBe(before.failures);
    expect(after.lockedUntil).toBeNull();
    expect(await attemptTotpLogin(account.email, await totp(account.secret))).toBe(200);
  });
});

describe("backup codes", () => {
  it("reports the remaining count and decrements as codes are used", async () => {
    const account = await enroll("count@example.com");
    expect((await get(BASE, account.cookie)).json()).toEqual({
      enrolled: true,
      backupCodesRemaining: 10,
    });

    expect(await attemptBackupLogin(account.email, account.backupCodes[0] ?? "")).toBe(200);

    expect((await get(BASE, account.cookie)).json()).toMatchObject({ backupCodesRemaining: 9 });
  });

  it("regenerates codes after re-authentication, invalidating the old set", async () => {
    const account = await enroll("regen@example.com");
    const before = await factorRow(account.userId);

    const wrongPassword = await post(
      `${BASE}/backup-codes/regenerate`,
      { password: "WrongPassword!42", code: await totp(account.secret) },
      account.cookie,
    );
    const wrongCode = await post(
      `${BASE}/backup-codes/regenerate`,
      { password: PASSWORD, code: "000000" },
      account.cookie,
    );
    expect(wrongPassword.statusCode).toBe(403);
    expect(wrongCode.statusCode).toBe(403);
    expect(await factorRow(account.userId)).toEqual(before);
    expect(emailSender.messages.filter((m) => m.kind === "backup-codes-regenerated")).toHaveLength(
      0,
    );

    const regenerated = await post(
      `${BASE}/backup-codes/regenerate`,
      { password: PASSWORD, code: await totp(account.secret) },
      account.cookie,
    );
    expect(regenerated.statusCode).toBe(200);
    const newCodes = regenerated.json<{ backupCodes: string[] }>().backupCodes;
    expect(newCodes).toHaveLength(10);
    expect(newCodes.some((code) => account.backupCodes.includes(code))).toBe(false);

    const after = await factorRow(account.userId);
    // Only the backup codes change; the authenticator secret and 2FA state are untouched.
    expect(after.secret).toBe(before.secret);
    expect(after).toMatchObject({ verified: true, enabled: true });
    expect(await attemptBackupLogin(account.email, account.backupCodes[1] ?? "")).toBe(401);
    expect(await attemptBackupLogin(account.email, newCodes[0] ?? "")).toBe(200);
    expect(await attemptBackupLogin(account.email, newCodes[0] ?? "")).toBe(401);
    expect(await attemptTotpLogin(account.email, await totp(account.secret))).toBe(200);

    expect(sentKinds(account.email)).toEqual(["backup-codes-regenerated"]);
    expect(await eventCount(account.userId, "BACKUP_CODES_REGENERATED")).toBe(1);
    expect(await eventCount(account.userId, "BACKUP_CODES_REGENERATE_FAILED")).toBe(2);
  });

  it("accepts a backup code as the current factor", async () => {
    const account = await enroll("regen-backup@example.com");

    const regenerated = await post(
      `${BASE}/backup-codes/regenerate`,
      { password: PASSWORD, code: account.backupCodes[0] ?? "" },
      account.cookie,
    );

    expect(regenerated.statusCode).toBe(200);
    expect(regenerated.json<{ backupCodes: string[] }>().backupCodes).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------------------------

async function enroll(email: string): Promise<Enrolled> {
  const initial = await createVerifiedSession(email);
  const enabled = await post("/api/auth/two-factor/enable", { password: PASSWORD }, initial);
  const enrollment = enabled.json<{ totpURI: string; backupCodes: string[] }>();
  const secret = secretFromUri(enrollment.totpURI);
  const verified = await post(
    "/api/auth/two-factor/verify-totp",
    { code: await totp(secret) },
    initial,
  );
  expect(verified.statusCode).toBe(200);
  const [profile] = await database.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  return {
    email,
    userId: profile?.id ?? "",
    cookie: sessionCookie(verified),
    secret,
    backupCodes: enrollment.backupCodes,
  };
}

async function createVerifiedSession(email: string): Promise<string> {
  const registration = await post("/api/auth/sign-up/email", {
    name: "Account Security Test",
    email,
    phone: "0712345678",
    password: PASSWORD,
    termsAccepted: true,
    callbackURL: `${ORIGIN}/verify-email`,
  });
  expect(registration.statusCode).toBe(200);
  const message = emailSender.messages.find(
    (entry) => entry.recipient === email && entry.kind === "verification",
  );
  const token = new URLSearchParams(new URL(message?.url ?? "").hash.slice(1)).get("token") ?? "";
  expect((await post("/api/v1/auth/verify-email", { token })).statusCode).toBe(200);
  const login = await post("/api/auth/sign-in/email", { email, password: PASSWORD });
  expect(login.statusCode).toBe(200);
  emailSender.messages.length = 0;
  return sessionCookie(login);
}

async function challenge(email: string): Promise<string> {
  // The inject transport gives every request the same socket address, so the IP-keyed
  // second-factor limiters would otherwise pool unrelated sign-ins. Only those scopes are reset;
  // the account-security limiter under test is left alone.
  await database.pool.query(
    `delete from security_rate_limit_windows where scope in ('auth-sign-in', 'auth-two-factor', 'auth-second-factor-pending')`,
  );
  const login = await post("/api/auth/sign-in/email", { email, password: PASSWORD });
  expect(login.json()).toMatchObject({ twoFactorRedirect: true });
  return cookies(login)
    .filter((value) => !value.includes("Max-Age=0"))
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

async function attemptTotpLogin(email: string, code: string): Promise<number> {
  const response = await post("/api/auth/two-factor/verify-totp", { code }, await challenge(email));
  return response.statusCode;
}

async function attemptBackupLogin(email: string, code: string): Promise<number> {
  const response = await post(
    "/api/auth/two-factor/verify-backup-code",
    { code },
    await challenge(email),
  );
  return response.statusCode;
}

async function signInWithTotp(email: string, secret: string): Promise<string> {
  const response = await post(
    "/api/auth/two-factor/verify-totp",
    { code: await totp(secret) },
    await challenge(email),
  );
  expect(response.statusCode).toBe(200);
  return sessionCookie(response);
}

async function totp(secret: string): Promise<string> {
  return (await auth.api.generateTOTP({ body: { secret } })).code;
}

function secretFromUri(uri: string): string {
  return new TextDecoder().decode(base32.decode(new URL(uri).searchParams.get("secret") ?? ""));
}

async function factorRow(userId: string) {
  const [row] = await database.db
    .select({
      secret: twoFactor.secret,
      backupCodes: twoFactor.backupCodes,
      verified: twoFactor.verified,
      failures: twoFactor.failedVerificationCount,
      lockedUntil: twoFactor.lockedUntil,
      enabled: user.twoFactorEnabled,
    })
    .from(twoFactor)
    .innerJoin(user, eq(user.id, twoFactor.userId))
    .where(eq(twoFactor.userId, userId));
  if (!row) throw new Error("two_factor row missing: 2FA must never be removed");
  return row;
}

/** Samples the live factor state from a second connection while a request is in flight. */
function watchFactorState(userId: string) {
  let running = true;
  let samples = 0;
  let everDisabled = false;
  const loop = (async () => {
    while (running) {
      const result = await database.pool.query<{ enabled: boolean; verified: boolean | null }>(
        `select u.two_factor_enabled as enabled, t.verified as verified
         from "user" u left join two_factor t on t.user_id = u.id where u.id = $1`,
        [userId],
      );
      samples += 1;
      const row = result.rows[0];
      if (!row || row.enabled !== true || row.verified !== true) everDisabled = true;
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      return { samples, everDisabled };
    },
  };
}

async function sessionCount(userId: string): Promise<number> {
  const [row] = await database.db
    .select({ value: count() })
    .from(session)
    .where(eq(session.userId, userId));
  return row?.value ?? 0;
}

async function pendingCount(userId: string): Promise<number> {
  const [row] = await database.db
    .select({ value: count() })
    .from(verification)
    .where(eq(verification.identifier, `authenticator-replace:${userId}`));
  return row?.value ?? 0;
}

async function eventTypes(userId: string): Promise<string[]> {
  const rows = await database.db
    .select({ type: authSecurityEvents.eventType })
    .from(authSecurityEvents)
    .where(eq(authSecurityEvents.userId, userId));
  return rows.map((row) => row.type);
}

async function eventCount(userId: string, type: string): Promise<number> {
  const [row] = await database.db
    .select({ value: count() })
    .from(authSecurityEvents)
    .where(
      and(
        eq(authSecurityEvents.userId, userId),
        eq(
          authSecurityEvents.eventType,
          type as (typeof authSecurityEvents.$inferSelect)["eventType"],
        ),
      ),
    );
  return row?.value ?? 0;
}

function sentKinds(email: string): string[] {
  return emailSender.messages.filter((m) => m.recipient === email).map((m) => m.kind);
}

function get(url: string, cookie?: string): Promise<InjectResponse> {
  return app.inject({
    method: "GET",
    url,
    headers: { ...(cookie ? { cookie } : {}), "x-real-ip": nextIp() },
  });
}

function post(
  url: string,
  payload: Record<string, unknown>,
  cookie?: string,
): Promise<InjectResponse> {
  return app.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-real-ip": nextIp(),
      ...(cookie ? { cookie } : {}),
    },
    payload,
  });
}

function nextIp(): string {
  counter += 1;
  return `198.51.100.${(counter % 250) + 1}`;
}

function cookies(response: InjectResponse): string[] {
  const header = response.headers["set-cookie"];
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

function sessionCookie(response: InjectResponse): string {
  const header = cookies(response).find((value) => value.includes("session_token"));
  expect(header).toBeDefined();
  return header?.split(";", 1)[0] ?? "";
}
