import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
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
  trustedOrigins: readonly string[];
};

export function registerAuthRoutes(
  app: FastifyInstance,
  { auth, baseURL, trustedOrigins }: RegisterAuthRoutesOptions,
): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const requestUrl = new URL(request.url, baseURL);
      const body = normalizeAuthBody(requestUrl.pathname, request.body, trustedOrigins);
      await enforceOneTimeEmailVerification(requestUrl, auth);
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

async function enforceOneTimeEmailVerification(requestUrl: URL, auth: AuthService): Promise<void> {
  if (!requestUrl.pathname.endsWith("/verify-email")) return;
  const token = requestUrl.searchParams.get("token");
  if (token && (await auth.consumeEmailVerificationToken(token))) return;

  // Let Better Auth preserve its normal trusted callback and invalid-token response behavior.
  requestUrl.searchParams.set("token", "invalid-or-consumed");
}

function normalizeAuthBody(
  path: string,
  body: unknown,
  trustedOrigins: readonly string[],
): unknown {
  const parsed = (() => {
    if (path.endsWith("/sign-up/email")) return RegistrationSchema.parse(body);
    if (path.endsWith("/sign-in/email")) return LoginSchema.parse(body);
    if (path.endsWith("/request-password-reset")) return PasswordResetRequestSchema.parse(body);
    if (path.endsWith("/reset-password")) return PasswordResetSchema.parse(body);
    if (path.endsWith("/send-verification-email")) return VerificationRequestSchema.parse(body);
    return body;
  })();

  const redirect = redirectFrom(parsed);
  if (redirect && !validateTrustedRedirect(redirect, trustedOrigins)) {
    throw new ValidationError("The redirect destination is not trusted");
  }
  return parsed;
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
