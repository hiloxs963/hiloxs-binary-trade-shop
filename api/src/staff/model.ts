import type { StaffPermission, StaffRole } from "../db/schema/staff.js";

export type StaffActor = {
  userId: string;
  role: StaffRole;
  permission: StaffPermission;
};

export type StaffAuthorization = {
  actor: StaffActor;
  sessionId: string;
};

export const STAFF_RECENT_SESSION_MAX_AGE_MS = 30 * 60 * 1_000;
