import { z } from "zod";
import { SELLER_APPLICATION_STATUSES, SELLER_TYPES } from "../sellers/model.js";
import { SELLER_PRODUCT_STATUSES } from "../seller-products/model.js";
import { SellerApplicantReviewReasonSchema } from "../sellers/validation.js";
import { SellerProductApplicantReviewReasonSchema } from "../seller-products/validation.js";

const PageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const LimitSchema = z.coerce.number().int().min(1).max(50).default(25);

export const SellerApplicationQueueQuerySchema = z
  .object({
    page: PageSchema,
    limit: LimitSchema,
    status: z.enum(SELLER_APPLICATION_STATUSES).optional(),
  })
  .strict();

export const SellerProductQueueQuerySchema = z
  .object({
    page: PageSchema,
    limit: LimitSchema,
    status: z.enum(SELLER_PRODUCT_STATUSES).optional(),
  })
  .strict();

export const StaffEmptyBodySchema = z.object({}).strict();
export const SellerApplicationRejectSchema = z
  .object({ reason: SellerApplicantReviewReasonSchema })
  .strict();
export const SellerProductRejectSchema = z
  .object({ reason: SellerProductApplicantReviewReasonSchema })
  .strict();

export const StaffSellerTypeSchema = z.enum(SELLER_TYPES);
