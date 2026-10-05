export type CartLines = Record<string, number>;

export const CART_REMOVED_MESSAGE =
  "Some items are no longer available and were removed from your cart.";

/** Copy of the cart without the given product ids. Unknown ids are ignored. */
export function omitCartItems(cart: CartLines, productIds: readonly string[]): CartLines {
  const drop = new Set(productIds);
  return Object.fromEntries(Object.entries(cart).filter(([productId]) => !drop.has(productId)));
}

/**
 * Splits a stored cart into lines that still exist in the live catalog and ids that do not, such
 * as the seeded demo products that were removed from the catalog. Callers must only pass
 * `availableIds` from a catalog fetch that succeeded: an outage is not evidence that products are
 * gone, and treating it as one would empty the shopper's cart.
 */
export function reconcileCart(
  cart: CartLines,
  availableIds: ReadonlySet<string>,
): { cart: CartLines; removed: string[] } {
  const removed = Object.keys(cart).filter((productId) => !availableIds.has(productId));
  return { cart: omitCartItems(cart, removed), removed };
}
