import { z } from "zod";
import { normalizeKenyanMpesaPhone } from "../payments/validation.js";
import { CartSchema } from "../commerce/validation.js";
import { SELLER_FULFILLMENT_STATUSES } from "../db/schema/commerce.js";
import { FULFILLMENT_ISSUE_REASONS, KENYA_COUNTIES } from "./model.js";

// Delivery fields must reject invisible control and bidirectional override characters.
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const MARKUP = /[<>]/u;
const URL_LIKE = /(?:https?:\/\/|www\.)/iu;

function plainText(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !CONTROL_OR_BIDI.test(value) && !MARKUP.test(value), "Use plain text only")
    .transform((value) => value.replace(/\s+/gu, " "));
}

export const DeliveryAddressSchema = z
  .object({
    recipientName: plainText(2, 120),
    phone: z.string().transform((value, context) => {
      const normalized = normalizeKenyanMpesaPhone(value);
      if (!normalized) {
        context.addIssue({ code: "custom", message: "Enter a valid Kenyan phone number" });
        return z.NEVER;
      }
      return normalized;
    }),
    county: z.enum(KENYA_COUNTIES),
    town: plainText(2, 100),
    addressLine: plainText(4, 240),
    landmark: plainText(2, 160).optional(),
  })
  .strict();

export const OrderCreateSchema = CartSchema.extend({
  deliveryAddress: DeliveryAddressSchema.optional(),
}).strict();

export const FulfillmentConfigInputSchema = z.object({ termsAccepted: z.literal(true) }).strict();
export const LiveInventoryInputSchema = z
  .object({ quantityOnHand: z.number().int().min(0).max(1_000_000) })
  .strict();

export const SellerCatalogProductIdSchema = z.uuid();
export const FulfillmentIdSchema = z.uuid();

const visibleStatuses = SELLER_FULFILLMENT_STATUSES.filter(
  (status) => status !== "AWAITING_PAYMENT",
);
export const SellerOrderListQuerySchema = z
  .object({
    status: z.enum(visibleStatuses).optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const DispatchInputSchema = z
  .object({
    carrier: plainText(2, 80).refine((value) => !URL_LIKE.test(value), "URLs are not allowed"),
    trackingReference: plainText(2, 120)
      .refine((value) => !URL_LIKE.test(value), "URLs are not allowed")
      .optional(),
  })
  .strict();

export const FulfillmentIssueInputSchema = z
  .object({
    reason: z.enum(FULFILLMENT_ISSUE_REASONS),
    message: plainText(4, 240).optional(),
  })
  .strict();

export const SupportListQuerySchema = z
  .object({
    type: z.enum(["PAYMENT_REVIEW_REQUIRED", "FULFILLMENT_ISSUE"]),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type DeliveryAddressInput = z.infer<typeof DeliveryAddressSchema>;
export type OrderCreateInput = z.infer<typeof OrderCreateSchema>;
