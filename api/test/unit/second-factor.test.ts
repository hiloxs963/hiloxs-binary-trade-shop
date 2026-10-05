import { describe, expect, it } from "vitest";
import {
  availableSecondFactorMethods,
  describeEmailOtpSendError,
  describeSecondFactorError,
  isValidSecondFactorCode,
  normalizeSecondFactorCode,
  secondsUntil,
} from "../../../src/lib/second-factor.js";

describe("second-factor method selection", () => {
  it("always offers an authenticator and a backup code", () => {
    expect(availableSecondFactorMethods(["totp"])).toEqual(["totp", "backup-code"]);
    expect(availableSecondFactorMethods(undefined)).toEqual(["totp", "backup-code"]);
    expect(availableSecondFactorMethods("email-otp")).toEqual(["totp", "backup-code"]);
  });

  it("offers email only when the server advertises it", () => {
    expect(availableSecondFactorMethods(["totp", "email-otp"])).toEqual([
      "totp",
      "email-otp",
      "backup-code",
    ]);
    expect(availableSecondFactorMethods(["otp"])).toEqual(["totp", "backup-code"]);
  });
});

describe("second-factor code handling", () => {
  it("keeps only six digits for authenticator and email codes", () => {
    expect(normalizeSecondFactorCode("totp", "12a3 45-6789")).toBe("123456");
    expect(normalizeSecondFactorCode("email-otp", "000042")).toBe("000042");
    expect(isValidSecondFactorCode("email-otp", "12345")).toBe(false);
    expect(isValidSecondFactorCode("totp", "123456")).toBe(true);
  });

  it("accepts backup codes as free text and never strips characters", () => {
    expect(normalizeSecondFactorCode("backup-code", "  abCD-1234 ")).toBe("abCD-1234");
    expect(isValidSecondFactorCode("backup-code", "abCD-1234")).toBe(true);
    expect(isValidSecondFactorCode("backup-code", "   ")).toBe(false);
    expect(isValidSecondFactorCode("backup-code", "x".repeat(129))).toBe(false);
  });
});

describe("resend countdown", () => {
  const now = Date.parse("2026-10-06T10:00:00.000Z");

  it("counts whole seconds up, never below zero", () => {
    expect(secondsUntil("2026-10-06T10:01:00.000Z", now)).toBe(60);
    expect(secondsUntil("2026-10-06T10:00:00.400Z", now)).toBe(1);
    expect(secondsUntil("2026-10-06T09:59:00.000Z", now)).toBe(0);
  });

  it("treats a missing or malformed timestamp as no wait", () => {
    expect(secondsUntil(null, now)).toBe(0);
    expect(secondsUntil(undefined, now)).toBe(0);
    expect(secondsUntil("not a date", now)).toBe(0);
  });
});

describe("second-factor messages", () => {
  it("points a failed send at the authenticator and never claims success", () => {
    const failed = describeEmailOtpSendError({ status: 503, code: "EMAIL_OTP_SEND_FAILED" });
    expect(failed).toContain("couldn't send");
    expect(failed).toContain("authenticator");
    expect(describeEmailOtpSendError({ status: 429, code: "RATE_LIMITED" })).toContain(
      "authenticator",
    );
    expect(describeEmailOtpSendError({ status: 403, code: "EMAIL_OTP_UNAVAILABLE" })).toContain(
      "authenticator",
    );
    expect(describeEmailOtpSendError({ status: 401, code: "INVALID_TWO_FACTOR_COOKIE" })).toContain(
      "Log in again",
    );
  });

  it("gives method-specific verification errors without revealing why a code failed", () => {
    expect(describeSecondFactorError("email-otp", { status: 401, code: "X" })).toContain(
      "incorrect or has expired",
    );
    expect(describeSecondFactorError("backup-code", { status: 401, code: "X" })).toContain("once");
    expect(describeSecondFactorError("totp", { status: 429, code: "X" })).toContain("Too many");
    expect(
      describeSecondFactorError("totp", { status: 401, code: "INVALID_TWO_FACTOR_COOKIE" }),
    ).toContain("Log in again");
  });
});
