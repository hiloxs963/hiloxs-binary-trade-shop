import { describe, expect, it } from "vitest";
import { fingerprintCart } from "../../src/commerce/idempotency.js";
import {
  CartSchema,
  IdempotencyKeySchema,
  MAX_CART_LINES,
  MAX_ITEM_QUANTITY,
} from "../../src/commerce/validation.js";

describe("commerce request validation", () => {
  it("accepts identifiers and bounded integer quantities", () => {
    expect(CartSchema.parse({ items: [{ productId: "lp-01", quantity: 2 }] })).toEqual({
      items: [{ productId: "lp-01", quantity: 2 }],
    });
  });

  it("rejects injected prices, totals, currencies, and user IDs", () => {
    for (const injected of [
      { price: 1 },
      { subtotal: 1 },
      { total: 1 },
      { currency: "USD" },
      { userId: "another-user" },
    ]) {
      expect(() =>
        CartSchema.parse({ items: [{ productId: "lp-01", quantity: 1 }], ...injected }),
      ).toThrow();
    }
  });

  it("rejects duplicate, empty, excessive, fractional, and oversized carts", () => {
    expect(() => CartSchema.parse({ items: [] })).toThrow();
    expect(() =>
      CartSchema.parse({
        items: [
          { productId: "lp-01", quantity: 1 },
          { productId: "lp-01", quantity: 1 },
        ],
      }),
    ).toThrow();
    expect(() =>
      CartSchema.parse({ items: [{ productId: "lp-01", quantity: MAX_ITEM_QUANTITY + 1 }] }),
    ).toThrow();
    expect(() => CartSchema.parse({ items: [{ productId: "lp-01", quantity: 1.5 }] })).toThrow();
    expect(() =>
      CartSchema.parse({
        items: Array.from({ length: MAX_CART_LINES + 1 }, (_, index) => ({
          productId: `product-${index}`,
          quantity: 1,
        })),
      }),
    ).toThrow();
  });

  it("requires an opaque bounded idempotency key", () => {
    expect(IdempotencyKeySchema.parse("abc123")).toBe("abc123");
    expect(IdempotencyKeySchema.parse("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(() => IdempotencyKeySchema.parse("short")).toThrow();
    expect(() => IdempotencyKeySchema.parse("not allowed spaces 123")).toThrow();
  });

  it("fingerprints logical carts independently of line ordering", () => {
    const first = CartSchema.parse({
      items: [
        { productId: "lp-01", quantity: 1 },
        { productId: "ac-01", quantity: 2 },
      ],
    });
    const reordered = CartSchema.parse({ items: [...first.items].reverse() });
    const changed = CartSchema.parse({
      items: [
        { productId: "lp-01", quantity: 1 },
        { productId: "ac-01", quantity: 3 },
      ],
    });

    expect(fingerprintCart(reordered)).toBe(fingerprintCart(first));
    expect(fingerprintCart(changed)).not.toBe(fingerprintCart(first));
    expect(fingerprintCart(first)).toMatch(/^[a-f0-9]{64}$/);
  });
});
