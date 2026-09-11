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

  it("allows only configured browser origins with credentials", async () => {
    app = await buildApp({ allowedOrigins: ["http://localhost:8080"] });
    const allowed = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "http://localhost:8080",
        "access-control-request-method": "GET",
      },
    });
    const rejected = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://attacker.example" },
    });

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:8080");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(allowed.headers["access-control-allow-methods"]).toBe(
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    expect(rejected.statusCode).toBe(403);
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("protects PUT mutations and returns the safe error contract", async () => {
    app = await buildApp({ allowedOrigins: ["http://localhost:8080"] });
    const trusted = await app.inject({
      method: "PUT",
      url: "/api/v1/seller/fulfillment-config",
      headers: { origin: "http://localhost:8080" },
      payload: {},
    });
    const missing = await app.inject({
      method: "PUT",
      url: "/api/v1/seller/fulfillment-config",
      payload: {},
    });
    const untrusted = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { origin: "https://attacker.example" },
      payload: {},
    });

    expect(trusted.statusCode).toBe(404);
    for (const response of [missing, untrusted]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "The request origin is not allowed",
          requestId: response.headers["x-request-id"],
        },
      });
    }
  });

  it("does not require an Origin for ordinary GET and HEAD requests", async () => {
    app = await buildApp({ allowedOrigins: ["http://localhost:8080"] });
    const get = await app.inject({ method: "GET", url: "/health" });
    const head = await app.inject({ method: "HEAD", url: "/health" });

    expect(get.statusCode).toBe(200);
    expect(head.statusCode).toBe(200);
  });

  it("applies bounded JSON body limits by route class", async () => {
    app = await buildApp({ allowedOrigins: ["http://localhost:8080"] });
    app.post("/api/auth/body-limit-test", (request) => request.body);
    app.post("/api/v1/body-limit-test", (request) => request.body);

    const headers = { origin: "http://localhost:8080", "content-type": "application/json" };
    const auth = await app.inject({
      method: "POST",
      url: "/api/auth/body-limit-test",
      headers,
      payload: JSON.stringify({ value: "x".repeat(17 * 1024) }),
    });
    const api = await app.inject({
      method: "POST",
      url: "/api/v1/body-limit-test",
      headers,
      payload: JSON.stringify({ value: "x".repeat(65 * 1024) }),
    });

    expect(auth.statusCode).toBe(413);
    expect(api.statusCode).toBe(413);
    expect(auth.json<{ error: { requestId: string } }>().error.requestId).toBeTruthy();
    expect(api.json<{ error: { requestId: string } }>().error.requestId).toBeTruthy();
  });

  it("requires a trusted Origin on authentication mutations", async () => {
    app = await buildApp({ allowedOrigins: ["http://localhost:8080"] });
    const missing = await app.inject({ method: "POST", url: "/api/auth/sign-out", payload: {} });
    const trusted = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { origin: "http://localhost:8080" },
      payload: {},
    });

    expect(missing.statusCode).toBe(403);
    expect(trusted.statusCode).toBe(404);
  });

  it("requires a trusted Origin on commerce mutations", async () => {
    app = await buildApp({ allowedOrigins: ["http://localhost:8080"] });
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      payload: { items: [] },
    });
    const trusted = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { origin: "http://localhost:8080" },
      payload: { items: [] },
    });

    expect(missing.statusCode).toBe(403);
    expect(trusted.statusCode).toBe(404);
  });

  it("allows provider callbacks without a browser Origin while protecting other payment posts", async () => {
    app = await buildApp({ allowedOrigins: ["http://localhost:8080"] });
    const callback = await app.inject({
      method: "POST",
      url: `/api/v1/payments/mpesa/callback/${"a".repeat(43)}`,
      payload: {},
    });
    const payment = await app.inject({
      method: "POST",
      url: "/api/v1/orders/00000000-0000-4000-8000-000000000001/payments/mpesa",
      payload: {},
    });

    expect(callback.statusCode).toBe(404);
    expect(payment.statusCode).toBe(403);
  });

  it("enforces the application body limit on provider callback paths", async () => {
    app = await buildApp({ allowedOrigins: ["http://localhost:8080"] });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/payments/mpesa/callback/${"a".repeat(43)}`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify("x".repeat(1_048_576)),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
