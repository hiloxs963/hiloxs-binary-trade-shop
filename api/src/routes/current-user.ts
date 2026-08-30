import { and, eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import type { DatabaseClient } from "../db/client.js";
import { session, user } from "../db/schema/auth.js";
import { UnauthenticatedError } from "../lib/errors.js";

type CurrentUserRouteOptions = {
  auth: AuthService;
  database: DatabaseClient;
};

export function registerCurrentUserRoute(
  app: FastifyInstance,
  { auth, database }: CurrentUserRouteOptions,
): void {
  app.get("/api/v1/users/me", async (request) => {
    const authSession = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!authSession) throw new UnauthenticatedError();

    const [profile] = await database.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        phone: user.phone,
        status: user.status,
      })
      .from(user)
      .where(and(eq(user.id, authSession.user.id), eq(user.status, "ACTIVE")))
      .limit(1);

    if (!profile) {
      await database.db.delete(session).where(eq(session.userId, authSession.user.id));
      throw new UnauthenticatedError();
    }

    return { user: profile };
  });
}
