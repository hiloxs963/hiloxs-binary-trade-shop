import { randomUUID } from "node:crypto";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricDecrypt, symmetricEncrypt, generateRandomString } from "better-auth/crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { decodeBackupCodes, encodeBackupCodes, generateBackupCodes } from "./backup-codes.js";
import { digestClientIp } from "../auth/email-otp/codes.js";
import { recordAuthSecurityEvent } from "../auth/email-otp/events.js";
import type { AuthEmail, AuthEmailSender } from "../auth/email.js";
import { RATE_LIMITS, type RateLimiter } from "../commerce/rate-limit.js";
import type { Database, DatabaseClient } from "../db/client.js";
import { account, session, twoFactor, user, verification } from "../db/schema/auth.js";
import type { AuthSecurityEventType } from "../db/schema/email-otp.js";
import {
  ConflictError,
  InvalidSecondFactorCodeError,
  ReauthenticationFailedError,
} from "../lib/errors.js";
import { writeOperationalLog } from "../lib/logger.js";

const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_ISSUER = "HILOXS";
export const PENDING_REPLACEMENT_TTL_MS = 10 * 60_000;
export const PENDING_REPLACEMENT_MAX_ATTEMPTS = 5;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type AuthContextProvider = {
  $context: Promise<{
    secretConfig: Parameters<typeof symmetricEncrypt>[0]["key"];
    password: { verify: (input: { hash: string; password: string }) => Promise<boolean> };
  }>;
};

export type AccountSecurityClient = { ip: string; userAgent?: string | undefined };

type PendingReplacement = {
  sessionId: string;
  secret: string;
  attempts: number;
};

type Factor = { id: string; secret: string; backupCodes: string; email: string };

type ReauthOutcome = { ok: true } | { ok: false };

export type AccountSecurityServiceOptions = {
  database: DatabaseClient;
  auth: AuthContextProvider;
  emailSender: AuthEmailSender;
  rateLimiter: RateLimiter;
  ipDigestKey: string;
};

/**
 * Replaces the authenticator secret and regenerates backup codes for an account that already has a
 * verified second factor.
 *
 * Better-auth offers no safe primitive for this: `enable` overwrites an enrolled secret at once and
 * without confirmation, and `disable` + `enable` leaves a window with no second factor. Here the
 * live `two_factor` row and `user.two_factor_enabled` are never cleared. A pending secret waits in
 * the `verification` table (encrypted, bound to the starting session, expiring) and is swapped in
 * one transaction only after a code from the new authenticator proves it works.
 */
export class AccountSecurityService {
  readonly #database: DatabaseClient;
  readonly #auth: AuthContextProvider;
  readonly #emailSender: AuthEmailSender;
  readonly #rateLimiter: RateLimiter;
  readonly #ipDigestKey: string;

  constructor(options: AccountSecurityServiceOptions) {
    this.#database = options.database;
    this.#auth = options.auth;
    this.#emailSender = options.emailSender;
    this.#rateLimiter = options.rateLimiter;
    this.#ipDigestKey = options.ipDigestKey;
  }

  async status(userId: string): Promise<{ enrolled: boolean; backupCodesRemaining: number }> {
    const factor = await this.#loadFactor(this.#database.db, userId, false);
    if (!factor) return { enrolled: false, backupCodesRemaining: 0 };
    const { secretConfig } = await this.#auth.$context;
    const codes = await decodeBackupCodes(factor.backupCodes, secretConfig);
    return { enrolled: true, backupCodesRemaining: codes.length };
  }

  async startReplacement(input: {
    userId: string;
    sessionId: string;
    password: string;
    code: string;
    client: AccountSecurityClient;
  }): Promise<{ totpURI: string; expiresAt: Date }> {
    await this.#rateLimiter.consume({
      scope: "account-security-reauth",
      key: input.userId,
      ...RATE_LIMITS.accountSecurityReauth,
    });
    const context = await this.#auth.$context;

    const outcome = await this.#database.db.transaction(async (transaction) => {
      await lockKey(transaction, `account-security:${input.userId}`);
      const factor = await this.#loadFactor(transaction, input.userId, true);
      if (!factor) return { kind: "not-enrolled" as const };
      const reauth = await this.#reauthenticate(transaction, context, factor, input);
      if (!reauth.ok) return { kind: "rejected" as const };

      const secret = generateRandomString(32);
      const expiresAt = new Date(Date.now() + PENDING_REPLACEMENT_TTL_MS);
      const pending: PendingReplacement = {
        sessionId: input.sessionId,
        secret: await symmetricEncrypt({ key: context.secretConfig, data: secret }),
        attempts: 0,
      };
      await transaction
        .delete(verification)
        .where(eq(verification.identifier, pendingIdentifier(input.userId)));
      await transaction.insert(verification).values({
        id: randomUUID(),
        identifier: pendingIdentifier(input.userId),
        value: JSON.stringify(pending),
        expiresAt,
      });
      await this.#audit(transaction, input.userId, "AUTHENTICATOR_REPLACE_STARTED", input.client);
      return { kind: "started" as const, secret, expiresAt, email: factor.email };
    });

    if (outcome.kind === "not-enrolled") {
      throw new ConflictError("Two-factor authentication is not enabled");
    }
    if (outcome.kind === "rejected") {
      await this.#audit(
        this.#database.db,
        input.userId,
        "AUTHENTICATOR_REPLACE_FAILED",
        input.client,
      );
      throw new ReauthenticationFailedError();
    }
    const totpURI = createOTP(outcome.secret, {
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
    }).url(TOTP_ISSUER, outcome.email);
    return { totpURI, expiresAt: outcome.expiresAt };
  }

  async confirmReplacement(input: {
    userId: string;
    sessionId: string;
    code: string;
    client: AccountSecurityClient;
  }): Promise<{ backupCodes: string[] }> {
    await this.#rateLimiter.consume({
      scope: "account-security-confirm",
      key: input.userId,
      ...RATE_LIMITS.accountSecurityConfirm,
    });
    const context = await this.#auth.$context;

    const outcome = await this.#database.db.transaction(async (transaction) => {
      await lockKey(transaction, `account-security:${input.userId}`);
      const [row] = await transaction
        .select({ id: verification.id, value: verification.value })
        .from(verification)
        .where(
          and(
            eq(verification.identifier, pendingIdentifier(input.userId)),
            sql`${verification.expiresAt} > now()`,
          ),
        )
        .for("update")
        .limit(1);
      const pending = row ? parsePending(row.value) : null;
      const factor = await this.#loadFactor(transaction, input.userId, true);
      // The pending secret belongs to the session that started the change; another session
      // (for example a stolen one) learns nothing about it.
      if (!row || !pending || !factor || pending.sessionId !== input.sessionId) {
        return { kind: "none" as const };
      }
      if (pending.attempts >= PENDING_REPLACEMENT_MAX_ATTEMPTS) {
        await transaction.delete(verification).where(eq(verification.id, row.id));
        return { kind: "none" as const };
      }

      const secret = await symmetricDecrypt({ key: context.secretConfig, data: pending.secret });
      const valid = await createOTP(secret, {
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD_SECONDS,
      }).verify(input.code);
      if (!valid) {
        await transaction
          .update(verification)
          .set({ value: JSON.stringify({ ...pending, attempts: pending.attempts + 1 }) })
          .where(eq(verification.id, row.id));
        return { kind: "invalid" as const };
      }

      const backupCodes = generateBackupCodes();
      const encryptedBackupCodes = await encodeBackupCodes(backupCodes, context.secretConfig);
      // `user.two_factor_enabled` and `two_factor.verified` are deliberately not written: the
      // account has a verified second factor before, during, and after the swap.
      await transaction
        .update(twoFactor)
        .set({
          secret: pending.secret,
          backupCodes: encryptedBackupCodes,
          failedVerificationCount: 0,
          lockedUntil: null,
        })
        .where(eq(twoFactor.id, factor.id));
      await transaction
        .delete(session)
        .where(and(eq(session.userId, input.userId), ne(session.id, input.sessionId)));
      await transaction.delete(verification).where(eq(verification.id, row.id));
      await this.#audit(transaction, input.userId, "AUTHENTICATOR_REPLACED", input.client);
      return { kind: "replaced" as const, backupCodes, email: factor.email };
    });

    if (outcome.kind === "none") {
      throw new ConflictError("No authenticator change is in progress. Start again.");
    }
    if (outcome.kind === "invalid") {
      await this.#audit(
        this.#database.db,
        input.userId,
        "AUTHENTICATOR_REPLACE_FAILED",
        input.client,
      );
      throw new InvalidSecondFactorCodeError();
    }
    this.#notify({ kind: "authenticator-replaced", recipient: outcome.email });
    return { backupCodes: outcome.backupCodes };
  }

  async regenerateBackupCodes(input: {
    userId: string;
    password: string;
    code: string;
    client: AccountSecurityClient;
  }): Promise<{ backupCodes: string[] }> {
    await this.#rateLimiter.consume({
      scope: "account-security-reauth",
      key: input.userId,
      ...RATE_LIMITS.accountSecurityReauth,
    });
    const context = await this.#auth.$context;

    const outcome = await this.#database.db.transaction(async (transaction) => {
      await lockKey(transaction, `account-security:${input.userId}`);
      const factor = await this.#loadFactor(transaction, input.userId, true);
      if (!factor) return { kind: "not-enrolled" as const };
      const reauth = await this.#reauthenticate(transaction, context, factor, input);
      if (!reauth.ok) return { kind: "rejected" as const };

      const backupCodes = generateBackupCodes();
      const encryptedBackupCodes = await encodeBackupCodes(backupCodes, context.secretConfig);
      await transaction
        .update(twoFactor)
        .set({ backupCodes: encryptedBackupCodes })
        .where(eq(twoFactor.id, factor.id));
      await this.#audit(transaction, input.userId, "BACKUP_CODES_REGENERATED", input.client);
      return { kind: "regenerated" as const, backupCodes, email: factor.email };
    });

    if (outcome.kind === "not-enrolled") {
      throw new ConflictError("Two-factor authentication is not enabled");
    }
    if (outcome.kind === "rejected") {
      await this.#audit(
        this.#database.db,
        input.userId,
        "BACKUP_CODES_REGENERATE_FAILED",
        input.client,
      );
      throw new ReauthenticationFailedError();
    }
    this.#notify({ kind: "backup-codes-regenerated", recipient: outcome.email });
    return { backupCodes: outcome.backupCodes };
  }

  /**
   * Requires the account password and a current TOTP code or unused backup code. A backup code that
   * authorizes the change is consumed. The password is checked first so a wrong password never
   * spends a code.
   */
  async #reauthenticate(
    transaction: Transaction,
    context: Awaited<AuthContextProvider["$context"]>,
    factor: Factor,
    input: { userId: string; password: string; code: string },
  ): Promise<ReauthOutcome> {
    const [credential] = await transaction
      .select({ hash: account.password })
      .from(account)
      .where(and(eq(account.userId, input.userId), eq(account.providerId, "credential")))
      .limit(1);
    if (!credential?.hash) return { ok: false };
    if (!(await context.password.verify({ hash: credential.hash, password: input.password }))) {
      return { ok: false };
    }

    const code = input.code.trim();
    if (/^\d{6}$/.test(code)) {
      const secret = await symmetricDecrypt({ key: context.secretConfig, data: factor.secret });
      const valid = await createOTP(secret, {
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD_SECONDS,
      }).verify(code);
      return { ok: valid };
    }

    const codes = await decodeBackupCodes(factor.backupCodes, context.secretConfig);
    if (!codes.includes(code)) return { ok: false };
    const remaining = codes.filter((candidate) => candidate !== code);
    const updated = await transaction
      .update(twoFactor)
      .set({
        backupCodes: await encodeBackupCodes(remaining, context.secretConfig),
      })
      .where(and(eq(twoFactor.id, factor.id), eq(twoFactor.backupCodes, factor.backupCodes)))
      .returning({ id: twoFactor.id });
    return { ok: updated.length === 1 };
  }

  async #loadFactor(
    executor: Pick<Database, "select">,
    userId: string,
    lock: boolean,
  ): Promise<Factor | null> {
    const query = executor
      .select({
        id: twoFactor.id,
        secret: twoFactor.secret,
        backupCodes: twoFactor.backupCodes,
        email: user.email,
      })
      .from(twoFactor)
      .innerJoin(user, eq(user.id, twoFactor.userId))
      .where(
        and(
          eq(twoFactor.userId, userId),
          eq(twoFactor.verified, true),
          eq(user.twoFactorEnabled, true),
        ),
      )
      .limit(1);
    const [factor] = await (lock ? query.for("update", { of: twoFactor }) : query);
    return factor ?? null;
  }

  #audit(
    executor: Pick<Database, "insert">,
    userId: string,
    eventType: AuthSecurityEventType,
    client: AccountSecurityClient,
  ): Promise<void> {
    return recordAuthSecurityEvent(executor, {
      userId,
      eventType,
      ipDigest: digestClientIp(this.#ipDigestKey, client.ip),
      userAgent: client.userAgent,
    });
  }

  /** Best effort: a mail outage must not undo a change that is already committed and audited. */
  #notify(message: AuthEmail): void {
    void this.#emailSender.send(message).catch(() => {
      writeOperationalLog("warn", `Account security: ${message.kind} notification not delivered`);
    });
  }
}

function pendingIdentifier(userId: string): string {
  return `authenticator-replace:${userId}`;
}

function parsePending(value: string): PendingReplacement | null {
  try {
    const parsed = JSON.parse(value) as Partial<PendingReplacement>;
    if (
      typeof parsed.sessionId === "string" &&
      typeof parsed.secret === "string" &&
      typeof parsed.attempts === "number"
    ) {
      return { sessionId: parsed.sessionId, secret: parsed.secret, attempts: parsed.attempts };
    }
    return null;
  } catch {
    return null;
  }
}

async function lockKey(transaction: Transaction, key: string): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
