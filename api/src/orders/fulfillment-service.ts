import { and, desc, eq, lt, notInArray, or } from "drizzle-orm";
import type { DatabaseClient } from "../db/client.js";
import {
  orderDeliveryAddresses,
  orderFulfillmentEvents,
  orderItems,
  orders,
  sellerOrderFulfillments,
  type SellerFulfillmentStatus,
} from "../db/schema/commerce.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import type { FulfillmentIssueReason } from "./model.js";

const SELLER_VISIBLE_EXCLUSIONS: SellerFulfillmentStatus[] = ["AWAITING_PAYMENT", "CANCELLED"];
const ADDRESS_VISIBLE_STATUSES = [
  "READY_FOR_SELLER",
  "ACCEPTED",
  "PREPARING",
  "DISPATCHED",
] as const satisfies readonly SellerFulfillmentStatus[];

export async function listSellerFulfillments(
  database: DatabaseClient,
  sellerApplicationId: string,
  query: {
    status?: SellerFulfillmentStatus | undefined;
    cursor?: string | undefined;
    limit: number;
  },
) {
  let cursorCondition;
  if (query.cursor) {
    const [cursor] = await database.db
      .select({ id: sellerOrderFulfillments.id, createdAt: sellerOrderFulfillments.createdAt })
      .from(sellerOrderFulfillments)
      .where(
        and(
          eq(sellerOrderFulfillments.id, query.cursor),
          eq(sellerOrderFulfillments.sellerApplicationId, sellerApplicationId),
        ),
      )
      .limit(1);
    if (!cursor) throw new NotFoundError();
    cursorCondition = or(
      lt(sellerOrderFulfillments.createdAt, cursor.createdAt),
      and(
        eq(sellerOrderFulfillments.createdAt, cursor.createdAt),
        lt(sellerOrderFulfillments.id, cursor.id),
      ),
    );
  }
  const conditions = [
    eq(sellerOrderFulfillments.sellerApplicationId, sellerApplicationId),
    notInArray(sellerOrderFulfillments.status, SELLER_VISIBLE_EXCLUSIONS),
  ];
  if (query.status) conditions.push(eq(sellerOrderFulfillments.status, query.status));
  if (cursorCondition) conditions.push(cursorCondition);
  const rows = await database.db
    .select({
      id: sellerOrderFulfillments.id,
      status: sellerOrderFulfillments.status,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      currency: orders.currency,
      createdAt: sellerOrderFulfillments.createdAt,
      updatedAt: sellerOrderFulfillments.updatedAt,
    })
    .from(sellerOrderFulfillments)
    .innerJoin(orders, eq(orders.id, sellerOrderFulfillments.orderId))
    .where(and(...conditions))
    .orderBy(desc(sellerOrderFulfillments.createdAt), desc(sellerOrderFulfillments.id))
    .limit(query.limit + 1);
  return {
    items: rows.slice(0, query.limit).map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    nextCursor: rows.length > query.limit ? (rows[query.limit - 1]?.id ?? null) : null,
  };
}

export async function getSellerFulfillment(
  database: DatabaseClient,
  sellerApplicationId: string,
  fulfillmentId: string,
) {
  const [fulfillment] = await database.db
    .select({
      id: sellerOrderFulfillments.id,
      orderId: sellerOrderFulfillments.orderId,
      status: sellerOrderFulfillments.status,
      acceptedAt: sellerOrderFulfillments.acceptedAt,
      preparingAt: sellerOrderFulfillments.preparingAt,
      dispatchedAt: sellerOrderFulfillments.dispatchedAt,
      deliveredAt: sellerOrderFulfillments.deliveredAt,
      issueAt: sellerOrderFulfillments.issueAt,
      issueReason: sellerOrderFulfillments.issueReason,
      issueMessage: sellerOrderFulfillments.issueMessage,
      carrier: sellerOrderFulfillments.carrier,
      trackingReference: sellerOrderFulfillments.trackingReference,
      createdAt: sellerOrderFulfillments.createdAt,
      updatedAt: sellerOrderFulfillments.updatedAt,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      currency: orders.currency,
    })
    .from(sellerOrderFulfillments)
    .innerJoin(orders, eq(orders.id, sellerOrderFulfillments.orderId))
    .where(
      and(
        eq(sellerOrderFulfillments.id, fulfillmentId),
        eq(sellerOrderFulfillments.sellerApplicationId, sellerApplicationId),
        notInArray(sellerOrderFulfillments.status, SELLER_VISIBLE_EXCLUSIONS),
      ),
    )
    .limit(1);
  if (!fulfillment) throw new NotFoundError();
  const items = await database.db
    .select({
      productId: orderItems.productId,
      productName: orderItems.productName,
      productSlug: orderItems.productSlug,
      unitPriceMinor: orderItems.unitPriceMinor,
      quantity: orderItems.quantity,
      lineTotalMinor: orderItems.lineTotalMinor,
    })
    .from(orderItems)
    .where(eq(orderItems.sellerFulfillmentId, fulfillment.id));
  const includeAddress = (ADDRESS_VISIBLE_STATUSES as readonly string[]).includes(
    fulfillment.status,
  );
  const [address] = includeAddress
    ? await database.db
        .select()
        .from(orderDeliveryAddresses)
        .where(eq(orderDeliveryAddresses.orderId, fulfillment.orderId))
        .limit(1)
    : [];
  return serializeSellerFulfillment(fulfillment, items, address);
}

export async function transitionSellerFulfillment(
  database: DatabaseClient,
  input: {
    sellerApplicationId: string;
    sellerUserId: string;
    fulfillmentId: string;
    action: "accept" | "prepare" | "dispatch" | "issue";
    requestId: string;
    carrier?: string;
    trackingReference?: string;
    issueReason?: FulfillmentIssueReason;
    issueMessage?: string;
  },
) {
  await database.db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(sellerOrderFulfillments)
      .where(
        and(
          eq(sellerOrderFulfillments.id, input.fulfillmentId),
          eq(sellerOrderFulfillments.sellerApplicationId, input.sellerApplicationId),
          notInArray(sellerOrderFulfillments.status, SELLER_VISIBLE_EXCLUSIONS),
        ),
      )
      .for("update")
      .limit(1);
    if (!current) throw new NotFoundError();
    const transition = sellerTransition(current, input);
    if (!transition.changed) return;
    const now = new Date();
    await transaction
      .update(sellerOrderFulfillments)
      .set({ ...transition.values, updatedAt: now })
      .where(eq(sellerOrderFulfillments.id, current.id));
    await transaction.insert(orderFulfillmentEvents).values({
      fulfillmentId: current.id,
      actorType: "SELLER",
      actorUserId: input.sellerUserId,
      action: transition.event,
      previousStatus: current.status,
      resultingStatus: transition.status,
      requestId: input.requestId,
      createdAt: now,
    });
  });
  return getSellerFulfillment(database, input.sellerApplicationId, input.fulfillmentId);
}

export async function confirmDelivery(
  database: DatabaseClient,
  customerUserId: string,
  orderId: string,
  fulfillmentId: string,
  requestId: string,
) {
  return database.db.transaction(async (transaction) => {
    const [current] = await transaction
      .select({
        id: sellerOrderFulfillments.id,
        status: sellerOrderFulfillments.status,
        deliveredAt: sellerOrderFulfillments.deliveredAt,
      })
      .from(sellerOrderFulfillments)
      .innerJoin(orders, eq(orders.id, sellerOrderFulfillments.orderId))
      .where(
        and(
          eq(sellerOrderFulfillments.id, fulfillmentId),
          eq(sellerOrderFulfillments.orderId, orderId),
          eq(orders.userId, customerUserId),
        ),
      )
      .for("update")
      .limit(1);
    if (!current) throw new NotFoundError();
    if (current.status === "DELIVERED") {
      return {
        id: current.id,
        status: current.status,
        deliveredAt: current.deliveredAt?.toISOString(),
      };
    }
    if (current.status !== "DISPATCHED") {
      throw new ConflictError("Only a dispatched fulfillment can be confirmed delivered");
    }
    const now = new Date();
    const [updated] = await transaction
      .update(sellerOrderFulfillments)
      .set({ status: "DELIVERED", deliveredAt: now, updatedAt: now })
      .where(
        and(
          eq(sellerOrderFulfillments.id, current.id),
          eq(sellerOrderFulfillments.status, "DISPATCHED"),
        ),
      )
      .returning();
    if (!updated) throw new ConflictError("Delivery could not be confirmed safely");
    await transaction.insert(orderFulfillmentEvents).values({
      fulfillmentId: current.id,
      actorType: "CUSTOMER",
      actorUserId: customerUserId,
      action: "DELIVERED",
      previousStatus: "DISPATCHED",
      resultingStatus: "DELIVERED",
      requestId,
      createdAt: now,
    });
    return { id: updated.id, status: updated.status, deliveredAt: now.toISOString() };
  });
}

function sellerTransition(
  current: typeof sellerOrderFulfillments.$inferSelect,
  input: Parameters<typeof transitionSellerFulfillment>[1],
):
  | { changed: false }
  | {
      changed: true;
      status: SellerFulfillmentStatus;
      event: "ACCEPTED" | "PREPARING" | "DISPATCHED" | "FULFILLMENT_ISSUE_REPORTED";
      values: Partial<typeof sellerOrderFulfillments.$inferInsert>;
    } {
  const now = new Date();
  if (input.action === "accept") {
    if (current.status === "ACCEPTED") return { changed: false };
    if (current.status !== "READY_FOR_SELLER")
      throw new ConflictError("The fulfillment cannot be accepted");
    return {
      changed: true,
      status: "ACCEPTED",
      event: "ACCEPTED",
      values: { status: "ACCEPTED", acceptedAt: now },
    };
  }
  if (input.action === "prepare") {
    if (current.status === "PREPARING") return { changed: false };
    if (current.status !== "ACCEPTED")
      throw new ConflictError("The fulfillment cannot enter preparation");
    return {
      changed: true,
      status: "PREPARING",
      event: "PREPARING",
      values: { status: "PREPARING", preparingAt: now },
    };
  }
  if (input.action === "dispatch") {
    if (current.status === "DISPATCHED") {
      if (
        current.carrier === input.carrier &&
        current.trackingReference === (input.trackingReference ?? null)
      )
        return { changed: false };
      throw new ConflictError("The fulfillment was already dispatched with different details");
    }
    if (current.status !== "PREPARING")
      throw new ConflictError("The fulfillment cannot be dispatched");
    return {
      changed: true,
      status: "DISPATCHED",
      event: "DISPATCHED",
      values: {
        status: "DISPATCHED",
        dispatchedAt: now,
        carrier: input.carrier,
        trackingReference: input.trackingReference ?? null,
      },
    };
  }
  if (current.status === "FULFILLMENT_ISSUE") {
    if (
      current.issueReason === input.issueReason &&
      current.issueMessage === (input.issueMessage ?? null)
    )
      return { changed: false };
    throw new ConflictError("A different fulfillment issue is already recorded");
  }
  if (!(["READY_FOR_SELLER", "ACCEPTED", "PREPARING"] as string[]).includes(current.status)) {
    throw new ConflictError("A fulfillment issue cannot be reported in this state");
  }
  return {
    changed: true,
    status: "FULFILLMENT_ISSUE",
    event: "FULFILLMENT_ISSUE_REPORTED",
    values: {
      status: "FULFILLMENT_ISSUE",
      issueAt: now,
      issueReason: input.issueReason,
      issueMessage: input.issueMessage ?? null,
    },
  };
}

function serializeSellerFulfillment(
  fulfillment: {
    id: string;
    status: SellerFulfillmentStatus;
    orderNumber: string;
    orderStatus: string;
    currency: string;
    acceptedAt: Date | null;
    preparingAt: Date | null;
    dispatchedAt: Date | null;
    deliveredAt: Date | null;
    issueAt: Date | null;
    issueReason: string | null;
    issueMessage: string | null;
    carrier: string | null;
    trackingReference: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  items: Array<{
    productId: string;
    productName: string;
    productSlug: string;
    unitPriceMinor: bigint;
    quantity: number;
    lineTotalMinor: bigint;
  }>,
  address?: typeof orderDeliveryAddresses.$inferSelect,
) {
  return {
    id: fulfillment.id,
    orderNumber: fulfillment.orderNumber,
    status: fulfillment.status,
    orderStatus: fulfillment.orderStatus,
    currency: fulfillment.currency,
    acceptedAt: fulfillment.acceptedAt?.toISOString() ?? null,
    preparingAt: fulfillment.preparingAt?.toISOString() ?? null,
    dispatchedAt: fulfillment.dispatchedAt?.toISOString() ?? null,
    deliveredAt: fulfillment.deliveredAt?.toISOString() ?? null,
    issueAt: fulfillment.issueAt?.toISOString() ?? null,
    issueReason: fulfillment.issueReason,
    issueMessage: fulfillment.issueMessage,
    carrier: fulfillment.carrier,
    trackingReference: fulfillment.trackingReference,
    createdAt: fulfillment.createdAt.toISOString(),
    updatedAt: fulfillment.updatedAt.toISOString(),
    items: items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      productSlug: item.productSlug,
      unitPriceMinor: item.unitPriceMinor.toString(),
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor.toString(),
    })),
    ...(address
      ? {
          deliveryAddress: {
            recipientName: address.recipientName,
            phone: address.phone,
            county: address.county,
            town: address.town,
            addressLine: address.addressLine,
            landmark: address.landmark,
          },
        }
      : {}),
  };
}
