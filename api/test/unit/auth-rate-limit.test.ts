import { describe, expect, it, vi } from "vitest";
import type { RateLimitInput, RateLimiter } from "../../src/commerce/rate-limit.js";
import { RATE_LIMITS } from "../../src/commerce/rate-limit.js";
import { applyAuthRateLimit } from "../../src/auth/fastify.js";
import type { AuthService } from "../../src/auth/auth.js";

function makeLimiter(): { limiter: RateLimiter; calls: RateLimitInput[] } {
  const calls: RateLimitInput[] = [];
  const limiter: RateLimiter = {
    consume(input) {
      calls.push(input);
      return Promise.resolve();
    },
  };
  return { limiter, calls };
}

const fakeAuth = {
  api: { getSession: vi.fn().mockResolvedValue(null) },
} as unknown as AuthService;

describe("auth rate limiting", () => {
  it("applies the default policy to unmatched paths and keys by IP", async () => {
    for (const path of [
      "/api/auth/sign-out",
      "/api/auth/change-password",
      "/api/auth/list-sessions",
    ]) {
      const { limiter, calls } = makeLimiter();
      await applyAuthRateLimit(limiter, fakeAuth, path, {}, "1.2.3.4", {});
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        scope: "auth-default",
        key: "1.2.3.4",
        limit: RATE_LIMITS.authDefault.limit,
        windowMs: RATE_LIMITS.authDefault.windowMs,
      });
    }
  });

  it("applies the sign-up policy to /sign-up/email keyed by IP and email", async () => {
    const { limiter, calls } = makeLimiter();
    await applyAuthRateLimit(
      limiter,
      fakeAuth,
      "/api/auth/sign-up/email",
      { email: "user@example.com" },
      "1.2.3.4",
      {},
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      scope: "auth-sign-up",
      key: "1.2.3.4|user@example.com",
      limit: RATE_LIMITS.signUp.limit,
      windowMs: RATE_LIMITS.signUp.windowMs,
    });
  });

  it("applies the sign-in policy to /sign-in/email", async () => {
    const { limiter, calls } = makeLimiter();
    await applyAuthRateLimit(
      limiter,
      fakeAuth,
      "/api/auth/sign-in/email",
      { email: "user@example.com" },
      "1.2.3.5",
      {},
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      scope: "auth-sign-in",
      limit: RATE_LIMITS.signIn.limit,
      windowMs: RATE_LIMITS.signIn.windowMs,
    });
  });

  it("applies the password-reset-request policy to /request-password-reset", async () => {
    const { limiter, calls } = makeLimiter();
    await applyAuthRateLimit(
      limiter,
      fakeAuth,
      "/api/auth/request-password-reset",
      { email: "user@example.com" },
      "1.2.3.4",
      {},
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      scope: "auth-password-reset-request",
      limit: RATE_LIMITS.passwordResetRequest.limit,
    });
  });
});

describe("second-factor rate limiting", () => {
  const pendingCookie = "hiloxs.two_factor=signed-pending-value.sig; other=1";

  it("limits email OTP sends and verifies per IP and per pending login", async () => {
    for (const [path, scope, policy] of [
      ["/api/auth/email-otp/send", "auth-email-otp-send", RATE_LIMITS.emailOtpSend],
      ["/api/auth/email-otp/verify", "auth-email-otp-verify", RATE_LIMITS.secondFactorAttempt],
    ] as const) {
      const { limiter, calls } = makeLimiter();
      await applyAuthRateLimit(limiter, fakeAuth, path, {}, "1.2.3.4", { cookie: pendingCookie });

      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        scope: "auth-second-factor-pending",
        key: "signed-pending-value.sig",
        limit: RATE_LIMITS.secondFactorAttempt.limit,
      });
      expect(calls[1]).toMatchObject({
        scope,
        key: "1.2.3.4",
        limit: policy.limit,
        windowMs: policy.windowMs,
      });
    }
  });

  it("adds the per-pending-login ceiling to backup-code and TOTP attempts", async () => {
    for (const path of [
      "/api/auth/two-factor/verify-backup-code",
      "/api/auth/two-factor/verify-totp",
    ]) {
      const { limiter, calls } = makeLimiter();
      await applyAuthRateLimit(limiter, fakeAuth, path, {}, "1.2.3.4", { cookie: pendingCookie });

      expect(calls.map((call) => call.scope)).toEqual([
        "auth-second-factor-pending",
        "auth-two-factor",
      ]);
    }
  });

  it("does not add a pending-login limit when there is no pending cookie", async () => {
    const { limiter, calls } = makeLimiter();
    await applyAuthRateLimit(
      limiter,
      fakeAuth,
      "/api/auth/two-factor/verify-backup-code",
      {},
      "1.2.3.4",
      {},
    );

    expect(calls.map((call) => call.scope)).toEqual(["auth-two-factor"]);
  });
});
