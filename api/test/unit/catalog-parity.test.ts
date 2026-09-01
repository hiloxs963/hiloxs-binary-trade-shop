import { describe, expect, it } from "vitest";
import { PRODUCTS, productSlug } from "../../../src/lib/hiloxs.js";
import { INITIAL_CATALOG } from "../../src/catalog/initial-catalog.js";

describe("initial commerce catalog", () => {
  it("matches all 44 approved frontend products without price changes", () => {
    expect(INITIAL_CATALOG).toHaveLength(44);
    expect(INITIAL_CATALOG.map(toComparableServerProduct)).toEqual(
      PRODUCTS.map((product, sortOrder) => ({
        catalogKey: product.id,
        slug: productSlug(product),
        name: product.name,
        category: product.category,
        description: product.blurb,
        priceMinor: BigInt(product.priceKes) * 100n,
        currency: "KES",
        sortOrder,
      })),
    );
  });

  it("contains no duplicate keys or slugs", () => {
    expect(new Set(INITIAL_CATALOG.map((product) => product.catalogKey)).size).toBe(44);
    expect(new Set(INITIAL_CATALOG.map((product) => product.slug)).size).toBe(44);
  });
});

function toComparableServerProduct(product: (typeof INITIAL_CATALOG)[number]) {
  return { ...product };
}
