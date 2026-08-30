import { resolve } from "node:path";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { session, user, verification } from "../../src/db/schema/auth.js";

const FRONTEND_ORIGIN = "http://localhost:8080";
const VERIFIED_CALLBACK = `${FRONTEND_ORIGIN}/verify-email?verified=true`;
const RESET_CALLBACK = `${FRONTEND_ORIGIN}/reset-password`;
const ORIGINAL_PASSWORD = "StrongPassword!42";
const NEW_PASSWORD = "NewStrongPassword!43";

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
  await database.pool.query('truncate table "verification", "session", "account", "user" cascade');
  emailSender.messages.length = 0;
});

afterAll(async () => {
  await app.close();
});

describe("email and password authentication", () => {
  it("registers a normalized account without creating a session", async () => {
    const response = await register("Customer@Example.COM", "0712 345 678");
    const [stored] = await database.db
      .select({
        email: user.email,
        phone: user.phone,
        status: user.status,
        verified: user.emailVerified,
      })
      .from(user);

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(stored).toEqual({
      email: "customer@example.com",
      phone: "+254712345678",
      status: "ACTIVE",
      verified: false,
    });
    expect(emailSender.messages).toHaveLength(1);
    expect(emailSender.messages[0]).toMatchObject({
      kind: "verification",
      recipient: "customer@example.com",
    });
  });

  it("returns an enumeration-resistant response for duplicate registration", async () => {
    const first = await register("duplicate@example.com");
    const duplicate = await register("DUPLICATE@example.com");
    const userCounts = await database.db.select({ value: count() }).from(user);

    expect(first.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(200);
    expect(Object.keys(duplicate.json()).sort()).toEqual(Object.keys(first.json()).sort());
    expect(duplicate.body.toLowerCase()).not.toContain("already exists");
    expect(userCounts[0]?.value).toBe(1);
  });

  it("requires email verification before login and issues a secure-shaped cookie afterward", async () => {
    await register("verified@example.com");
    const blocked = await login("verified@example.com", ORIGINAL_PASSWORD);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.headers["set-cookie"]).toBeUndefined();

    await verifyRegistrationEmail();
    const authenticated = await login("verified@example.com", ORIGINAL_PASSWORD);
    const setCookie = cookieHeaders(authenticated).join("; ");

    expect(authenticated.statusCode).toBe(200);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("SameSite=None");
    expect(authenticated.body).not.toContain("sessionToken");
  });

  it("accepts an email verification token only once", async () => {
    await register("one-time-verification@example.com");
    const message = emailSender.messages.find((email) => email.kind === "verification");
    const verificationUrl = new URL(message?.url ?? "");
    const rawToken = verificationUrl.searchParams.get("token") ?? "";
    const path = `${verificationUrl.pathname}${verificationUrl.search}`;
    const [storedToken] = await database.db
      .select({ identifier: verification.identifier })
      .from(verification);

    const first = await app.inject({ method: "GET", url: path });
    const replay = await app.inject({ method: "GET", url: path });
    const replayLocation = new URL(replay.headers.location ?? "", FRONTEND_ORIGIN);

    expect(first.statusCode).toBe(302);
    expect(storedToken?.identifier).not.toContain(rawToken);
    expect(replay.statusCode).toBe(302);
    expect(replayLocation.searchParams.get("error")).toBe("INVALID_TOKEN");
  });

  it("emits a secure host-only cookie for the production cross-origin flow", async () => {
    const productionDatabase = createDatabaseClient(databaseUrl);
    const productionEmailSender = new InMemoryAuthEmailSender();
    const productionRuntime = {
      baseURL: "https://api.hiloxs.co.ke",
      secret: "production-cookie-test-secret-with-sufficient-entropy-42",
      trustedOrigins: ["https://hiloxs.co.ke"],
      secureCookies: true,
    };
    const productionAuth = createAuthService({
      database: productionDatabase,
      emailSender: productionEmailSender,
      runtime: productionRuntime,
    });
    const productionApp = await buildApp({
      database: productionDatabase,
      auth: productionAuth,
      authRuntime: productionRuntime,
      allowedOrigins: productionRuntime.trustedOrigins,
    });

    try {
      const headers = {
        "content-type": "application/json",
        origin: "https://hiloxs.co.ke",
        "x-real-ip": "203.0.113.80",
      };
      const registration = await productionApp.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers,
        payload: {
          ...registrationBody("production-cookie@example.com"),
          callbackURL: "https://hiloxs.co.ke/verify-email?verified=true",
        },
      });
      const message = productionEmailSender.messages[0];
      const verificationUrl = new URL(message?.url ?? "");
      await productionApp.inject({
        method: "GET",
        url: `${verificationUrl.pathname}${verificationUrl.search}`,
      });
      const loginResponse = await productionApp.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers,
        payload: { email: "production-cookie@example.com", password: ORIGINAL_PASSWORD },
      });
      const setCookie = cookieHeaders(loginResponse).join("; ");

      expect(registration.statusCode).toBe(200);
      expect(loginResponse.statusCode).toBe(200);
      expect(setCookie).toContain("__Secure-");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).not.toMatch(/Domain=/i);
      expect(loginResponse.headers["access-control-allow-origin"]).toBe("https://hiloxs.co.ke");
      expect(loginResponse.headers["access-control-allow-credentials"]).toBe("true");
    } finally {
      await productionApp.close();
    }
  });

  it("uses a generic failure for invalid credentials", async () => {
    await register("existing@example.com");
    await verifyRegistrationEmail();
    const existing = await login("existing@example.com", "WrongPassword!42");
    const missing = await login("missing@example.com", "WrongPassword!42");

    expect(existing.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(existing.json()).toEqual({
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Unable to log in",
    });
    expect(missing.body).toBe(existing.body);
  });

  it("returns only safe current-user fields and rejects unauthenticated requests", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/users/me" });
    expect(anonymous.statusCode).toBe(401);

    const cookie = await createVerifiedSession("profile@example.com");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { cookie },
    });
    const body = response.json<{ user: Record<string, unknown> }>();

    expect(response.statusCode).toBe(200);
    expect(Object.keys(body.user).sort()).toEqual([
      "email",
      "emailVerified",
      "id",
      "name",
      "phone",
      "status",
    ]);
    expect(response.body).not.toMatch(/password|token|secret/i);
  });

  it("revokes the current session on logout", async () => {
    const cookie = await createVerifiedSession("logout@example.com");
    const logout = await post("/api/auth/sign-out", {}, { cookie });
    const currentUser = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { cookie },
    });

    expect(logout.statusCode).toBe(200);
    expect(currentUser.statusCode).toBe(401);
  });

  it("uses single-use reset tokens and revokes existing sessions", async () => {
    const cookie = await createVerifiedSession("reset@example.com");
    const unknown = await post("/api/auth/request-password-reset", {
      email: "unknown@example.com",
      redirectTo: RESET_CALLBACK,
    });
    const requested = await post("/api/auth/request-password-reset", {
      email: "reset@example.com",
      redirectTo: RESET_CALLBACK,
    });

    expect(unknown.statusCode).toBe(200);
    expect(requested.statusCode).toBe(200);
    expect(unknown.body).toBe(requested.body);

    const message = emailSender.messages.find((email) => email.kind === "password-reset");
    expect(message).toBeDefined();
    const resetLink = new URL(message?.url ?? "");
    const callback = await app.inject({
      method: "GET",
      url: `${resetLink.pathname}${resetLink.search}`,
    });
    const location = new URL(callback.headers.location ?? "", FRONTEND_ORIGIN);
    const token = location.searchParams.get("token");
    expect(callback.statusCode).toBe(302);
    expect(token).toEqual(expect.any(String));

    const reset = await post("/api/auth/reset-password", { newPassword: NEW_PASSWORD, token });
    const reused = await post("/api/auth/reset-password", { newPassword: NEW_PASSWORD, token });
    const oldSession = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { cookie },
    });
    const newLogin = await login("reset@example.com", NEW_PASSWORD);

    expect(reset.statusCode).toBe(200);
    expect(reused.statusCode).toBeGreaterThanOrEqual(400);
    expect(oldSession.statusCode).toBe(401);
    expect(newLogin.statusCode).toBe(200);
  });

  it.each(["SUSPENDED", "DISABLED"] as const)(
    "revokes access and blocks new sessions for %s users",
    async (status) => {
      const email = `${status.toLowerCase()}@example.com`;
      const cookie = await createVerifiedSession(email);
      await database.db.update(user).set({ status }).where(eq(user.email, email));

      const currentUser = await app.inject({
        method: "GET",
        url: "/api/v1/users/me",
        headers: { cookie },
      });
      const sessionCounts = await database.db.select({ value: count() }).from(session);
      const relogin = await login(email, ORIGINAL_PASSWORD);

      expect(currentUser.statusCode).toBe(401);
      expect(sessionCounts[0]?.value).toBe(0);
      expect(relogin.statusCode).toBe(401);
      expect(relogin.headers["set-cookie"]).toBeUndefined();
    },
  );

  it("rejects a cookie-authenticated mutation without an Origin", async () => {
    const cookie = await createVerifiedSession("missing-origin@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { "content-type": "application/json", cookie, "x-real-ip": "203.0.113.9" },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects untrusted origins before auth processing", async () => {
    const response = await post("/api/auth/sign-up/email", registrationBody("cors@example.com"), {
      origin: "https://attacker.example",
    });
    const userCounts = await database.db.select({ value: count() }).from(user);

    expect(response.statusCode).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(userCounts[0]?.value).toBe(0);
  });

  it("cannot bypass rate limiting with email casing or spoofed X-Forwarded-For", async () => {
    const responses: InjectResponse[] = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(
        await post(
          "/api/auth/sign-in/email",
          {
            email: index % 2 === 0 ? "limited@example.com" : "LIMITED@EXAMPLE.COM",
            password: "WrongPassword!42",
          },
          { ip: "203.0.113.50", forwardedFor: `198.51.100.${index + 1}` },
        ),
      );
    }
    expect(responses.at(-1)?.statusCode).toBe(429);
  });

  it("groups IPv6 rate-limit keys by the default /64 allocation", async () => {
    const responses: InjectResponse[] = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(
        await post(
          "/api/auth/sign-in/email",
          { email: "ipv6-limited@example.com", password: "WrongPassword!42" },
          { ip: `2001:db8:abcd:42::${index + 1}` },
        ),
      );
    }
    expect(responses.at(-1)?.statusCode).toBe(429);
  });
});

async function register(email: string, phone = "0712345678"): Promise<InjectResponse> {
  return post("/api/auth/sign-up/email", registrationBody(email, phone));
}

function registrationBody(email: string, phone = "0712345678") {
  return {
    name: "Test Customer",
    email,
    phone,
    password: ORIGINAL_PASSWORD,
    callbackURL: VERIFIED_CALLBACK,
  };
}

async function verifyRegistrationEmail(): Promise<void> {
  const message = emailSender.messages.find((email) => email.kind === "verification");
  expect(message).toBeDefined();
  const verificationUrl = new URL(message?.url ?? "");
  const response = await app.inject({
    method: "GET",
    url: `${verificationUrl.pathname}${verificationUrl.search}`,
  });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toContain(FRONTEND_ORIGIN);
}

async function login(email: string, password: string): Promise<InjectResponse> {
  return post("/api/auth/sign-in/email", { email, password });
}

async function createVerifiedSession(email: string): Promise<string> {
  await register(email);
  await verifyRegistrationEmail();
  const response = await login(email, ORIGINAL_PASSWORD);
  expect(response.statusCode).toBe(200);
  return sessionCookie(response);
}

async function post(
  url: string,
  payload: Record<string, unknown>,
  options: { cookie?: string; origin?: string; ip?: string; forwardedFor?: string } = {},
): Promise<InjectResponse> {
  requestCounter += 1;
  return app.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/json",
      origin: options.origin ?? FRONTEND_ORIGIN,
      "x-real-ip": options.ip ?? `198.51.100.${requestCounter}`,
      "x-forwarded-for": options.forwardedFor ?? `192.0.2.${requestCounter}`,
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    payload,
  });
}

function cookieHeaders(response: InjectResponse): string[] {
  const header = response.headers["set-cookie"];
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

function sessionCookie(response: InjectResponse): string {
  const header = cookieHeaders(response).find((value) => value.includes("session_token"));
  expect(header).toBeDefined();
  return header?.split(";", 1)[0] ?? "";
}
