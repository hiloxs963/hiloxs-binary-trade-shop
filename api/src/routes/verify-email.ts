import { isAPIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import { EmailVerificationSchema } from "../auth/validation.js";
import { RATE_LIMITS, type RateLimiter } from "../commerce/rate-limit.js";
import { ValidationError } from "../lib/errors.js";

type EmailVerificationRouteOptions = {
  auth: AuthService;
  rateLimiter: RateLimiter;
};

export function registerEmailVerificationRoute(
  app: FastifyInstance,
  { auth, rateLimiter }: EmailVerificationRouteOptions,
): void {
  app.post("/api/v1/auth/verify-email", async (request) => {
    const { token } = EmailVerificationSchema.parse(request.body);
    await rateLimiter.consume({
      scope: "auth-email-verification",
      key: `${request.ip}|${token}`,
      ...RATE_LIMITS.security,
    });

    try {
      const result = await auth.verifyEmailToken(token, fromNodeHeaders(request.headers));
      if (!result) throw new ValidationError("The verification link is invalid or has expired");
      return { status: true };
    } catch (error) {
      if (isAPIError(error)) {
        throw new ValidationError("The verification link is invalid or has expired", error);
      }
      throw error;
    }
  });
}
