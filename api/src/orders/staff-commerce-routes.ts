import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth.js";
import { EmptyBodySchema } from "../commerce/validation.js";
import type { DatabaseClient } from "../db/client.js";
import { requireStaffPermission } from "../staff/authorization.js";
import { getCommerceReadiness, setSellerCommerce } from "./staff-commerce-service.js";
import { SellerCatalogProductIdSchema } from "./validation.js";

export function registerStaffCommerceRoutes(
  app: FastifyInstance,
  options: { auth: AuthService; database: DatabaseClient; sellerCommerceEnabled: boolean },
): void {
  app.get("/api/v1/staff/catalog-products/:productId/commerce-readiness", async (request) => {
    await requireStaffPermission(
      options.auth,
      options.database,
      request.headers,
      "SELLER_COMMERCE_ACTIVATE",
    );
    return {
      readiness: await getCommerceReadiness(
        options.database,
        productIdFrom(request.params),
        options.sellerCommerceEnabled,
      ),
    };
  });

  for (const action of ["enable-commerce", "pause-commerce"] as const) {
    app.post(`/api/v1/staff/catalog-products/:productId/${action}`, async (request) => {
      const authorization = await requireStaffPermission(
        options.auth,
        options.database,
        request.headers,
        "SELLER_COMMERCE_ACTIVATE",
        { recent: true },
      );
      EmptyBodySchema.parse(request.body ?? {});
      const product = await setSellerCommerce(
        options.database,
        authorization,
        productIdFrom(request.params),
        action === "enable-commerce",
        options.sellerCommerceEnabled,
        request.id,
      );
      return { product: { id: product.id, isPurchasable: product.isPurchasable } };
    });
  }
}

function productIdFrom(params: unknown): string {
  return SellerCatalogProductIdSchema.parse((params as { productId?: unknown }).productId);
}
