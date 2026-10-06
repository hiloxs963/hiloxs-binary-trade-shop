import { and, eq, sql } from "drizzle-orm";
import { isAPIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import type { AuthService } from "../auth/auth.js";
import type { EmailOtpClient } from "../auth/email-otp/service.js";
import type { RateLimiter } from "../commerce/rate-limit.js";
import { RATE_LIMITS } from "../commerce/rate-limit.js";
import type { DatabaseClient } from "../db/client.js";
import { session, twoFactor } from "../db/schema/auth.js";
import { staffMemberships } from "../db/schema/staff.js";
import {
  InvalidSecondFactorCodeError,
  RateLimitError,
  StaffPermissionRequiredError,
  StaffReauthRequiredError,
  UnauthenticatedError,
} from "../lib/errors.js";
import { assertStaffSessionMfaMethod } from "./authorization.js";
import { STAFF_STEP_UP_MAX_FAILURES } from "./model.js";

// Same budget as better-auth's per-account two-factor lock, so a guessing attack cannot dodge it by
// switching between sign-in, email codes and step-up.
const ACCOUNT_LOCK_THRESHOLD = 10;
const ACCOUNT_LOCK_MS = 15 * 60_000;

export type StaffStepUpInput = { method: "totp" | "backup-code"; code: string };

export type StaffStepUpResult = { verifiedAt: string };

/**
 * Re-verifies the second factor for the CURRENT session: no password, no new session. Only a
 * TOTP or backup code can open the window (staff are TOTP-only). Five consecutive failures on a
 * session revoke it; every failure also counts against the shared account lock.
 */
export async function performStaffStepUp(options: {
  auth: AuthService;
  database: DatabaseClient;
  rateLimiter: RateLimiter;
  headers: IncomingHttpHeaders;
  input: StaffStepUpInput;
  client: EmailOtpClient;
  now?: Date;
}): Promise<StaffStepUpResult> {
  const { auth, database, input, client } = options;
  const now = options.now ?? new Date();
  const audit = auth.emailOtp.recordSecurityEvent.bind(auth.emailOtp);

  const authSession = await auth.api.getSession({ headers: fromNodeHeaders(options.headers) });
  if (!authSession) throw new UnauthenticatedError();
  const userId = authSession.user.id;
  const sessionId = authSession.session.id;

  await options.rateLimiter.consume({
    scope: "staff-step-up",
    key: userId,
    ...RATE_LIMITS.security,
  });

  const [state] = await database.db
    .select({
      membershipCreatedAt: staffMemberships.createdAt,
      sessionCreatedAt: session.createdAt,
      mfaMethod: session.mfaMethod,
      lockedUntil: twoFactor.lockedUntil,
    })
    .from(session)
    .innerJoin(
      staffMemberships,
      and(eq(staffMemberships.userId, session.userId), eq(staffMemberships.status, "ACTIVE")),
    )
    .innerJoin(twoFactor, and(eq(twoFactor.userId, session.userId), eq(twoFactor.verified, true)))
    .where(eq(session.id, sessionId))
    .limit(1);
  if (!state) {
    await audit(database.db, userId, "STAFF_STEP_UP_REFUSED", client);
    throw new StaffPermissionRequiredError();
  }
  try {
    assertStaffSessionMfaMethod(state.mfaMethod);
    // A session that predates the membership can never become valid by stepping up.
    if (state.sessionCreatedAt.getTime() <= state.membershipCreatedAt.getTime()) {
      throw new StaffReauthRequiredError();
    }
  } catch (error) {
    await audit(database.db, userId, "STAFF_STEP_UP_REFUSED", client);
    throw error;
  }
  if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) throw new RateLimitError();

  const verified = await verifySecondFactor(auth, options.headers, input);

  if (!verified) {
    await database.db.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(session)
        .set({ stepUpFailures: sql`${session.stepUpFailures} + 1` })
        .where(eq(session.id, sessionId))
        .returning({ failures: session.stepUpFailures });
      const [factor] = await transaction
        .update(twoFactor)
        .set({ failedVerificationCount: sql`${twoFactor.failedVerificationCount} + 1` })
        .where(eq(twoFactor.userId, userId))
        .returning({ failures: twoFactor.failedVerificationCount });
      if (factor && factor.failures >= ACCOUNT_LOCK_THRESHOLD) {
        await transaction
          .update(twoFactor)
          .set({ lockedUntil: new Date(now.getTime() + ACCOUNT_LOCK_MS) })
          .where(eq(twoFactor.userId, userId));
      }
      await audit(transaction, userId, "STAFF_STEP_UP_FAILED", client);
      if ((updated?.failures ?? 0) >= STAFF_STEP_UP_MAX_FAILURES) {
        await transaction.delete(session).where(eq(session.id, sessionId));
        await audit(transaction, userId, "STAFF_STEP_UP_SESSION_REVOKED", client);
      }
    });
    throw new InvalidSecondFactorCodeError();
  }

  await database.db.transaction(async (transaction) => {
    await transaction
      .update(session)
      .set({ lastMfaVerifiedAt: now, stepUpFailures: 0 })
      .where(eq(session.id, sessionId));
    await transaction
      .update(twoFactor)
      .set({ failedVerificationCount: 0, lockedUntil: null })
      .where(eq(twoFactor.userId, userId));
    await audit(transaction, userId, "STAFF_STEP_UP_SUCCEEDED", client);
  });
  return { verifiedAt: now.toISOString() };
}

/**
 * Uses better-auth's own verification in session mode, which checks the code without creating a
 * session. That mode has no attempt counter, which is why the caller counts failures itself.
 */
async function verifySecondFactor(
  auth: AuthService,
  headers: IncomingHttpHeaders,
  input: StaffStepUpInput,
): Promise<boolean> {
  try {
    if (input.method === "totp") {
      await auth.api.verifyTOTP({
        body: { code: input.code },
        headers: fromNodeHeaders(headers),
      });
    } else {
      await auth.api.verifyBackupCode({
        body: { code: input.code, disableSession: true },
        headers: fromNodeHeaders(headers),
      });
    }
    return true;
  } catch (error) {
    // Only a rejected code counts as a failed attempt; infrastructure errors must surface as such.
    if (isAPIError(error)) return false;
    throw error;
  }
}
