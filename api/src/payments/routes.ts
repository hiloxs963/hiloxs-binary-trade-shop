import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireActiveUser } from "../auth/active-user.js";
import type { AuthService } from "../auth/auth.js";
import { FixedWindowRateLimiter } from "../commerce/rate-limit.js";
import { EmptyBodySchema, IdempotencyKeySchema, OrderIdSchema } from "../commerce/validation.js";
import type { MpesaRuntimeConfig } from "../config/env.js";
import type { DatabaseClient } from "../db/client.js";
import { orders } from "../db/schema/commerce.js";
import { paymentAttempts, paymentEvents } from "../db/schema/payments.js";
import {
  IdempotencyKeyReusedError,
  NotFoundError,
  PaymentAlreadyInProgressError,
  PaymentProviderUnavailableError,
  PaymentRequiresReviewError,
  ValidationError,
} from "../lib/errors.js";
import { hashCanonical, sha256 } from "./hash.js";
import { minorKesToWholeKes } from "./money.js";
import { MpesaProviderError, type MpesaProvider } from "./provider.js";
import {
  ACTIVE_PAYMENT_STATUSES,
  canTransitionPayment,
  type PaymentAttemptStatus,
} from "./state.js";
import {
  callbackMetadata,
  MpesaCallbackSchema,
  MpesaCallbackTokenSchema,
  MpesaInitiationSchema,
  normalizeKenyanMpesaPhone,
  type ParsedMpesaCallback,
} from "./validation.js";

type PaymentAttempt = typeof paymentAttempts.$inferSelect;

export function registerMpesaRoutes(
  app: FastifyInstance,
  options: {
    auth: AuthService;
    database: DatabaseClient;
    provider: MpesaProvider;
    config: MpesaRuntimeConfig;
  },
): void {
  const limiter = new FixedWindowRateLimiter();

  app.post("/api/v1/orders/:orderId/payments/mpesa", async (request, reply) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    limiter.consume(`mpesa-initiate:${owner.id}`, 5, 60_000);
    const orderId = OrderIdSchema.parse((request.params as { orderId?: unknown }).orderId);
    const input = MpesaInitiationSchema.parse(request.body);
    const idempotencyKey = IdempotencyKeySchema.parse(request.headers["idempotency-key"]);
    const requestFingerprint = sha256(JSON.stringify({ orderId, phoneE164: input.phone }));
    const callbackToken = randomBytes(32).toString("base64url");

    const prepared = await options.database.db.transaction(async (transaction) => {
      const [order] = await transaction
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.userId, owner.id)))
        .for("update")
        .limit(1);
      if (!order) throw new NotFoundError();

      const [existing] = await transaction
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.orderId, order.id),
            eq(paymentAttempts.initiationIdempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new IdempotencyKeyReusedError();
        }
        return { attempt: existing, created: false, amountKes: 0n, callbackToken: "" };
      }

      if (order.status !== "PENDING_PAYMENT") {
        throw new ValidationError("Only pending-payment orders can start an M-Pesa payment");
      }
      const [active] = await transaction
        .select({ id: paymentAttempts.id })
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.orderId, order.id),
            inArray(paymentAttempts.status, ACTIVE_PAYMENT_STATUSES),
          ),
        )
        .limit(1);
      if (active) throw new PaymentAlreadyInProgressError();

      const amountKes = minorKesToWholeKes(
        order.totalMinor,
        order.currency,
        options.config.maxAmountKes,
      );
      const [attempt] = await transaction
        .insert(paymentAttempts)
        .values({
          id: randomUUID(),
          orderId: order.id,
          provider: "MPESA",
          status: "INITIATING",
          currency: order.currency,
          amountMinor: order.totalMinor,
          phoneE164: input.phone,
          initiationIdempotencyKey: idempotencyKey,
          requestFingerprint,
          callbackTokenHash: sha256(callbackToken),
        })
        .returning();
      if (!attempt) throw new PaymentProviderUnavailableError();
      return { attempt, created: true, amountKes, callbackToken };
    });

    if (!prepared.created) {
      return reply.status(200).send({ payment: serializePayment(prepared.attempt) });
    }

    const callbackURL = `${options.config.callbackBaseURL}/api/v1/payments/mpesa/callback/${prepared.callbackToken}`;
    try {
      const result = await options.provider.initiate({
        amountKes: prepared.amountKes,
        phoneE164: prepared.attempt.phoneE164,
        callbackURL,
        accountReference: await orderNumberForAttempt(options.database, prepared.attempt),
        transactionDescription: "HILOXS order payment",
      });
      const attempt = await persistAcceptedInitiation(
        options.database,
        prepared.attempt.id,
        result,
      );
      return reply.status(202).send({ payment: serializePayment(attempt) });
    } catch (error) {
      const ambiguous = error instanceof MpesaProviderError && error.ambiguous;
      const attempt = await persistInitiationFailure(
        options.database,
        prepared.attempt.id,
        ambiguous ? "UNKNOWN" : "FAILED",
        error instanceof MpesaProviderError ? error.providerCode : undefined,
      );
      if (ambiguous || attempt.status !== "FAILED") {
        return reply.status(202).send({ payment: serializePayment(attempt) });
      }
      throw new PaymentProviderUnavailableError(error);
    }
  });

  app.get("/api/v1/orders/:orderId/payment", async (request) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    const orderId = OrderIdSchema.parse((request.params as { orderId?: unknown }).orderId);
    const { order, attempt } = await loadOwnedPayment(options.database, owner.id, orderId);
    return { payment: serializePaymentStatus(order, attempt) };
  });

  app.post("/api/v1/orders/:orderId/payments/mpesa/refresh", async (request) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    limiter.consume(`mpesa-refresh:${owner.id}`, 6, 60_000);
    EmptyBodySchema.parse(request.body ?? {});
    const orderId = OrderIdSchema.parse((request.params as { orderId?: unknown }).orderId);
    const { order, attempt } = await loadOwnedPayment(options.database, owner.id, orderId);
    if (!attempt) return { payment: serializePaymentStatus(order, undefined) };
    if (attempt.status === "REVIEW_REQUIRED") throw new PaymentRequiresReviewError();
    if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED") {
      return { payment: serializePaymentStatus(order, attempt) };
    }
    if (!attempt.providerCheckoutRequestId) {
      return { payment: serializePaymentStatus(order, attempt) };
    }

    try {
      const result = await options.provider.query(attempt.providerCheckoutRequestId);
      const reconciled = await reconcileQueryResult(options.database, attempt.id, result);
      if (reconciled.attempt.status === "REVIEW_REQUIRED") {
        request.log.error(
          { paymentAttemptId: reconciled.attempt.id, orderId: reconciled.order.id },
          "M-Pesa reconciliation requires review",
        );
      }
      return { payment: serializePaymentStatus(reconciled.order, reconciled.attempt) };
    } catch (error) {
      if (error instanceof PaymentRequiresReviewError) throw error;
      const unresolved = await markQueryUnknown(options.database, attempt.id);
      request.log.warn(
        { paymentAttemptId: attempt.id, errorName: errorName(error) },
        "M-Pesa status query did not resolve",
      );
      return { payment: serializePaymentStatus(order, unresolved) };
    }
  });

  app.post("/api/v1/payments/mpesa/callback/:token", async (request) => {
    const token = MpesaCallbackTokenSchema.parse((request.params as { token?: unknown }).token);
    const callback = MpesaCallbackSchema.parse(request.body).Body.stkCallback;
    const attempt = await persistCallback(options.database, sha256(token), callback);
    if (attempt.status === "REVIEW_REQUIRED") {
      request.log.error(
        { paymentAttemptId: attempt.id, orderId: attempt.orderId },
        "Contradictory M-Pesa callback requires review",
      );
    }
    return { received: true };
  });
}

async function orderNumberForAttempt(
  database: DatabaseClient,
  attempt: PaymentAttempt,
): Promise<string> {
  const [order] = await database.db
    .select({ orderNumber: orders.orderNumber })
    .from(orders)
    .where(eq(orders.id, attempt.orderId))
    .limit(1);
  if (!order) throw new NotFoundError();
  return order.orderNumber;
}

async function persistAcceptedInitiation(
  database: DatabaseClient,
  attemptId: string,
  result: {
    merchantRequestId: string;
    checkoutRequestId: string;
    responseCode: string;
    responseDescription: string;
  },
): Promise<PaymentAttempt> {
  return database.db.transaction(async (transaction) => {
    const [attempt] = await transaction
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .for("update")
      .limit(1);
    if (!attempt) throw new NotFoundError();

    const identifiersConflict =
      (attempt.providerMerchantRequestId &&
        attempt.providerMerchantRequestId !== result.merchantRequestId) ||
      (attempt.providerCheckoutRequestId &&
        attempt.providerCheckoutRequestId !== result.checkoutRequestId);
    const nextStatus = identifiersConflict
      ? "REVIEW_REQUIRED"
      : attempt.status === "INITIATING"
        ? "PENDING"
        : attempt.status;
    const [updated] = await transaction
      .update(paymentAttempts)
      .set({
        status: nextStatus,
        providerMerchantRequestId: result.merchantRequestId,
        providerCheckoutRequestId: result.checkoutRequestId,
        providerResponseCode: result.responseCode,
        providerResponseDescription: result.responseDescription,
        initiatedAt: attempt.initiatedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attempt.id))
      .returning();
    if (!updated) throw new NotFoundError();
    return updated;
  });
}

async function persistInitiationFailure(
  database: DatabaseClient,
  attemptId: string,
  status: "FAILED" | "UNKNOWN",
  providerCode?: string,
): Promise<PaymentAttempt> {
  return database.db.transaction(async (transaction) => {
    const [attempt] = await transaction
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .for("update")
      .limit(1);
    if (!attempt) throw new NotFoundError();
    if (attempt.status !== "INITIATING") return attempt;
    const [updated] = await transaction
      .update(paymentAttempts)
      .set({
        status,
        providerResponseCode: providerCode,
        providerResponseDescription:
          status === "UNKNOWN" ? "Initiation outcome is unresolved" : "Initiation was rejected",
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attempt.id))
      .returning();
    if (!updated) throw new NotFoundError();
    return updated;
  });
}

async function persistCallback(
  database: DatabaseClient,
  callbackTokenHash: string,
  callback: ParsedMpesaCallback,
): Promise<PaymentAttempt> {
  const observed = await database.db
    .select({ orderId: paymentAttempts.orderId })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.callbackTokenHash, callbackTokenHash))
    .limit(1);
  const observedAttempt = observed[0];
  if (!observedAttempt) throw new NotFoundError();

  return database.db.transaction(async (transaction) => {
    const [order] = await transaction
      .select()
      .from(orders)
      .where(eq(orders.id, observedAttempt.orderId))
      .for("update")
      .limit(1);
    const [attempt] = await transaction
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.callbackTokenHash, callbackTokenHash))
      .for("update")
      .limit(1);
    if (!order || !attempt) throw new NotFoundError();

    const payloadHash = hashCanonical(callback);
    const [event] = await transaction
      .insert(paymentEvents)
      .values({
        id: randomUUID(),
        paymentAttemptId: attempt.id,
        eventType: "MPESA_STK_CALLBACK",
        payloadHash,
        providerResultCode: String(callback.ResultCode),
        providerResultDescription: safeDescription(callback.ResultDesc),
      })
      .onConflictDoNothing()
      .returning();
    if (!event) return attempt;

    const metadata = parseCallbackMetadata(callback);
    if (metadata.receiptNumber) {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${metadata.receiptNumber}, 0))`,
      );
    }
    const [otherSuccess] = await transaction
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.orderId, order.id),
          eq(paymentAttempts.status, "SUCCEEDED"),
          ne(paymentAttempts.id, attempt.id),
        ),
      )
      .limit(1);
    const [otherBlockingAttempt] = await transaction
      .select()
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.orderId, order.id),
          ne(paymentAttempts.id, attempt.id),
          inArray(paymentAttempts.status, ACTIVE_PAYMENT_STATUSES),
        ),
      )
      .for("update")
      .limit(1);
    const [receiptOwner] = metadata.receiptNumber
      ? await transaction
          .select({ id: paymentAttempts.id })
          .from(paymentAttempts)
          .where(eq(paymentAttempts.mpesaReceiptNumber, metadata.receiptNumber))
          .limit(1)
      : [];
    const receiptBelongsToAnotherAttempt = Boolean(receiptOwner && receiptOwner.id !== attempt.id);
    const receiptConflictsWithAttempt = Boolean(
      metadata.receiptNumber &&
      attempt.mpesaReceiptNumber &&
      metadata.receiptNumber !== attempt.mpesaReceiptNumber,
    );
    const lateSuccessAfterFailure = callback.ResultCode === 0 && attempt.status === "FAILED";
    const contradictory =
      Boolean(
        (attempt.providerMerchantRequestId &&
          attempt.providerMerchantRequestId !== callback.MerchantRequestID) ||
        (attempt.providerCheckoutRequestId &&
          attempt.providerCheckoutRequestId !== callback.CheckoutRequestID),
      ) ||
      metadata.amountMinor === "invalid" ||
      (typeof metadata.amountMinor === "bigint" && metadata.amountMinor !== attempt.amountMinor) ||
      (metadata.phoneE164 !== undefined && metadata.phoneE164 !== attempt.phoneE164) ||
      receiptBelongsToAnotherAttempt ||
      receiptConflictsWithAttempt ||
      Boolean(otherSuccess) ||
      order.status === "CANCELLED" ||
      lateSuccessAfterFailure ||
      (callback.ResultCode !== 0 && attempt.status === "SUCCEEDED");

    let status: PaymentAttemptStatus = attempt.status;
    if (lateSuccessAfterFailure && otherBlockingAttempt) status = "FAILED";
    else if (contradictory) status = "REVIEW_REQUIRED";
    else if (callback.ResultCode === 0) {
      if (attempt.status !== "SUCCEEDED") status = "CONFIRMING";
    } else if (attempt.status !== "SUCCEEDED" && attempt.status !== "FAILED") {
      status = "CONFIRMING";
    }

    let reviewedBlockingAttempt: PaymentAttempt | undefined;
    if (lateSuccessAfterFailure && otherBlockingAttempt) {
      [reviewedBlockingAttempt] = await transaction
        .update(paymentAttempts)
        .set({ status: "REVIEW_REQUIRED", updatedAt: new Date() })
        .where(eq(paymentAttempts.id, otherBlockingAttempt.id))
        .returning();
    }

    if (!canTransitionPayment(attempt.status, status)) status = "REVIEW_REQUIRED";
    const [updated] = await transaction
      .update(paymentAttempts)
      .set({
        status,
        providerMerchantRequestId: attempt.providerMerchantRequestId ?? callback.MerchantRequestID,
        providerCheckoutRequestId: attempt.providerCheckoutRequestId ?? callback.CheckoutRequestID,
        providerResultCode: String(callback.ResultCode),
        providerResultDescription: safeDescription(callback.ResultDesc),
        mpesaReceiptNumber: receiptBelongsToAnotherAttempt
          ? attempt.mpesaReceiptNumber
          : (attempt.mpesaReceiptNumber ?? metadata.receiptNumber),
        providerTransactionDate: attempt.providerTransactionDate ?? metadata.transactionDate,
        callbackReceivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attempt.id))
      .returning();
    if (!updated) throw new NotFoundError();
    return reviewedBlockingAttempt ?? updated;
  });
}

async function reconcileQueryResult(
  database: DatabaseClient,
  attemptId: string,
  result: {
    merchantRequestId?: string;
    checkoutRequestId: string;
    resultCode: number;
    resultDescription: string;
  },
) {
  return database.db.transaction(async (transaction) => {
    const observed = await transaction
      .select({ orderId: paymentAttempts.orderId })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .limit(1);
    if (!observed[0]) throw new NotFoundError();
    const [order] = await transaction
      .select()
      .from(orders)
      .where(eq(orders.id, observed[0].orderId))
      .for("update")
      .limit(1);
    const [attempt] = await transaction
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .for("update")
      .limit(1);
    if (!order || !attempt) throw new NotFoundError();
    if (attempt.status === "SUCCEEDED") return { order, attempt };

    const identifierConflict =
      attempt.providerCheckoutRequestId !== result.checkoutRequestId ||
      Boolean(
        result.merchantRequestId &&
        attempt.providerMerchantRequestId &&
        result.merchantRequestId !== attempt.providerMerchantRequestId,
      );
    if (identifierConflict) {
      const reviewed = await updateAttemptStatus(transaction, attempt, "REVIEW_REQUIRED", result);
      return { order, attempt: reviewed };
    }

    if (result.resultCode !== 0) {
      const unresolved = await updateAttemptStatus(transaction, attempt, "UNKNOWN", result);
      return { order, attempt: unresolved };
    }

    const [otherSuccess] = await transaction
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.orderId, order.id),
          eq(paymentAttempts.status, "SUCCEEDED"),
          ne(paymentAttempts.id, attempt.id),
        ),
      )
      .limit(1);
    const invalid =
      order.status !== "PENDING_PAYMENT" ||
      order.currency !== "KES" ||
      attempt.currency !== "KES" ||
      attempt.amountMinor !== order.totalMinor ||
      !canTransitionPayment(attempt.status, "SUCCEEDED") ||
      Boolean(otherSuccess);
    if (invalid) {
      const reviewed = await updateAttemptStatus(transaction, attempt, "REVIEW_REQUIRED", result);
      return { order, attempt: reviewed };
    }

    const now = new Date();
    const [succeeded] = await transaction
      .update(paymentAttempts)
      .set({
        status: "SUCCEEDED",
        providerResultCode: "0",
        providerResultDescription: safeDescription(result.resultDescription),
        lastQueryAt: now,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(eq(paymentAttempts.id, attempt.id))
      .returning();
    const [paidOrder] = await transaction
      .update(orders)
      .set({ status: "PAID", updatedAt: now })
      .where(and(eq(orders.id, order.id), eq(orders.status, "PENDING_PAYMENT")))
      .returning();
    if (!succeeded || !paidOrder) throw new PaymentRequiresReviewError();
    return { order: paidOrder, attempt: succeeded };
  });
}

async function updateAttemptStatus(
  transaction: Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0],
  attempt: PaymentAttempt,
  status: PaymentAttemptStatus,
  result: { resultCode: number; resultDescription: string },
): Promise<PaymentAttempt> {
  const safeStatus = canTransitionPayment(attempt.status, status) ? status : "REVIEW_REQUIRED";
  const [updated] = await transaction
    .update(paymentAttempts)
    .set({
      status: safeStatus,
      providerResultCode: String(result.resultCode),
      providerResultDescription: safeDescription(result.resultDescription),
      lastQueryAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(paymentAttempts.id, attempt.id))
    .returning();
  if (!updated) throw new NotFoundError();
  return updated;
}

async function markQueryUnknown(
  database: DatabaseClient,
  attemptId: string,
): Promise<PaymentAttempt> {
  return database.db.transaction(async (transaction) => {
    const [attempt] = await transaction
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .for("update")
      .limit(1);
    if (!attempt) throw new NotFoundError();
    if (["SUCCEEDED", "FAILED", "REVIEW_REQUIRED"].includes(attempt.status)) return attempt;
    const [updated] = await transaction
      .update(paymentAttempts)
      .set({ status: "UNKNOWN", lastQueryAt: new Date(), updatedAt: new Date() })
      .where(eq(paymentAttempts.id, attempt.id))
      .returning();
    if (!updated) throw new NotFoundError();
    return updated;
  });
}

async function loadOwnedPayment(database: DatabaseClient, userId: string, orderId: string) {
  const [order] = await database.db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  if (!order) throw new NotFoundError();
  const [attempt] = await database.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, order.id))
    .orderBy(desc(paymentAttempts.createdAt))
    .limit(1);
  return { order, attempt };
}

function serializePayment(attempt: PaymentAttempt) {
  return {
    paymentAttemptId: attempt.id,
    orderId: attempt.orderId,
    paymentStatus: attempt.status,
    amountMinor: attempt.amountMinor.toString(),
    currency: attempt.currency,
    updatedAt: attempt.updatedAt.toISOString(),
    ...(attempt.status === "SUCCEEDED" && attempt.mpesaReceiptNumber
      ? { receiptNumber: attempt.mpesaReceiptNumber }
      : {}),
  };
}

function serializePaymentStatus(
  order: typeof orders.$inferSelect,
  attempt: PaymentAttempt | undefined,
) {
  return {
    orderStatus: order.status,
    ...(attempt
      ? serializePayment(attempt)
      : { orderId: order.id, paymentAttemptId: null, paymentStatus: null }),
  };
}

function parseCallbackMetadata(callback: ParsedMpesaCallback): {
  amountMinor?: bigint | "invalid";
  receiptNumber?: string;
  transactionDate?: Date;
  phoneE164?: string;
} {
  const amountMinor = parseCallbackAmount(callbackMetadata(callback, "Amount"));
  const receiptValue = callbackMetadata(callback, "MpesaReceiptNumber");
  const dateValue = callbackMetadata(callback, "TransactionDate");
  const phoneValue = callbackMetadata(callback, "PhoneNumber");
  const receiptNumber =
    typeof receiptValue === "string" && /^[A-Za-z0-9]{5,30}$/.test(receiptValue)
      ? receiptValue
      : undefined;
  const phoneE164 =
    typeof phoneValue === "string" || typeof phoneValue === "number"
      ? (normalizeKenyanMpesaPhone(String(phoneValue)) ?? undefined)
      : undefined;
  const transactionDate = parseTransactionDate(dateValue);
  return {
    ...(amountMinor === undefined ? {} : { amountMinor }),
    ...(receiptNumber ? { receiptNumber } : {}),
    ...(transactionDate ? { transactionDate } : {}),
    ...(phoneE164 ? { phoneE164 } : {}),
  };
}

function parseCallbackAmount(value: unknown): bigint | "invalid" | undefined {
  if (value === undefined) return undefined;
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d+$/.test(text)) return "invalid";
  return BigInt(text) * 100n;
}

function parseTransactionDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value);
  if (!/^\d{14}$/.test(text)) return undefined;
  const [, year, month, day, hour, minute, second] =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text) ?? [];
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function safeDescription(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 500);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
