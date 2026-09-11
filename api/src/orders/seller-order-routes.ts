import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import { RATE_LIMITS, type RateLimiter } from "../commerce/rate-limit.js";
import type { DatabaseClient } from "../db/client.js";
import { SellerOrderActionsDisabledError } from "../lib/errors.js";
import { requireApprovedSeller } from "../seller-products/authorization.js";
import {
  getSellerFulfillment,
  listSellerFulfillments,
  transitionSellerFulfillment,
} from "./fulfillment-service.js";
import {
  DispatchInputSchema,
  FulfillmentIdSchema,
  FulfillmentIssueInputSchema,
  SellerOrderListQuerySchema,
} from "./validation.js";
import { EmptyBodySchema } from "../commerce/validation.js";

export function registerSellerOrderRoutes(
  app: FastifyInstance,
  options: {
    auth: AuthService;
    database: DatabaseClient;
    sellerOrderActionsEnabled: boolean;
    rateLimiter: RateLimiter;
  },
): void {
  app.get("/api/v1/seller/orders", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const query = SellerOrderListQuerySchema.parse(request.query);
    return listSellerFulfillments(options.database, seller.sellerApplicationId, query);
  });

  app.get("/api/v1/seller/orders/:fulfillmentId", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    return {
      fulfillment: await getSellerFulfillment(
        options.database,
        seller.sellerApplicationId,
        fulfillmentIdFrom(request.params),
      ),
    };
  });

  for (const action of ["accept", "prepare"] as const) {
    app.post(`/api/v1/seller/orders/:fulfillmentId/${action}`, async (request) => {
      const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
      await options.rateLimiter.consume({
        scope: `seller-fulfillment-${action}`,
        key: seller.userId,
        ...RATE_LIMITS.sellerMutation,
      });
      EmptyBodySchema.parse(request.body ?? {});
      requireActionsEnabled(options.sellerOrderActionsEnabled);
      return {
        fulfillment: await transitionSellerFulfillment(options.database, {
          sellerApplicationId: seller.sellerApplicationId,
          sellerUserId: seller.userId,
          fulfillmentId: fulfillmentIdFrom(request.params),
          action,
          requestId: request.id,
        }),
      };
    });
  }

  app.post("/api/v1/seller/orders/:fulfillmentId/dispatch", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    await options.rateLimiter.consume({
      scope: "seller-fulfillment-dispatch",
      key: seller.userId,
      ...RATE_LIMITS.sellerMutation,
    });
    const input = DispatchInputSchema.parse(request.body);
    requireActionsEnabled(options.sellerOrderActionsEnabled);
    return {
      fulfillment: await transitionSellerFulfillment(options.database, {
        sellerApplicationId: seller.sellerApplicationId,
        sellerUserId: seller.userId,
        fulfillmentId: fulfillmentIdFrom(request.params),
        action: "dispatch",
        requestId: request.id,
        carrier: input.carrier,
        ...(input.trackingReference ? { trackingReference: input.trackingReference } : {}),
      }),
    };
  });

  app.post("/api/v1/seller/orders/:fulfillmentId/issue", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    await options.rateLimiter.consume({
      scope: "seller-fulfillment-issue",
      key: seller.userId,
      ...RATE_LIMITS.sellerMutation,
    });
    const input = FulfillmentIssueInputSchema.parse(request.body);
    requireActionsEnabled(options.sellerOrderActionsEnabled);
    const fulfillment = await transitionSellerFulfillment(options.database, {
      sellerApplicationId: seller.sellerApplicationId,
      sellerUserId: seller.userId,
      fulfillmentId: fulfillmentIdFrom(request.params),
      action: "issue",
      requestId: request.id,
      issueReason: input.reason,
      ...(input.message ? { issueMessage: input.message } : {}),
    });
    request.log.warn(
      { event: "fulfillment-issue-reported", issueReason: input.reason },
      "Seller reported a fulfillment issue",
    );
    return { fulfillment };
  });
}

function requireActionsEnabled(enabled: boolean): void {
  if (!enabled) throw new SellerOrderActionsDisabledError();
}

function fulfillmentIdFrom(params: unknown): string {
  return FulfillmentIdSchema.parse((params as { fulfillmentId?: unknown }).fulfillmentId);
}
