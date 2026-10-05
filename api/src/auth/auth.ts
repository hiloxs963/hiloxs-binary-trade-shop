import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor as twoFactorPlugin } from "better-auth/plugins/two-factor";
import { recordRegistrationConsent } from "../consent/service.js";
import { EMAIL_OTP_DISABLED, type AuthRuntimeConfig, type EmailOtpConfig } from "../config/env.js";
import type { DatabaseClient } from "../db/client.js";
import {
  ACCOUNT_STATUSES,
  account,
  session,
  twoFactor,
  user,
  verification,
} from "../db/schema/auth.js";
import { EmailDeliveryError } from "../lib/errors.js";
import { emailOtpPlugin } from "./email-otp/plugin.js";
import { EmailOtpService } from "./email-otp/service.js";
import type { AuthEmailSender } from "./email.js";
import { PASSWORD_MIN_LENGTH } from "./validation.js";
import { EmailVerificationTokenStore } from "./verification-tokens.js";

const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60;
const SIGN_UP_PATH = "/sign-up/email";

type CreateAuthOptions = {
  database: DatabaseClient;
  emailSender: AuthEmailSender;
  runtime: AuthRuntimeConfig;
  emailOtp?: EmailOtpConfig;
};

type AuthRequestDeliveryState = {
  verificationError?: unknown;
};

export function createAuthService({
  database,
  emailSender,
  runtime,
  emailOtp = EMAIL_OTP_DISABLED,
}: CreateAuthOptions) {
  const emailOtpService = new EmailOtpService({
    database,
    emailSender,
    config: emailOtp,
    ipDigestKey: runtime.secret,
  });
  const verificationTokens = new EmailVerificationTokenStore(database);
  const deliveryState = new AsyncLocalStorage<AuthRequestDeliveryState>();
  const service = betterAuth({
    appName: "HILOXS",
    baseURL: runtime.baseURL,
    basePath: "/api/auth",
    secret: runtime.secret,
    trustedOrigins: runtime.trustedOrigins,
    database: drizzleAdapter(database.db, {
      provider: "pg",
      schema: { user, session, account, verification, twoFactor },
    }),
    user: {
      additionalFields: {
        phone: { type: "string", required: true, input: true, returned: true },
        status: {
          type: [...ACCOUNT_STATUSES],
          required: true,
          defaultValue: "ACTIVE",
          input: false,
          returned: true,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      additionalFields: {
        mfaMethod: { type: "string", required: false, defaultValue: "none", input: false },
      },
    },
    plugins: [
      twoFactorPlugin({
        issuer: "HILOXS",
        skipVerificationOnEnable: false,
        trustDeviceMaxAge: 0,
      }),
      emailOtpPlugin({ service: emailOtpService, database }),
    ],
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: EMAIL_VERIFICATION_TTL_SECONDS,
      sendVerificationEmail: async ({ user: target, token }) => {
        try {
          await verificationTokens.issue(token, target.id, EMAIL_VERIFICATION_TTL_SECONDS);
          await emailSender.send({
            kind: "verification",
            recipient: target.email,
            url: verificationFrontendURL(runtime.frontendURL, token),
          });
        } catch (error) {
          const currentDelivery = deliveryState.getStore();
          if (currentDelivery) currentDelivery.verificationError = error;
          throw error;
        }
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      // Email-based recovery must not turn the mailbox into the only factor: the next login
      // after a reset has to use TOTP or a backup code (ADR 0010).
      onPasswordReset: async ({ user: target }) => {
        await emailOtpService.markPasswordReset(target.id);
      },
      sendResetPassword: ({ user: target, token }) => {
        void emailSender
          .send({
            kind: "password-reset",
            recipient: target.email,
            url: passwordResetFrontendURL(runtime.frontendURL, token),
          })
          .catch(() => undefined);
        return Promise.resolve();
      },
    },
    verification: {
      storeIdentifier: "hashed",
    },
    rateLimit: {
      enabled: false,
    },
    databaseHooks: {
      user: {
        create: {
          // Sign-up is the only route that creates a user, and it cannot be
          // reached without RegistrationSchema accepting termsAccepted: true,
          // so reaching here means consent was given. A failure here fails the
          // registration rather than leaving an unrecorded acceptance.
          after: async (created, context) => {
            if (context?.path !== SIGN_UP_PATH) return;
            await recordRegistrationConsent(database.db, created.id, {
              ipAddress: context.headers?.get("x-real-ip"),
              userAgent: context.headers?.get("user-agent"),
            });
          },
        },
      },
      session: {
        create: {
          before: async (pendingSession) => {
            const [owner] = await database.db
              .select({ status: user.status })
              .from(user)
              .where(eq(user.id, pendingSession.userId))
              .limit(1);
            return owner?.status === "ACTIVE";
          },
        },
      },
    },
    advanced: {
      useSecureCookies: runtime.secureCookies,
      ipAddress: {
        ipAddressHeaders: ["x-real-ip"],
        ipv6Subnet: 64,
      },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: runtime.secureCookies,
        sameSite: "lax",
        path: "/",
      },
    },
    logger: { disabled: true },
  });

  const handleAuthRequest = service.handler.bind(service);

  return Object.assign(service, {
    emailOtp: emailOtpService,
    handler: (request: Request) =>
      deliveryState.run({}, async () => {
        const response = await handleAuthRequest(request);
        const failure = deliveryState.getStore()?.verificationError;
        if (failure && requiresConfirmedVerificationDelivery(new URL(request.url).pathname)) {
          if (failure instanceof Error) throw failure;
          throw new EmailDeliveryError();
        }
        return response;
      }),
    verifyEmailToken: (token: string, headers: Headers) =>
      verificationTokens.consumeAfter(token, async () => {
        const result = await service.api.verifyEmail({ query: { token }, headers });
        if (!result?.status) throw new Error("Email verification did not complete");
        return result;
      }),
  });
}

function requiresConfirmedVerificationDelivery(path: string): boolean {
  return path.endsWith("/sign-up/email") || path.endsWith("/send-verification-email");
}

function verificationFrontendURL(frontendURL: string, token: string): string {
  const url = new URL("/verify-email", frontendURL);
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}

function passwordResetFrontendURL(frontendURL: string, token: string): string {
  const url = new URL("/reset-password", frontendURL);
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}

export type AuthService = ReturnType<typeof createAuthService>;
