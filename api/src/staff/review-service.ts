import { and, eq, isNull } from "drizzle-orm";
import type { Database, DatabaseClient } from "../db/client.js";
import { session, twoFactor, user } from "../db/schema/auth.js";
import { sellerProductSubmissions } from "../db/schema/seller-products.js";
import { sellerApplications } from "../db/schema/sellers.js";
import {
  staffAuditEvents,
  staffMemberships,
  staffPermissionGrants,
  type StaffAuditAction,
  type StaffPermission,
} from "../db/schema/staff.js";
import { ConflictError, NotFoundError, StaffPermissionRequiredError } from "../lib/errors.js";
import {
  SellerProductApplicantReviewReasonSchema,
  SellerProductIdSchema,
} from "../seller-products/validation.js";
import {
  SellerApplicantReviewReasonSchema,
  SellerApplicationIdSchema,
} from "../sellers/validation.js";
import { assertPostMembershipSession, assertRecentSession } from "./authorization.js";
import type { StaffAuthorization } from "./model.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ReviewAction = "start-review" | "approve" | "reject";

export async function reviewSellerApplication(
  database: DatabaseClient,
  authorization: StaffAuthorization,
  applicationIdInput: string,
  action: ReviewAction,
  requestId: string,
  reason?: string,
) {
  const applicationId = SellerApplicationIdSchema.parse(applicationIdInput);
  const safeReason =
    action === "reject" ? SellerApplicantReviewReasonSchema.parse(reason) : undefined;
  return database.db.transaction(async (transaction) => {
    await lockAuthorizedActor(transaction, authorization, "SELLER_REVIEW");
    const [target] = await transaction
      .select()
      .from(sellerApplications)
      .where(eq(sellerApplications.id, applicationId))
      .for("update")
      .limit(1);
    if (!target) throw new NotFoundError();

    const transition = sellerApplicationTransition(action, target.status, safeReason);
    const now = new Date();
    const [updated] = await transaction
      .update(sellerApplications)
      .set({
        status: transition.status,
        reviewReason: transition.reviewReason,
        reviewedAt: transition.reviewed ? now : null,
        updatedAt: now,
      })
      .where(eq(sellerApplications.id, applicationId))
      .returning();
    if (!updated) throw new ConflictError("The seller review transition failed safely");

    await transaction.insert(staffAuditEvents).values({
      actorType: "STAFF",
      actorUserId: authorization.actor.userId,
      actorRole: authorization.actor.role,
      permission: authorization.actor.permission,
      action: transition.auditAction,
      sellerApplicationId: applicationId,
      previousStatus: target.status,
      resultingStatus: transition.status,
      requestId,
    });
    return updated;
  });
}

export async function reviewSellerProduct(
  database: DatabaseClient,
  authorization: StaffAuthorization,
  submissionIdInput: string,
  action: ReviewAction,
  requestId: string,
  reason?: string,
) {
  const submissionId = SellerProductIdSchema.parse(submissionIdInput);
  const safeReason =
    action === "reject" ? SellerProductApplicantReviewReasonSchema.parse(reason) : undefined;
  return database.db.transaction(async (transaction) => {
    await lockAuthorizedActor(transaction, authorization, "PRODUCT_REVIEW");
    const [target] = await transaction
      .select()
      .from(sellerProductSubmissions)
      .where(eq(sellerProductSubmissions.id, submissionId))
      .for("update")
      .limit(1);
    if (!target) throw new NotFoundError();

    const transition = sellerProductTransition(action, target.status, safeReason);
    const now = new Date();
    const [updated] = await transaction
      .update(sellerProductSubmissions)
      .set({
        status: transition.status,
        reviewReason: transition.reviewReason,
        reviewStartedAt: action === "start-review" ? now : target.reviewStartedAt,
        reviewedAt: transition.reviewed ? now : null,
        updatedAt: now,
      })
      .where(eq(sellerProductSubmissions.id, submissionId))
      .returning();
    if (!updated) throw new ConflictError("The product review transition failed safely");

    await transaction.insert(staffAuditEvents).values({
      actorType: "STAFF",
      actorUserId: authorization.actor.userId,
      actorRole: authorization.actor.role,
      permission: authorization.actor.permission,
      action: transition.auditAction,
      sellerProductSubmissionId: submissionId,
      previousStatus: target.status,
      resultingStatus: transition.status,
      requestId,
    });
    return updated;
  });
}

async function lockAuthorizedActor(
  transaction: Transaction,
  authorization: StaffAuthorization,
  permission: StaffPermission,
): Promise<void> {
  const [membership] = await transaction
    .select({
      status: staffMemberships.status,
      role: staffMemberships.role,
      createdAt: staffMemberships.createdAt,
    })
    .from(staffMemberships)
    .where(eq(staffMemberships.userId, authorization.actor.userId))
    .for("update")
    .limit(1);
  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    membership.role !== authorization.actor.role
  ) {
    throw new StaffPermissionRequiredError();
  }

  const [grant] = await transaction
    .select({ id: staffPermissionGrants.id })
    .from(staffPermissionGrants)
    .where(
      and(
        eq(staffPermissionGrants.staffUserId, authorization.actor.userId),
        eq(staffPermissionGrants.permission, permission),
        isNull(staffPermissionGrants.revokedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (!grant || authorization.actor.permission !== permission) {
    throw new StaffPermissionRequiredError();
  }

  const [security] = await transaction
    .select({
      accountStatus: user.status,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      factorVerified: twoFactor.verified,
      sessionCreatedAt: session.createdAt,
      sessionExpiresAt: session.expiresAt,
    })
    .from(user)
    .innerJoin(twoFactor, eq(twoFactor.userId, user.id))
    .innerJoin(session, and(eq(session.id, authorization.sessionId), eq(session.userId, user.id)))
    .where(eq(user.id, authorization.actor.userId))
    .limit(1);
  if (
    !security ||
    security.accountStatus !== "ACTIVE" ||
    !security.emailVerified ||
    !security.twoFactorEnabled ||
    !security.factorVerified ||
    security.sessionExpiresAt.getTime() <= Date.now()
  ) {
    throw new StaffPermissionRequiredError();
  }
  assertPostMembershipSession(security.sessionCreatedAt, membership.createdAt);
  assertRecentSession(security.sessionCreatedAt, new Date());
}

function sellerApplicationTransition(action: ReviewAction, status: string, reason?: string) {
  if (action === "start-review" && status === "SUBMITTED") {
    return {
      status: "UNDER_REVIEW" as const,
      reviewReason: null,
      reviewed: false,
      auditAction: "SELLER_APPLICATION_REVIEW_STARTED" as StaffAuditAction,
    };
  }
  if (action === "approve" && status === "UNDER_REVIEW") {
    return {
      status: "APPROVED" as const,
      reviewReason: null,
      reviewed: true,
      auditAction: "SELLER_APPLICATION_APPROVED" as StaffAuditAction,
    };
  }
  if (action === "reject" && status === "UNDER_REVIEW" && reason) {
    return {
      status: "REJECTED" as const,
      reviewReason: reason,
      reviewed: true,
      auditAction: "SELLER_APPLICATION_REJECTED" as StaffAuditAction,
    };
  }
  throw new ConflictError("The seller review transition is not allowed");
}

function sellerProductTransition(action: ReviewAction, status: string, reason?: string) {
  if (action === "start-review" && status === "SUBMITTED") {
    return {
      status: "UNDER_REVIEW" as const,
      reviewReason: null,
      reviewed: false,
      auditAction: "SELLER_PRODUCT_REVIEW_STARTED" as StaffAuditAction,
    };
  }
  if (action === "approve" && status === "UNDER_REVIEW") {
    return {
      status: "APPROVED" as const,
      reviewReason: null,
      reviewed: true,
      auditAction: "SELLER_PRODUCT_APPROVED" as StaffAuditAction,
    };
  }
  if (action === "reject" && status === "UNDER_REVIEW" && reason) {
    return {
      status: "REJECTED" as const,
      reviewReason: reason,
      reviewed: true,
      auditAction: "SELLER_PRODUCT_REJECTED" as StaffAuditAction,
    };
  }
  throw new ConflictError("The product review transition is not allowed");
}
