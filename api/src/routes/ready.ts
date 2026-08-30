import type { FastifyInstance } from "fastify";
import type { DatabaseClient } from "../db/client.js";
import { safeErrorForLog } from "../lib/redact.js";

type ReadinessDatabase = Pick<DatabaseClient, "checkConnection">;

export function registerReadyRoute(app: FastifyInstance, database?: ReadinessDatabase): void {
  app.get("/ready", async (request, reply) => {
    try {
      if (!database) throw new Error("Database client is not configured");
      await database.checkConnection();
      return { status: "ready" as const, database: "up" as const };
    } catch (error) {
      request.log.warn({ error: safeErrorForLog(error) }, "Readiness database check failed");
      return reply.status(503).send({ status: "not_ready" as const, database: "down" as const });
    }
  });
}
