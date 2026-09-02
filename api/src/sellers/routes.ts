import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireActiveUser } from "../auth/active-user.js";
import type { AuthService } from "../auth/auth.js";
import { FixedWindowRateLimiter } from "../commerce/rate-limit.js";
import type { DatabaseClient } from "../db/client.js";
import { sellerApplications } from "../db/schema/sellers.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { SELLER_TERMS_VERSION } from "./model.js";
import {
  SellerDraftSchema,
  SellerEmptyBodySchema,
  SellerSubmissionConsentSchema,
  SellerSubmissionFieldsSchema,
  type SellerDraftInput,
} from "./validation.js";

type SellerApplication = typeof sellerApplications.$inferSelect;

export function registerSellerRoutes(
  app: FastifyInstance,
  options: { auth: AuthService; database: DatabaseClient },
): void {
  const limiter = new FixedWindowRateLimiter();

  app.get("/api/v1/seller/application", async (request) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    const application = await findApplication(options.database, owner.id);
    return responseFor(application);
  });

  app.post("/api/v1/seller/application", async (request, reply) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    limiter.consume(`seller-create:${owner.id}`, 5, 60_000);
    const input = SellerDraftSchema.parse(request.body);
    const [created] = await options.database.db
      .insert(sellerApplications)
      .values({ userId: owner.id, ...toStoredDraft(input) })
      .onConflictDoNothing({ target: sellerApplications.userId })
      .returning();
    if (!created) throw new ConflictError("A seller application already exists");
    return reply.status(201).send(responseFor(created));
  });

  app.post("/api/v1/seller/application/edit", async (request) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    limiter.consume(`seller-edit:${owner.id}`, 20, 60_000);
    const input = SellerDraftSchema.parse(request.body);
    const application = await options.database.db.transaction(async (transaction) => {
      const existing = await lockApplication(transaction, owner.id);
      if (existing.status !== "DRAFT") {
        throw new ConflictError("Only a draft seller application can be edited");
      }
      const [updated] = await transaction
        .update(sellerApplications)
        .set({ ...toStoredDraft(input), updatedAt: new Date() })
        .where(eq(sellerApplications.id, existing.id))
        .returning();
      if (!updated) throw new ConflictError("The seller application could not be updated safely");
      return updated;
    });
    return responseFor(application);
  });

  app.post("/api/v1/seller/application/submit", async (request) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    limiter.consume(`seller-submit:${owner.id}`, 5, 60_000);
    SellerSubmissionConsentSchema.parse(request.body);
    const application = await options.database.db.transaction(async (transaction) => {
      const existing = await lockApplication(transaction, owner.id);
      if (existing.status === "SUBMITTED") return existing;
      if (existing.status !== "DRAFT") {
        throw new ConflictError("Only a draft seller application can be submitted");
      }
      SellerSubmissionFieldsSchema.parse(toDraftInput(existing));
      const now = new Date();
      const [submitted] = await transaction
        .update(sellerApplications)
        .set({
          status: "SUBMITTED",
          termsVersion: SELLER_TERMS_VERSION,
          termsAcceptedAt: now,
          submittedAt: now,
          updatedAt: now,
        })
        .where(eq(sellerApplications.id, existing.id))
        .returning();
      if (!submitted) {
        throw new ConflictError("The seller application could not be submitted safely");
      }
      return submitted;
    });
    return responseFor(application);
  });

  app.post("/api/v1/seller/application/withdraw", async (request) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    limiter.consume(`seller-withdraw:${owner.id}`, 5, 60_000);
    SellerEmptyBodySchema.parse(request.body ?? {});
    const application = await options.database.db.transaction(async (transaction) => {
      const existing = await lockApplication(transaction, owner.id);
      if (existing.status === "WITHDRAWN") return existing;
      if (existing.status !== "DRAFT" && existing.status !== "SUBMITTED") {
        throw new ConflictError("This seller application cannot be withdrawn");
      }
      const [withdrawn] = await transaction
        .update(sellerApplications)
        .set({ status: "WITHDRAWN", updatedAt: new Date() })
        .where(eq(sellerApplications.id, existing.id))
        .returning();
      if (!withdrawn) {
        throw new ConflictError("The seller application could not be withdrawn safely");
      }
      return withdrawn;
    });
    return responseFor(application);
  });
}

function toStoredDraft(input: SellerDraftInput) {
  return {
    sellerType: input.sellerType,
    legalName: input.legalName,
    tradingName: input.tradingName ?? null,
    registrationNumber: input.registrationNumber ?? null,
    kraPin: input.kraPin ?? null,
  };
}

function toDraftInput(application: SellerApplication): SellerDraftInput {
  return {
    sellerType: application.sellerType,
    legalName: application.legalName,
    tradingName: application.tradingName ?? undefined,
    registrationNumber: application.registrationNumber ?? undefined,
    kraPin: application.kraPin ?? undefined,
  };
}

async function findApplication(database: DatabaseClient, userId: string) {
  const [application] = await database.db
    .select()
    .from(sellerApplications)
    .where(eq(sellerApplications.userId, userId))
    .limit(1);
  return application;
}

async function lockApplication(
  transaction: Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0],
  userId: string,
): Promise<SellerApplication> {
  const [application] = await transaction
    .select()
    .from(sellerApplications)
    .where(eq(sellerApplications.userId, userId))
    .for("update")
    .limit(1);
  if (!application) throw new NotFoundError();
  return application;
}

function serializeApplication(application: SellerApplication) {
  return {
    id: application.id,
    sellerType: application.sellerType,
    legalName: application.legalName,
    tradingName: application.tradingName,
    registrationNumber: application.registrationNumber,
    kraPin: application.kraPin,
    status: application.status,
    reviewReason: application.status === "REJECTED" ? application.reviewReason : null,
    termsVersion: application.termsVersion,
    termsAcceptedAt: application.termsAcceptedAt?.toISOString() ?? null,
    submittedAt: application.submittedAt?.toISOString() ?? null,
    reviewedAt: application.reviewedAt?.toISOString() ?? null,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  };
}

function responseFor(application: SellerApplication | undefined) {
  return {
    application: application ? serializeApplication(application) : null,
    termsVersion: SELLER_TERMS_VERSION,
  };
}
