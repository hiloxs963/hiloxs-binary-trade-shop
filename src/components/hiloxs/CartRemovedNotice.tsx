import { CART_REMOVED_MESSAGE } from "@/lib/cart-reconcile";

/** One-line, non-blocking notice shown after stale cart lines were dropped. */
export function CartRemovedNotice({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <p className="mt-3 text-sm text-muted-foreground" role="status">
      {CART_REMOVED_MESSAGE}
    </p>
  );
}
