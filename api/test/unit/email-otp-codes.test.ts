import { describe, expect, it } from "vitest";
import {
  digestClientIp,
  digestPendingLogin,
  digestsMatch,
  formatEmailOtpCode,
  generateEmailOtpCode,
  hashEmailOtpCode,
} from "../../src/auth/email-otp/codes.js";
import { renderAuthEmail } from "../../src/auth/email-templates.js";
import { resolveEmailOtpConfig, parseEnv } from "../../src/config/env.js";
import { ConfigurationError } from "../../src/lib/errors.js";

const KEY = "unit-test-email-otp-hmac-key-0123456789";

describe("email OTP codes", () => {
  it("generates zero-padded six-digit codes", () => {
    for (let index = 0; index < 500; index += 1) {
      expect(generateEmailOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("keeps leading zeros across the whole range", () => {
    expect(formatEmailOtpCode(0)).toBe("000000");
    expect(formatEmailOtpCode(42)).toBe("000042");
    expect(formatEmailOtpCode(999_999)).toBe("999999");
  });

  it("hashes with a key and binds the code to its challenge and user", () => {
    const base = hashEmailOtpCode(KEY, "challenge-1", "user-1", "123456");

    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).toBe(hashEmailOtpCode(KEY, "challenge-1", "user-1", "123456"));
    expect(base).not.toBe(hashEmailOtpCode(KEY, "challenge-2", "user-1", "123456"));
    expect(base).not.toBe(hashEmailOtpCode(KEY, "challenge-1", "user-2", "123456"));
    expect(base).not.toBe(hashEmailOtpCode(KEY, "challenge-1", "user-1", "123457"));
    expect(base).not.toBe(hashEmailOtpCode(`${KEY}-other`, "challenge-1", "user-1", "123456"));
    expect(base).not.toContain("123456");
  });

  it("separates digest purposes so one cannot stand in for another", () => {
    expect(digestPendingLogin(KEY, "value")).not.toBe(digestClientIp(KEY, "value"));
  });

  it("compares digests in constant time and rejects malformed input", () => {
    const digest = hashEmailOtpCode(KEY, "c", "u", "000000");

    expect(digestsMatch(digest, digest)).toBe(true);
    expect(digestsMatch(digest, hashEmailOtpCode(KEY, "c", "u", "000001"))).toBe(false);
    expect(digestsMatch(digest, "")).toBe(false);
    expect(digestsMatch("", "")).toBe(false);
    expect(digestsMatch(digest, digest.slice(2))).toBe(false);
  });
});

describe("email OTP message", () => {
  it("shows the code and expiry with no link and no code in the subject", () => {
    const rendered = renderAuthEmail({
      kind: "email-otp",
      recipient: "user@example.com",
      code: "483920",
      expiresInMinutes: 10,
    });

    expect(rendered.subject).not.toContain("483920");
    expect(rendered.text).toContain("483920");
    expect(rendered.html).toContain("483920");
    expect(rendered.text).toContain("10 minutes");
    expect(rendered.text).toContain("If this wasn't you");
    expect(rendered.text).not.toMatch(/https?:\/\//);
    expect(rendered.html).not.toMatch(/href=/);
  });

  it.each(["email-otp-enabled", "email-otp-disabled", "password-reset-notice"] as const)(
    "renders the %s notice without a link or a code",
    (kind) => {
      const rendered = renderAuthEmail({ kind, recipient: "user@example.com" });

      expect(rendered.text).not.toMatch(/https?:\/\//);
      expect(rendered.text).not.toMatch(/\b\d{6}\b/);
    },
  );
});

describe("email OTP configuration", () => {
  it("is off unless the flag is exactly the string true", () => {
    for (const value of [undefined, "", "TRUE", "1", "yes", "false"]) {
      expect(resolveEmailOtpConfig(parseEnv({ EMAIL_OTP_ENABLED: value }))).toEqual({
        enabled: false,
      });
    }
  });

  it("requires its own HMAC key when enabled", () => {
    expect(() => resolveEmailOtpConfig(parseEnv({ EMAIL_OTP_ENABLED: "true" }))).toThrow(
      ConfigurationError,
    );
    expect(() =>
      resolveEmailOtpConfig(parseEnv({ EMAIL_OTP_ENABLED: "true", EMAIL_OTP_HMAC_KEY: "short" })),
    ).toThrow(ConfigurationError);
    expect(
      resolveEmailOtpConfig(parseEnv({ EMAIL_OTP_ENABLED: "true", EMAIL_OTP_HMAC_KEY: KEY })),
    ).toEqual({ enabled: true, hmacKey: KEY });
  });
});
