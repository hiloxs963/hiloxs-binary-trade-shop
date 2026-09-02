import type { ProductCategory } from "../catalog/categories.js";

export const SELLER_PRODUCT_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type SellerProductStatus = (typeof SELLER_PRODUCT_STATUSES)[number];
export type SellerProductCategory = ProductCategory;

export const SELLER_PRODUCT_TERMS_VERSION = "seller-product-terms-v1";
export const SELLER_PRODUCT_CURRENCY = "KES" as const;

// HILOXS application safety ceiling, not a legal or payment-provider limit.
export const MAX_SELLER_PRODUCT_PRICE_MINOR = 1_000_000_000n;
export const MAX_SELLER_PRODUCT_SUBMISSIONS = 50;
