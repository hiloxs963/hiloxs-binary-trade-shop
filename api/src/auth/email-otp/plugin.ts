import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { expireCookie, setSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "../../db/client.js";
import { session, type SessionMfaMethod } from "../../db/schema/auth.js";
import { AppError } from "../../lib/errors.js";
import type { EmailOtpClient, EmailOtpService } from "./service.js";

const TWO_FACTOR_COOKIE_NAME = "two_factor";
const VERIFY_TOTP_PATH = "/two-factor/verify-totp";
const VERIFY_BACKUP_CODE_PATH = "/two-factor/verify-backup-code";

export type PendingLogin = { identifier: string; userId: string };

/**
 * Better-auth's pending (pre-2FA) login is a signed `two_factor` cookie naming a short-lived
 * verification row whose value is the user id. This resolves it without consuming it.
 */
async function resolvePendingLogin(ctx: GenericEndpointContext): Promise<PendingLogin | null> {
  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) return null;
  const record = await ctx.context.internalAdapter.findVerificationValue(identifier);
  if (!record || record.expiresAt.getTime() <= Date.now()) return null;
  return { identifier, userId: record.value };
}

function clientOf(ctx: GenericEndpointContext): EmailOtpClient {
  return {
    ip: ctx.headers?.get("x-real-ip") ?? "unknown",
    userAgent: ctx.headers?.get("user-agent"),
  };
}

const STATUS_BY_CODE: Record<number, ConstructorParameters<typeof APIError>[0]> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  429: "TOO_MANY_REQUESTS",
  503: "SERVICE_UNAVAILABLE",
};

/** Better-auth swallows non-API errors into a bare 500, so expected failures are translated. */
function toApiError(error: unknown): unknown {
  if (!(error instanceof AppError) || !error.expose) return error;
  return APIError.from(STATUS_BY_CODE[error.statusCode] ?? "BAD_REQUEST", {
    message: error.message,
    code: error.code,
  });
}

function invalidPendingLogin(): APIError {
  return APIError.from("UNAUTHORIZED", {
    message: "Your sign-in session expired. Sign in again.",
    code: "INVALID_TWO_FACTOR_COOKIE",
  });
}

export function emailOtpPlugin({
  service,
  database,
}: {
  service: EmailOtpService;
  database: DatabaseClient;
}): BetterAuthPlugin {
  // A TOTP or backup code was just verified for this brand-new session, so the staff step-up
  // window starts now. Email-OTP sessions never reach this and keep a null timestamp.
  const tagSession = async (sessionId: string, mfaMethod: SessionMfaMethod) => {
    await database.db
      .update(session)
      .set({ mfaMethod, lastMfaVerifiedAt: new Date(), stepUpFailures: 0 })
      .where(eq(session.id, sessionId));
  };

  return {
    id: "hiloxs-email-otp",
    endpoints: {
      sendEmailOtp: createAuthEndpoint("/email-otp/send", { method: "POST" }, async (ctx) => {
        const pending = await resolvePendingLogin(ctx);
        if (!pending) throw invalidPendingLogin();
        try {
          const sent = await service.send({
            userId: pending.userId,
            pendingIdentifier: pending.identifier,
            client: clientOf(ctx),
          });
          return ctx.json({
            status: true,
            expiresAt: sent.expiresAt.toISOString(),
            resendAvailableAt: sent.resendAvailableAt.toISOString(),
          });
        } catch (error) {
          throw toApiError(error);
        }
      }),

      verifyEmailOtp: createAuthEndpoint(
        "/email-otp/verify",
        { method: "POST", body: z.object({ code: z.string().regex(/^\d{6}$/) }).strict() },
        async (ctx) => {
          const pending = await resolvePendingLogin(ctx);
          if (!pending) throw invalidPendingLogin();
          const twoFactorCookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
          try {
            await service.verify({
              userId: pending.userId,
              pendingIdentifier: pending.identifier,
              code: ctx.body.code,
              client: clientOf(ctx),
            });
          } catch (error) {
            throw toApiError(error);
          }

          // The challenge is spent. Claiming the pending login is atomic, so a concurrent TOTP or
          // email request for the same login can never also obtain a session.
          const consumed = await ctx.context.internalAdapter.consumeVerificationValue(
            pending.identifier,
          );
          if (!consumed || consumed.value !== pending.userId) {
            expireCookie(ctx, twoFactorCookie);
            throw invalidPendingLogin();
          }
          const account = await ctx.context.internalAdapter.findUserById(pending.userId);
          const created = account
            ? await ctx.context.internalAdapter.createSession(
                pending.userId,
                false,
                { mfaMethod: "email-otp" },
                true,
              )
            : null;
          if (!account || !created) {
            throw APIError.from("INTERNAL_SERVER_ERROR", {
              message: "Unable to complete sign-in",
              code: "FAILED_TO_CREATE_SESSION",
            });
          }
          await setSessionCookie(ctx, { session: created, user: account });
          expireCookie(ctx, twoFactorCookie);
          return ctx.json({ status: true });
        },
      ),
    },
    hooks: {
      after: [
        {
          matcher: (context) =>
            context.path === VERIFY_TOTP_PATH || context.path === VERIFY_BACKUP_CODE_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const backupCode = ctx.path === VERIFY_BACKUP_CODE_PATH;
            const issued = ctx.context.newSession;
            const client = clientOf(ctx);
            if (issued) {
              await tagSession(issued.session.id, backupCode ? "backup-code" : "totp");
              await service.clearRequireTotp(issued.user.id);
              if (backupCode) await service.recordBackupCodeLogin(issued.user.id, true, client);
              return;
            }
            if (backupCode) {
              // The pending login may already be gone (attempt cap); the event is still recorded.
              const pending = await resolvePendingLogin(ctx);
              // A backup code verified for an existing session is a staff step-up, which writes
              // its own audit events; it is neither a login failure nor a login success.
              if (!pending && (await getSessionFromCtx(ctx))) return;
              await service.recordBackupCodeLogin(pending?.userId ?? null, false, client);
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
