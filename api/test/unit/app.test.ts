import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("API application", () => {
  it("constructs without opening a network listener or database connection", async () => {
    app = await buildApp();
    expect(app.server.listening).toBe(false);
  });

  it("serves process liveness without querying PostgreSQL", async () => {
    app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("includes a request ID in safe error responses", async () => {
    app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/missing" });
    const requestId = response.headers["x-request-id"];

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found",
        requestId,
      },
    });
  });

  it("applies security headers and does not enable wildcard CORS", async () => {
    app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
