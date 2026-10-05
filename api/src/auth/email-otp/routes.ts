import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { RATE_LIMITS, type RateLimiter } from "../../commerce/rate-limit.js";
import {
  InvalidSecondFactorCodeError,
  NotFoundError,
  UnauthenticatedError,
} from "../../lib/errors.js";
import type { AuthService } from "../auth.js";

const CodeBodySchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

type Options = { auth: AuthService; rateLimiter: RateLimiter };

/**
 * Account-management endpoints for email codes. They sit beside (and take precedence over) the
 * /api/auth/* catch-all because they need an authenticated session and a fresh TOTP proof.
 */
export function registerEmailOtpRoutes(app: FastifyInstance, { auth, rateLimiter }: Options): void {
  const requireEnabled = (): void => {
    if (!auth.emailOtp.enabled) throw new NotFoundError();
  };
  const requireUser = async (request: FastifyRequest): Promise<string> => {
    const current = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!current) throw new UnauthenticatedError();
    return current.user.id;
  };
  const confirmTotpWith = (request: FastifyRequest, code: string) => async () => {
    try {
      // Session mode of verifyTOTP has no attempt counter of its own, so the per-user limiter
      // below is what bounds guessing here.
      await auth.api.verifyTOTP({ body: { code }, headers: fromNodeHeaders(request.headers) });
    } catch {
      throw new InvalidSecondFactorCodeError();
    }
  };

  app.get("/api/auth/email-otp/status", async (request) => {
    requireEnabled();
    return auth.emailOtp.status(await requireUser(request));
  });

  for (const action of ["enroll", "disable"] as const) {
    app.post(`/api/auth/email-otp/${action}`, async (request, reply) => {
      requireEnabled();
      const userId = await requireUser(request);
      await rateLimiter.consume({
        scope: "auth-email-otp-manage",
        key: userId,
        ...RATE_LIMITS.security,
      });
      const { code } = CodeBodySchema.parse(request.body);
      await auth.emailOtp[action]({
        userId,
        client: { ip: request.ip, userAgent: request.headers["user-agent"] },
        confirmTotp: confirmTotpWith(request, code),
      });
      return reply.send({ status: true });
    });
  }
}
