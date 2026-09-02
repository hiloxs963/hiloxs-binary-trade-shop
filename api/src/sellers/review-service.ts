import { eq } from "drizzle-orm";
import type { DatabaseClient } from "../db/client.js";
import { sellerApplications } from "../db/schema/sellers.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { SellerApplicantReviewReasonSchema, SellerApplicationIdSchema } from "./validation.js";

export async function startSellerApplicationReview(
  database: DatabaseClient,
  applicationId: string,
): Promise<void> {
  await transition(database, applicationId, "SUBMITTED", {
    status: "UNDER_REVIEW",
    updatedAt: new Date(),
  });
}

export async function approveSellerApplication(
  database: DatabaseClient,
  applicationId: string,
): Promise<void> {
  const now = new Date();
  await transition(database, applicationId, "UNDER_REVIEW", {
    status: "APPROVED",
    reviewReason: null,
    reviewedAt: now,
    updatedAt: now,
  });
}

export async function rejectSellerApplication(
  database: DatabaseClient,
  applicationId: string,
  applicantReason: string,
): Promise<void> {
  const reviewReason = SellerApplicantReviewReasonSchema.parse(applicantReason);
  const now = new Date();
  await transition(database, applicationId, "UNDER_REVIEW", {
    status: "REJECTED",
    reviewReason,
    reviewedAt: now,
    updatedAt: now,
  });
}

async function transition(
  database: DatabaseClient,
  applicationIdInput: string,
  expectedStatus: "SUBMITTED" | "UNDER_REVIEW",
  values: Partial<typeof sellerApplications.$inferInsert>,
): Promise<void> {
  const applicationId = SellerApplicationIdSchema.parse(applicationIdInput);
  await database.db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ status: sellerApplications.status })
      .from(sellerApplications)
      .where(eq(sellerApplications.id, applicationId))
      .for("update")
      .limit(1);
    if (!existing) throw new NotFoundError();
    if (existing.status !== expectedStatus) {
      throw new ConflictError("The seller review transition is not allowed");
    }
    await transaction
      .update(sellerApplications)
      .set(values)
      .where(eq(sellerApplications.id, applicationId));
  });
}
