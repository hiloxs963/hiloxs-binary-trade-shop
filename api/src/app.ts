import { randomUUID } from "node:crypto";
import Fastify, { type FastifyServerOptions } from "fastify";
import type { DatabaseClient } from "./db/client.js";
import { NotFoundError, serializeError, ValidationError } from "./lib/errors.js";
import { safeErrorForLog } from "./lib/redact.js";
import { requestContextPlugin } from "./plugins/request-context.js";
import { securityPlugin } from "./plugins/security.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerReadyRoute } from "./routes/ready.js";

export type BuildAppOptions = {
  database?: DatabaseClient;
  logger?: FastifyServerOptions["logger"];
};

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID(),
    bodyLimit: 1_048_576,
    requestTimeout: 15_000,
    connectionTimeout: 10_000,
    keepAliveTimeout: 5_000,
  });

  requestContextPlugin(app);
  await securityPlugin(app);
  registerHealthRoute(app);
  registerReadyRoute(app, options.database);

  if (options.database) {
    app.addHook("onClose", async () => {
      await options.database?.close();
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const serialized = serializeError(new NotFoundError(), request.id);
    return reply.status(serialized.statusCode).send(serialized.body);
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = isValidationFailure(error)
      ? new ValidationError("The request is invalid", error)
      : error;
    const serialized = serializeError(normalized, request.id);
    request.log.error(
      { error: safeErrorForLog(normalized), requestId: request.id },
      "Request failed",
    );
    return reply.status(serialized.statusCode).send(serialized.body);
  });

  return app;
}

function isValidationFailure(error: unknown): error is { validation: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "validation" in error &&
    Boolean(error.validation)
  );
}
