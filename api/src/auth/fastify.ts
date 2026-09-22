import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../lib/errors.js";
import { RATE_LIMITS, type RateLimiter } from "../commerce/rate-limit.js";
import type { AuthService } from "./auth.js";
import {
  LoginSchema,
  PasswordResetRequestSchema,
  PasswordResetSchema,
  RegistrationSchema,
  VerificationRequestSchema,
  validateTrustedRedirect,
} from "./validation.js";

type RegisterAuthRoutesOptions = {
  auth: AuthService;
  baseURL: string;
  frontendURL: string;
  trustedOrigins: readonly string[];
  rateLimiter: RateLimiter;
};

export function registerAuthRoutes(
  app: FastifyInstance,
  { auth, baseURL, frontendURL, trustedOrigins, rateLimiter }: RegisterAuthRoutesOptions,
): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const requestUrl = new URL(request.url, baseURL);
      const body = normalizeAuthBody(
        requestUrl.pathname,
        request.body,
        frontendURL,
        trustedOrigins,
      );
      await applyAuthRateLimit(
        rateLimiter,
        auth,
        requestUrl.pathname,
        body,
        request.ip,
        request.headers,
      );
      if (requestUrl.pathname.endsWith("/verify-email")) {
        return reply
          .header("allow", "POST")
          .status(405)
          .send({ code: "METHOD_NOT_ALLOWED", message: "Use explicit email verification" });
      }
      const forwardedHeaders = fromNodeHeaders(request.headers);
      forwardedHeaders.set("x-real-ip", request.ip);
      const authRequest = new Request(requestUrl, {
        method: request.method,
        headers: forwardedHeaders,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const response = await auth.handler(authRequest);

      const genericLoginFailure = isGenericLoginFailure(requestUrl.pathname, response.status);
      reply.status(genericLoginFailure ? 401 : response.status);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);

      const payload = response.body ? await response.text() : null;
      if (genericLoginFailure) {
        return reply.send({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Unable to log in" });
      }
      return reply.send(payload);
    },
  });
}

export async function applyAuthRateLimit(
  limiter: RateLimiter,
  auth: AuthService,
  path: string,
  body: unknown,
  requestIp: string,
  requestHeaders: Parameters<typeof fromNodeHeaders>[0],
): Promise<void> {
  const email = emailFrom(body);
  const preAuthKey = email ? `${requestIp}|${email}` : requestIp;
  const policy = path.endsWith("/sign-up/email")
    ? { scope: "auth-sign-up", ...RATE_LIMITS.signUp }
    : path.endsWith("/sign-in/email")
      ? { scope: "auth-sign-in", ...RATE_LIMITS.signIn }
      : path.endsWith("/request-password-reset")
        ? { scope: "auth-password-reset-request", ...RATE_LIMITS.passwordResetRequest }
        : path.endsWith("/send-verification-email")
          ? { scope: "auth-verification-resend", ...RATE_LIMITS.verificationResend }
          : undefined;
  if (policy) {
    await limiter.consume({ ...policy, key: preAuthKey });
    return;
  }
  const passwordReset = path.endsWith("/reset-password");
  const sensitiveTwoFactor =
    path.includes("/two-factor/") &&
    /\/(enable|disable|verify-totp|verify-backup-code|generate-backup-codes)$/.test(path);
  if (!passwordReset && !sensitiveTwoFactor) {
    await limiter.consume({ scope: "auth-default", ...RATE_LIMITS.authDefault, key: requestIp });
    return;
  }
  const session = await auth.api.getSession({ headers: fromNodeHeaders(requestHeaders) });
  await limiter.consume({
    scope: passwordReset ? "auth-password-reset-consume" : "auth-two-factor",
    key: session?.user.id ?? preAuthKey,
    ...RATE_LIMITS.security,
  });
}

function emailFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("email" in value)) return undefined;
  const email = value.email;
  return typeof email === "string" ? email.trim().toLowerCase() : undefined;
}

function normalizeAuthBody(
  path: string,
  body: unknown,
  frontendURL: string,
  trustedOrigins: readonly string[],
): unknown {
  const parsed = (() => {
    if (path.endsWith("/sign-up/email")) {
      // The acknowledgement is recorded against user_consents by the
      // create-user hook, so Better Auth never needs to see it.
      const registration: Record<string, unknown> = { ...RegistrationSchema.parse(body) };
      delete registration["termsAccepted"];
      return registration;
    }
    if (path.endsWith("/sign-in/email")) return LoginSchema.parse(body);
    if (path.endsWith("/request-password-reset")) return PasswordResetRequestSchema.parse(body);
    if (path.endsWith("/reset-password")) return PasswordResetSchema.parse(body);
    if (path.endsWith("/send-verification-email")) return VerificationRequestSchema.parse(body);
    if (path.endsWith("/two-factor/enable")) {
      return z
        .object({ password: z.string().min(1).max(128) })
        .strict()
        .parse(body);
    }
    if (path.endsWith("/two-factor/verify-totp")) {
      const verified = z
        .object({ code: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(body);
      return { ...verified, trustDevice: false };
    }
    if (path.endsWith("/two-factor/verify-backup-code")) {
      const verified = z
        .object({ code: z.string().min(1).max(128) })
        .strict()
        .parse(body);
      return { ...verified, disableSession: false, trustDevice: false };
    }
    return body;
  })();

  const redirect = redirectFrom(parsed);
  if (redirect && !validateTrustedRedirect(redirect, trustedOrigins)) {
    throw new ValidationError("The redirect destination is not trusted");
  }
  return withCanonicalAuthRedirect(path, parsed, frontendURL);
}

function withCanonicalAuthRedirect(path: string, value: unknown, frontendURL: string): unknown {
  if (!value || typeof value !== "object") return value;
  if (path.endsWith("/sign-up/email") || path.endsWith("/send-verification-email")) {
    return {
      ...value,
      callbackURL: new URL("/verify-email", frontendURL).href,
    };
  }
  if (path.endsWith("/request-password-reset")) {
    return { ...value, redirectTo: new URL("/reset-password", frontendURL).href };
  }
  return value;
}

function redirectFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { callbackURL?: unknown; redirectTo?: unknown };
  const redirect = candidate.callbackURL ?? candidate.redirectTo;
  return typeof redirect === "string" ? redirect : undefined;
}

function isGenericLoginFailure(path: string, status: number): boolean {
  return path.endsWith("/sign-in/email") && [400, 401, 500].includes(status);
}
