import { describe, expect, it } from "vitest";
import {
  CART_REMOVED_MESSAGE,
  omitCartItems,
  reconcileCart,
} from "../../../src/lib/cart-reconcile.js";

describe("reconcileCart", () => {
  it("keeps lines that are in the live catalog and reports none removed", () => {
    const cart = { "seller-abc": 2, "seller-def": 1 };
    const result = reconcileCart(cart, new Set(["seller-abc", "seller-def", "seller-xyz"]));
    expect(result.cart).toEqual(cart);
    expect(result.removed).toEqual([]);
  });

  it("drops lines for removed demo products and keeps the rest with their quantities", () => {
    const result = reconcileCart(
      { "lp-01": 1, "seller-abc": 3, "sp-04": 2 },
      new Set(["seller-abc"]),
    );
    expect(result.cart).toEqual({ "seller-abc": 3 });
    expect(result.removed.sort()).toEqual(["lp-01", "sp-04"]);
  });

  it("empties a cart that holds only removed products without throwing", () => {
    const result = reconcileCart({ "lp-01": 1, "wf-02": 4 }, new Set());
    expect(result.cart).toEqual({});
    expect(result.removed).toHaveLength(2);
  });

  it("handles an empty cart", () => {
    expect(reconcileCart({}, new Set(["seller-abc"]))).toEqual({ cart: {}, removed: [] });
  });

  it("does not mutate the cart it was given", () => {
    const cart = { "lp-01": 1, "seller-abc": 1 };
    reconcileCart(cart, new Set(["seller-abc"]));
    expect(cart).toEqual({ "lp-01": 1, "seller-abc": 1 });
  });

  it("is idempotent: reconciling an already reconciled cart removes nothing", () => {
    const first = reconcileCart({ "lp-01": 1, "seller-abc": 1 }, new Set(["seller-abc"]));
    const second = reconcileCart(first.cart, new Set(["seller-abc"]));
    expect(second.removed).toEqual([]);
    expect(second.cart).toEqual(first.cart);
  });

  it("uses the one-line notice wording agreed for shoppers", () => {
    expect(CART_REMOVED_MESSAGE).toBe(
      "Some items are no longer available and were removed from your cart.",
    );
  });
});

describe("omitCartItems", () => {
  it("removes only the listed ids and ignores unknown ones", () => {
    expect(omitCartItems({ a: 1, b: 2, c: 3 }, ["b", "zzz"])).toEqual({ a: 1, c: 3 });
  });

  it("returns the cart unchanged for an empty list", () => {
    expect(omitCartItems({ a: 1 }, [])).toEqual({ a: 1 });
  });
});
