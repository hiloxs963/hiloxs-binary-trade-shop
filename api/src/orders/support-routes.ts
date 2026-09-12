import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import type { DatabaseClient } from "../db/client.js";
import { orderItems, orders, sellerOrderFulfillments } from "../db/schema/commerce.js";
import { NotFoundError } from "../lib/errors.js";
import { requireStaffPermission } from "../staff/authorization.js";
import { OrderIdSchema } from "../commerce/validation.js";
import { SupportListQuerySchema } from "./validation.js";

export function registerOrderSupportRoutes(
  app: FastifyInstance,
  options: { auth: AuthService; database: DatabaseClient },
): void {
  app.get("/api/v1/staff/order-support", async (request) => {
    await requireStaffPermission(options.auth, options.database, request.headers, "ORDER_SUPPORT");
    const query = SupportListQuerySchema.parse(request.query);
    const rows = await options.database.db
      .select({
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        orderStatus: orders.status,
        fulfillmentId: sellerOrderFulfillments.id,
        fulfillmentStatus: sellerOrderFulfillments.status,
        issueReason: sellerOrderFulfillments.issueReason,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .leftJoin(sellerOrderFulfillments, eq(sellerOrderFulfillments.orderId, orders.id))
      .where(
        query.type === "PAYMENT_REVIEW_REQUIRED"
          ? eq(orders.status, "PAYMENT_REVIEW_REQUIRED")
          : eq(sellerOrderFulfillments.status, "FULFILLMENT_ISSUE"),
      )
      .orderBy(desc(orders.updatedAt), desc(orders.id))
      .limit(query.limit);
    return {
      items: rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    };
  });

  app.get("/api/v1/staff/order-support/:orderId", async (request) => {
    await requireStaffPermission(options.auth, options.database, request.headers, "ORDER_SUPPORT");
    const orderId = OrderIdSchema.parse((request.params as { orderId?: unknown }).orderId);
    const [order] = await options.database.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order || !["PAYMENT_REVIEW_REQUIRED"].includes(order.status)) {
      const [issue] = await options.database.db
        .select({ id: sellerOrderFulfillments.id })
        .from(sellerOrderFulfillments)
        .where(
          and(
            eq(sellerOrderFulfillments.orderId, orderId),
            eq(sellerOrderFulfillments.status, "FULFILLMENT_ISSUE"),
          ),
        )
        .limit(1);
      if (!order || !issue) throw new NotFoundError();
    }
    const [items, fulfillments] = await Promise.all([
      options.database.db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
      options.database.db
        .select()
        .from(sellerOrderFulfillments)
        .where(eq(sellerOrderFulfillments.orderId, orderId)),
    ]);
    return {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        currency: order.currency,
        totalMinor: order.totalMinor.toString(),
        items: items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          lineTotalMinor: item.lineTotalMinor.toString(),
        })),
        fulfillments: fulfillments.map((fulfillment) => ({
          id: fulfillment.id,
          status: fulfillment.status,
          issueReason: fulfillment.issueReason,
          issueMessage: fulfillment.issueMessage,
          updatedAt: fulfillment.updatedAt.toISOString(),
        })),
      },
    };
  });
}
