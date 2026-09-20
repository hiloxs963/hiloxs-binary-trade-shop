import { randomUUID } from "node:crypto";
import type { AppEnv } from "../config/env.js";
import type { DatabaseClient } from "../db/client.js";
import { STAFF_PERMISSIONS, type StaffPermission } from "../db/schema/staff.js";
import { ConfigurationError, ConflictError } from "../lib/errors.js";
import { writeOperationalLog } from "../lib/logger.js";
import { grantStaffPermissionBySystem } from "./bootstrap-service.js";

// grantStaffPermissionBySystem signals "this grant already exists" with a ConflictError carrying
// this exact message. ConflictError has a single shared code ("CONFLICT"), so the message is the
// only way to tell an already-active grant from a genuinely ineligible account. Matching on it is
// deliberate: widening the catch to every ConflictError would swallow the eligibility failures
// this bootstrap exists to surface.
const PERMISSION_ALREADY_ACTIVE = "The staff permission is already active";

export type StaffBootstrapConfig = {
  userId: string;
  permissions: StaffPermission[];
};

function isStaffPermission(value: string): value is StaffPermission {
  return (STAFF_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Reads STAFF_BOOTSTRAP_USER_ID and STAFF_BOOTSTRAP_PERMISSIONS. Returns null when either is
 * absent, so the bootstrap is opt-in. A permission name that is not a StaffPermission throws
 * rather than being skipped: a typo in the deploy configuration must fail the startup loudly.
 */
export function resolveStaffBootstrapConfig(env: AppEnv): StaffBootstrapConfig | null {
  const userId = env.STAFF_BOOTSTRAP_USER_ID?.trim();
  const raw = env.STAFF_BOOTSTRAP_PERMISSIONS?.trim();
  if (!userId || !raw) return null;

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new ConfigurationError("STAFF_BOOTSTRAP_PERMISSIONS lists no permissions");
  }

  const invalid = entries.filter((entry) => !isStaffPermission(entry));
  if (invalid.length > 0) {
    throw new ConfigurationError(
      `STAFF_BOOTSTRAP_PERMISSIONS contains unknown permissions: ${invalid.join(", ")}`,
    );
  }

  return { userId, permissions: [...new Set(entries.filter(isStaffPermission))] };
}

/**
 * Ensures every configured permission exists for the configured user. Idempotent: an already
 * active grant is a success, and grantStaffPermissionBySystem aborts its transaction before
 * touching sessions in that case, so repeated startups neither duplicate rows nor sign the user
 * out. Every other failure propagates so the server refuses to start on invalid bootstrap
 * configuration.
 *
 * The grant function is injectable so the startup sequence can be tested without a live database.
 */
export async function runStaffBootstrapGrants(
  database: DatabaseClient,
  env: AppEnv,
  grant: typeof grantStaffPermissionBySystem = grantStaffPermissionBySystem,
): Promise<void> {
  const config = resolveStaffBootstrapConfig(env);
  if (!config) {
    writeOperationalLog("info", "Staff bootstrap: no STAFF_BOOTSTRAP_USER_ID set, skipping");
    return;
  }

  const requestId = `startup-bootstrap:${randomUUID()}`;
  for (const permission of config.permissions) {
    try {
      await grant(database, { staffUserId: config.userId, permission, requestId });
      writeOperationalLog("info", `Staff bootstrap: granted ${permission} to ${config.userId}`);
    } catch (error) {
      if (error instanceof ConflictError && error.message === PERMISSION_ALREADY_ACTIVE) {
        writeOperationalLog(
          "info",
          `Staff bootstrap: ${permission} already active for ${config.userId}`,
        );
        continue;
      }
      throw error;
    }
  }
}
