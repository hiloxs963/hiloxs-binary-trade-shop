import { isAPIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import { EmailVerificationSchema } from "../auth/validation.js";
import { ValidationError } from "../lib/errors.js";

type EmailVerificationRouteOptions = {
  auth: AuthService;
};

export function registerEmailVerificationRoute(
  app: FastifyInstance,
  { auth }: EmailVerificationRouteOptions,
): void {
  app.post("/api/v1/auth/verify-email", async (request) => {
    const { token } = EmailVerificationSchema.parse(request.body);

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
