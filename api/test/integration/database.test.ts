import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { assertSafeTestDatabaseUrl, parseEnv, requireDatabaseUrl } from "../../src/config/env.js";
import { createDatabaseClient } from "../../src/db/client.js";
import { PostgresRateLimiter, digestLimiterKey } from "../../src/commerce/rate-limit.js";
import { securityRateLimitWindows } from "../../src/db/schema/security.js";
import { RateLimitError } from "../../src/lib/errors.js";

const env = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(env);
assertSafeTestDatabaseUrl(databaseUrl, env.NODE_ENV);

let migrationsApplied = false;

beforeAll(async () => {
  const database = createDatabaseClient(databaseUrl);
  try {
    await migrate(database.db, { migrationsFolder: resolve("src/db/migrations") });
    migrationsApplied = true;
  } finally {
    await database.close();
  }
});

afterAll(() => {
  migrationsApplied = false;
});

describe("PostgreSQL integration", () => {
  it("applies deterministic migrations", () => {
    expect(migrationsApplied).toBe(true);
  });

  it("connects to the disposable PostgreSQL database", async () => {
    const database = createDatabaseClient(databaseUrl);
    try {
      await expect(database.checkConnection()).resolves.toBeUndefined();
    } finally {
      await database.close();
    }
  });

  it("creates the system_metadata infrastructure table", async () => {
    const database = createDatabaseClient(databaseUrl);
    try {
      const result = await database.pool.query<{ table_name: string | null }>(
        "select to_regclass('public.system_metadata') as table_name",
      );
      expect(result.rows[0]?.table_name).toBe("system_metadata");
    } finally {
      await database.close();
    }
  });

  it("creates the privacy-preserving durable rate-limit table", async () => {
    const database = createDatabaseClient(databaseUrl);
    try {
      const result = await database.pool.query<{ table_name: string | null }>(
        "select to_regclass('public.security_rate_limit_windows') as table_name",
      );
      expect(result.rows[0]?.table_name).toBe("security_rate_limit_windows");
    } finally {
      await database.close();
    }
  });

  it("enforces a shared rate limit atomically across limiter instances", async () => {
    const database = createDatabaseClient(databaseUrl);
    const key = `concurrent-user-${Date.now()}`;
    const now = new Date("2030-01-01T00:00:00.000Z");
    try {
      const attempts = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          new PostgresRateLimiter(database, "integration-rate-limit-secret-key").consume({
            scope: "integration-concurrency",
            key,
            limit: 5,
            windowMs: 60_000,
            now,
          }),
        ),
      );
      expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(5);
      const rejected = attempts.filter((result) => result.status === "rejected");
      expect(rejected).toHaveLength(15);
      expect(rejected.every((result) => result.reason instanceof RateLimitError)).toBe(true);

      const [stored] = await database.db
        .select()
        .from(securityRateLimitWindows)
        .where(eq(securityRateLimitWindows.scope, "integration-concurrency"));
      expect(stored?.keyDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(stored?.keyDigest).not.toContain(key);
      expect(stored?.count).toBe(6);
    } finally {
      await database.close();
    }
  });

  it("opens a fresh durable window after expiry", async () => {
    const database = createDatabaseClient(databaseUrl);
    const limiter = new PostgresRateLimiter(database, "integration-rate-limit-secret-key");
    const key = `expiry-user-${Date.now()}`;
    try {
      await limiter.consume({
        scope: "integration-expiry",
        key,
        limit: 1,
        windowMs: 60_000,
        now: new Date("2030-01-01T00:00:00.000Z"),
      });
      await expect(
        limiter.consume({
          scope: "integration-expiry",
          key,
          limit: 1,
          windowMs: 60_000,
          now: new Date("2030-01-01T00:00:30.000Z"),
        }),
      ).rejects.toBeInstanceOf(RateLimitError);
      await expect(
        limiter.consume({
          scope: "integration-expiry",
          key,
          limit: 1,
          windowMs: 60_000,
          now: new Date("2030-01-01T00:01:00.000Z"),
        }),
      ).resolves.toBeUndefined();
    } finally {
      await database.close();
    }
  });

  it("uses keyed HMAC rather than a plain identifier hash", () => {
    const first = digestLimiterKey("a".repeat(32), "scope", "low-entropy@example.com");
    const second = digestLimiterKey("b".repeat(32), "scope", "low-entropy@example.com");
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    expect(first).not.toContain("low-entropy");
  });

  it("returns ready when PostgreSQL is available", async () => {
    const database = createDatabaseClient(databaseUrl);
    const app = await buildApp({ database });
    try {
      const response = await app.inject({ method: "GET", url: "/ready" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ready", database: "up" });
    } finally {
      await app.close();
    }
  });

  it("returns a safe 503 when PostgreSQL is unavailable", async () => {
    const unavailable = createDatabaseClient(
      "postgresql://hiloxs:hiloxs_test@127.0.0.1:1/hiloxs_test",
      { connectionTimeoutMs: 250 },
    );
    const app = await buildApp({ database: unavailable });
    try {
      const response = await app.inject({ method: "GET", url: "/ready" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: "not_ready",
        database: "down",
        requestId: response.headers["x-request-id"],
      });
      expect(response.body).not.toContain("ECONNREFUSED");
      expect(response.body).not.toContain("127.0.0.1");
    } finally {
      await app.close();
    }
  });
});
