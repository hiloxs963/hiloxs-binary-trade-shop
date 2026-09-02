import { describe, expect, it } from "vitest";
import {
  MAX_SELLER_PRODUCT_PRICE_MINOR,
  minorToKesInput,
  parseKesPriceToMinor,
} from "../../../src/lib/seller-product-money.js";

describe("seller product browser money conversion", () => {
  it("converts KSh decimal strings to minor-unit integer strings exactly", () => {
    expect(parseKesPriceToMinor("0.01")).toBe("1");
    expect(parseKesPriceToMinor("2899")).toBe("289900");
    expect(parseKesPriceToMinor("2899.5")).toBe("289950");
    expect(parseKesPriceToMinor(" 2899.00 ")).toBe("289900");
    expect(parseKesPriceToMinor("10000000.00")).toBe(MAX_SELLER_PRODUCT_PRICE_MINOR.toString());
  });

  it("rejects non-decimal, non-positive, over-precise, malformed, and oversized values", () => {
    for (const value of [
      "",
      "0",
      "0.00",
      "-1",
      "1.001",
      "1e3",
      "NaN",
      "Infinity",
      "01.00",
      "1,000.00",
      "10000000.01",
    ]) {
      expect(() => parseKesPriceToMinor(value)).toThrow();
    }
  });

  it("formats stored minor units without floating-point arithmetic", () => {
    expect(minorToKesInput("1")).toBe("0.01");
    expect(minorToKesInput("289900")).toBe("2899.00");
  });
});
