import { describe, expect, it, vi } from "vitest";
import type { RateLimitInput, RateLimiter } from "../../src/commerce/rate-limit.js";
import { RATE_LIMITS } from "../../src/commerce/rate-limit.js";
import { applyAuthRateLimit } from "../../src/auth/fastify.js";
import type { AuthService } from "../../src/auth/auth.js";

function makeLimiter(): { limiter: RateLimiter; calls: RateLimitInput[] } {
  const calls: RateLimitInput[] = [];
  const limiter: RateLimiter = {
    async consume(input) {
      calls.push(input);
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
