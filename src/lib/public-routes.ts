export const PUBLIC_INFORMATIONAL_PATHS = [
  "/",
  "/shop",
  "/training",
  "/binary-plan",
  "/trading",
] as const;

/**
 * Product detail pages are no longer prerendered: the catalog is seller-sourced and
 * served from the API at runtime, so there is no build-time list of slugs.
 */
export const PUBLIC_PRERENDER_PATHS = [...PUBLIC_INFORMATIONAL_PATHS];
