import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { AuthRuntimeConfig } from "../config/env.js";
import type { DatabaseClient } from "../db/client.js";
import { ACCOUNT_STATUSES, account, session, user, verification } from "../db/schema/auth.js";
import { EmailDeliveryError } from "../lib/errors.js";
import type { AuthEmailSender } from "./email.js";
import { PASSWORD_MIN_LENGTH } from "./validation.js";
import { EmailVerificationTokenStore } from "./verification-tokens.js";

const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60;

type CreateAuthOptions = {
  database: DatabaseClient;
  emailSender: AuthEmailSender;
  runtime: AuthRuntimeConfig;
};

type AuthRequestDeliveryState = {
  verificationError?: unknown;
};

export function createAuthService({ database, emailSender, runtime }: CreateAuthOptions) {
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
      schema: { user, session, account, verification },
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
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: EMAIL_VERIFICATION_TTL_SECONDS,
      sendVerificationEmail: async ({ user: target, url, token }) => {
        try {
          await verificationTokens.issue(token, target.id, EMAIL_VERIFICATION_TTL_SECONDS);
          await emailSender.send({ kind: "verification", recipient: target.email, url });
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
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      customRules: {
        "/sign-up/email": { window: 15 * 60, max: 5 },
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 15 * 60, max: 3 },
        "/send-verification-email": { window: 15 * 60, max: 3 },
      },
    },
    databaseHooks: {
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
    consumeEmailVerificationToken: (token: string) => verificationTokens.consume(token),
  });
}

function requiresConfirmedVerificationDelivery(path: string): boolean {
  return path.endsWith("/sign-up/email") || path.endsWith("/send-verification-email");
}

function passwordResetFrontendURL(frontendURL: string, token: string): string {
  const url = new URL("/reset-password", frontendURL);
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}

export type AuthService = ReturnType<typeof createAuthService>;
