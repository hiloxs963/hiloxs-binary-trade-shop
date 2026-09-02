import { describe, expect, it } from "vitest";
import { StaffReauthRequiredError, StaffRecentAuthRequiredError } from "../../src/lib/errors.js";
import { STAFF_RECENT_SESSION_MAX_AGE_MS } from "../../src/staff/model.js";
import { assertPostMembershipSession, assertRecentSession } from "../../src/staff/authorization.js";

describe("staff recent-session authorization", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");
  const membershipCreatedAt = new Date("2026-09-03T11:45:00.000Z");

  it("accepts a session created after membership within 30 minutes", () => {
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

  it("rejects stale and future-created sessions", () => {
    expect(() =>
      assertRecentSession(new Date(now.getTime() - STAFF_RECENT_SESSION_MAX_AGE_MS - 1), now),
    ).toThrow(StaffRecentAuthRequiredError);
    expect(() => assertRecentSession(new Date(now.getTime() + 1), now)).toThrow(
      StaffRecentAuthRequiredError,
    );
  });
});
