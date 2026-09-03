import { eq } from "drizzle-orm";
import type { DatabaseClient } from "../db/client.js";
import { sellerProductMedia } from "../db/schema/media.js";
import { staffAuditEvents } from "../db/schema/staff.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { lockAuthorizedActor } from "../staff/review-service.js";
import type { StaffAuthorization } from "../staff/model.js";
import { MediaIdSchema, MediaRejectSchema } from "./validation.js";

export async function reviewSellerProductMedia(
  database: DatabaseClient,
  authorization: StaffAuthorization,
  mediaIdInput: string,
  action: "approve" | "reject",
  requestId: string,
  reason?: string,
) {
  const mediaId = MediaIdSchema.parse(mediaIdInput);
  const safeReason = action === "reject" ? MediaRejectSchema.parse({ reason }).reason : null;
  return database.db.transaction(async (transaction) => {
    await lockAuthorizedActor(transaction, authorization, "PRODUCT_REVIEW");
    const [media] = await transaction
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.id, mediaId))
      .for("update")
      .limit(1);
    if (!media) throw new NotFoundError();
    if (media.status !== "READY_FOR_REVIEW") {
      throw new ConflictError("The media review transition is not allowed");
    }
    const now = new Date();
    const resultingStatus = action === "approve" ? "APPROVED" : "REJECTED";
    const [updated] = await transaction
      .update(sellerProductMedia)
      .set({
        status: resultingStatus,
        selectedForActivation: false,
        reviewedAt: now,
        reviewReason: safeReason,
        updatedAt: now,
      })
      .where(eq(sellerProductMedia.id, media.id))
      .returning();
    if (!updated) throw new ConflictError("The media review transition failed safely");
    await transaction.insert(staffAuditEvents).values({
      actorType: "STAFF",
      actorUserId: authorization.actor.userId,
      actorRole: authorization.actor.role,
      permission: "PRODUCT_REVIEW",
      action:
        action === "approve" ? "SELLER_PRODUCT_MEDIA_APPROVED" : "SELLER_PRODUCT_MEDIA_REJECTED",
      sellerProductMediaId: media.id,
      previousStatus: media.status,
      resultingStatus,
      requestId,
    });
    return updated;
  });
}
