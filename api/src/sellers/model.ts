export const SELLER_TYPES = ["COMPANY", "REGISTERED_BUSINESS", "SOLE_PROPRIETOR"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

export const SELLER_APPLICATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type SellerApplicationStatus = (typeof SELLER_APPLICATION_STATUSES)[number];

export const SELLER_TERMS_VERSION = "seller-terms-v1";
