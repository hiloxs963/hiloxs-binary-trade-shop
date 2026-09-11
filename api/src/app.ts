import { randomUUID } from "node:crypto";
import Fastify, { type FastifyServerOptions } from "fastify";
import { ZodError } from "zod";
import type { AuthService } from "./auth/auth.js";
import { registerAuthRoutes } from "./auth/fastify.js";
import { PostgresRateLimiter } from "./commerce/rate-limit.js";
import type { AuthRuntimeConfig, MpesaRuntimeConfig } from "./config/env.js";
import type { DatabaseClient } from "./db/client.js";
import {
  NotFoundError,
  PayloadTooLargeError,
  serializeError,
  ValidationError,
} from "./lib/errors.js";
import { safeErrorForLog } from "./lib/redact.js";
import { requestContextPlugin } from "./plugins/request-context.js";
import { securityPlugin } from "./plugins/security.js";
import type { MpesaProvider } from "./payments/provider.js";
import { registerSellerMediaRoutes } from "./media/seller-routes.js";
import { registerStaffMediaRoutes } from "./media/staff-routes.js";
import type { MediaStorage } from "./media/storage.js";
import { registerMpesaRoutes } from "./payments/routes.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerCurrentUserRoute } from "./routes/current-user.js";
import { registerReadyRoute } from "./routes/ready.js";
import { registerEmailVerificationRoute } from "./routes/verify-email.js";
import { registerCheckoutRoute } from "./routes/checkout.js";
import { registerOrderRoutes } from "./routes/orders.js";
import { registerProductRoutes } from "./routes/products.js";
import { registerSellerRoutes } from "./sellers/routes.js";
import { registerSellerProductRoutes } from "./seller-products/routes.js";
import { registerStaffRoutes } from "./staff/routes.js";
import { registerSellerInventoryRoutes } from "./orders/seller-inventory-routes.js";
import { registerSellerOrderRoutes } from "./orders/seller-order-routes.js";
import { registerStaffCommerceRoutes } from "./orders/staff-commerce-routes.js";
import { registerOrderSupportRoutes } from "./orders/support-routes.js";

export type BuildAppOptions = {
  database?: DatabaseClient;
  auth?: AuthService;
  authRuntime?: AuthRuntimeConfig;
  allowedOrigins?: readonly string[];
  logger?: FastifyServerOptions["logger"];
  mpesa?: { provider: MpesaProvider; config: MpesaRuntimeConfig };
  staffReviewEnabled?: boolean;
  sellerCommerceEnabled?: boolean;
  sellerOrderActionsEnabled?: boolean;
  media?: {
    storage?: MediaStorage;
    uploadEnabled: boolean;
    catalogActivationEnabled: boolean;
  };
  rateLimitHmacKey?: string;
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

  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.some((method) => ["POST", "PUT", "PATCH", "DELETE"].includes(method))) return;
    route.bodyLimit = route.url.startsWith("/api/auth/") ? 16 * 1024 : 64 * 1024;
  });

  app.setNotFoundHandler((request, reply) => {
    const serialized = serializeError(new NotFoundError(), request.id);
    return reply.status(serialized.statusCode).send(serialized.body);
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = isPayloadTooLarge(error)
      ? new PayloadTooLargeError(error)
      : isValidationFailure(error) || isInvalidJsonBody(error) || error instanceof ZodError
        ? new ValidationError("The request is invalid", error)
        : error;
    const serialized = serializeError(normalized, request.id);
    const log =
      serialized.statusCode >= 500
        ? request.log.error.bind(request.log)
        : request.log.warn.bind(request.log);
    log({ error: safeErrorForLog(normalized), requestId: request.id }, "Request failed");
    return reply.status(serialized.statusCode).send(serialized.body);
  });

  requestContextPlugin(app);
  app.addHook("onResponse", (request, reply, done) => {
    const route = request.routeOptions.url ?? "unmatched";
    const event = operationalFailureEvent(route, request.method, reply.statusCode);
    if (event) {
      request.log.warn(
        {
          event,
          method: request.method,
          route,
          statusCode: reply.statusCode,
          responseTimeMs: Math.round(reply.elapsedTime),
        },
        "Operational request signal",
      );
    }
    done();
  });
  await securityPlugin(app, options.allowedOrigins ?? ["http://localhost:8080"]);
  registerHealthRoute(app);
  registerReadyRoute(app, options.database);

  const rateLimiter = options.database
    ? new PostgresRateLimiter(
        options.database,
        options.rateLimitHmacKey ?? "development-only-rate-limit-hmac-key-change-me",
      )
    : undefined;

  if (options.auth && options.authRuntime && options.database) {
    if (!rateLimiter) throw new Error("Rate limiter was not initialized");
    registerAuthRoutes(app, {
      auth: options.auth,
      baseURL: options.authRuntime.baseURL,
      frontendURL: options.authRuntime.frontendURL,
      trustedOrigins: options.authRuntime.trustedOrigins,
      rateLimiter,
    });
    registerEmailVerificationRoute(app, { auth: options.auth, rateLimiter });
    registerCurrentUserRoute(app, { auth: options.auth, database: options.database });
    registerCheckoutRoute(app, {
      auth: options.auth,
      database: options.database,
      sellerCommerceEnabled: options.sellerCommerceEnabled ?? false,
      rateLimiter,
    });
    registerOrderRoutes(app, {
      auth: options.auth,
      database: options.database,
      sellerCommerceEnabled: options.sellerCommerceEnabled ?? false,
      rateLimiter,
    });
    registerSellerRoutes(app, { auth: options.auth, database: options.database, rateLimiter });
    registerSellerProductRoutes(app, {
      auth: options.auth,
      database: options.database,
      rateLimiter,
    });
    registerSellerInventoryRoutes(app, {
      auth: options.auth,
      database: options.database,
      sellerCommerceEnabled: options.sellerCommerceEnabled ?? false,
      rateLimiter,
    });
    registerSellerOrderRoutes(app, {
      auth: options.auth,
      database: options.database,
      sellerOrderActionsEnabled: options.sellerOrderActionsEnabled ?? false,
      rateLimiter,
    });
    registerSellerMediaRoutes(app, {
      auth: options.auth,
      database: options.database,
      ...(options.media?.storage ? { storage: options.media.storage } : {}),
      uploadEnabled: options.media?.uploadEnabled ?? false,
      rateLimiter,
    });
    registerStaffRoutes(app, {
      auth: options.auth,
      database: options.database,
      reviewEnabled: options.staffReviewEnabled ?? false,
      catalogActivationEnabled: options.media?.catalogActivationEnabled ?? false,
      rateLimiter,
    });
    registerStaffMediaRoutes(app, {
      auth: options.auth,
      database: options.database,
      ...(options.media?.storage ? { storage: options.media.storage } : {}),
      staffReviewEnabled: options.staffReviewEnabled ?? false,
      catalogActivationEnabled: options.media?.catalogActivationEnabled ?? false,
      rateLimiter,
    });
    registerStaffCommerceRoutes(app, {
      auth: options.auth,
      database: options.database,
      sellerCommerceEnabled: options.sellerCommerceEnabled ?? false,
      rateLimiter,
    });
    registerOrderSupportRoutes(app, { auth: options.auth, database: options.database });
    if (options.mpesa) {
      registerMpesaRoutes(app, {
        auth: options.auth,
        database: options.database,
        provider: options.mpesa.provider,
        config: options.mpesa.config,
        rateLimiter,
      });
    }
  }

  if (options.database) {
    registerProductRoutes(
      app,
      options.database,
      options.media?.storage,
      options.sellerCommerceEnabled ?? false,
    );
    app.addHook("onClose", async () => {
      await options.database?.close();
    });
  }

  return app;
}

function isPayloadTooLarge(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
  );
}

function isInvalidJsonBody(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FST_ERR_CTP_INVALID_JSON_BODY"
  );
}

function isValidationFailure(error: unknown): error is { validation: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "validation" in error &&
    Boolean(error.validation)
  );
}

function operationalFailureEvent(route: string, method: string, statusCode: number) {
  if (statusCode >= 500) return "api-server-error";
  if (statusCode < 400) return undefined;
  if (route.includes("/api/auth/sign-in")) return "auth-sign-in-failure";
  if (route === "/api/v1/checkout/quote") return "checkout-failure";
  if (route === "/api/v1/orders" && method === "POST") return "order-create-failure";
  if (route.includes("/payments/mpesa")) return "payment-operation-failure";
  return undefined;
}
