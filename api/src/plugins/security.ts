import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";

export async function securityPlugin(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
}
