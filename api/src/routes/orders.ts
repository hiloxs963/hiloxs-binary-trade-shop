import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireActiveUser } from "../auth/active-user.js";
import type { AuthService } from "../auth/auth.js";
import { fingerprintCart } from "../commerce/idempotency.js";
import { priceCart } from "../commerce/pricing.js";
import { FixedWindowRateLimiter } from "../commerce/rate-limit.js";
import {
  CartSchema,
  EmptyBodySchema,
  IdempotencyKeySchema,
  OrderIdSchema,
} from "../commerce/validation.js";
import type { Database, DatabaseClient } from "../db/client.js";
import { orderItems, orders } from "../db/schema/commerce.js";
import { ConflictError, IdempotencyKeyReusedError, NotFoundError } from "../lib/errors.js";

type SelectExecutor = Pick<Database, "select">;
type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;

export function registerOrderRoutes(
  app: FastifyInstance,
  options: { auth: AuthService; database: DatabaseClient },
): void {
  const limiter = new FixedWindowRateLimiter();

  app.post("/api/v1/orders", async (request, reply) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    limiter.consume(`create:${owner.id}`, 10, 60_000);
    const input = CartSchema.parse(request.body);
    const idempotencyKey = IdempotencyKeySchema.parse(request.headers["idempotency-key"]);
    const requestFingerprint = fingerprintCart(input);

    const result = await options.database.db.transaction(async (transaction) => {
      const existing = await findOrder(transaction, owner.id, idempotencyKey);
      if (existing) {
        assertMatchingFingerprint(existing, requestFingerprint);
        return { order: await loadOrder(transaction, existing), created: false };
      }

      const priced = await priceCart(transaction, input);
      const orderId = randomUUID();
      const [created] = await transaction
        .insert(orders)
        .values({
          id: orderId,
          orderNumber: orderNumber(orderId),
          userId: owner.id,
          status: "PENDING_PAYMENT",
          currency: priced.currency,
          subtotalMinor: priced.subtotalMinor,
          totalMinor: priced.totalMinor,
          idempotencyKey,
          requestFingerprint,
        })
        .onConflictDoNothing({ target: [orders.userId, orders.idempotencyKey] })
        .returning();

      if (!created) {
        const concurrent = await findOrder(transaction, owner.id, idempotencyKey);
        if (!concurrent) throw new ConflictError("The order could not be created safely");
        assertMatchingFingerprint(concurrent, requestFingerprint);
        return { order: await loadOrder(transaction, concurrent), created: false };
      }

      await transaction.insert(orderItems).values(
        priced.items.map((item) => ({
          orderId: created.id,
          productId: item.productDatabaseId,
          productName: item.name,
          productSlug: item.slug,
          unitPriceMinor: item.unitPriceMinor,
          quantity: item.quantity,
          lineTotalMinor: item.lineTotalMinor,
        })),
      );

      const itemRows: OrderItemRow[] = priced.items.map((item) => ({
        id: randomUUID(),
        orderId: created.id,
        productId: item.productDatabaseId,
        productName: item.name,
        productSlug: item.slug,
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        lineTotalMinor: item.lineTotalMinor,
        createdAt: created.createdAt,
      }));
      return { order: serializeOrder(created, itemRows), created: true };
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
    if (rows.length === 0) return { orders: [] };

    const items = await options.database.db
      .select()
      .from(orderItems)
      .where(
        inArray(
          orderItems.orderId,
          rows.map((order) => order.id),
        ),
      );
    const byOrder = groupItems(items);
    return { orders: rows.map((order) => serializeOrder(order, byOrder.get(order.id) ?? [])) };
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
    limiter.consume(`cancel:${owner.id}`, 20, 60_000);
    const orderId = OrderIdSchema.parse((request.params as { orderId?: unknown }).orderId);
    EmptyBodySchema.parse(request.body ?? {});

    const order = await options.database.db.transaction(async (transaction) => {
      const [cancelled] = await transaction
        .update(orders)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.userId, owner.id),
            eq(orders.status, "PENDING_PAYMENT"),
          ),
        )
        .returning();
      if (cancelled) return loadOrder(transaction, cancelled);

      const [existing] = await transaction
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.userId, owner.id)))
        .limit(1);
      if (!existing) throw new NotFoundError();
      if (existing.status !== "CANCELLED") {
        throw new ConflictError("Only pending-payment orders can be cancelled");
      }
      return loadOrder(transaction, existing);
    });

    return { order };
  });
}

function assertMatchingFingerprint(order: OrderRow, requestFingerprint: string): void {
  if (order.requestFingerprint !== requestFingerprint) {
    throw new IdempotencyKeyReusedError();
  }
}

async function findOrder(
  executor: SelectExecutor,
  userId: string,
  idempotencyKey: string,
): Promise<OrderRow | undefined> {
  const [order] = await executor
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, idempotencyKey)))
    .limit(1);
  return order;
}

async function loadOrder(executor: SelectExecutor, order: OrderRow) {
  const items = await executor.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  return serializeOrder(order, items);
}

function serializeOrder(order: OrderRow, items: OrderItemRow[]) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor.toString(),
    totalMinor: order.totalMinor.toString(),
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      productSlug: item.productSlug,
      unitPriceMinor: item.unitPriceMinor.toString(),
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor.toString(),
    })),
  };
}

function groupItems(items: OrderItemRow[]): Map<string, OrderItemRow[]> {
  const grouped = new Map<string, OrderItemRow[]>();
  for (const item of items) {
    const group = grouped.get(item.orderId) ?? [];
    group.push(item);
    grouped.set(item.orderId, group);
  }
  return grouped;
}

function orderNumber(id: string): string {
  return `HX-${id.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}
