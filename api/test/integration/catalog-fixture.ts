export const TEST_CATALOG_CURRENCY = "KES" as const;

export type TestCatalogProduct = {
  catalogKey: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  priceMinor: bigint;
  currency: typeof TEST_CATALOG_CURRENCY;
  sortOrder: number;
};

/**
 * Minimal platform catalog for the commerce, payment and seller suites.
 *
 * The shipped catalog holds no platform products any more, so these exist only in the
 * ephemeral integration-test database. They are deliberately named as fixtures: nothing
 * here should ever be seeded into a real environment, and no migration creates them.
 */
export const TEST_CATALOG = [
  {
    catalogKey: "test-product-a",
    slug: "test-platform-product-a",
    name: "Test Platform Product A",
    category: "Laptops",
    description: "Fixture product for server-authoritative commerce tests.",
    priceMinor: 7_850_000n,
    currency: TEST_CATALOG_CURRENCY,
    sortOrder: 0,
  },
  {
    catalogKey: "test-product-b",
    slug: "test-platform-product-b",
    name: "Test Platform Product B",
    category: "Laptops",
    description: "Second fixture product, for multi-line cart and quote tests.",
    priceMinor: 5_200_000n,
    currency: TEST_CATALOG_CURRENCY,
    sortOrder: 1,
  },
] as const satisfies readonly TestCatalogProduct[];
