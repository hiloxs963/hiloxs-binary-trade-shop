import { and, eq, isNull } from "drizzle-orm";
import type { DatabaseClient } from "../db/client.js";
import { session, twoFactor, user } from "../db/schema/auth.js";
import {
  staffAuditEvents,
  staffMemberships,
  staffPermissionGrants,
  type StaffPermission,
  type StaffRole,
} from "../db/schema/staff.js";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors.js";

export async function bootstrapStaffMembership(
  database: DatabaseClient,
  input: {
    userId: string;
    role: StaffRole;
    permissions: readonly StaffPermission[];
    requestId: string;
  },
): Promise<void> {
  if (!input.userId.trim() || !input.requestId.trim() || input.permissions.length === 0) {
    throw new ValidationError("A user ID, request ID, and permissions are required");
  }
  const permissions = [...new Set(input.permissions)];

  await database.db.transaction(async (transaction) => {
    const [target] = await transaction
      .select({
        id: user.id,
        status: user.status,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        factorVerified: twoFactor.verified,
      })
      .from(user)
      .innerJoin(twoFactor, eq(twoFactor.userId, user.id))
      .where(eq(user.id, input.userId))
      .for("update")
      .limit(1);
    if (!target) throw new NotFoundError();
    if (
      target.status !== "ACTIVE" ||
      !target.emailVerified ||
      !target.twoFactorEnabled ||
      !target.factorVerified
    ) {
      throw new ConflictError("The account is not eligible for staff bootstrap");
    }

    const [existing] = await transaction
      .select({ userId: staffMemberships.userId })
      .from(staffMemberships)
      .where(eq(staffMemberships.userId, input.userId))
      .limit(1);
    if (existing) throw new ConflictError("A staff membership already exists");

    await transaction.insert(staffMemberships).values({ userId: input.userId, role: input.role });
    await transaction.insert(staffAuditEvents).values({
      actorType: "SYSTEM_BOOTSTRAP",
      actorRole: input.role,
      action: "STAFF_BOOTSTRAPPED",
      requestId: input.requestId,
    });

    for (const permission of permissions) {
      await transaction.insert(staffPermissionGrants).values({
        staffUserId: input.userId,
        permission,
        grantSource: "BOOTSTRAP",
      });
      await transaction.insert(staffAuditEvents).values({
        actorType: "SYSTEM_BOOTSTRAP",
        actorRole: input.role,
        permission,
        action: "STAFF_PERMISSION_GRANTED",
        requestId: input.requestId,
      });
    }

    await transaction.delete(session).where(eq(session.userId, input.userId));
  });
}

export async function revokeStaffPermission(
  database: DatabaseClient,
  staffUserId: string,
  permission: StaffPermission,
  revokedByUserId: string,
): Promise<void> {
  await database.db.transaction(async (transaction) => {
    const [membership] = await transaction
      .select({ userId: staffMemberships.userId })
      .from(staffMemberships)
      .where(eq(staffMemberships.userId, staffUserId))
      .for("update")
      .limit(1);
    if (!membership) throw new NotFoundError();
    const [grant] = await transaction
      .select({ id: staffPermissionGrants.id })
      .from(staffPermissionGrants)
      .where(
        and(
          eq(staffPermissionGrants.staffUserId, staffUserId),
          eq(staffPermissionGrants.permission, permission),
          isNull(staffPermissionGrants.revokedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!grant) throw new NotFoundError();
    await transaction
      .update(staffPermissionGrants)
      .set({ revokedAt: new Date(), revokedByUserId })
      .where(eq(staffPermissionGrants.id, grant.id));
  });
}
