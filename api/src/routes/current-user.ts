import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import { requireActiveUser } from "../auth/active-user.js";
import type { DatabaseClient } from "../db/client.js";

type CurrentUserRouteOptions = {
  auth: AuthService;
  database: DatabaseClient;
};

export function registerCurrentUserRoute(
  app: FastifyInstance,
  { auth, database }: CurrentUserRouteOptions,
): void {
  app.get("/api/v1/users/me", async (request) => {
    return { user: await requireActiveUser(auth, database, request.headers) };
  });
}
