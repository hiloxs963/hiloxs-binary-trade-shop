import { randomUUID } from "node:crypto";
import type { AppEnv } from "../config/env.js";
import type { DatabaseClient } from "../db/client.js";
import { STAFF_PERMISSIONS, type StaffPermission } from "../db/schema/staff.js";
import { AppError, ConflictError } from "../lib/errors.js";
import { writeOperationalLog } from "../lib/logger.js";
import { bootstrapStaffMembership, grantStaffPermissionBySystem } from "./bootstrap-service.js";

// The bootstrap services signal "this already exists" with a ConflictError carrying these exact
// messages. ConflictError has a single shared code ("CONFLICT"), so the message is the only way to
// tell an existing membership or active grant from a genuinely ineligible account. Matching on it is
// deliberate: widening the catch to every ConflictError would swallow the eligibility failures this
// bootstrap exists to surface (as warnings).
const PERMISSION_ALREADY_ACTIVE = "The staff permission is already active";
const MEMBERSHIP_ALREADY_EXISTS = "A staff membership already exists";

// Better Auth user ids are short URL-safe tokens. Anything else cannot name a user, so it is
// skipped without a database round trip.
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type StaffBootstrapConfig = {
  userIds: string[];
  invalidUserIds: string[];
  permissions: StaffPermission[];
  unknownPermissions: string[];
};

export type StaffBootstrapDependencies = {
  grant: typeof grantStaffPermissionBySystem;
  createMembership: typeof bootstrapStaffMembership;
};

function isStaffPermission(value: string): value is StaffPermission {
  return (STAFF_PERMISSIONS as readonly string[]).includes(value);
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Reads STAFF_BOOTSTRAP_USER_ID (one id or a comma-separated list) and STAFF_BOOTSTRAP_PERMISSIONS.
 * Returns null when either is absent or empty, so the bootstrap is opt-in. This never throws: a
 * malformed value is reported through `invalidUserIds` / `unknownPermissions` and skipped, because a
 * bad deploy variable must not stop the API from starting.
 */
export function resolveStaffBootstrapConfig(env: AppEnv): StaffBootstrapConfig | null {
  const rawUsers = env.STAFF_BOOTSTRAP_USER_ID?.trim();
  const rawPermissions = env.STAFF_BOOTSTRAP_PERMISSIONS?.trim();
  if (!rawUsers || !rawPermissions) return null;

  const candidates = [...new Set(splitList(rawUsers))];
  const permissions = [...new Set(splitList(rawPermissions))];
  if (candidates.length === 0 || permissions.length === 0) return null;

  return {
    userIds: candidates.filter((id) => USER_ID_PATTERN.test(id)),
    invalidUserIds: candidates.filter((id) => !USER_ID_PATTERN.test(id)),
    permissions: permissions.filter(isStaffPermission),
    unknownPermissions: permissions.filter((entry) => !isStaffPermission(entry)),
  };
}

/**
 * Ensures every listed user has a staff membership and every configured permission. Idempotent: an
 * existing membership or active grant is a success, and both services abort their transaction before
 * touching sessions in that case, so repeated startups neither duplicate rows nor sign anyone out.
 * A new membership or grant does delete that user's sessions, by design, so the next login postdates
 * the grant.
 *
 * This function never throws. A missing user, an invalid id, an ineligible account, or any failed
 * grant is logged as a warning and that user is skipped; the remaining users are still processed and
 * the API still starts. Each user is handled independently and every change is audited by the
 * services (SYSTEM_BOOTSTRAP events).
 *
 * The services are injectable so the sequence can be tested without a live database.
 */
export async function runStaffBootstrapGrants(
  database: DatabaseClient,
  env: AppEnv,
  dependencies: Partial<StaffBootstrapDependencies> = {},
): Promise<void> {
  const grant = dependencies.grant ?? grantStaffPermissionBySystem;
  const createMembership = dependencies.createMembership ?? bootstrapStaffMembership;

  const config = resolveStaffBootstrapConfig(env);
  if (!config) {
    writeOperationalLog("info", "Staff bootstrap: no STAFF_BOOTSTRAP_USER_ID set, skipping");
    return;
  }
  for (const id of config.invalidUserIds) {
    writeOperationalLog("warn", `Staff bootstrap: skipping invalid user id "${safeLabel(id)}"`);
  }
  for (const name of config.unknownPermissions) {
    writeOperationalLog(
      "warn",
      `Staff bootstrap: ignoring unknown permission "${safeLabel(name)}"`,
    );
  }
  if (config.permissions.length === 0) {
    writeOperationalLog("warn", "Staff bootstrap: no valid permissions configured, skipping");
    return;
  }

  for (const userId of config.userIds) {
    try {
      await bootstrapUser(database, userId, config.permissions, { grant, createMembership });
    } catch (error) {
      writeOperationalLog("warn", `Staff bootstrap: skipped ${userId}: ${describe(error)}`);
    }
  }
}

async function bootstrapUser(
  database: DatabaseClient,
  userId: string,
  permissions: StaffPermission[],
  { grant, createMembership }: StaffBootstrapDependencies,
): Promise<void> {
  const requestId = `startup-bootstrap:${randomUUID()}`;

  try {
    await createMembership(database, { userId, role: "STAFF", permissions, requestId });
    writeOperationalLog(
      "info",
      `Staff bootstrap: created membership for ${userId} with ${permissions.join(", ")}`,
    );
    return;
  } catch (error) {
    if (!(error instanceof ConflictError && error.message === MEMBERSHIP_ALREADY_EXISTS)) {
      throw error;
    }
  }

  for (const permission of permissions) {
    try {
      await grant(database, { staffUserId: userId, permission, requestId });
      writeOperationalLog("info", `Staff bootstrap: granted ${permission} to ${userId}`);
    } catch (error) {
      if (error instanceof ConflictError && error.message === PERMISSION_ALREADY_ACTIVE) {
        writeOperationalLog("info", `Staff bootstrap: ${permission} already active for ${userId}`);
        continue;
      }
      // One refused permission must not hide the user's remaining grants.
      writeOperationalLog(
        "warn",
        `Staff bootstrap: could not grant ${permission} to ${userId}: ${describe(error)}`,
      );
    }
  }
}

// Only expected application errors carry a message that is safe to log; anything else (database
// driver errors in particular) is reduced to its class name.
function describe(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return error instanceof Error ? error.name : "unexpected error";
}

function safeLabel(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "?").slice(0, 64);
}
