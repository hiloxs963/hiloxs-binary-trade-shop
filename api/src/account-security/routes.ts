import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireActiveUser } from "../auth/active-user.js";
import type { AuthService } from "../auth/auth.js";
import type { DatabaseClient } from "../db/client.js";
import { UnauthenticatedError } from "../lib/errors.js";
import type { AccountSecurityService } from "./service.js";

const ReauthBodySchema = z
  .object({ password: z.string().min(1).max(128), code: z.string().min(1).max(128) })
  .strict();
const ConfirmBodySchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

type Options = {
  auth: AuthService;
  database: DatabaseClient;
  service: AccountSecurityService;
};

/**
 * Account-security management for signed-in users with two-factor authentication. These live under
 * /api/v1/account/security so an API that predates them answers 404 and the frontend can hide the
 * controls.
 */
export function registerAccountSecurityRoutes(
  app: FastifyInstance,
  { auth, database, service }: Options,
): void {
  const identify = async (request: FastifyRequest) => {
    const profile = await requireActiveUser(auth, database, request.headers);
    const current = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!current) throw new UnauthenticatedError();
    return {
      userId: profile.id,
      sessionId: current.session.id,
      client: { ip: request.ip, userAgent: request.headers["user-agent"] },
    };
  };

  app.get("/api/v1/account/security", async (request, reply) => {
    const { userId } = await identify(request);
    void reply.header("cache-control", "no-store");
    return service.status(userId);
  });

  app.post("/api/v1/account/security/authenticator/start", async (request, reply) => {
    const { userId, sessionId, client } = await identify(request);
    const body = ReauthBodySchema.parse(request.body);
    const started = await service.startReplacement({ userId, sessionId, client, ...body });
    void reply.header("cache-control", "no-store");
    return { totpURI: started.totpURI, expiresAt: started.expiresAt.toISOString() };
  });

  app.post("/api/v1/account/security/authenticator/confirm", async (request, reply) => {
    const { userId, sessionId, client } = await identify(request);
    const body = ConfirmBodySchema.parse(request.body);
    const confirmed = await service.confirmReplacement({ userId, sessionId, client, ...body });
    void reply.header("cache-control", "no-store");
    return { backupCodes: confirmed.backupCodes };
  });

  app.post("/api/v1/account/security/backup-codes/regenerate", async (request, reply) => {
    const { userId, client } = await identify(request);
    const body = ReauthBodySchema.parse(request.body);
    const regenerated = await service.regenerateBackupCodes({ userId, client, ...body });
    void reply.header("cache-control", "no-store");
    return { backupCodes: regenerated.backupCodes };
  });
}
