import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";
import { OriginNotAllowedError } from "../lib/errors.js";

export async function securityPlugin(
  app: FastifyInstance,
  allowedOrigins: readonly string[],
): Promise<void> {
  const allowed = new Set(allowedOrigins);

  app.addHook("onRequest", (request, _reply, done) => {
    const origin = request.headers.origin;
    const authMutation =
      request.method === "POST" &&
      (request.url.startsWith("/api/auth/") || request.url.startsWith("/api/v1/auth/"));
    if ((authMutation && !origin) || (origin && !allowed.has(origin))) {
      done(new OriginNotAllowedError());
      return;
    }
    done();
  });

  await app.register(cors, {
    origin: [...allowed],
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Requested-With"],
    maxAge: 86_400,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
}
