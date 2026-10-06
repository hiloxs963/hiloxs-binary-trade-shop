import type { StaffPermission, StaffRole } from "../db/schema/staff.js";

export type StaffActor = {
  userId: string;
  role: StaffRole;
  permission: StaffPermission;
};

export type StaffAuthorization = {
  actor: StaffActor;
  sessionId: string;
  /** The step-up tier this request was authorized under; re-checked inside the write transaction. */
  stepUpTier: StaffStepUpTier;
};

/**
 * How recently a TOTP or backup code must have been verified on the session (sign-in or step-up).
 * "normal" covers reads and start-review; "high" covers every approval, rejection, activation,
 * deactivation, commerce change, takedown and permission change. Constants, not configuration:
 * staff policy has no toggles.
 */
export const STAFF_STEP_UP_WINDOWS_MS = {
  normal: 8 * 60 * 60 * 1_000,
  high: 30 * 60 * 1_000,
} as const;

export type StaffStepUpTier = keyof typeof STAFF_STEP_UP_WINDOWS_MS;

/** Consecutive failed step-ups on one session before it is revoked. */
export const STAFF_STEP_UP_MAX_FAILURES = 5;
