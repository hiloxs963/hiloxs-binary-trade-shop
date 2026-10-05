import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { base32 } from "@better-auth/utils/base32";
import { and, count, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService, type AuthService } from "../../src/auth/auth.js";
import { digestClientIp, digestPendingLogin } from "../../src/auth/email-otp/codes.js";
import {
  InMemoryAuthEmailSender,
  type AuthEmail,
  type AuthEmailSender,
} from "../../src/auth/email.js";
import {
  assertSafeTestDatabaseUrl,
  parseEnv,
  requireDatabaseUrl,
  resolveAuthRuntimeConfig,
  type EmailOtpConfig,
} from "../../src/config/env.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { session, twoFactor, user } from "../../src/db/schema/auth.js";
import {
  authSecurityEvents,
  emailOtpChallenges,
  emailOtpEnrollments,
} from "../../src/db/schema/email-otp.js";
import { requireStaffPermission } from "../../src/staff/authorization.js";
import { bootstrapStaffMembership } from "../../src/staff/bootstrap-service.js";
import { EmailDeliveryError, StaffReauthRequiredError } from "../../src/lib/errors.js";

const ORIGIN = "http://localhost:8080";
const PASSWORD = "StrongPassword!42";
const NEW_PASSWORD = "NewStrongPassword!43";
const OTP_CONFIG: EmailOtpConfig = {
  enabled: true,
  hmacKey: "test-only-email-otp-hmac-key-0123456789abcdef",
};

const env = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(env);
assertSafeTestDatabaseUrl(databaseUrl, env.NODE_ENV);
const runtime = resolveAuthRuntimeConfig(env);

let database: DatabaseClient;
let auth: AuthService;
let app: FastifyInstance;
let counter = 0;
const emailSender = new InMemoryAuthEmailSender();
const extraClosers: Array<() => Promise<void>> = [];

async function buildTestApp(
  sender: AuthEmailSender,
  emailOtp?: EmailOtpConfig,
  appDatabase: DatabaseClient = createDatabaseClient(databaseUrl),
): Promise<{ app: FastifyInstance; auth: AuthService }> {
  const service = createAuthService({
    database: appDatabase,
    emailSender: sender,
    runtime,
    ...(emailOtp ? { emailOtp } : {}),
  });
  const built = await buildApp({
    database: appDatabase,
    auth: service,
    authRuntime: runtime,
    allowedOrigins: runtime.trustedOrigins,
  });
  extraClosers.push(() => built.close());
  return { app: built, auth: service };
}

beforeAll(async () => {
  database = createDatabaseClient(databaseUrl);
  await migrate(database.db, { migrationsFolder: resolve("src/db/migrations") });
  ({ app, auth } = await buildTestApp(emailSender, OTP_CONFIG, database));
});

beforeEach(async () => {
  await database.pool.query(
    'truncate table "security_rate_limit_windows", "verification", "session", "account", "user" cascade',
  );
  emailSender.messages.length = 0;
});

afterAll(async () => {
  for (const close of extraClosers) await close();
});

type Account = {
  email: string;
  userId: string;
  secret: string;
  backupCodes: string[];
  cookie: string;
};

describe("email OTP second factor", () => {
  it("is invisible and answers 404 when the feature flag is off", async () => {
    const { app: disabledApp } = await buildTestApp(emailSender);
    const account = await provision("flag-off@example.com");

    const login = await signIn(account.email, { target: disabledApp });
    expect(login.json<{ twoFactorMethods: string[] }>().twoFactorMethods).toEqual(["totp"]);
    const cookie = challengeCookie(login);
    expect(
      (await post("/api/auth/email-otp/send", {}, { cookie, target: disabledApp })).statusCode,
    ).toBe(404);
    expect((await get("/api/auth/email-otp/status", account.cookie, disabledApp)).statusCode).toBe(
      404,
    );
    expect(
      (
        await post(
          "/api/auth/email-otp/enroll",
          { code: "123456" },
          { cookie: account.cookie, target: disabledApp },
        )
      ).statusCode,
    ).toBe(404);
    // TOTP is untouched.
    const completed = await post(
      "/api/auth/two-factor/verify-totp",
      { code: await totpCode(account.secret) },
      { cookie, target: disabledApp },
    );
    expect(completed.statusCode).toBe(200);
  });

  it("answers 404 for the built-in two-factor OTP endpoints even when enabled", async () => {
    const account = await provision("builtin-otp@example.com");
    const login = await signIn(account.email);
    const cookie = challengeCookie(login);

    for (const path of ["/api/auth/two-factor/send-otp", "/api/auth/two-factor/verify-otp"]) {
      const response = await post(path, { code: "123456" }, { cookie });
      expect(response.statusCode).toBe(404);
    }
  });

  describe("enrollment", () => {
    it("requires a current TOTP code and notifies the user", async () => {
      const account = await provision("enroll@example.com");

      const wrong = await post(
        "/api/auth/email-otp/enroll",
        { code: "000000" },
        { cookie: account.cookie },
      );
      expect(wrong.statusCode).toBe(401);
      expect(await enrollmentCount()).toBe(0);

      const enrolled = await enroll(account);
      expect(enrolled.statusCode).toBe(200);
      expect(await enrollmentCount()).toBe(1);
      expect(sentKinds(account.email)).toContain("email-otp-enabled");
      expect(await eventTypes()).toContain("EMAIL_OTP_ENROLLED");
      const status = await get("/api/auth/email-otp/status", account.cookie);
      expect(status.json()).toEqual({ enrolled: true, eligible: true });
    });

    it("refuses accounts without a verified TOTP enrollment", async () => {
      const cookie = await createSession("no-totp@example.com");
      const response = await post("/api/auth/email-otp/enroll", { code: "123456" }, { cookie });

      expect(response.statusCode).toBe(403);
      expect(await enrollmentCount()).toBe(0);
    });

    it("requires a TOTP code to disable and notifies the user", async () => {
      const account = await provision("disable@example.com");
      await enroll(account);

      const wrong = await post(
        "/api/auth/email-otp/disable",
        { code: "000000" },
        { cookie: account.cookie },
      );
      expect(wrong.statusCode).toBe(401);
      expect(await enrollmentCount()).toBe(1);

      const disabled = await post(
        "/api/auth/email-otp/disable",
        { code: await totpCode(account.secret) },
        { cookie: account.cookie },
      );
      expect(disabled.statusCode).toBe(200);
      expect(await enrollmentCount()).toBe(0);
      expect(sentKinds(account.email)).toContain("email-otp-disabled");
      expect(await eventTypes()).toContain("EMAIL_OTP_DISABLED");
    });
  });

  describe("login", () => {
    it("offers email as a method only to enrolled accounts, then completes sign-in with the code", async () => {
      const plain = await provision("plain-method@example.com");
      expect(
        (await signIn(plain.email)).json<{ twoFactorMethods: string[] }>().twoFactorMethods,
      ).toEqual(["totp"]);

      const account = await provision("login-method@example.com");
      await enroll(account);
      const login = await signIn(account.email);
      expect(login.json<{ twoFactorMethods: string[] }>().twoFactorMethods).toEqual([
        "totp",
        "email-otp",
      ]);
      const cookie = challengeCookie(login);

      const sent = await post("/api/auth/email-otp/send", {}, { cookie });
      expect(sent.statusCode).toBe(200);
      const message = lastOtp(account.email);
      expect(message.url).toBeUndefined();
      expect(message.code).toMatch(/^\d{6}$/);
      const rendered = (await import("../../src/auth/email-templates.js")).renderAuthEmail(message);
      expect(rendered.subject).not.toContain(message.code);
      expect(rendered.text).not.toMatch(/https?:\/\//);
      expect(rendered.html).not.toMatch(/<a /);

      // Only a keyed hash is stored: never the code.
      const [stored] = await database.db.select().from(emailOtpChallenges);
      expect(stored?.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(message.code);

      const verified = await post("/api/auth/email-otp/verify", { code: message.code }, { cookie });
      expect(verified.statusCode).toBe(200);
      const sessionToken = sessionCookie(verified);
      const me = await get("/api/v1/users/me", sessionToken);
      expect(me.statusCode).toBe(200);
      expect(await sessionCount(account.userId, "email-otp")).toBe(1);
      expect(await eventTypes()).toEqual(
        expect.arrayContaining(["EMAIL_OTP_SENT", "EMAIL_OTP_VERIFIED"]),
      );
    });

    it("rejects an expired code", async () => {
      const { account, cookie, code } = await challengedLogin("expired@example.com");
      await database.pool.query(
        "update email_otp_challenges set created_at = created_at - interval '20 minutes', sent_at = sent_at - interval '20 minutes', expires_at = expires_at - interval '20 minutes'",
      );

      const response = await post("/api/auth/email-otp/verify", { code }, { cookie });

      expect(response.statusCode).toBe(401);
      expect(response.json<{ code: string }>().code).toBe("INVALID_SECOND_FACTOR_CODE");
      expect(await sessionCount(account.userId, "email-otp")).toBe(0);
    });

    it("rejects reuse of a spent code", async () => {
      const { account, cookie, code } = await challengedLogin("reuse@example.com");
      expect((await post("/api/auth/email-otp/verify", { code }, { cookie })).statusCode).toBe(200);

      const replay = await post("/api/auth/email-otp/verify", { code }, { cookie });

      expect(replay.statusCode).toBe(401);
      expect(await sessionCount(account.userId, "email-otp")).toBe(1);
    });

    it("locks the challenge after five wrong attempts, even for the right code", async () => {
      const { account, cookie, code } = await challengedLogin("attempts@example.com");
      const wrong = code === "000000" ? "111111" : "000000";

      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(
          (await post("/api/auth/email-otp/verify", { code: wrong }, { cookie })).statusCode,
        ).toBe(401);
      }
      const afterLockout = await post("/api/auth/email-otp/verify", { code }, { cookie });

      expect(afterLockout.statusCode).toBe(401);
      expect(await sessionCount(account.userId, "email-otp")).toBe(0);
      const events = await eventTypes();
      expect(events.filter((type) => type === "EMAIL_OTP_FAILED")).toHaveLength(6);
      expect(events).toContain("EMAIL_OTP_LOCKED");
      const [challenge] = await database.db.select().from(emailOtpChallenges);
      expect(challenge?.attempts).toBe(5);
      expect(challenge?.invalidatedAt).not.toBeNull();
    });

    it("refuses email codes while the account-level two-factor lock is active", async () => {
      const { account, cookie, code } = await challengedLogin("account-lock@example.com");
      await database.db
        .update(twoFactor)
        .set({ lockedUntil: new Date(Date.now() + 10 * 60_000) })
        .where(eq(twoFactor.userId, account.userId));

      const response = await post("/api/auth/email-otp/verify", { code }, { cookie });

      expect(response.statusCode).toBe(429);
      expect(await sessionCount(account.userId, "email-otp")).toBe(0);
      expect(await eventTypes()).toContain("EMAIL_OTP_LOCKED");
    });

    it("invalidates the previous code when a new one is sent", async () => {
      const { cookie, code: first } = await challengedLogin("resend@example.com");
      await ageSends(2);
      expect((await post("/api/auth/email-otp/send", {}, { cookie })).statusCode).toBe(200);
      const second = lastOtp("resend@example.com").code;
      expect(second).not.toBe(first);

      const live = await database.db
        .select({ total: count() })
        .from(emailOtpChallenges)
        .where(sql`consumed_at is null and invalidated_at is null`);
      expect(live[0]?.total).toBe(1);

      expect(
        (await post("/api/auth/email-otp/verify", { code: first }, { cookie })).statusCode,
      ).toBe(401);
      expect(
        (await post("/api/auth/email-otp/verify", { code: second }, { cookie })).statusCode,
      ).toBe(200);
    });

    it("binds a code to the pending login and user it was issued for", async () => {
      const first = await challengedLogin("bind-a@example.com");
      const second = await signIn(first.account.email);
      const secondCookie = challengeCookie(second);
      await ageSends(2);
      await post("/api/auth/email-otp/send", {}, { cookie: secondCookie });
      const secondCode = lastOtp(first.account.email).code;

      // The first login's code is dead for the second pending login (and vice versa).
      expect(
        (await post("/api/auth/email-otp/verify", { code: first.code }, { cookie: secondCookie }))
          .statusCode,
      ).toBe(401);

      const other = await challengedLogin("bind-b@example.com");
      expect(
        (await post("/api/auth/email-otp/verify", { code: other.code }, { cookie: first.cookie }))
          .statusCode,
      ).toBe(401);
      expect(
        (await post("/api/auth/email-otp/verify", { code: secondCode }, { cookie: secondCookie }))
          .statusCode,
      ).toBe(200);
    });

    it("issues exactly one session when two valid codes race for one pending login", async () => {
      const same = await challengedLogin("race-same@example.com");
      const sameResults = await Promise.all([
        post("/api/auth/email-otp/verify", { code: same.code }, { cookie: same.cookie }),
        post("/api/auth/email-otp/verify", { code: same.code }, { cookie: same.cookie }),
      ]);
      expect(sameResults.map((result) => result.statusCode).sort()).toEqual([200, 401]);
      expect(await totalSessions(same.account.userId)).toBe(
        await baselineSessions(same.account.userId, 1),
      );

      // An email code and a TOTP code, both valid, submitted together for the same login.
      const mixed = await challengedLogin("race-mixed@example.com");
      const mixedResults = await Promise.all([
        post("/api/auth/email-otp/verify", { code: mixed.code }, { cookie: mixed.cookie }),
        post(
          "/api/auth/two-factor/verify-totp",
          { code: await totpCode(mixed.account.secret) },
          { cookie: mixed.cookie },
        ),
      ]);
      const winners = mixedResults.filter((result) => result.statusCode === 200);
      expect(winners).toHaveLength(1);
      expect(await totalSessions(mixed.account.userId)).toBe(
        await baselineSessions(mixed.account.userId, 1),
      );
    });

    it("enforces the 60 second resend cooldown", async () => {
      const { cookie } = await challengedLogin("cooldown@example.com");

      const tooSoon = await post("/api/auth/email-otp/send", {}, { cookie });

      expect(tooSoon.statusCode).toBe(429);
      expect(emailSender.messages.filter((message) => message.kind === "email-otp")).toHaveLength(
        1,
      );
      expect(await eventTypes()).toContain("EMAIL_OTP_RATE_LIMITED");
    });

    it("caps sends per account per hour", async () => {
      const { cookie } = await challengedLogin("account-cap@example.com");
      for (let sent = 1; sent < 5; sent += 1) {
        await ageSends(2);
        expect((await post("/api/auth/email-otp/send", {}, { cookie })).statusCode).toBe(200);
      }
      await ageSends(2);

      const capped = await post("/api/auth/email-otp/send", {}, { cookie });

      expect(capped.statusCode).toBe(429);
      expect(emailSender.messages.filter((message) => message.kind === "email-otp")).toHaveLength(
        5,
      );
    });

    it("caps sends per IP per hour across accounts", async () => {
      const account = await provision("ip-cap@example.com");
      await enroll(account);
      // The app has no trusted proxy configuration, so injected requests all come from loopback.
      const ipDigest = digestClientIp(runtime.secret, "127.0.0.1");
      const filler = await provision("ip-cap-filler@example.com");
      await database.db.insert(emailOtpChallenges).values(
        Array.from({ length: 20 }, () => ({
          userId: filler.userId,
          pendingDigest: digestPendingLogin("filler", randomUUID()),
          codeHash: "0".repeat(64),
          ipDigest,
          expiresAt: new Date(Date.now() + 60_000),
          invalidatedAt: new Date(),
        })),
      );
      const cookie = challengeCookie(await signIn(account.email));

      const capped = await post("/api/auth/email-otp/send", {}, { cookie });

      expect(capped.statusCode).toBe(429);
    });

    it("keeps TOTP working when the provider is down, and does not leave a live code", async () => {
      const failing = new RejectingSender();
      const { app: failingApp } = await buildTestApp(failing, OTP_CONFIG);
      const account = await provision("provider-down@example.com");
      await enroll(account);
      const login = await signIn(account.email, { target: failingApp });
      const cookie = challengeCookie(login);

      const sent = await post("/api/auth/email-otp/send", {}, { cookie, target: failingApp });
      const retry = await post("/api/auth/email-otp/send", {}, { cookie, target: failingApp });

      expect(sent.statusCode).toBe(503);
      expect(sent.json<{ code: string }>().code).toBe("EMAIL_OTP_SEND_FAILED");
      // A failed send does not start the cooldown, so an immediate retry is attempted (and fails).
      expect(retry.statusCode).toBe(503);
      const live = await database.db
        .select({ total: count() })
        .from(emailOtpChallenges)
        .where(sql`consumed_at is null and invalidated_at is null`);
      expect(live[0]?.total).toBe(0);
      expect(await eventTypes()).toContain("EMAIL_OTP_SEND_FAILED");
      const totp = await post(
        "/api/auth/two-factor/verify-totp",
        { code: await totpCode(account.secret) },
        { cookie, target: failingApp },
      );
      expect(totp.statusCode).toBe(200);
    });
  });

  describe("recovery", () => {
    it("requires TOTP on the first login after a password reset, then restores email codes", async () => {
      const account = await provision("recovery@example.com");
      await enroll(account);
      emailSender.messages.length = 0;

      await post("/api/auth/request-password-reset", { email: account.email });
      const resetMessage = emailSender.messages.find(
        (message) => message.kind === "password-reset",
      );
      const token =
        new URLSearchParams(new URL(resetMessage?.url ?? "").hash.slice(1)).get("token") ?? "";
      const reset = await post("/api/auth/reset-password", { newPassword: NEW_PASSWORD, token });
      expect(reset.statusCode).toBe(200);
      await waitFor(() => sentKinds(account.email).includes("password-reset-notice"));

      const [flag] = await database.db.select().from(emailOtpEnrollments);
      expect(flag?.requireTotpNextLogin).toBe(true);
      const login = await signIn(account.email, { password: NEW_PASSWORD });
      expect(login.json<{ twoFactorMethods: string[] }>().twoFactorMethods).toEqual(["totp"]);
      const cookie = challengeCookie(login);

      // Even a direct request cannot use email for this login.
      const blocked = await post("/api/auth/email-otp/send", {}, { cookie });
      expect(blocked.statusCode).toBe(403);
      expect(emailSender.messages.some((message) => message.kind === "email-otp")).toBe(false);
      expect(await eventTypes()).toContain("EMAIL_OTP_BLOCKED_AFTER_RESET");

      const totp = await post(
        "/api/auth/two-factor/verify-totp",
        { code: await totpCode(account.secret) },
        { cookie },
      );
      expect(totp.statusCode).toBe(200);
      const [cleared] = await database.db.select().from(emailOtpEnrollments);
      expect(cleared?.requireTotpNextLogin).toBe(false);
      const next = await signIn(account.email, { password: NEW_PASSWORD });
      expect(next.json<{ twoFactorMethods: string[] }>().twoFactorMethods).toEqual([
        "totp",
        "email-otp",
      ]);
    });

    it("does not notify accounts that never enrolled", async () => {
      const account = await provision("recovery-plain@example.com");
      emailSender.messages.length = 0;
      await post("/api/auth/request-password-reset", { email: account.email });
      const resetMessage = emailSender.messages.find(
        (message) => message.kind === "password-reset",
      );
      const token =
        new URLSearchParams(new URL(resetMessage?.url ?? "").hash.slice(1)).get("token") ?? "";
      await post("/api/auth/reset-password", { newPassword: NEW_PASSWORD, token });
      await new Promise((settle) => setTimeout(settle, 100));

      expect(sentKinds(account.email)).not.toContain("password-reset-notice");
    });
  });

  describe("staff", () => {
    it("drops an existing enrollment when a staff membership is created and refuses new ones", async () => {
      const account = await provision("future-staff@example.com");
      await enroll(account);
      await bootstrapStaffMembership(database, {
        userId: account.userId,
        role: "STAFF",
        permissions: ["SELLER_REVIEW"],
        requestId: `test-${randomUUID()}`,
      });

      expect(await enrollmentCount()).toBe(0);
      expect(await eventTypes()).toContain("EMAIL_OTP_DISABLED_BY_STAFF_MEMBERSHIP");
      await new Promise((settle) => setTimeout(settle, 5));
      const login = await signIn(account.email);
      expect(login.json<{ twoFactorMethods: string[] }>().twoFactorMethods).toEqual(["totp"]);
      const sessionCookieValue = await completeTotp(account, login);

      const refused = await post(
        "/api/auth/email-otp/enroll",
        { code: await totpCode(account.secret) },
        { cookie: sessionCookieValue },
      );
      expect(refused.statusCode).toBe(403);
      expect(await enrollmentCount()).toBe(0);
      expect(await eventTypes()).toContain("EMAIL_OTP_BLOCKED_STAFF");
    });

    it("rejects staff authority on a session opened with an emailed code", async () => {
      const account = await provision("staff-session@example.com");
      await bootstrapStaffMembership(database, {
        userId: account.userId,
        role: "STAFF",
        permissions: ["SELLER_REVIEW"],
        requestId: `test-${randomUUID()}`,
      });
      await new Promise((settle) => setTimeout(settle, 5));
      const login = await signIn(account.email);
      const staffCookie = await completeTotp(account, login);

      const allowed = await requireStaffPermission(
        auth,
        database,
        { cookie: staffCookie },
        "SELLER_REVIEW",
      );
      expect(allowed.actor.userId).toBe(account.userId);

      await database.db
        .update(session)
        .set({ mfaMethod: "email-otp" })
        .where(eq(session.userId, account.userId));
      await expect(
        requireStaffPermission(auth, database, { cookie: staffCookie }, "SELLER_REVIEW"),
      ).rejects.toBeInstanceOf(StaffReauthRequiredError);
    });

    it("lets staff sign in with a backup code", async () => {
      const account = await provision("staff-backup@example.com");
      await bootstrapStaffMembership(database, {
        userId: account.userId,
        role: "STAFF",
        permissions: ["SELLER_REVIEW"],
        requestId: `test-${randomUUID()}`,
      });
      await new Promise((settle) => setTimeout(settle, 5));
      const cookie = challengeCookie(await signIn(account.email));

      const completed = await post(
        "/api/auth/two-factor/verify-backup-code",
        { code: account.backupCodes[0] },
        { cookie },
      );

      expect(completed.statusCode).toBe(200);
      const allowed = await requireStaffPermission(
        auth,
        database,
        { cookie: sessionCookie(completed) },
        "SELLER_REVIEW",
      );
      expect(allowed.actor.userId).toBe(account.userId);
    });
  });

  describe("backup-code login", () => {
    it("audits success and failure and tags the session", async () => {
      const account = await provision("backup-audit@example.com");
      const cookie = challengeCookie(await signIn(account.email));

      const wrong = await post(
        "/api/auth/two-factor/verify-backup-code",
        { code: "not-a-code" },
        { cookie },
      );
      expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
      const ok = await post(
        "/api/auth/two-factor/verify-backup-code",
        { code: account.backupCodes[0] },
        { cookie },
      );

      expect(ok.statusCode).toBe(200);
      const events = await eventTypes();
      expect(events).toEqual(
        expect.arrayContaining(["BACKUP_CODE_LOGIN_FAILED", "BACKUP_CODE_LOGIN_SUCCEEDED"]),
      );
      const [created] = await database.db
        .select({ mfaMethod: session.mfaMethod })
        .from(session)
        .where(and(eq(session.userId, account.userId), eq(session.mfaMethod, "backup-code")));
      expect(created?.mfaMethod).toBe("backup-code");
      const [event] = await database.db
        .select()
        .from(authSecurityEvents)
        .where(eq(authSecurityEvents.eventType, "BACKUP_CODE_LOGIN_SUCCEEDED"));
      expect(JSON.stringify(event)).not.toContain(account.backupCodes[0] ?? "unreachable");
    });

    it("rate limits attempts per pending login", async () => {
      const account = await provision("backup-limit@example.com");
      const cookie = challengeCookie(await signIn(account.email));

      let last = 0;
      for (let attempt = 0; attempt < 11; attempt += 1) {
        last = (
          await post("/api/auth/two-factor/verify-backup-code", { code: "wrong-code" }, { cookie })
        ).statusCode;
      }

      expect(last).toBe(429);
    });
  });

  it("never writes a code into the audit log", async () => {
    const { code, account } = await challengedLogin("audit-clean@example.com");
    const events = await database.db
      .select()
      .from(authSecurityEvents)
      .where(eq(authSecurityEvents.userId, account.userId));

    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(code);
  });
});

// --- helpers -------------------------------------------------------------------------------

class RejectingSender implements AuthEmailSender {
  readonly messages: AuthEmail[] = [];
  send(message: AuthEmail): Promise<void> {
    // Verification mail must still work during provisioning; only the OTP is refused.
    if (message.kind === "email-otp") {
      return Promise.reject(new EmailDeliveryError(new Error("provider rejected the request")));
    }
    this.messages.push(message);
    return Promise.resolve();
  }
}

async function request(
  method: "GET" | "POST",
  url: string,
  payload: Record<string, unknown> | undefined,
  options: { cookie?: string; ip?: string; target?: FastifyInstance },
): Promise<InjectResponse> {
  counter += 1;
  const ip = options.ip ?? `198.51.100.${(counter % 250) + 1}`;
  return (options.target ?? app).inject({
    method,
    url,
    headers: {
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      origin: ORIGIN,
      "x-real-ip": ip,
      "x-forwarded-for": options.ip ? options.ip : `192.0.2.${counter}`,
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(payload ? { payload } : {}),
  });
}

function post(
  url: string,
  payload: Record<string, unknown>,
  options: { cookie?: string; ip?: string; target?: FastifyInstance } = {},
): Promise<InjectResponse> {
  return request("POST", url, payload, options);
}

function get(url: string, cookie: string, target?: FastifyInstance): Promise<InjectResponse> {
  return request("GET", url, undefined, { cookie, ...(target ? { target } : {}) });
}

function cookieValues(response: InjectResponse): string[] {
  const header = response.headers["set-cookie"];
  const all = header ? (Array.isArray(header) ? header : [header]) : [];
  return all
    .filter((value) => !value.includes("Max-Age=0"))
    .map((value) => value.split(";", 1)[0] ?? "");
}

function challengeCookie(response: InjectResponse): string {
  const cookies = cookieValues(response).filter((value) => value.includes("two_factor"));
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.join("; ");
}

function sessionCookie(response: InjectResponse): string {
  const cookie = cookieValues(response).find((value) => value.includes("session_token"));
  expect(cookie).toBeDefined();
  return cookie ?? "";
}

async function createSession(email: string): Promise<string> {
  const registration = await post("/api/auth/sign-up/email", {
    name: "Email OTP Test User",
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
  const verified = await post("/api/v1/auth/verify-email", { token });
  expect(verified.statusCode).toBe(200);
  const login = await post("/api/auth/sign-in/email", { email, password: PASSWORD });
  expect(login.statusCode).toBe(200);
  return sessionCookie(login);
}

async function provision(email: string): Promise<Account> {
  const initial = await createSession(email);
  const enabled = await post(
    "/api/auth/two-factor/enable",
    { password: PASSWORD },
    { cookie: initial },
  );
  const body = enabled.json<{ totpURI: string; backupCodes: string[] }>();
  const secret = new TextDecoder().decode(
    base32.decode(new URL(body.totpURI).searchParams.get("secret") ?? ""),
  );
  const verified = await post(
    "/api/auth/two-factor/verify-totp",
    { code: await totpCode(secret) },
    { cookie: initial },
  );
  expect(verified.statusCode).toBe(200);
  const [profile] = await database.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  return {
    email,
    userId: profile?.id ?? "",
    secret,
    backupCodes: body.backupCodes,
    cookie: sessionCookie(verified),
  };
}

async function totpCode(secret: string): Promise<string> {
  return (await auth.api.generateTOTP({ body: { secret } })).code;
}

async function enroll(account: Account): Promise<InjectResponse> {
  return post(
    "/api/auth/email-otp/enroll",
    { code: await totpCode(account.secret) },
    { cookie: account.cookie },
  );
}

async function signIn(
  email: string,
  options: { password?: string; target?: FastifyInstance } = {},
): Promise<InjectResponse> {
  const response = await post(
    "/api/auth/sign-in/email",
    { email, password: options.password ?? PASSWORD },
    options.target ? { target: options.target } : {},
  );
  expect(response.json()).toMatchObject({ twoFactorRedirect: true });
  return response;
}

async function completeTotp(account: Account, login: InjectResponse): Promise<string> {
  const completed = await post(
    "/api/auth/two-factor/verify-totp",
    { code: await totpCode(account.secret) },
    { cookie: challengeCookie(login) },
  );
  expect(completed.statusCode).toBe(200);
  return sessionCookie(completed);
}

/** Enrolls a fresh account, signs in with the password, and requests the first emailed code. */
async function challengedLogin(email: string) {
  const account = await provision(email);
  await enroll(account);
  const cookie = challengeCookie(await signIn(email));
  const sent = await post("/api/auth/email-otp/send", {}, { cookie });
  expect(sent.statusCode).toBe(200);
  return { account, cookie, code: lastOtp(email).code };
}

function lastOtp(email: string): Extract<AuthEmail, { kind: "email-otp" }> {
  const messages = emailSender.messages.filter(
    (message): message is Extract<AuthEmail, { kind: "email-otp" }> =>
      message.kind === "email-otp" && message.recipient === email,
  );
  const last = messages.at(-1);
  expect(last).toBeDefined();
  return last as Extract<AuthEmail, { kind: "email-otp" }>;
}

function sentKinds(email: string): string[] {
  return emailSender.messages
    .filter((message) => message.recipient === email)
    .map((message) => message.kind);
}

async function eventTypes(): Promise<string[]> {
  const rows = await database.db
    .select({ eventType: authSecurityEvents.eventType })
    .from(authSecurityEvents)
    .orderBy(authSecurityEvents.createdAt);
  return rows.map((row) => row.eventType);
}

async function enrollmentCount(): Promise<number> {
  const [row] = await database.db.select({ total: count() }).from(emailOtpEnrollments);
  return row?.total ?? 0;
}

async function sessionCount(userId: string, method: string): Promise<number> {
  const [row] = await database.db
    .select({ total: count() })
    .from(session)
    .where(and(eq(session.userId, userId), eq(session.mfaMethod, method as "email-otp")));
  return row?.total ?? 0;
}

async function totalSessions(userId: string): Promise<number> {
  const [row] = await database.db
    .select({ total: count() })
    .from(session)
    .where(eq(session.userId, userId));
  return row?.total ?? 0;
}

/** Sessions that existed before the login under test (enrollment) plus the expected new ones. */
async function baselineSessions(userId: string, added: number): Promise<number> {
  const [row] = await database.db
    .select({ total: count() })
    .from(session)
    .where(and(eq(session.userId, userId), eq(session.mfaMethod, "none")));
  const [totp] = await database.db
    .select({ total: count() })
    .from(session)
    .where(and(eq(session.userId, userId), eq(session.mfaMethod, "totp")));
  return (row?.total ?? 0) + (totp?.total ?? 0) + added;
}

/** Moves recorded send times back so the 60 second cooldown has elapsed (hour caps still count). */
async function ageSends(minutes: number): Promise<void> {
  await database.pool.query(
    `update email_otp_challenges set sent_at = sent_at - interval '${minutes} minutes' where sent_at is not null`,
  );
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((settle) => setTimeout(settle, 20));
  }
}
