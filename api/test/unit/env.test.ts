import { describe, expect, it } from "vitest";
import {
  assertSafeTestDatabaseUrl,
  parseEnv,
  requireDatabaseUrl,
  resolveAuthRuntimeConfig,
  resolveMediaRuntimeConfig,
  resolveMpesaRuntimeConfig,
  resolveProductionEmailConfig,
} from "../../src/config/env.js";
import { ConfigurationError } from "../../src/lib/errors.js";

describe("environment configuration", () => {
  it("applies safe development defaults", () => {
    expect(parseEnv({})).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 3000,
      LOG_LEVEL: "info",
      MPESA_PUBLIC_ENABLED: false,
      MPESA_REQUEST_TIMEOUT_MS: 10_000,
      STAFF_REVIEW_ENABLED: false,
      MEDIA_UPLOAD_ENABLED: false,
      CATALOG_ACTIVATION_ENABLED: false,
      MEDIA_S3_FORCE_PATH_STYLE: false,
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
      frontendURL: "http://localhost:8080",
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
          FRONTEND_URL: "https://hiloxs.co.ke",
        }),
      ),
    ).toMatchObject({ secureCookies: true, trustedOrigins: ["https://hiloxs.co.ke"] });
    expect(() =>
      resolveAuthRuntimeConfig(
        parseEnv({
          NODE_ENV: "production",
          BETTER_AUTH_URL: "https://api.attacker.example",
          BETTER_AUTH_SECRET: secret,
          FRONTEND_URL: "https://hiloxs.co.ke",
        }),
      ),
    ).toThrow(ConfigurationError);
  });

  it("requires the canonical frontend origin in production", () => {
    const base = {
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://api.hiloxs.co.ke",
      BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-long-enough",
    };

    expect(() => resolveAuthRuntimeConfig(parseEnv(base))).toThrow(
      "FRONTEND_URL is required in production",
    );
    expect(() =>
      resolveAuthRuntimeConfig(
        parseEnv({ ...base, FRONTEND_URL: "https://frontend.attacker.example" }),
      ),
    ).toThrow(ConfigurationError);
  });

  it("requires valid Resend configuration only in production", () => {
    const apiKey = "re_test_key_with_safe_placeholder_characters";

    expect(resolveProductionEmailConfig(parseEnv({ NODE_ENV: "development" }))).toBeUndefined();
    expect(() => resolveProductionEmailConfig(parseEnv({ NODE_ENV: "production" }))).toThrow(
      "RESEND_API_KEY is required in production",
    );
    expect(() =>
      resolveProductionEmailConfig(parseEnv({ NODE_ENV: "production", RESEND_API_KEY: apiKey })),
    ).toThrow("AUTH_EMAIL_FROM is required in production");
    expect(
      resolveProductionEmailConfig(
        parseEnv({
          NODE_ENV: "production",
          RESEND_API_KEY: apiKey,
          AUTH_EMAIL_FROM: "HILOXS <auth@mail.hiloxs.co.ke>",
        }),
      ),
    ).toEqual({ apiKey, from: "HILOXS <auth@mail.hiloxs.co.ke>" });
  });

  it("requires complete M-Pesa configuration and selects the configured environment", () => {
    expect(resolveMpesaRuntimeConfig(parseEnv({ NODE_ENV: "test" }))).toBeUndefined();
    expect(() => resolveMpesaRuntimeConfig(parseEnv({ NODE_ENV: "production" }))).toThrow(
      "All M-Pesa environment variables are required together",
    );
    expect(() => resolveMpesaRuntimeConfig(parseEnv({ MPESA_ENV: "sandbox" }))).toThrow(
      ConfigurationError,
    );

    const config = resolveMpesaRuntimeConfig(
      parseEnv({
        NODE_ENV: "test",
        MPESA_ENV: "sandbox",
        MPESA_PUBLIC_ENABLED: "true",
        MPESA_CONSUMER_KEY: "test-consumer-key",
        MPESA_CONSUMER_SECRET: "test-consumer-secret",
        MPESA_SHORTCODE: "174379",
        MPESA_PASSKEY: "test-passkey",
        MPESA_TRANSACTION_TYPE: "CustomerPayBillOnline",
        MPESA_PARTY_B: "174379",
        MPESA_CALLBACK_BASE_URL: "http://localhost:3000",
        MPESA_MAX_AMOUNT_KES: "100000",
      }),
    );

    expect(config).toMatchObject({
      environment: "sandbox",
      publicEnabled: true,
      baseURL: "https://sandbox.safaricom.co.ke",
      maxAmountKes: 100_000n,
    });
  });

  it("parses the public M-Pesa flag strictly and defaults it off", () => {
    expect(parseEnv({}).MPESA_PUBLIC_ENABLED).toBe(false);
    expect(parseEnv({ MPESA_PUBLIC_ENABLED: "false" }).MPESA_PUBLIC_ENABLED).toBe(false);
    expect(parseEnv({ MPESA_PUBLIC_ENABLED: "true" }).MPESA_PUBLIC_ENABLED).toBe(true);
    expect(() => parseEnv({ MPESA_PUBLIC_ENABLED: "1" })).toThrow(ConfigurationError);
    expect(() => parseEnv({ MPESA_PUBLIC_ENABLED: "TRUE" })).toThrow(ConfigurationError);
  });

  it("enables staff review only for the exact true value and otherwise fails closed", () => {
    expect(parseEnv({}).STAFF_REVIEW_ENABLED).toBe(false);
    expect(parseEnv({ STAFF_REVIEW_ENABLED: "false" }).STAFF_REVIEW_ENABLED).toBe(false);
    expect(parseEnv({ STAFF_REVIEW_ENABLED: "true" }).STAFF_REVIEW_ENABLED).toBe(true);
    expect(parseEnv({ STAFF_REVIEW_ENABLED: "TRUE" }).STAFF_REVIEW_ENABLED).toBe(false);
    expect(parseEnv({ STAFF_REVIEW_ENABLED: "1" }).STAFF_REVIEW_ENABLED).toBe(false);
  });

  it("keeps media writes disabled without storage and requires complete storage when enabled", () => {
    expect(resolveMediaRuntimeConfig(parseEnv({}))).toEqual({
      uploadEnabled: false,
      catalogActivationEnabled: false,
    });
    expect(() =>
      resolveMediaRuntimeConfig(
        parseEnv({ MEDIA_UPLOAD_ENABLED: "true", MEDIA_S3_ENDPOINT: "http://localhost:9000" }),
      ),
    ).toThrow("All required media S3 environment variables must be set together");
    expect(() => resolveMediaRuntimeConfig(parseEnv({ MEDIA_UPLOAD_ENABLED: "true" }))).toThrow(
      "Media S3 configuration is required",
    );
    expect(() =>
      resolveMediaRuntimeConfig(parseEnv({ MEDIA_S3_SESSION_TOKEN: "orphaned-test-token" })),
    ).toThrow("All required media S3 environment variables must be set together");
    expect(() =>
      resolveMediaRuntimeConfig(parseEnv({ MEDIA_S3_FORCE_PATH_STYLE: "true" })),
    ).toThrow("All required media S3 environment variables must be set together");
  });

  it("parses complete media storage configuration without exposing it through flags", () => {
    const config = resolveMediaRuntimeConfig(
      parseEnv({
        MEDIA_UPLOAD_ENABLED: "true",
        CATALOG_ACTIVATION_ENABLED: "true",
        MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000",
        MEDIA_S3_REGION: "us-east-1",
        MEDIA_S3_BUCKET: "hiloxs-media-test",
        MEDIA_S3_ACCESS_KEY_ID: "test-access-key",
        MEDIA_S3_SECRET_ACCESS_KEY: "test-secret-key",
        MEDIA_S3_FORCE_PATH_STYLE: "true",
      }),
    );

    expect(config).toEqual({
      uploadEnabled: true,
      catalogActivationEnabled: true,
      storage: {
        endpoint: "http://127.0.0.1:9000",
        region: "us-east-1",
        bucket: "hiloxs-media-test",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
        forcePathStyle: true,
      },
    });
    expect(() =>
      resolveMediaRuntimeConfig(
        parseEnv({
          MEDIA_S3_ENDPOINT: "http://user:password@127.0.0.1:9000",
          MEDIA_S3_REGION: "us-east-1",
          MEDIA_S3_BUCKET: "hiloxs-media-test",
          MEDIA_S3_ACCESS_KEY_ID: "test-access-key",
          MEDIA_S3_SECRET_ACCESS_KEY: "test-secret-key",
        }),
      ),
    ).toThrow("cannot include credentials");
  });

  it("requires HTTPS for the production M-Pesa callback", () => {
    const base = {
      NODE_ENV: "production",
      MPESA_ENV: "production",
      MPESA_CONSUMER_KEY: "test-consumer-key",
      MPESA_CONSUMER_SECRET: "test-consumer-secret",
      MPESA_SHORTCODE: "123456",
      MPESA_PASSKEY: "test-passkey",
      MPESA_TRANSACTION_TYPE: "CustomerBuyGoodsOnline",
      MPESA_PARTY_B: "654321",
      MPESA_MAX_AMOUNT_KES: "100000",
    };
    expect(() =>
      resolveMpesaRuntimeConfig(
        parseEnv({ ...base, MPESA_CALLBACK_BASE_URL: "http://api.example.test" }),
      ),
    ).toThrow("must use HTTPS");
    expect(
      resolveMpesaRuntimeConfig(
        parseEnv({ ...base, MPESA_CALLBACK_BASE_URL: "https://api.example.test" }),
      ),
    ).toMatchObject({
      environment: "production",
      baseURL: "https://api.safaricom.co.ke",
    });
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
