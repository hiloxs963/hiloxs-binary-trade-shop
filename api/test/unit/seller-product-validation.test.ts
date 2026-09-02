import { describe, expect, it } from "vitest";
import { PRODUCT_CATEGORIES } from "../../src/catalog/categories.js";
import {
  MAX_SELLER_PRODUCT_PRICE_MINOR,
  SELLER_PRODUCT_TERMS_VERSION,
} from "../../src/seller-products/model.js";
import {
  SellerProductConsentSchema,
  SellerProductDraftSchema,
} from "../../src/seller-products/validation.js";

describe("seller product validation", () => {
  it.each(PRODUCT_CATEGORIES)("accepts the catalog category %s", (category) => {
    expect(SellerProductDraftSchema.parse({ ...validDraft(), category }).category).toBe(category);
  });

  it("normalizes plain text and parses integer minor units exactly", () => {
    expect(
      SellerProductDraftSchema.parse({
        ...validDraft(),
        name: "  Handcrafted   Desk Lamp  ",
        description: "  A carefully   described lamp for a home workspace.  ",
        priceMinor: "289900",
      }),
    ).toEqual({
      name: "Handcrafted Desk Lamp",
      category: "Home & Kitchen",
      description: "A carefully described lamp for a home workspace.",
      priceMinor: 289_900n,
    });
  });

  it("enforces positive decimal integer minor units and the application ceiling", () => {
    expect(parsePrice("1")).toBe(1n);
    expect(parsePrice(MAX_SELLER_PRODUCT_PRICE_MINOR.toString())).toBe(
      MAX_SELLER_PRODUCT_PRICE_MINOR,
    );
    for (const value of [
      "0",
      "-1",
      "1.00",
      "1e3",
      "NaN",
      "Infinity",
      "01",
      (MAX_SELLER_PRODUCT_PRICE_MINOR + 1n).toString(),
    ]) {
      expect(
        SellerProductDraftSchema.safeParse({ ...validDraft(), priceMinor: value }).success,
      ).toBe(false);
    }
  });

  it("rejects unsupported categories and browser-authoritative fields", () => {
    expect(
      SellerProductDraftSchema.safeParse({ ...validDraft(), category: "Unreviewed Category" })
        .success,
    ).toBe(false);
    for (const field of [
      "userId",
      "sellerApplicationId",
      "status",
      "reviewReason",
      "reviewedAt",
      "termsAcceptedAt",
      "imageUrl",
      "stock",
      "payoutAccount",
    ]) {
      expect(
        SellerProductDraftSchema.safeParse({ ...validDraft(), [field]: "injected" }).success,
      ).toBe(false);
    }
  });

  it("rejects markup, scripts, control characters, bidi tricks, and oversized text", () => {
    for (const name of [
      "<b>Product</b>",
      "javascript:alert(1)",
      "Bad\u0000Name",
      "Bad\u202eName",
    ]) {
      expect(SellerProductDraftSchema.safeParse({ ...validDraft(), name }).success).toBe(false);
    }
    for (const description of [
      "<script>alert(1)</script> with more product detail",
      "An otherwise useful description\nwith an unexpected newline.",
      `Description with a bidi override \u202e${"x".repeat(20)}`,
      "x".repeat(5_001),
    ]) {
      expect(SellerProductDraftSchema.safeParse({ ...validDraft(), description }).success).toBe(
        false,
      );
    }
    expect(
      SellerProductDraftSchema.safeParse({ ...validDraft(), name: "x".repeat(161) }).success,
    ).toBe(false);
  });

  it("requires explicit current product terms without extra authority fields", () => {
    expect(
      SellerProductConsentSchema.parse({
        termsAccepted: true,
        termsVersion: SELLER_PRODUCT_TERMS_VERSION,
      }),
    ).toEqual({ termsAccepted: true, termsVersion: SELLER_PRODUCT_TERMS_VERSION });
    for (const body of [
      { termsAccepted: false, termsVersion: SELLER_PRODUCT_TERMS_VERSION },
      { termsAccepted: true, termsVersion: "seller-product-terms-v0" },
      {
        termsAccepted: true,
        termsVersion: SELLER_PRODUCT_TERMS_VERSION,
        submittedAt: new Date().toISOString(),
      },
    ]) {
      expect(SellerProductConsentSchema.safeParse(body).success).toBe(false);
    }
  });
});

function validDraft(): Record<string, unknown> {
  return {
    name: "Handcrafted Desk Lamp",
    category: "Home & Kitchen",
    description: "A carefully described lamp for a home workspace.",
    priceMinor: "289900",
  };
}

function parsePrice(priceMinor: string): bigint {
  return SellerProductDraftSchema.parse({ ...validDraft(), priceMinor }).priceMinor;
}
