import { describe, expect, it } from "vitest";
import {
  assertSafeTestDatabaseUrl,
  parseEnv,
  requireDatabaseUrl,
  resolveAuthRuntimeConfig,
} from "../../src/config/env.js";
import { ConfigurationError } from "../../src/lib/errors.js";

describe("environment configuration", () => {
  it("applies safe development defaults", () => {
    expect(parseEnv({})).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 3000,
      LOG_LEVEL: "info",
    });
  });

  it("parses explicit values", () => {
    expect(
      parseEnv({
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "8080",
        LOG_LEVEL: "warn",
        DATABASE_URL: "postgresql://user:password@database:5432/hiloxs",
      }),
    ).toMatchObject({ NODE_ENV: "production", HOST: "0.0.0.0", PORT: 8080, LOG_LEVEL: "warn" });
  });

  it("rejects invalid values without echoing them", () => {
    expect(() => parseEnv({ PORT: "70000" })).toThrow(ConfigurationError);
    expect(() => parseEnv({ DATABASE_URL: "https://not-postgres.invalid" })).toThrow(
      "must be a PostgreSQL URL",
    );
  });

  it("requires a database URL only when database functionality is used", () => {
    expect(() => requireDatabaseUrl(parseEnv({}))).toThrow("DATABASE_URL is required");
    expect(
      requireDatabaseUrl(parseEnv({ DATABASE_URL: "postgresql://user:pass@localhost:5432/db" })),
    ).toContain("localhost");
  });

  it("uses explicit local auth origins and requires production secrets", () => {
    expect(resolveAuthRuntimeConfig(parseEnv({ NODE_ENV: "test" }))).toMatchObject({
      baseURL: "http://127.0.0.1:3000",
      trustedOrigins: ["http://localhost:8080", "https://hiloxs.co.ke"],
      secureCookies: false,
    });
    expect(() => resolveAuthRuntimeConfig(parseEnv({ NODE_ENV: "production" }))).toThrow(
      ConfigurationError,
    );
    expect(() => parseEnv({ BETTER_AUTH_SECRET: "too-short" })).toThrow(ConfigurationError);
  });

  it("requires the canonical HTTPS API origin in production", () => {
    const secret = "a-secure-test-secret-that-is-long-enough";
    expect(
      resolveAuthRuntimeConfig(
        parseEnv({
          NODE_ENV: "production",
          BETTER_AUTH_URL: "https://api.hiloxs.co.ke",
          BETTER_AUTH_SECRET: secret,
        }),
      ),
    ).toMatchObject({ secureCookies: true, trustedOrigins: ["https://hiloxs.co.ke"] });
    expect(() =>
      resolveAuthRuntimeConfig(
        parseEnv({
          NODE_ENV: "production",
          BETTER_AUTH_URL: "https://api.attacker.example",
          BETTER_AUTH_SECRET: secret,
        }),
      ),
    ).toThrow(ConfigurationError);
  });
});

describe("integration database safety guard", () => {
  it("accepts local and CI test databases", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://hiloxs:hiloxs_test@localhost:55432/hiloxs_test",
        "test",
      ),
    ).not.toThrow();
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://hiloxs:hiloxs_test@postgres:5432/hiloxs_test",
        "test",
      ),
    ).not.toThrow();
  });

  it("rejects production-like destinations and non-test environments", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://user:secret@postgres.railway.internal:5432/hiloxs",
        "test",
      ),
    ).toThrow(ConfigurationError);
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://hiloxs:hiloxs_test@localhost:55432/hiloxs_test",
        "production",
      ),
    ).toThrow(ConfigurationError);
  });
});
