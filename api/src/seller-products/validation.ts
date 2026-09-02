import { z } from "zod";
import { PRODUCT_CATEGORIES } from "../catalog/categories.js";
import { MAX_SELLER_PRODUCT_PRICE_MINOR, SELLER_PRODUCT_TERMS_VERSION } from "./model.js";

const plainText = (value: string) =>
  !/[<>\p{C}]/u.test(value) && !/(?:javascript|data):/i.test(value);

const ProductNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .refine(plainText, "Markup and control characters are not allowed")
  .transform(collapseWhitespace);

const ProductDescriptionSchema = z
  .string()
  .trim()
  .min(20)
  .max(5_000)
  .refine(plainText, "Markup and control characters are not allowed")
  .transform(collapseWhitespace);

const PriceMinorSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^(?:0|[1-9][0-9]*)$/)
  .transform((value) => BigInt(value))
  .refine((value) => value > 0n, "Price must be greater than zero")
  .refine(
    (value) => value <= MAX_SELLER_PRODUCT_PRICE_MINOR,
    "Price exceeds the HILOXS application limit",
  );

export const SellerProductDraftSchema = z
  .object({
    name: ProductNameSchema,
    category: z.enum(PRODUCT_CATEGORIES),
    description: ProductDescriptionSchema,
    priceMinor: PriceMinorSchema,
  })
  .strict();

export const SellerProductConsentSchema = z
  .object({
    termsAccepted: z.literal(true),
    termsVersion: z.literal(SELLER_PRODUCT_TERMS_VERSION),
  })
  .strict();

export const SellerProductEmptyBodySchema = z.object({}).strict();
export const SellerProductIdSchema = z.uuid();

export const SellerProductApplicantReviewReasonSchema = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .refine(plainText, "Markup and control characters are not allowed")
  .transform(collapseWhitespace);

export type SellerProductDraftInput = z.infer<typeof SellerProductDraftSchema>;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}
