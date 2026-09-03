import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Database, DatabaseClient } from "../db/client.js";
import {
  orderDeliveryAddresses,
  orderFulfillmentEvents,
  orderItems,
  orders,
  sellerOrderFulfillments,
} from "../db/schema/commerce.js";
import {
  inventoryEvents,
  inventoryReservations,
  productInventory,
  type InventoryReleaseReason,
} from "../db/schema/media.js";
import { paymentAttempts } from "../db/schema/payments.js";
import {
  ConflictError,
  IdempotencyKeyReusedError,
  PaymentInProgressError,
  ValidationError,
} from "../lib/errors.js";
import { ACTIVE_PAYMENT_STATUSES } from "../payments/state.js";
import { fingerprintOrderRequest } from "../commerce/idempotency.js";
import { priceCart } from "../commerce/pricing.js";
import type { OrderCreateInput } from "./validation.js";
import { RESERVATION_TTL_MS, RESERVATION_WORKER_BATCH_SIZE } from "./model.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;

export async function createPendingOrder(
  database: DatabaseClient,
  input: {
    userId: string;
    request: OrderCreateInput;
    idempotencyKey: string;
    sellerCommerceEnabled: boolean;
    requestId: string;
    now?: Date;
  },
) {
  const requestFingerprint = fingerprintOrderRequest(input.request);
  return database.db.transaction(async (transaction) => {
    const existing = await findOrder(transaction, input.userId, input.idempotencyKey);
    if (existing) return existingOrderResult(transaction, existing, requestFingerprint);

    const priced = await priceCart(transaction, input.request, {
      sellerCommerceEnabled: input.sellerCommerceEnabled,
    });
    if (priced.hasSellerItems && !input.request.deliveryAddress) {
      throw new ValidationError("A delivery address is required for seller products");
    }
    if (!priced.hasSellerItems && input.request.deliveryAddress) {
      throw new ValidationError("A delivery address is not required for this order");
    }

    const sellerItems = priced.items
      .filter((item) => item.productSource === "SELLER")
      .sort((left, right) => left.productDatabaseId.localeCompare(right.productDatabaseId));
    const inventoryRows =
      sellerItems.length === 0
        ? []
        : await transaction
            .select()
            .from(productInventory)
            .where(
              inArray(
                productInventory.productId,
                sellerItems.map((item) => item.productDatabaseId),
              ),
            )
            .orderBy(asc(productInventory.productId))
            .for("update");

    const concurrent = await findOrder(transaction, input.userId, input.idempotencyKey);
    if (concurrent) return existingOrderResult(transaction, concurrent, requestFingerprint);
    assertInventoryAvailable(sellerItems, inventoryRows);

    const now = input.now ?? new Date();
    const orderId = randomUUID();
    const reservationExpiresAt = priced.hasSellerItems
      ? new Date(now.getTime() + RESERVATION_TTL_MS)
      : null;
    const [created] = await transaction
      .insert(orders)
      .values({
        id: orderId,
        orderNumber: orderNumber(orderId),
        userId: input.userId,
        status: "PENDING_PAYMENT",
        currency: priced.currency,
        subtotalMinor: priced.subtotalMinor,
        shippingMinor: 0n,
        totalMinor: priced.totalMinor,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        reservationExpiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [orders.userId, orders.idempotencyKey] })
      .returning();
    if (!created) {
      const raced = await findOrder(transaction, input.userId, input.idempotencyKey);
      if (!raced) throw new ConflictError("The order could not be created safely");
      return existingOrderResult(transaction, raced, requestFingerprint);
    }

    const sellerApplicationIds = [
      ...new Set(sellerItems.map((item) => item.sellerApplicationId).filter(Boolean)),
    ] as string[];
    const fulfillmentIds = new Map(sellerApplicationIds.map((id) => [id, randomUUID()]));
    if (sellerApplicationIds.length > 0) {
      await transaction.insert(sellerOrderFulfillments).values(
        sellerApplicationIds.map((sellerApplicationId) => ({
          id: fulfillmentIds.get(sellerApplicationId) as string,
          orderId,
          sellerApplicationId,
          status: "AWAITING_PAYMENT" as const,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    const itemRows = priced.items.map((item) => ({
      id: randomUUID(),
      orderId,
      productId: item.productDatabaseId,
      productName: item.name,
      productSlug: item.slug,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor,
      productSource: item.productSource,
      sellerApplicationId: item.sellerApplicationId,
      sellerFulfillmentId: item.sellerApplicationId
        ? (fulfillmentIds.get(item.sellerApplicationId) as string)
        : null,
      createdAt: now,
    }));
    await transaction.insert(orderItems).values(itemRows);

    if (input.request.deliveryAddress) {
      await transaction.insert(orderDeliveryAddresses).values({
        orderId,
        ...input.request.deliveryAddress,
        createdAt: now,
      });
    }

    for (const item of itemRows.filter((item) => item.productSource === "SELLER")) {
      const before = inventoryRows.find((row) => row.productId === item.productId);
      if (!before || !reservationExpiresAt)
        throw new ValidationError("Seller stock is unavailable");
      const reservationId = randomUUID();
      const [updated] = await transaction
        .update(productInventory)
        .set({
          quantityReserved: sql`${productInventory.quantityReserved} + ${item.quantity}`,
          version: sql`${productInventory.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(productInventory.productId, item.productId),
            sql`${productInventory.quantityOnHand} - ${productInventory.quantityReserved} >= ${item.quantity}`,
          ),
        )
        .returning();
      if (!updated) throw new ValidationError("Seller stock is unavailable");
      await transaction.insert(inventoryReservations).values({
        id: reservationId,
        productId: item.productId,
        orderId,
        orderItemId: item.id,
        quantity: item.quantity,
        status: "ACTIVE",
        expiresAt: reservationExpiresAt,
        createdAt: now,
      });
      await transaction.insert(inventoryEvents).values({
        productId: item.productId,
        reservationId,
        orderId,
        actorType: "SYSTEM",
        action: "RESERVED",
        quantityDelta: item.quantity,
        previousOnHand: before.quantityOnHand,
        resultingOnHand: updated.quantityOnHand,
        previousReserved: updated.quantityReserved - item.quantity,
        resultingReserved: updated.quantityReserved,
        requestId: input.requestId,
        createdAt: now,
      });
      before.quantityReserved = updated.quantityReserved;
    }
    return { order: await loadOrder(transaction, created), created: true };
  });
}

export async function cancelPendingOrder(
  database: DatabaseClient,
  userId: string,
  orderId: string,
  requestId: string,
) {
  return database.db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
      .for("update")
      .limit(1);
    if (!existing) return undefined;
    if (existing.status === "CANCELLED") return loadOrder(transaction, existing);
    if (existing.status !== "PENDING_PAYMENT") {
      throw new ConflictError("Only pending-payment orders can be cancelled");
    }
    const [activePayment] = await transaction
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.orderId, existing.id),
          inArray(paymentAttempts.status, ACTIVE_PAYMENT_STATUSES),
        ),
      )
      .limit(1);
    if (activePayment) throw new PaymentInProgressError();
    const now = new Date();
    await releaseReservations(
      transaction,
      existing.id,
      "RELEASED",
      "CUSTOMER_CANCELLED",
      requestId,
      now,
    );
    await cancelAwaitingFulfillments(transaction, existing.id, "ORDER_CANCELLED", requestId, now);
    const [cancelled] = await transaction
      .update(orders)
      .set({
        status: "CANCELLED",
        cancelledAt: now,
        cancellationReason: "CUSTOMER_CANCELLED",
        updatedAt: now,
      })
      .where(and(eq(orders.id, existing.id), eq(orders.status, "PENDING_PAYMENT")))
      .returning();
    if (!cancelled) throw new ConflictError("The order could not be cancelled safely");
    return loadOrder(transaction, cancelled);
  });
}

export async function settleOrderAfterConfirmedPayment(
  transaction: Transaction,
  order: OrderRow,
  requestId: string,
  now = new Date(),
): Promise<{ outcome: "PAID" | "REVIEW_REQUIRED"; order: OrderRow }> {
  const sellerItems = await transaction
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, order.id), eq(orderItems.productSource, "SELLER")));
  if (sellerItems.length === 0) {
    if (order.status !== "PENDING_PAYMENT") return markPaymentReview(transaction, order, now);
    const [paid] = await transaction
      .update(orders)
      .set({ status: "PAID", updatedAt: now })
      .where(and(eq(orders.id, order.id), eq(orders.status, "PENDING_PAYMENT")))
      .returning();
    if (!paid) return markPaymentReview(transaction, order, now);
    return { outcome: "PAID", order: paid };
  }

  const reservations = await transaction
    .select()
    .from(inventoryReservations)
    .where(eq(inventoryReservations.orderId, order.id))
    .orderBy(asc(inventoryReservations.productId))
    .for("update");
  const valid =
    order.status === "PENDING_PAYMENT" &&
    reservations.length === sellerItems.length &&
    reservations.every(
      (reservation) => reservation.status === "ACTIVE" && reservation.expiresAt > now,
    );
  if (!valid) {
    await releaseReservations(
      transaction,
      order.id,
      "EXPIRED",
      "RESERVATION_EXPIRED",
      requestId,
      now,
      reservations,
    );
    await cancelAwaitingFulfillments(transaction, order.id, "RESERVATION_EXPIRED", requestId, now);
    return markPaymentReview(transaction, order, now);
  }

  const inventoryRows = await lockInventoryForReservations(transaction, reservations);
  for (const reservation of reservations) {
    const before = inventoryRows.find((row) => row.productId === reservation.productId);
    if (
      !before ||
      before.quantityReserved < reservation.quantity ||
      before.quantityOnHand < reservation.quantity
    ) {
      throw new ConflictError("Reserved inventory could not be committed safely");
    }
    const [updated] = await transaction
      .update(productInventory)
      .set({
        quantityOnHand: sql`${productInventory.quantityOnHand} - ${reservation.quantity}`,
        quantityReserved: sql`${productInventory.quantityReserved} - ${reservation.quantity}`,
        version: sql`${productInventory.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(productInventory.productId, reservation.productId),
          sql`${productInventory.quantityOnHand} >= ${reservation.quantity}`,
          sql`${productInventory.quantityReserved} >= ${reservation.quantity}`,
        ),
      )
      .returning();
    if (!updated) throw new ConflictError("Reserved inventory could not be committed safely");
    await transaction
      .update(inventoryReservations)
      .set({ status: "COMMITTED", committedAt: now })
      .where(
        and(
          eq(inventoryReservations.id, reservation.id),
          eq(inventoryReservations.status, "ACTIVE"),
        ),
      );
    await transaction.insert(inventoryEvents).values({
      productId: reservation.productId,
      reservationId: reservation.id,
      orderId: order.id,
      actorType: "SYSTEM",
      action: "COMMITTED",
      quantityDelta: -reservation.quantity,
      previousOnHand: before.quantityOnHand,
      resultingOnHand: updated.quantityOnHand,
      previousReserved: before.quantityReserved,
      resultingReserved: updated.quantityReserved,
      requestId,
      createdAt: now,
    });
    before.quantityOnHand = updated.quantityOnHand;
    before.quantityReserved = updated.quantityReserved;
  }
  const fulfillments = await transaction
    .select()
    .from(sellerOrderFulfillments)
    .where(eq(sellerOrderFulfillments.orderId, order.id))
    .orderBy(asc(sellerOrderFulfillments.id))
    .for("update");
  if (
    fulfillments.length === 0 ||
    fulfillments.some((item) => item.status !== "AWAITING_PAYMENT")
  ) {
    throw new ConflictError("Seller fulfillment could not be released safely");
  }
  for (const fulfillment of fulfillments) {
    await transaction
      .update(sellerOrderFulfillments)
      .set({ status: "READY_FOR_SELLER", updatedAt: now })
      .where(eq(sellerOrderFulfillments.id, fulfillment.id));
    await transaction.insert(orderFulfillmentEvents).values({
      fulfillmentId: fulfillment.id,
      actorType: "SYSTEM",
      action: "PAYMENT_CONFIRMED",
      previousStatus: "AWAITING_PAYMENT",
      resultingStatus: "READY_FOR_SELLER",
      requestId,
      createdAt: now,
    });
  }
  const [paid] = await transaction
    .update(orders)
    .set({ status: "PAID", updatedAt: now })
    .where(and(eq(orders.id, order.id), eq(orders.status, "PENDING_PAYMENT")))
    .returning();
  if (!paid) throw new ConflictError("The paid order transition failed safely");
  return { outcome: "PAID", order: paid };
}

export async function expirePendingReservations(
  database: DatabaseClient,
  now = new Date(),
  limit = RESERVATION_WORKER_BATCH_SIZE,
): Promise<number> {
  return database.db.transaction(async (transaction) => {
    const expiredOrders = await transaction
      .select()
      .from(orders)
      .where(and(eq(orders.status, "PENDING_PAYMENT"), lte(orders.reservationExpiresAt, now)))
      .orderBy(asc(orders.reservationExpiresAt), asc(orders.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const order of expiredOrders) {
      const requestId = `reservation-expiry:${order.id}:${order.reservationExpiresAt?.getTime() ?? 0}`;
      await releaseReservations(
        transaction,
        order.id,
        "EXPIRED",
        "RESERVATION_EXPIRED",
        requestId,
        now,
      );
      await cancelAwaitingFulfillments(
        transaction,
        order.id,
        "RESERVATION_EXPIRED",
        requestId,
        now,
      );
      await transaction
        .update(orders)
        .set({
          status: "CANCELLED",
          cancelledAt: now,
          cancellationReason: "RESERVATION_EXPIRED",
          updatedAt: now,
        })
        .where(and(eq(orders.id, order.id), eq(orders.status, "PENDING_PAYMENT")));
    }
    return expiredOrders.length;
  });
}

export async function loadOrder(executor: Pick<Database, "select">, order: OrderRow) {
  const items = await executor.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const fulfillments = await executor
    .select()
    .from(sellerOrderFulfillments)
    .where(eq(sellerOrderFulfillments.orderId, order.id))
    .orderBy(asc(sellerOrderFulfillments.createdAt), asc(sellerOrderFulfillments.id));
  const addresses = await executor
    .select()
    .from(orderDeliveryAddresses)
    .where(eq(orderDeliveryAddresses.orderId, order.id));
  return serializeOrder(order, items, fulfillments, addresses[0]);
}

export function serializeOrder(
  order: OrderRow,
  items: OrderItemRow[],
  fulfillments: (typeof sellerOrderFulfillments.$inferSelect)[] = [],
  address?: typeof orderDeliveryAddresses.$inferSelect,
) {
  const result = {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor.toString(),
    totalMinor: order.totalMinor.toString(),
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: items.map(serializeItem),
  };
  if (fulfillments.length === 0) return result;
  return {
    ...result,
    shippingMinor: order.shippingMinor.toString(),
    reservationExpiresAt: order.reservationExpiresAt?.toISOString() ?? null,
    deliveryAddress: address
      ? {
          recipientName: address.recipientName,
          phone: address.phone,
          county: address.county,
          town: address.town,
          addressLine: address.addressLine,
          landmark: address.landmark,
        }
      : null,
    fulfillments: fulfillments.map((fulfillment) => ({
      id: fulfillment.id,
      status: fulfillment.status,
      acceptedAt: fulfillment.acceptedAt?.toISOString() ?? null,
      preparingAt: fulfillment.preparingAt?.toISOString() ?? null,
      dispatchedAt: fulfillment.dispatchedAt?.toISOString() ?? null,
      deliveredAt: fulfillment.deliveredAt?.toISOString() ?? null,
      issueAt: fulfillment.issueAt?.toISOString() ?? null,
      issueReason: fulfillment.issueReason,
      issueMessage: fulfillment.issueMessage,
      carrier: fulfillment.carrier,
      trackingReference: fulfillment.trackingReference,
      items: items.filter((item) => item.sellerFulfillmentId === fulfillment.id).map(serializeItem),
    })),
  };
}

function serializeItem(item: OrderItemRow) {
  return {
    productId: item.productId,
    productName: item.productName,
    productSlug: item.productSlug,
    unitPriceMinor: item.unitPriceMinor.toString(),
    quantity: item.quantity,
    lineTotalMinor: item.lineTotalMinor.toString(),
  };
}

async function existingOrderResult(
  transaction: Transaction,
  order: OrderRow,
  requestFingerprint: string,
) {
  if (order.requestFingerprint !== requestFingerprint) throw new IdempotencyKeyReusedError();
  return { order: await loadOrder(transaction, order), created: false };
}

async function findOrder(
  executor: Pick<Database, "select">,
  userId: string,
  idempotencyKey: string,
) {
  const [order] = await executor
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, idempotencyKey)))
    .limit(1);
  return order;
}

function assertInventoryAvailable(
  items: Array<{ productDatabaseId: string; quantity: number }>,
  inventory: (typeof productInventory.$inferSelect)[],
) {
  if (
    inventory.length !== items.length ||
    items.some((item) => {
      const row = inventory.find((candidate) => candidate.productId === item.productDatabaseId);
      return !row || row.quantityOnHand - row.quantityReserved < item.quantity;
    })
  ) {
    throw new ValidationError("Seller stock is unavailable");
  }
}

async function lockInventoryForReservations(
  transaction: Transaction,
  reservations: (typeof inventoryReservations.$inferSelect)[],
) {
  const productIds = [...new Set(reservations.map((item) => item.productId))];
  if (productIds.length === 0) return [];
  return transaction
    .select()
    .from(productInventory)
    .where(inArray(productInventory.productId, productIds))
    .orderBy(asc(productInventory.productId))
    .for("update");
}

async function releaseReservations(
  transaction: Transaction,
  orderId: string,
  status: "RELEASED" | "EXPIRED",
  reason: InventoryReleaseReason,
  requestId: string,
  now: Date,
  lockedRows?: (typeof inventoryReservations.$inferSelect)[],
) {
  const reservations =
    lockedRows ??
    (await transaction
      .select()
      .from(inventoryReservations)
      .where(eq(inventoryReservations.orderId, orderId))
      .orderBy(asc(inventoryReservations.productId))
      .for("update"));
  const active = reservations.filter((item) => item.status === "ACTIVE");
  const inventoryRows = await lockInventoryForReservations(transaction, active);
  for (const reservation of active) {
    const before = inventoryRows.find((row) => row.productId === reservation.productId);
    if (!before || before.quantityReserved < reservation.quantity) {
      throw new ConflictError("Reserved inventory could not be released safely");
    }
    const [updated] = await transaction
      .update(productInventory)
      .set({
        quantityReserved: sql`${productInventory.quantityReserved} - ${reservation.quantity}`,
        version: sql`${productInventory.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(productInventory.productId, reservation.productId),
          sql`${productInventory.quantityReserved} >= ${reservation.quantity}`,
        ),
      )
      .returning();
    if (!updated) throw new ConflictError("Reserved inventory could not be released safely");
    await transaction
      .update(inventoryReservations)
      .set({ status, releasedAt: now, releaseReason: reason })
      .where(
        and(
          eq(inventoryReservations.id, reservation.id),
          eq(inventoryReservations.status, "ACTIVE"),
        ),
      );
    await transaction.insert(inventoryEvents).values({
      productId: reservation.productId,
      reservationId: reservation.id,
      orderId,
      actorType: "SYSTEM",
      action: status === "EXPIRED" ? "EXPIRED" : "RELEASED",
      quantityDelta: -reservation.quantity,
      previousOnHand: before.quantityOnHand,
      resultingOnHand: updated.quantityOnHand,
      previousReserved: before.quantityReserved,
      resultingReserved: updated.quantityReserved,
      requestId,
      createdAt: now,
    });
    before.quantityReserved = updated.quantityReserved;
  }
}

async function cancelAwaitingFulfillments(
  transaction: Transaction,
  orderId: string,
  action: "ORDER_CANCELLED" | "RESERVATION_EXPIRED",
  requestId: string,
  now: Date,
) {
  const rows = await transaction
    .select()
    .from(sellerOrderFulfillments)
    .where(eq(sellerOrderFulfillments.orderId, orderId))
    .orderBy(asc(sellerOrderFulfillments.id))
    .for("update");
  for (const fulfillment of rows.filter((item) => item.status === "AWAITING_PAYMENT")) {
    await transaction
      .update(sellerOrderFulfillments)
      .set({ status: "CANCELLED", cancelledAt: now, updatedAt: now })
      .where(eq(sellerOrderFulfillments.id, fulfillment.id));
    await transaction.insert(orderFulfillmentEvents).values({
      fulfillmentId: fulfillment.id,
      actorType: "SYSTEM",
      action,
      previousStatus: "AWAITING_PAYMENT",
      resultingStatus: "CANCELLED",
      requestId,
      createdAt: now,
    });
  }
}

async function markPaymentReview(transaction: Transaction, order: OrderRow, now: Date) {
  if (order.status === "PAID") return { outcome: "REVIEW_REQUIRED" as const, order };
  const [review] = await transaction
    .update(orders)
    .set({ status: "PAYMENT_REVIEW_REQUIRED", updatedAt: now })
    .where(eq(orders.id, order.id))
    .returning();
  if (!review) throw new ConflictError("The order could not enter payment review safely");
  return { outcome: "REVIEW_REQUIRED" as const, order: review };
}

function orderNumber(id: string): string {
  return `HX-${id.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}
