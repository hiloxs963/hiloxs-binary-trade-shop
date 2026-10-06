import { describe, expect, it } from "vitest";
import { StaffReauthRequiredError, StaffStepUpRequiredError } from "../../src/lib/errors.js";
import { STAFF_STEP_UP_WINDOWS_MS } from "../../src/staff/model.js";
import {
  assertPostMembershipSession,
  assertStaffSessionMfaMethod,
  assertStepUpWindow,
  stepUpValidUntil,
} from "../../src/staff/authorization.js";

describe("staff session freshness", () => {
  const membershipCreatedAt = new Date("2026-09-03T11:45:00.000Z");

  it("accepts a session created after membership", () => {
    expect(() =>
      assertPostMembershipSession(new Date("2026-09-03T11:45:00.001Z"), membershipCreatedAt),
    ).not.toThrow();
  });

  it("rejects sessions created before or at membership creation", () => {
    expect(() =>
      assertPostMembershipSession(new Date("2026-09-03T11:44:59.999Z"), membershipCreatedAt),
    ).toThrow(StaffReauthRequiredError);
    expect(() => assertPostMembershipSession(membershipCreatedAt, membershipCreatedAt)).toThrow(
      StaffReauthRequiredError,
    );
  });

  it("rejects email-otp sessions and accepts TOTP, backup-code and legacy sessions", () => {
    expect(() => assertStaffSessionMfaMethod("email-otp")).toThrow(StaffReauthRequiredError);
    for (const method of ["totp", "backup-code", "none"] as const) {
      expect(() => assertStaffSessionMfaMethod(method)).not.toThrow();
    }
  });
});

describe("staff step-up windows", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("uses 8 hours for the normal tier and 30 minutes for the high tier", () => {
    expect(STAFF_STEP_UP_WINDOWS_MS.normal).toBe(8 * 60 * 60 * 1_000);
    expect(STAFF_STEP_UP_WINDOWS_MS.high).toBe(30 * 60 * 1_000);
  });

  it.each(["normal", "high"] as const)("accepts a verification at the %s boundary", (tier) => {
    expect(() => assertStepUpWindow(ago(STAFF_STEP_UP_WINDOWS_MS[tier]), tier, now)).not.toThrow();
    expect(() => assertStepUpWindow(now, tier, now)).not.toThrow();
  });

  it.each(["normal", "high"] as const)("rejects a verification just past the %s window", (tier) => {
    expect(() => assertStepUpWindow(ago(STAFF_STEP_UP_WINDOWS_MS[tier] + 1), tier, now)).toThrow(
      StaffStepUpRequiredError,
    );
  });

  it("keeps the tiers independent", () => {
    const fortyFiveMinutesAgo = ago(45 * 60 * 1_000);

    expect(() => assertStepUpWindow(fortyFiveMinutesAgo, "normal", now)).not.toThrow();
    expect(() => assertStepUpWindow(fortyFiveMinutesAgo, "high", now)).toThrow(
      StaffStepUpRequiredError,
    );
  });

  it("requires a step-up when no verification was ever recorded or it is in the future", () => {
    expect(() => assertStepUpWindow(null, "normal", now)).toThrow(StaffStepUpRequiredError);
    expect(() => assertStepUpWindow(new Date(now.getTime() + 1), "normal", now)).toThrow(
      StaffStepUpRequiredError,
    );
  });

  it("reports when each window ends, or null when it already has", () => {
    const verified = ago(10 * 60 * 1_000);

    expect(stepUpValidUntil(verified, "high", now)).toBe(
      new Date(verified.getTime() + STAFF_STEP_UP_WINDOWS_MS.high).toISOString(),
    );
    expect(stepUpValidUntil(ago(31 * 60 * 1_000), "high", now)).toBeNull();
    expect(stepUpValidUntil(ago(31 * 60 * 1_000), "normal", now)).not.toBeNull();
    expect(stepUpValidUntil(null, "normal", now)).toBeNull();
  });
});
