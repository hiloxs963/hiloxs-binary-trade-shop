import { and, eq, isNull, lt } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import type { AuthService } from "../auth/auth.js";
import type { DatabaseClient } from "../db/client.js";
import { session, twoFactor, user, type SessionMfaMethod } from "../db/schema/auth.js";
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
  StaffStepUpRequiredError,
  UnauthenticatedError,
} from "../lib/errors.js";
import {
  STAFF_STEP_UP_WINDOWS_MS,
  type StaffAuthorization,
  type StaffStepUpTier,
} from "./model.js";

type StaffProfile = {
  role: StaffRole;
  permissions: StaffPermission[];
  mfaEnabled: true;
  /** When each tier's window ends for this session; null means a step-up is needed now. */
  stepUp: { normalValidUntil: string | null; highValidUntil: string | null };
};

export async function requireStaffPermission(
  auth: AuthService,
  database: DatabaseClient,
  headers: IncomingHttpHeaders,
  permission: StaffPermission,
  options: { stepUp?: StaffStepUpTier; now?: Date } = {},
): Promise<StaffAuthorization> {
  const authSession = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!authSession) throw new UnauthenticatedError();

  const [access] = await database.db
    .select({
      role: staffMemberships.role,
      membershipCreatedAt: staffMemberships.createdAt,
      grantCreatedAt: staffPermissionGrants.grantedAt,
      sessionCreatedAt: session.createdAt,
      mfaMethod: session.mfaMethod,
      lastMfaVerifiedAt: session.lastMfaVerifiedAt,
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
  assertStaffSessionMfaMethod(access.mfaMethod);
  assertPostMembershipSession(access.sessionCreatedAt, access.membershipCreatedAt);
  assertPostPermissionGrantSession(access.sessionCreatedAt, access.grantCreatedAt);
  // Every staff call, reads included, needs a recent second-factor verification. The tier decides
  // how recent: "normal" (default) for reads and start-review, "high" for everything that changes
  // what sellers, buyers or the catalog see.
  assertStepUpWindow(
    access.lastMfaVerifiedAt,
    options.stepUp ?? "normal",
    options.now ?? new Date(),
  );

  return {
    actor: { userId: authSession.user.id, role: access.role, permission },
    sessionId: authSession.session.id,
    stepUpTier: options.stepUp ?? "normal",
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
      mfaMethod: session.mfaMethod,
      lastMfaVerifiedAt: session.lastMfaVerifiedAt,
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
  assertStaffSessionMfaMethod(first.mfaMethod);
  assertPostMembershipSession(first.sessionCreatedAt, first.membershipCreatedAt);
  return {
    role: first.role,
    permissions: STAFF_PERMISSIONS.filter((permission) =>
      rows.some((row) => row.permission === permission),
    ),
    mfaEnabled: true,
    // /staff/me is deliberately not step-up gated: the console needs it to know when to prompt.
    stepUp: {
      normalValidUntil: stepUpValidUntil(first.lastMfaVerifiedAt, "normal"),
      highValidUntil: stepUpValidUntil(first.lastMfaVerifiedAt, "high"),
    },
  };
}

/** Staff are TOTP-only: a session opened with an emailed code never carries staff authority. */
export function assertStaffSessionMfaMethod(mfaMethod: SessionMfaMethod): void {
  if (mfaMethod === "email-otp") throw new StaffReauthRequiredError();
}

export function assertPostMembershipSession(
  sessionCreatedAt: Date,
  membershipCreatedAt: Date,
): void {
  if (sessionCreatedAt.getTime() <= membershipCreatedAt.getTime()) {
    throw new StaffReauthRequiredError();
  }
}

/** Throws unless the second factor was verified (never in the future) within the tier's window. */
export function assertStepUpWindow(
  lastMfaVerifiedAt: Date | null,
  tier: StaffStepUpTier,
  now: Date,
): void {
  if (!lastMfaVerifiedAt) throw new StaffStepUpRequiredError();
  const age = now.getTime() - lastMfaVerifiedAt.getTime();
  if (age < 0 || age > STAFF_STEP_UP_WINDOWS_MS[tier]) throw new StaffStepUpRequiredError();
}

export function stepUpValidUntil(
  lastMfaVerifiedAt: Date | null,
  tier: StaffStepUpTier,
  now: Date = new Date(),
): string | null {
  if (!lastMfaVerifiedAt) return null;
  const until = lastMfaVerifiedAt.getTime() + STAFF_STEP_UP_WINDOWS_MS[tier];
  return until > now.getTime() ? new Date(until).toISOString() : null;
}

export function assertPostPermissionGrantSession(
  sessionCreatedAt: Date,
  permissionGrantedAt: Date,
): void {
  if (sessionCreatedAt.getTime() <= permissionGrantedAt.getTime()) {
    throw new StaffReauthRequiredError();
  }
}
