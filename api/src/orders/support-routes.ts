import { and, desc, eq, lt, or } from "drizzle-orm";
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
    const rows =
      query.type === "PAYMENT_REVIEW_REQUIRED"
        ? await paymentReviewRows(options.database, query.cursor, query.limit + 1)
        : await fulfillmentIssueRows(options.database, query.cursor, query.limit + 1);
    const visible = rows.slice(0, query.limit);
    return {
      items: visible.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
      nextCursor:
        rows.length > query.limit
          ? (visible.at(-1)?.fulfillmentId ?? visible.at(-1)?.orderId ?? null)
          : null,
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

async function paymentReviewRows(
  database: DatabaseClient,
  cursor: string | undefined,
  limit: number,
) {
  let cursorCondition;
  if (cursor) {
    const [row] = await database.db
      .select({ id: orders.id, updatedAt: orders.updatedAt })
      .from(orders)
      .where(and(eq(orders.id, cursor), eq(orders.status, "PAYMENT_REVIEW_REQUIRED")))
      .limit(1);
    if (!row) throw new NotFoundError();
    cursorCondition = or(
      lt(orders.updatedAt, row.updatedAt),
      and(eq(orders.updatedAt, row.updatedAt), lt(orders.id, row.id)),
    );
  }
  const conditions = [eq(orders.status, "PAYMENT_REVIEW_REQUIRED")];
  if (cursorCondition) conditions.push(cursorCondition);
  const rows = await database.db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.updatedAt), desc(orders.id))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    fulfillmentId: null,
    fulfillmentStatus: null,
    issueReason: null,
  }));
}

async function fulfillmentIssueRows(
  database: DatabaseClient,
  cursor: string | undefined,
  limit: number,
) {
  let cursorCondition;
  if (cursor) {
    const [row] = await database.db
      .select({ id: sellerOrderFulfillments.id, updatedAt: sellerOrderFulfillments.updatedAt })
      .from(sellerOrderFulfillments)
      .where(
        and(
          eq(sellerOrderFulfillments.id, cursor),
          eq(sellerOrderFulfillments.status, "FULFILLMENT_ISSUE"),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError();
    cursorCondition = or(
      lt(sellerOrderFulfillments.updatedAt, row.updatedAt),
      and(
        eq(sellerOrderFulfillments.updatedAt, row.updatedAt),
        lt(sellerOrderFulfillments.id, row.id),
      ),
    );
  }
  const conditions = [eq(sellerOrderFulfillments.status, "FULFILLMENT_ISSUE")];
  if (cursorCondition) conditions.push(cursorCondition);
  return database.db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      fulfillmentId: sellerOrderFulfillments.id,
      fulfillmentStatus: sellerOrderFulfillments.status,
      issueReason: sellerOrderFulfillments.issueReason,
      updatedAt: sellerOrderFulfillments.updatedAt,
    })
    .from(sellerOrderFulfillments)
    .innerJoin(orders, eq(orders.id, sellerOrderFulfillments.orderId))
    .where(and(...conditions))
    .orderBy(desc(sellerOrderFulfillments.updatedAt), desc(sellerOrderFulfillments.id))
    .limit(limit);
}
