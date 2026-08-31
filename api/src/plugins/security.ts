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
    const providerCallback =
      request.method === "POST" &&
      /^\/api\/v1\/payments\/mpesa\/callback\/[^/?]+(?:\?.*)?$/.test(request.url);
    const protectedMutation =
      request.method === "POST" &&
      !providerCallback &&
      (request.url.startsWith("/api/auth/") || request.url.startsWith("/api/v1/"));
    if ((protectedMutation && !origin) || (origin && !allowed.has(origin))) {
      done(new OriginNotAllowedError());
      return;
    }
    done();
  });

  await app.register(cors, {
    origin: [...allowed],
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Requested-With", "Idempotency-Key"],
    maxAge: 86_400,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
}
