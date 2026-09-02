import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../lib/errors.js";
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
};

export function registerAuthRoutes(
  app: FastifyInstance,
  { auth, baseURL, frontendURL, trustedOrigins }: RegisterAuthRoutesOptions,
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
      if (requestUrl.pathname.endsWith("/verify-email")) {
        return reply
          .header("allow", "POST")
          .status(405)
          .send({ code: "METHOD_NOT_ALLOWED", message: "Use explicit email verification" });
      }
      const authRequest = new Request(requestUrl, {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
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

function normalizeAuthBody(
  path: string,
  body: unknown,
  frontendURL: string,
  trustedOrigins: readonly string[],
): unknown {
  const parsed = (() => {
    if (path.endsWith("/sign-up/email")) return RegistrationSchema.parse(body);
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
