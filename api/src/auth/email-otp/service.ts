import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNull, max, sql } from "drizzle-orm";
import type { EmailOtpConfig } from "../../config/env.js";
import type { DatabaseClient, Database } from "../../db/client.js";
import { twoFactor, user } from "../../db/schema/auth.js";
import {
  EMAIL_OTP_MAX_ATTEMPTS,
  emailOtpChallenges,
  emailOtpEnrollments,
  type AuthSecurityEventType,
} from "../../db/schema/email-otp.js";
import { staffMemberships } from "../../db/schema/staff.js";
import {
  EmailOtpSendFailedError,
  EmailOtpUnavailableError,
  InvalidSecondFactorCodeError,
  NotFoundError,
  RateLimitError,
} from "../../lib/errors.js";
import type { AuthEmail, AuthEmailSender } from "../email.js";
import {
  digestClientIp,
  digestPendingLogin,
  digestsMatch,
  generateEmailOtpCode,
  hashEmailOtpCode,
} from "./codes.js";
import { recordAuthSecurityEvent } from "./events.js";

export const EMAIL_OTP_TTL_MS = 10 * 60_000;
export const EMAIL_OTP_RESEND_COOLDOWN_MS = 60_000;
export const EMAIL_OTP_SENDS_PER_ACCOUNT_PER_HOUR = 5;
export const EMAIL_OTP_SENDS_PER_IP_PER_HOUR = 20;
// Mirrors better-auth's per-account two-factor lock so email codes share the TOTP failure budget.
const ACCOUNT_LOCK_THRESHOLD = 10;
const ACCOUNT_LOCK_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;
// Suspended staff can be reinstated, so they stay TOTP-only; only a revoked membership is not staff.
const STAFF_STATUSES = ["ACTIVE", "SUSPENDED"] as const;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type EmailOtpClient = {
  ip: string;
  userAgent?: string | null | undefined;
};

export type EmailOtpServiceOptions = {
  database: DatabaseClient;
  emailSender: AuthEmailSender;
  config: EmailOtpConfig;
  /** Keys the digest stored for client IPs in challenges and audit events. */
  ipDigestKey: string;
  now?: () => Date;
};

type Eligibility = {
  email: string;
  enrolled: boolean;
  requireTotpNextLogin: boolean;
  staff: boolean;
  totpReady: boolean;
};

export class EmailOtpService {
  readonly #database: DatabaseClient;
  readonly #emailSender: AuthEmailSender;
  readonly #config: EmailOtpConfig;
  readonly #ipDigestKey: string;
  readonly #now: () => Date;

  constructor(options: EmailOtpServiceOptions) {
    this.#database = options.database;
    this.#emailSender = options.emailSender;
    this.#config = options.config;
    this.#ipDigestKey = options.ipDigestKey;
    this.#now = options.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return this.#config.enabled;
  }

  /** Whether this account may be offered email codes at the second-factor step right now. */
  async isAvailableForLogin(userId: string): Promise<boolean> {
    if (!this.#config.enabled) return false;
    const eligibility = await this.#loadEligibility(userId);
    return (
      eligibility !== null &&
      eligibility.enrolled &&
      eligibility.totpReady &&
      !eligibility.staff &&
      !eligibility.requireTotpNextLogin
    );
  }

  async isAvailableForLoginByEmail(email: string): Promise<boolean> {
    if (!this.#config.enabled) return false;
    const [account] = await this.#database.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()))
      .limit(1);
    return account ? this.isAvailableForLogin(account.id) : false;
  }

  /** What the account page needs: whether the user can turn email codes on, and whether on. */
  async status(userId: string): Promise<{ enrolled: boolean; eligible: boolean }> {
    this.#requireKey();
    const eligibility = await this.#loadEligibility(userId);
    return {
      enrolled: eligibility?.enrolled ?? false,
      eligible: Boolean(eligibility?.totpReady && !eligibility.staff),
    };
  }

  async isEnrolled(userId: string): Promise<boolean> {
    const [row] = await this.#database.db
      .select({ userId: emailOtpEnrollments.userId })
      .from(emailOtpEnrollments)
      .where(eq(emailOtpEnrollments.userId, userId))
      .limit(1);
    return Boolean(row);
  }

  /** Sends a fresh code for a pending login, invalidating any earlier one for it. */
  async send(input: {
    userId: string;
    pendingIdentifier: string;
    client: EmailOtpClient;
  }): Promise<{ expiresAt: Date; resendAvailableAt: Date }> {
    const key = this.#requireKey();
    const eligibility = await this.#assertUsable(input.userId, input.client);
    const now = this.#now();
    const pendingDigest = digestPendingLogin(key, input.pendingIdentifier);
    const ipDigest = digestClientIp(this.#ipDigestKey, input.client.ip);
    const code = generateEmailOtpCode();
    const challengeId = randomUUID();
    const expiresAt = new Date(now.getTime() + EMAIL_OTP_TTL_MS);

    const limited = await this.#database.db.transaction(async (transaction) => {
      await lockKey(transaction, `email-otp:pending:${pendingDigest}`);
      await lockKey(transaction, `email-otp:user:${input.userId}`);

      const [latest] = await transaction
        .select({ sentAt: max(emailOtpChallenges.sentAt) })
        .from(emailOtpChallenges)
        .where(eq(emailOtpChallenges.pendingDigest, pendingDigest));
      const sinceHour = new Date(now.getTime() - HOUR_MS);
      const [accountSends] = await transaction
        .select({ total: count() })
        .from(emailOtpChallenges)
        .where(
          and(
            eq(emailOtpChallenges.userId, input.userId),
            gt(emailOtpChallenges.createdAt, sinceHour),
          ),
        );
      const [ipSends] = await transaction
        .select({ total: count() })
        .from(emailOtpChallenges)
        .where(
          and(
            eq(emailOtpChallenges.ipDigest, ipDigest),
            gt(emailOtpChallenges.createdAt, sinceHour),
          ),
        );

      const coolingDown =
        latest?.sentAt != null &&
        now.getTime() - latest.sentAt.getTime() < EMAIL_OTP_RESEND_COOLDOWN_MS;
      if (
        coolingDown ||
        (accountSends?.total ?? 0) >= EMAIL_OTP_SENDS_PER_ACCOUNT_PER_HOUR ||
        (ipSends?.total ?? 0) >= EMAIL_OTP_SENDS_PER_IP_PER_HOUR
      ) {
        await this.#audit(transaction, input.userId, "EMAIL_OTP_RATE_LIMITED", input.client);
        return true;
      }

      await transaction
        .update(emailOtpChallenges)
        .set({ invalidatedAt: now })
        .where(
          and(
            eq(emailOtpChallenges.pendingDigest, pendingDigest),
            isNull(emailOtpChallenges.consumedAt),
            isNull(emailOtpChallenges.invalidatedAt),
          ),
        );
      // sentAt is set optimistically so a concurrent request sees the cooldown while the
      // provider call is in flight; a provider failure clears it again below.
      await transaction.insert(emailOtpChallenges).values({
        id: challengeId,
        userId: input.userId,
        pendingDigest,
        codeHash: hashEmailOtpCode(key, challengeId, input.userId, code),
        ipDigest,
        createdAt: now,
        expiresAt,
        sentAt: now,
      });
      return false;
    });
    if (limited) throw new RateLimitError();

    try {
      await this.#emailSender.send({
        kind: "email-otp",
        recipient: eligibility.email,
        code,
        expiresInMinutes: EMAIL_OTP_TTL_MS / 60_000,
      });
    } catch (error) {
      // Never leave a live code that was not delivered. A failed send does not start a cooldown
      // but still counts toward the hourly caps, and the pending login stays valid for TOTP.
      await this.#database.db.transaction(async (transaction) => {
        await transaction
          .update(emailOtpChallenges)
          .set({ invalidatedAt: this.#now(), sentAt: null })
          .where(eq(emailOtpChallenges.id, challengeId));
        await this.#audit(
          transaction,
          input.userId,
          "EMAIL_OTP_SEND_FAILED",
          input.client,
          challengeId,
        );
      });
      throw new EmailOtpSendFailedError(error);
    }
    await this.#audit(this.#database.db, input.userId, "EMAIL_OTP_SENT", input.client, challengeId);
    return {
      expiresAt,
      resendAvailableAt: new Date(now.getTime() + EMAIL_OTP_RESEND_COOLDOWN_MS),
    };
  }

  /**
   * Consumes the live challenge for this pending login if the code matches. The caller must only
   * issue a session after this resolves, and must itself consume the pending-login record.
   */
  async verify(input: {
    userId: string;
    pendingIdentifier: string;
    code: string;
    client: EmailOtpClient;
  }): Promise<{ challengeId: string }> {
    const key = this.#requireKey();
    await this.#assertUsable(input.userId, input.client);
    const now = this.#now();
    const pendingDigest = digestPendingLogin(key, input.pendingIdentifier);

    const outcome = await this.#database.db.transaction(
      async (transaction): Promise<{ kind: "ok" | "invalid" | "locked"; challengeId?: string }> => {
        await lockKey(transaction, `email-otp:pending:${pendingDigest}`);

        const [factor] = await transaction
          .select({
            id: twoFactor.id,
            failures: twoFactor.failedVerificationCount,
            lockedUntil: twoFactor.lockedUntil,
          })
          .from(twoFactor)
          .where(eq(twoFactor.userId, input.userId))
          .for("update")
          .limit(1);
        if (factor?.lockedUntil) {
          if (factor.lockedUntil.getTime() > now.getTime()) {
            await this.#audit(transaction, input.userId, "EMAIL_OTP_LOCKED", input.client);
            return { kind: "locked" };
          }
          await transaction
            .update(twoFactor)
            .set({ failedVerificationCount: 0, lockedUntil: null })
            .where(eq(twoFactor.id, factor.id));
          factor.failures = 0;
        }

        const [challenge] = await transaction
          .select()
          .from(emailOtpChallenges)
          .where(
            and(
              eq(emailOtpChallenges.pendingDigest, pendingDigest),
              eq(emailOtpChallenges.userId, input.userId),
              isNull(emailOtpChallenges.consumedAt),
              isNull(emailOtpChallenges.invalidatedAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!challenge) {
          await this.#audit(transaction, input.userId, "EMAIL_OTP_FAILED", input.client);
          return { kind: "invalid" };
        }
        if (challenge.expiresAt.getTime() <= now.getTime()) {
          await transaction
            .update(emailOtpChallenges)
            .set({ invalidatedAt: now })
            .where(eq(emailOtpChallenges.id, challenge.id));
          await this.#audit(
            transaction,
            input.userId,
            "EMAIL_OTP_FAILED",
            input.client,
            challenge.id,
          );
          return { kind: "invalid" };
        }

        // The attempt is counted before the comparison so a crash cannot grant a free guess.
        const attempts = challenge.attempts + 1;
        const matches = digestsMatch(
          hashEmailOtpCode(key, challenge.id, input.userId, input.code),
          challenge.codeHash,
        );

        if (!matches) {
          const exhausted = attempts >= EMAIL_OTP_MAX_ATTEMPTS;
          await transaction
            .update(emailOtpChallenges)
            .set({ attempts, ...(exhausted ? { invalidatedAt: now } : {}) })
            .where(eq(emailOtpChallenges.id, challenge.id));
          let locked = false;
          if (factor) {
            const failures = factor.failures + 1;
            locked = failures >= ACCOUNT_LOCK_THRESHOLD;
            await transaction
              .update(twoFactor)
              .set({
                failedVerificationCount: failures,
                ...(locked ? { lockedUntil: new Date(now.getTime() + ACCOUNT_LOCK_MS) } : {}),
              })
              .where(eq(twoFactor.id, factor.id));
          }
          await this.#audit(
            transaction,
            input.userId,
            "EMAIL_OTP_FAILED",
            input.client,
            challenge.id,
          );
          if (exhausted || locked) {
            await this.#audit(
              transaction,
              input.userId,
              "EMAIL_OTP_LOCKED",
              input.client,
              challenge.id,
            );
          }
          return { kind: "invalid" };
        }

        // Atomic single-use claim: only one concurrent request can flip consumed_at.
        const [claimed] = await transaction
          .update(emailOtpChallenges)
          .set({ attempts, consumedAt: now })
          .where(
            and(
              eq(emailOtpChallenges.id, challenge.id),
              isNull(emailOtpChallenges.consumedAt),
              isNull(emailOtpChallenges.invalidatedAt),
              gt(emailOtpChallenges.expiresAt, now),
            ),
          )
          .returning({ id: emailOtpChallenges.id });
        if (!claimed) return { kind: "invalid" };

        if (factor) {
          await transaction
            .update(twoFactor)
            .set({ failedVerificationCount: 0, lockedUntil: null })
            .where(eq(twoFactor.id, factor.id));
        }
        await this.#audit(
          transaction,
          input.userId,
          "EMAIL_OTP_VERIFIED",
          input.client,
          challenge.id,
        );
        return { kind: "ok", challengeId: challenge.id };
      },
    );

    if (outcome.kind === "locked") throw new RateLimitError();
    if (outcome.kind !== "ok" || !outcome.challengeId) throw new InvalidSecondFactorCodeError();
    return { challengeId: outcome.challengeId };
  }

  /**
   * Turns email codes on. `confirmTotp` must throw unless the caller just proved a current TOTP
   * code; eligibility is checked first so a refused account never reaches the TOTP check.
   */
  async enroll(input: {
    userId: string;
    client: EmailOtpClient;
    confirmTotp: () => Promise<void>;
  }): Promise<void> {
    this.#requireKey();
    const eligibility = await this.#loadEligibility(input.userId);
    if (
      !eligibility ||
      eligibility.staff ||
      !eligibility.totpReady ||
      eligibility.requireTotpNextLogin
    ) {
      await this.#audit(
        this.#database.db,
        input.userId,
        eligibility?.staff ? "EMAIL_OTP_BLOCKED_STAFF" : "EMAIL_OTP_ENROLL_REFUSED",
        input.client,
      );
      throw new EmailOtpUnavailableError();
    }
    await input.confirmTotp();
    const inserted = await this.#database.db.transaction(async (transaction) => {
      // Re-check staff status in the same transaction that writes the enrollment.
      const [staff] = await transaction
        .select({ userId: staffMemberships.userId })
        .from(staffMemberships)
        .where(
          and(
            eq(staffMemberships.userId, input.userId),
            inArray(staffMemberships.status, STAFF_STATUSES),
          ),
        )
        .for("share")
        .limit(1);
      if (staff) return "staff" as const;
      const rows = await transaction
        .insert(emailOtpEnrollments)
        .values({ userId: input.userId, enabledAt: this.#now() })
        .onConflictDoNothing()
        .returning({ userId: emailOtpEnrollments.userId });
      if (rows.length === 0) return "existing" as const;
      await this.#audit(transaction, input.userId, "EMAIL_OTP_ENROLLED", input.client);
      return "created" as const;
    });
    if (inserted === "staff") throw new EmailOtpUnavailableError();
    if (inserted === "created")
      this.#notify({ kind: "email-otp-enabled", recipient: eligibility.email });
  }

  /** Turns email codes off after the caller has proved a current TOTP code. */
  async disable(input: {
    userId: string;
    client: EmailOtpClient;
    confirmTotp: () => Promise<void>;
  }): Promise<void> {
    this.#requireKey();
    const eligibility = await this.#loadEligibility(input.userId);
    if (!eligibility?.enrolled) throw new EmailOtpUnavailableError();
    await input.confirmTotp();
    const removed = await this.#database.db.transaction(async (transaction) => {
      const rows = await transaction
        .delete(emailOtpEnrollments)
        .where(eq(emailOtpEnrollments.userId, input.userId))
        .returning({ userId: emailOtpEnrollments.userId });
      if (rows.length === 0) return false;
      await invalidateLiveChallenges(transaction, input.userId, this.#now());
      await this.#audit(transaction, input.userId, "EMAIL_OTP_DISABLED", input.client);
      return true;
    });
    if (removed) this.#notify({ kind: "email-otp-disabled", recipient: eligibility.email });
  }

  /** Called after a password reset completes: the next login must use TOTP or a backup code. */
  async markPasswordReset(userId: string): Promise<void> {
    const eligibility = await this.#loadEligibility(userId);
    if (!eligibility?.enrolled) return;
    await this.#database.db.transaction(async (transaction) => {
      await transaction
        .update(emailOtpEnrollments)
        .set({ requireTotpNextLogin: true })
        .where(eq(emailOtpEnrollments.userId, userId));
      await invalidateLiveChallenges(transaction, userId, this.#now());
    });
    this.#notify({ kind: "password-reset-notice", recipient: eligibility.email });
  }

  /** Called after a successful TOTP or backup-code login. */
  async clearRequireTotp(userId: string): Promise<void> {
    await this.#database.db
      .update(emailOtpEnrollments)
      .set({ requireTotpNextLogin: false })
      .where(
        and(
          eq(emailOtpEnrollments.userId, userId),
          eq(emailOtpEnrollments.requireTotpNextLogin, true),
        ),
      );
  }

  /** Backup-code outcomes are audited whether or not email OTP is enabled. */
  async recordBackupCodeLogin(
    userId: string | null,
    succeeded: boolean,
    client: EmailOtpClient,
  ): Promise<void> {
    await this.#audit(
      this.#database.db,
      userId,
      succeeded ? "BACKUP_CODE_LOGIN_SUCCEEDED" : "BACKUP_CODE_LOGIN_FAILED",
      client,
    );
  }

  /** Appends an authentication event (keyed IP digest, never a code). Also used by staff step-up. */
  recordSecurityEvent(
    executor: Pick<Database, "insert">,
    userId: string | null,
    eventType: AuthSecurityEventType,
    client: EmailOtpClient,
  ): Promise<void> {
    return this.#audit(executor, userId, eventType, client);
  }

  async #assertUsable(userId: string, client: EmailOtpClient): Promise<Eligibility> {
    const eligibility = await this.#loadEligibility(userId);
    if (!eligibility || !eligibility.enrolled || !eligibility.totpReady) {
      throw new EmailOtpUnavailableError();
    }
    if (eligibility.staff) {
      await this.#audit(this.#database.db, userId, "EMAIL_OTP_BLOCKED_STAFF", client);
      throw new EmailOtpUnavailableError();
    }
    if (eligibility.requireTotpNextLogin) {
      await this.#audit(this.#database.db, userId, "EMAIL_OTP_BLOCKED_AFTER_RESET", client);
      throw new EmailOtpUnavailableError();
    }
    return eligibility;
  }

  async #loadEligibility(userId: string): Promise<Eligibility | null> {
    const [account] = await this.#database.db
      .select({
        email: user.email,
        status: user.status,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        totpVerified: twoFactor.verified,
        requireTotpNextLogin: emailOtpEnrollments.requireTotpNextLogin,
        enrolledUserId: emailOtpEnrollments.userId,
        staffUserId: staffMemberships.userId,
      })
      .from(user)
      .leftJoin(twoFactor, eq(twoFactor.userId, user.id))
      .leftJoin(emailOtpEnrollments, eq(emailOtpEnrollments.userId, user.id))
      .leftJoin(
        staffMemberships,
        and(eq(staffMemberships.userId, user.id), inArray(staffMemberships.status, STAFF_STATUSES)),
      )
      .where(eq(user.id, userId))
      .limit(1);
    if (!account || account.status !== "ACTIVE") return null;
    return {
      email: account.email,
      enrolled: account.enrolledUserId !== null,
      requireTotpNextLogin: account.requireTotpNextLogin ?? false,
      staff: account.staffUserId !== null,
      totpReady: account.emailVerified && account.twoFactorEnabled && account.totpVerified === true,
    };
  }

  #requireKey(): string {
    if (!this.#config.enabled) throw new NotFoundError();
    return this.#config.hmacKey;
  }

  #audit(
    executor: Pick<Database, "insert">,
    userId: string | null,
    eventType: AuthSecurityEventType,
    client: EmailOtpClient,
    challengeId?: string,
  ): Promise<void> {
    return recordAuthSecurityEvent(executor, {
      userId,
      eventType,
      challengeId,
      ipDigest: digestClientIp(this.#ipDigestKey, client.ip),
      userAgent: client.userAgent,
    });
  }

  /** Notifications are best effort: a mail outage must not undo a security-relevant change. */
  #notify(message: AuthEmail): void {
    void this.#emailSender.send(message).catch(() => undefined);
  }
}

/** Used when a staff membership is created: staff are TOTP-only. */
export async function disableEmailOtpForStaffMember(
  transaction: Pick<Database, "delete" | "update" | "insert">,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const removed = await transaction
    .delete(emailOtpEnrollments)
    .where(eq(emailOtpEnrollments.userId, userId))
    .returning({ userId: emailOtpEnrollments.userId });
  await invalidateLiveChallenges(transaction, userId, now);
  if (removed.length > 0) {
    await recordAuthSecurityEvent(transaction, {
      userId,
      eventType: "EMAIL_OTP_DISABLED_BY_STAFF_MEMBERSHIP",
    });
  }
}

async function invalidateLiveChallenges(
  executor: Pick<Database, "update">,
  userId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(emailOtpChallenges)
    .set({ invalidatedAt: now })
    .where(
      and(
        eq(emailOtpChallenges.userId, userId),
        isNull(emailOtpChallenges.consumedAt),
        isNull(emailOtpChallenges.invalidatedAt),
      ),
    );
}

async function lockKey(transaction: Transaction, key: string): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
