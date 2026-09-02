import { describe, expect, it } from "vitest";
import {
  redactRequestUrl,
  redactSensitive,
  redactText,
  safeErrorForLog,
} from "../../src/lib/redact.js";

describe("log redaction", () => {
  it("redacts database credentials and bearer tokens in text", () => {
    const text = redactText(
      "postgresql://admin:secret@database:5432/hiloxs Bearer re_resend-secret password=hunter2 apiKey=client-key x-api-key: header-key RESEND_API_KEY=re_private-key kraPin=P123456789Z registration_number=BN-12345",
    );

    expect(text).not.toContain("admin:secret");
    expect(text).not.toContain("re_resend-secret");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("client-key");
    expect(text).not.toContain("header-key");
    expect(text).not.toContain("re_private-key");
    expect(text).not.toContain("P123456789Z");
    expect(text).not.toContain("BN-12345");
    expect(text).toContain("[REDACTED]");
  });

  it("redacts sensitive object keys recursively", () => {
    expect(
      redactSensitive({
        user: "safe",
        headers: { authorization: "Bearer secret", cookie: "session=secret" },
        databaseUrl: "postgresql://user:password@database/hiloxs",
        DATABASE_URL: "postgresql://user:password@database/hiloxs",
        password: "password-value",
        token: "token-value",
        secret: "secret-value",
        apiKey: "api-key-value",
        api_key: "api-key-value",
        API_KEY: "api-key-value",
        RESEND_API_KEY: "re_private-key",
        "x-api-key": "api-key-value",
        nested: { xApiKey: "api-key-value" },
        totpCode: "123456",
        totpURI: "otpauth://totp/HILOXS:test?secret=secret-value",
        twoFactorCode: "654321",
        twoFactorChallenge: "challenge-value",
        backupCodes: ["backup-one", "backup-two"],
      }),
    ).toEqual({
      user: "safe",
      headers: { authorization: "[REDACTED]", cookie: "[REDACTED]" },
      databaseUrl: "[REDACTED]",
      DATABASE_URL: "[REDACTED]",
      password: "[REDACTED]",
      token: "[REDACTED]",
      secret: "[REDACTED]",
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
      API_KEY: "[REDACTED]",
      RESEND_API_KEY: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      nested: { xApiKey: "[REDACTED]" },
      totpCode: "[REDACTED]",
      totpURI: "[REDACTED]",
      twoFactorCode: "[REDACTED]",
      twoFactorChallenge: "[REDACTED]",
      backupCodes: "[REDACTED]",
    });
  });

  it("redacts verification and reset tokens embedded in request URLs", () => {
    expect(redactRequestUrl("/api/auth/verify-email?token=verification-secret&callbackURL=/")).toBe(
      "/api/auth/verify-email?token=REDACTED&callbackURL=%2F",
    );
    expect(
      redactRequestUrl("/api/auth/reset-password/reset-secret?callbackURL=/reset-password"),
    ).toBe("/api/auth/reset-password/REDACTED?callbackURL=/reset-password");
    expect(redactRequestUrl(`/api/v1/payments/mpesa/callback/${"callback-secret".repeat(4)}`)).toBe(
      "/api/v1/payments/mpesa/callback/REDACTED",
    );
  });

  it("redacts M-Pesa passkeys, generated passwords, and callback tokens", () => {
    expect(
      redactSensitive({
        MPESA_CONSUMER_SECRET: "consumer-secret-value",
        MPESA_PASSKEY: "passkey-value",
        kraPin: "A123456789Z",
        kra_pin: "A123456789Z",
        registrationNumber: "BN-12345",
        registration_number: "BN-12345",
        Password: "generated-password",
        callbackToken: "callback-token",
        safeReference: "HX-TEST",
      }),
    ).toEqual({
      MPESA_CONSUMER_SECRET: "[REDACTED]",
      MPESA_PASSKEY: "[REDACTED]",
      kraPin: "[REDACTED]",
      kra_pin: "[REDACTED]",
      registrationNumber: "[REDACTED]",
      registration_number: "[REDACTED]",
      Password: "[REDACTED]",
      callbackToken: "[REDACTED]",
      safeReference: "HX-TEST",
    });
  });

  it("preserves benign structured values", () => {
    const value = {
      username: "safe-user",
      profile: { publicUrl: "https://example.com/profile" },
      apiVersion: "v1",
      keyLabel: "primary",
    };

    expect(redactSensitive(value)).toEqual(value);
  });

  it("creates safe structured error details", () => {
    expect(
      safeErrorForLog(new Error("connect postgresql://admin:secret@database/hiloxs failed")),
    ).toEqual({
      name: "Error",
      message: "connect postgresql://[REDACTED]@database/hiloxs failed",
    });
  });
});
