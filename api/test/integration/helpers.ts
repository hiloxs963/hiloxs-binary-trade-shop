import { TEST_CATALOG } from "./catalog-fixture.js";
import type { DatabaseClient } from "../../src/db/client.js";
import { products } from "../../src/db/schema/commerce.js";

export async function restoreTestCatalog(database: DatabaseClient): Promise<void> {
  await database.db
    .insert(products)
    .values(
      TEST_CATALOG.map((product) => ({
        ...product,
        source: "PLATFORM" as const,
        isActive: true,
        isPurchasable: true,
      })),
    )
    .onConflictDoNothing({ target: products.catalogKey });
}
