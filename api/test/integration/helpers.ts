import { INITIAL_CATALOG } from "../../src/catalog/initial-catalog.js";
import type { DatabaseClient } from "../../src/db/client.js";
import { products } from "../../src/db/schema/commerce.js";

export async function restoreInitialCatalog(database: DatabaseClient): Promise<void> {
  await database.db
    .insert(products)
    .values(
      INITIAL_CATALOG.map((product) => ({
        ...product,
        source: "PLATFORM" as const,
        isActive: true,
        isPurchasable: true,
      })),
    )
    .onConflictDoNothing({ target: products.catalogKey });
}
