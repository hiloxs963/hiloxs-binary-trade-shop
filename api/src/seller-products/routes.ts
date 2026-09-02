import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import { FixedWindowRateLimiter } from "../commerce/rate-limit.js";
import type { Database, DatabaseClient } from "../db/client.js";
import { sellerProductSubmissions } from "../db/schema/seller-products.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { requireApprovedSeller } from "./authorization.js";
import {
  MAX_SELLER_PRODUCT_SUBMISSIONS,
  SELLER_PRODUCT_CURRENCY,
  SELLER_PRODUCT_TERMS_VERSION,
} from "./model.js";
import {
  SellerProductConsentSchema,
  SellerProductDraftSchema,
  SellerProductEmptyBodySchema,
  SellerProductIdSchema,
  type SellerProductDraftInput,
} from "./validation.js";

type SellerProductSubmission = typeof sellerProductSubmissions.$inferSelect;

export function registerSellerProductRoutes(
  app: FastifyInstance,
  options: { auth: AuthService; database: DatabaseClient },
): void {
  const limiter = new FixedWindowRateLimiter();

  app.post("/api/v1/seller/products", async (request, reply) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    limiter.consume(`seller-product-create:${seller.userId}`, 10, 60_000);
    const input = SellerProductDraftSchema.parse(request.body);
    const [created] = await options.database.db
      .insert(sellerProductSubmissions)
      .values({ sellerApplicationId: seller.sellerApplicationId, ...toStoredDraft(input) })
      .returning();
    if (!created) throw new ConflictError("The product draft could not be created safely");
    return reply.status(201).send(responseFor(created));
  });

  app.get("/api/v1/seller/products", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const rows = await options.database.db
      .select()
      .from(sellerProductSubmissions)
      .where(eq(sellerProductSubmissions.sellerApplicationId, seller.sellerApplicationId))
      .orderBy(desc(sellerProductSubmissions.createdAt), desc(sellerProductSubmissions.id))
      .limit(MAX_SELLER_PRODUCT_SUBMISSIONS);
    return {
      submissions: rows.map(serializeSubmission),
      termsVersion: SELLER_PRODUCT_TERMS_VERSION,
    };
  });

  app.get("/api/v1/seller/products/:submissionId", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    const submissionId = submissionIdFrom(request.params);
    const submission = await findOwnedSubmission(
      options.database,
      seller.sellerApplicationId,
      submissionId,
    );
    if (!submission) throw new NotFoundError();
    return responseFor(submission);
  });

  app.post("/api/v1/seller/products/:submissionId/edit", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    limiter.consume(`seller-product-edit:${seller.userId}`, 30, 60_000);
    const submissionId = submissionIdFrom(request.params);
    const input = SellerProductDraftSchema.parse(request.body);
    const submission = await options.database.db.transaction(async (transaction) => {
      const existing = await lockOwnedSubmission(
        transaction,
        seller.sellerApplicationId,
        submissionId,
      );
      if (existing.status !== "DRAFT") {
        throw new ConflictError("Only a draft product submission can be edited");
      }
      const [updated] = await transaction
        .update(sellerProductSubmissions)
        .set({ ...toStoredDraft(input), updatedAt: new Date() })
        .where(eq(sellerProductSubmissions.id, existing.id))
        .returning();
      if (!updated) throw new ConflictError("The product draft could not be updated safely");
      return updated;
    });
    return responseFor(submission);
  });

  app.post("/api/v1/seller/products/:submissionId/submit", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    limiter.consume(`seller-product-submit:${seller.userId}`, 10, 60_000);
    SellerProductConsentSchema.parse(request.body);
    const submissionId = submissionIdFrom(request.params);
    const submission = await options.database.db.transaction(async (transaction) => {
      const existing = await lockOwnedSubmission(
        transaction,
        seller.sellerApplicationId,
        submissionId,
      );
      if (existing.status === "SUBMITTED") return existing;
      if (existing.status !== "DRAFT") {
        throw new ConflictError("Only a draft product submission can be submitted");
      }
      SellerProductDraftSchema.parse(toDraftInput(existing));
      const now = new Date();
      const [submitted] = await transaction
        .update(sellerProductSubmissions)
        .set({
          status: "SUBMITTED",
          termsVersion: SELLER_PRODUCT_TERMS_VERSION,
          termsAcceptedAt: now,
          submittedAt: now,
          updatedAt: now,
        })
        .where(eq(sellerProductSubmissions.id, existing.id))
        .returning();
      if (!submitted) throw new ConflictError("The product could not be submitted safely");
      return submitted;
    });
    return responseFor(submission);
  });

  app.post("/api/v1/seller/products/:submissionId/withdraw", async (request) => {
    const seller = await requireApprovedSeller(options.auth, options.database, request.headers);
    limiter.consume(`seller-product-withdraw:${seller.userId}`, 10, 60_000);
    SellerProductEmptyBodySchema.parse(request.body ?? {});
    const submissionId = submissionIdFrom(request.params);
    const submission = await options.database.db.transaction(async (transaction) => {
      const existing = await lockOwnedSubmission(
        transaction,
        seller.sellerApplicationId,
        submissionId,
      );
      if (existing.status === "WITHDRAWN") return existing;
      if (existing.status !== "DRAFT" && existing.status !== "SUBMITTED") {
        throw new ConflictError("This product submission cannot be withdrawn");
      }
      const [withdrawn] = await transaction
        .update(sellerProductSubmissions)
        .set({ status: "WITHDRAWN", updatedAt: new Date() })
        .where(eq(sellerProductSubmissions.id, existing.id))
        .returning();
      if (!withdrawn) throw new ConflictError("The product could not be withdrawn safely");
      return withdrawn;
    });
    return responseFor(submission);
  });
}

function toStoredDraft(input: SellerProductDraftInput) {
  return {
    name: input.name,
    category: input.category,
    description: input.description,
    priceMinor: input.priceMinor,
    currency: SELLER_PRODUCT_CURRENCY,
  };
}

function toDraftInput(submission: SellerProductSubmission) {
  return {
    name: submission.name,
    category: submission.category,
    description: submission.description,
    priceMinor: submission.priceMinor.toString(),
  };
}

function submissionIdFrom(params: unknown): string {
  return SellerProductIdSchema.parse((params as { submissionId?: unknown }).submissionId);
}

async function findOwnedSubmission(
  database: DatabaseClient,
  sellerApplicationId: string,
  submissionId: string,
) {
  const [submission] = await database.db
    .select()
    .from(sellerProductSubmissions)
    .where(
      and(
        eq(sellerProductSubmissions.id, submissionId),
        eq(sellerProductSubmissions.sellerApplicationId, sellerApplicationId),
      ),
    )
    .limit(1);
  return submission;
}

async function lockOwnedSubmission(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  sellerApplicationId: string,
  submissionId: string,
): Promise<SellerProductSubmission> {
  const [submission] = await transaction
    .select()
    .from(sellerProductSubmissions)
    .where(
      and(
        eq(sellerProductSubmissions.id, submissionId),
        eq(sellerProductSubmissions.sellerApplicationId, sellerApplicationId),
      ),
    )
    .for("update")
    .limit(1);
  if (!submission) throw new NotFoundError();
  return submission;
}

function serializeSubmission(submission: SellerProductSubmission) {
  return {
    id: submission.id,
    name: submission.name,
    category: submission.category,
    description: submission.description,
    priceMinor: submission.priceMinor.toString(),
    currency: submission.currency,
    status: submission.status,
    reviewReason: submission.status === "REJECTED" ? submission.reviewReason : null,
    termsVersion: submission.termsVersion,
    termsAcceptedAt: submission.termsAcceptedAt?.toISOString() ?? null,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    reviewStartedAt: submission.reviewStartedAt?.toISOString() ?? null,
    reviewedAt: submission.reviewedAt?.toISOString() ?? null,
    createdAt: submission.createdAt.toISOString(),
    updatedAt: submission.updatedAt.toISOString(),
  };
}

function responseFor(submission: SellerProductSubmission) {
  return {
    submission: serializeSubmission(submission),
    termsVersion: SELLER_PRODUCT_TERMS_VERSION,
  };
}
