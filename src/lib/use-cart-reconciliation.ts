import { useEffect, useState } from "react";
import { reconcileCart } from "./cart-reconcile";
import { useHiloxs } from "./hiloxs-context";

/**
 * Drops cart lines whose product is not in the live catalog and reports how many were dropped, so
 * the page can show a one-line notice. Pass null until a catalog fetch has succeeded.
 */
export function useCartReconciliation(availableIds: ReadonlySet<string> | null): number {
  const { state, hydrated, removeCartItems } = useHiloxs();
  const [removedCount, setRemovedCount] = useState(0);

  useEffect(() => {
    if (!hydrated || !availableIds) return;
    const { removed } = reconcileCart(state.cart, availableIds);
    if (removed.length === 0) return;
    removeCartItems(removed);
    setRemovedCount((count) => count + removed.length);
  }, [hydrated, availableIds, state.cart, removeCartItems]);

  return removedCount;
}
