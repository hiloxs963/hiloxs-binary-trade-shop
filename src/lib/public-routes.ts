import { PRODUCTS, productSlug } from "./hiloxs.ts";

export const PUBLIC_INFORMATIONAL_PATHS = [
  "/",
  "/shop",
  "/training",
  "/binary-plan",
  "/trading",
] as const;

export const PUBLIC_PRODUCT_PATHS = PRODUCTS.map((product) => `/shop/${productSlug(product)}`);

export const PUBLIC_PRERENDER_PATHS = [...PUBLIC_INFORMATIONAL_PATHS, ...PUBLIC_PRODUCT_PATHS];
