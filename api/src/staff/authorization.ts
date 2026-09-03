import { and, eq, isNull, lt } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import type { AuthService } from "../auth/auth.js";
import type { DatabaseClient } from "../db/client.js";
import { session, twoFactor, user } from "../db/schema/auth.js";
import {
  STAFF_PERMISSIONS,
  staffMemberships,
  staffPermissionGrants,
  type StaffPermission,
  type StaffRole,
} from "../db/schema/staff.js";
import {
  StaffPermissionRequiredError,
  StaffReauthRequiredError,
  StaffRecentAuthRequiredError,
  UnauthenticatedError,
} from "../lib/errors.js";
import { STAFF_RECENT_SESSION_MAX_AGE_MS, type StaffAuthorization } from "./model.js";

type StaffProfile = {
  role: StaffRole;
  permissions: StaffPermission[];
  mfaEnabled: true;
};

export async function requireStaffPermission(
  auth: AuthService,
  database: DatabaseClient,
  headers: IncomingHttpHeaders,
  permission: StaffPermission,
  options: { recent?: boolean; now?: Date } = {},
): Promise<StaffAuthorization> {
  const authSession = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!authSession) throw new UnauthenticatedError();

  const [access] = await database.db
    .select({
      role: staffMemberships.role,
      membershipCreatedAt: staffMemberships.createdAt,
      grantCreatedAt: staffPermissionGrants.grantedAt,
      sessionCreatedAt: session.createdAt,
    })
    .from(staffMemberships)
    .innerJoin(user, eq(user.id, staffMemberships.userId))
    .innerJoin(
      staffPermissionGrants,
      and(
        eq(staffPermissionGrants.staffUserId, staffMemberships.userId),
        eq(staffPermissionGrants.permission, permission),
        isNull(staffPermissionGrants.revokedAt),
      ),
    )
    .innerJoin(
      session,
      and(eq(session.id, authSession.session.id), eq(session.userId, staffMemberships.userId)),
    )
    .innerJoin(
      twoFactor,
      and(eq(twoFactor.userId, staffMemberships.userId), eq(twoFactor.verified, true)),
    )
    .where(
      and(
        eq(staffMemberships.userId, authSession.user.id),
        eq(staffMemberships.status, "ACTIVE"),
        eq(user.status, "ACTIVE"),
        eq(user.emailVerified, true),
        eq(user.twoFactorEnabled, true),
      ),
    )
    .limit(1);

  if (!access) throw new StaffPermissionRequiredError();
  assertPostMembershipSession(access.sessionCreatedAt, access.membershipCreatedAt);
  assertPostPermissionGrantSession(access.sessionCreatedAt, access.grantCreatedAt);
  if (options.recent) {
    assertRecentSession(access.sessionCreatedAt, options.now ?? new Date());
  }

  return {
    actor: { userId: authSession.user.id, role: access.role, permission },
    sessionId: authSession.session.id,
  };
}

export async function requireStaffProfile(
  auth: AuthService,
  database: DatabaseClient,
  headers: IncomingHttpHeaders,
): Promise<StaffProfile> {
  const authSession = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!authSession) throw new UnauthenticatedError();

  const rows = await database.db
    .select({
      role: staffMemberships.role,
      permission: staffPermissionGrants.permission,
      membershipCreatedAt: staffMemberships.createdAt,
      sessionCreatedAt: session.createdAt,
    })
    .from(staffMemberships)
    .innerJoin(user, eq(user.id, staffMemberships.userId))
    .innerJoin(twoFactor, and(eq(twoFactor.userId, user.id), eq(twoFactor.verified, true)))
    .innerJoin(
      session,
      and(eq(session.id, authSession.session.id), eq(session.userId, staffMemberships.userId)),
    )
    .leftJoin(
      staffPermissionGrants,
      and(
        eq(staffPermissionGrants.staffUserId, staffMemberships.userId),
        isNull(staffPermissionGrants.revokedAt),
        lt(staffPermissionGrants.grantedAt, session.createdAt),
      ),
    )
    .where(
      and(
        eq(staffMemberships.userId, authSession.user.id),
        eq(staffMemberships.status, "ACTIVE"),
        eq(user.status, "ACTIVE"),
        eq(user.emailVerified, true),
        eq(user.twoFactorEnabled, true),
      ),
    );

  const first = rows[0];
  if (!first) throw new StaffPermissionRequiredError();
  assertPostMembershipSession(first.sessionCreatedAt, first.membershipCreatedAt);
  return {
    role: first.role,
    permissions: STAFF_PERMISSIONS.filter((permission) =>
      rows.some((row) => row.permission === permission),
    ),
    mfaEnabled: true,
  };
}

export function assertPostMembershipSession(
  sessionCreatedAt: Date,
  membershipCreatedAt: Date,
): void {
  if (sessionCreatedAt.getTime() <= membershipCreatedAt.getTime()) {
    throw new StaffReauthRequiredError();
  }
}

export function assertRecentSession(sessionCreatedAt: Date, now: Date): void {
  const age = now.getTime() - sessionCreatedAt.getTime();
  if (age < 0 || age > STAFF_RECENT_SESSION_MAX_AGE_MS) {
    throw new StaffRecentAuthRequiredError();
  }
}

export function assertPostPermissionGrantSession(
  sessionCreatedAt: Date,
  permissionGrantedAt: Date,
): void {
  if (sessionCreatedAt.getTime() <= permissionGrantedAt.getTime()) {
    throw new StaffReauthRequiredError();
  }
}
