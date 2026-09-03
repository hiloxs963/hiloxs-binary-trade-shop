import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import type { DatabaseClient } from "../db/client.js";
import { sellerProductSubmissions } from "../db/schema/seller-products.js";
import { sellerApplications } from "../db/schema/sellers.js";
import { NotFoundError, StaffReviewDisabledError } from "../lib/errors.js";
import { SellerProductIdSchema } from "../seller-products/validation.js";
import { SellerApplicationIdSchema } from "../sellers/validation.js";
import { requireStaffPermission, requireStaffProfile } from "./authorization.js";
import { reviewSellerApplication, reviewSellerProduct } from "./review-service.js";
import {
  SellerApplicationQueueQuerySchema,
  SellerApplicationRejectSchema,
  SellerProductQueueQuerySchema,
  SellerProductRejectSchema,
  StaffEmptyBodySchema,
} from "./validation.js";

type StaffRouteOptions = {
  auth: AuthService;
  database: DatabaseClient;
  reviewEnabled: boolean;
  catalogActivationEnabled: boolean;
};

export function registerStaffRoutes(app: FastifyInstance, options: StaffRouteOptions): void {
  app.get("/api/v1/staff/me", async (request) => {
    const profile = await requireStaffProfile(options.auth, options.database, request.headers);
    return {
      staff: {
        ...profile,
        reviewEnabled: options.reviewEnabled,
        catalogActivationEnabled: options.catalogActivationEnabled,
      },
    };
  });

  app.get("/api/v1/staff/seller-applications", async (request) => {
    await requireStaffPermission(options.auth, options.database, request.headers, "SELLER_REVIEW");
    const query = SellerApplicationQueueQuerySchema.parse(request.query);
    const where = query.status ? eq(sellerApplications.status, query.status) : undefined;
    const rows = await options.database.db
      .select({
        id: sellerApplications.id,
        sellerType: sellerApplications.sellerType,
        legalName: sellerApplications.legalName,
        tradingName: sellerApplications.tradingName,
        status: sellerApplications.status,
        submittedAt: sellerApplications.submittedAt,
        reviewedAt: sellerApplications.reviewedAt,
      })
      .from(sellerApplications)
      .where(where)
      .orderBy(desc(sellerApplications.submittedAt), desc(sellerApplications.id))
      .limit(query.limit + 1)
      .offset((query.page - 1) * query.limit);
    return pageResponse(rows, query.page, query.limit, serializeApplicationList);
  });

  app.get("/api/v1/staff/seller-applications/:applicationId", async (request) => {
    await requireStaffPermission(options.auth, options.database, request.headers, "SELLER_REVIEW");
    const applicationId = applicationIdFrom(request.params);
    const [application] = await options.database.db
      .select()
      .from(sellerApplications)
      .where(eq(sellerApplications.id, applicationId))
      .limit(1);
    if (!application) throw new NotFoundError();
    return { application: serializeApplicationDetail(application) };
  });

  for (const action of ["start-review", "approve", "reject"] as const) {
    app.post(`/api/v1/staff/seller-applications/:applicationId/${action}`, async (request) => {
      const authorization = await requireStaffPermission(
        options.auth,
        options.database,
        request.headers,
        "SELLER_REVIEW",
        { recent: true },
      );
      if (!options.reviewEnabled) throw new StaffReviewDisabledError();
      const body =
        action === "reject"
          ? SellerApplicationRejectSchema.parse(request.body)
          : StaffEmptyBodySchema.parse(request.body ?? {});
      const application = await reviewSellerApplication(
        options.database,
        authorization,
        applicationIdFrom(request.params),
        action,
        request.id,
        "reason" in body ? body.reason : undefined,
      );
      return { application: serializeApplicationDetail(application) };
    });
  }

  app.get("/api/v1/staff/seller-products", async (request) => {
    await requireStaffPermission(options.auth, options.database, request.headers, "PRODUCT_REVIEW");
    const query = SellerProductQueueQuerySchema.parse(request.query);
    const where = query.status ? eq(sellerProductSubmissions.status, query.status) : undefined;
    const rows = await productQueueQuery(options.database, where)
      .orderBy(desc(sellerProductSubmissions.submittedAt), desc(sellerProductSubmissions.id))
      .limit(query.limit + 1)
      .offset((query.page - 1) * query.limit);
    return pageResponse(rows, query.page, query.limit, serializeProductList);
  });

  app.get("/api/v1/staff/seller-products/:submissionId", async (request) => {
    await requireStaffPermission(options.auth, options.database, request.headers, "PRODUCT_REVIEW");
    const submissionId = submissionIdFrom(request.params);
    const [submission] = await productQueueQuery(
      options.database,
      eq(sellerProductSubmissions.id, submissionId),
    ).limit(1);
    if (!submission) throw new NotFoundError();
    return { submission: serializeProductDetail(submission) };
  });

  for (const action of ["start-review", "approve", "reject"] as const) {
    app.post(`/api/v1/staff/seller-products/:submissionId/${action}`, async (request) => {
      const authorization = await requireStaffPermission(
        options.auth,
        options.database,
        request.headers,
        "PRODUCT_REVIEW",
        { recent: true },
      );
      if (!options.reviewEnabled) throw new StaffReviewDisabledError();
      const body =
        action === "reject"
          ? SellerProductRejectSchema.parse(request.body)
          : StaffEmptyBodySchema.parse(request.body ?? {});
      const submission = await reviewSellerProduct(
        options.database,
        authorization,
        submissionIdFrom(request.params),
        action,
        request.id,
        "reason" in body ? body.reason : undefined,
      );
      return { submission: serializeProductRecord(submission) };
    });
  }
}

function productQueueQuery(database: DatabaseClient, where?: ReturnType<typeof eq>) {
  return database.db
    .select({
      id: sellerProductSubmissions.id,
      sellerApplicationId: sellerProductSubmissions.sellerApplicationId,
      status: sellerProductSubmissions.status,
      name: sellerProductSubmissions.name,
      category: sellerProductSubmissions.category,
      description: sellerProductSubmissions.description,
      priceMinor: sellerProductSubmissions.priceMinor,
      currency: sellerProductSubmissions.currency,
      submittedAt: sellerProductSubmissions.submittedAt,
      reviewStartedAt: sellerProductSubmissions.reviewStartedAt,
      reviewedAt: sellerProductSubmissions.reviewedAt,
      sellerType: sellerApplications.sellerType,
      legalName: sellerApplications.legalName,
      tradingName: sellerApplications.tradingName,
      sellerStatus: sellerApplications.status,
    })
    .from(sellerProductSubmissions)
    .innerJoin(
      sellerApplications,
      and(
        eq(sellerApplications.id, sellerProductSubmissions.sellerApplicationId),
        eq(sellerApplications.status, "APPROVED"),
      ),
    )
    .where(where);
}

function pageResponse<T, R>(rows: T[], page: number, limit: number, serialize: (row: T) => R) {
  return {
    items: rows.slice(0, limit).map(serialize),
    page,
    limit,
    hasMore: rows.length > limit,
  };
}

function serializeApplicationList(application: {
  id: string;
  sellerType: string;
  legalName: string;
  tradingName: string | null;
  status: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
}) {
  return {
    ...application,
    submittedAt: application.submittedAt?.toISOString() ?? null,
    reviewedAt: application.reviewedAt?.toISOString() ?? null,
  };
}

function serializeApplicationDetail(application: typeof sellerApplications.$inferSelect) {
  return {
    ...serializeApplicationList(application),
    registrationNumber: application.registrationNumber,
    kraPin: application.kraPin,
    reviewReason: application.reviewReason,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  };
}

function serializeProductList(product: ProductQueueRow) {
  return {
    id: product.id,
    sellerApplicationId: product.sellerApplicationId,
    name: product.name,
    category: product.category,
    priceMinor: product.priceMinor.toString(),
    currency: product.currency,
    status: product.status,
    submittedAt: product.submittedAt?.toISOString() ?? null,
    reviewedAt: product.reviewedAt?.toISOString() ?? null,
    seller: {
      sellerType: product.sellerType,
      legalName: product.legalName,
      tradingName: product.tradingName,
      status: product.sellerStatus,
    },
  };
}

function serializeProductDetail(product: ProductQueueRow) {
  return {
    ...serializeProductList(product),
    description: product.description,
    reviewStartedAt: product.reviewStartedAt?.toISOString() ?? null,
  };
}

function serializeProductRecord(product: typeof sellerProductSubmissions.$inferSelect) {
  return {
    id: product.id,
    sellerApplicationId: product.sellerApplicationId,
    name: product.name,
    category: product.category,
    description: product.description,
    priceMinor: product.priceMinor.toString(),
    currency: product.currency,
    status: product.status,
    submittedAt: product.submittedAt?.toISOString() ?? null,
    reviewStartedAt: product.reviewStartedAt?.toISOString() ?? null,
    reviewedAt: product.reviewedAt?.toISOString() ?? null,
  };
}

type ProductQueueRow = Awaited<ReturnType<typeof productQueueQuery>>[number];

function applicationIdFrom(params: unknown): string {
  return SellerApplicationIdSchema.parse((params as { applicationId?: unknown }).applicationId);
}

function submissionIdFrom(params: unknown): string {
  return SellerProductIdSchema.parse((params as { submissionId?: unknown }).submissionId);
}
