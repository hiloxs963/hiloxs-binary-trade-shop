import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireActiveUser } from "../auth/active-user.js";
import type { AuthService } from "../auth/auth.js";
import { RATE_LIMITS, type RateLimiter } from "../commerce/rate-limit.js";
import { EmptyBodySchema, IdempotencyKeySchema, OrderIdSchema } from "../commerce/validation.js";
import type { DatabaseClient } from "../db/client.js";
import { orders } from "../db/schema/commerce.js";
import { NotFoundError } from "../lib/errors.js";
import { confirmDelivery } from "../orders/fulfillment-service.js";
import {
  cancelPendingOrder,
  createPendingOrder,
  loadOrder,
  loadOrders,
} from "../orders/service.js";
import { FulfillmentIdSchema, OrderCreateSchema } from "../orders/validation.js";

export function registerOrderRoutes(
  app: FastifyInstance,
  options: {
    auth: AuthService;
    database: DatabaseClient;
    sellerCommerceEnabled: boolean;
    rateLimiter: RateLimiter;
  },
): void {
  app.post("/api/v1/orders", async (request, reply) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    await options.rateLimiter.consume({
      scope: "order-create",
      key: owner.id,
      ...RATE_LIMITS.orderCreate,
    });
    const input = OrderCreateSchema.parse(request.body);
    const idempotencyKey = IdempotencyKeySchema.parse(request.headers["idempotency-key"]);
    const result = await createPendingOrder(options.database, {
      userId: owner.id,
      request: input,
      idempotencyKey,
      sellerCommerceEnabled: options.sellerCommerceEnabled,
      requestId: request.id,
    });
    return reply.status(result.created ? 201 : 200).send({ order: result.order });
  });

  app.get("/api/v1/orders", async (request) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    const rows = await options.database.db
      .select()
      .from(orders)
      .where(eq(orders.userId, owner.id))
      .orderBy(desc(orders.createdAt))
      .limit(50);
    return {
      orders: await loadOrders(options.database.db, rows),
    };
  });

  app.get("/api/v1/orders/:orderId", async (request) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    const orderId = OrderIdSchema.parse((request.params as { orderId?: unknown }).orderId);
    const [order] = await options.database.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, owner.id)))
      .limit(1);
    if (!order) throw new NotFoundError();
    return { order: await loadOrder(options.database.db, order) };
  });

  app.post("/api/v1/orders/:orderId/cancel", async (request) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    await options.rateLimiter.consume({
      scope: "order-cancel",
      key: owner.id,
      ...RATE_LIMITS.orderCancel,
    });
    const orderId = OrderIdSchema.parse((request.params as { orderId?: unknown }).orderId);
    EmptyBodySchema.parse(request.body ?? {});
    const order = await cancelPendingOrder(options.database, owner.id, orderId, request.id);
    if (!order) throw new NotFoundError();
    return { order };
  });

  app.post(
    "/api/v1/orders/:orderId/fulfillments/:fulfillmentId/confirm-delivery",
    async (request) => {
      const owner = await requireActiveUser(options.auth, options.database, request.headers);
      await options.rateLimiter.consume({
        scope: "order-confirm-delivery",
        key: owner.id,
        ...RATE_LIMITS.sellerMutation,
      });
      EmptyBodySchema.parse(request.body ?? {});
      const params = request.params as { orderId?: unknown; fulfillmentId?: unknown };
      const fulfillment = await confirmDelivery(
        options.database,
        owner.id,
        OrderIdSchema.parse(params.orderId),
        FulfillmentIdSchema.parse(params.fulfillmentId),
        request.id,
      );
      return { fulfillment };
    },
  );
}
