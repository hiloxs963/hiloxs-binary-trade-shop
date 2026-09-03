import { createHash } from "node:crypto";
import type { CartInput } from "./validation.js";
import type { OrderCreateInput } from "../orders/validation.js";

export function fingerprintCart(input: CartInput): string {
  const items = [...input.items].sort((left, right) => {
    if (left.productId < right.productId) return -1;
    if (left.productId > right.productId) return 1;
    return 0;
  });

  return createHash("sha256").update(JSON.stringify({ items })).digest("hex");
}

export function fingerprintOrderRequest(input: OrderCreateInput): string {
  const items = [...input.items].sort((left, right) =>
    left.productId.localeCompare(right.productId),
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        items,
        ...(input.deliveryAddress ? { deliveryAddress: input.deliveryAddress } : {}),
      }),
    )
    .digest("hex");
}
