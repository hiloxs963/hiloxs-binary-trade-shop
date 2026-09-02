import { eq } from "drizzle-orm";
import type { Database, DatabaseClient } from "../db/client.js";
import { sellerProductSubmissions } from "../db/schema/seller-products.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { SellerProductApplicantReviewReasonSchema, SellerProductIdSchema } from "./validation.js";

export async function startSellerProductReview(
  database: DatabaseClient,
  submissionId: string,
): Promise<void> {
  await transition(database, submissionId, "SUBMITTED", {
    status: "UNDER_REVIEW",
    reviewStartedAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function approveSellerProduct(
  database: DatabaseClient,
  submissionId: string,
): Promise<void> {
  const now = new Date();
  await transition(database, submissionId, "UNDER_REVIEW", {
    status: "APPROVED",
    reviewReason: null,
    reviewedAt: now,
    updatedAt: now,
  });
}

export async function rejectSellerProduct(
  database: DatabaseClient,
  submissionId: string,
  applicantReason: string,
): Promise<void> {
  const reviewReason = SellerProductApplicantReviewReasonSchema.parse(applicantReason);
  const now = new Date();
  await transition(database, submissionId, "UNDER_REVIEW", {
    status: "REJECTED",
    reviewReason,
    reviewedAt: now,
    updatedAt: now,
  });
}

async function transition(
  database: DatabaseClient,
  submissionIdInput: string,
  expectedStatus: "SUBMITTED" | "UNDER_REVIEW",
  values: Partial<typeof sellerProductSubmissions.$inferInsert>,
): Promise<void> {
  const submissionId = SellerProductIdSchema.parse(submissionIdInput);
  await database.db.transaction(async (transaction) => {
    const existing = await lockSubmission(transaction, submissionId);
    if (existing.status !== expectedStatus) {
      throw new ConflictError("The product review transition is not allowed");
    }
    const [updated] = await transaction
      .update(sellerProductSubmissions)
      .set(values)
      .where(eq(sellerProductSubmissions.id, submissionId))
      .returning({ id: sellerProductSubmissions.id });
    if (!updated) throw new ConflictError("The product review transition failed safely");
  });
}

async function lockSubmission(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  submissionId: string,
) {
  const [submission] = await transaction
    .select({ status: sellerProductSubmissions.status })
    .from(sellerProductSubmissions)
    .where(eq(sellerProductSubmissions.id, submissionId))
    .for("update")
    .limit(1);
  if (!submission) throw new NotFoundError();
  return submission;
}
