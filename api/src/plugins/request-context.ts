import type { FastifyInstance } from "fastify";

export function requestContextPlugin(app: FastifyInstance): void {
  app.addHook("onRequest", (request, reply, done) => {
    reply.header("x-request-id", request.id);
    done();
  });
}
