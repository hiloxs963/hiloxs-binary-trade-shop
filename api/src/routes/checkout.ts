import type { FastifyInstance } from "fastify";
import { requireActiveUser } from "../auth/active-user.js";
import type { AuthService } from "../auth/auth.js";
import { priceCart, serializePricedCart } from "../commerce/pricing.js";
import { CartSchema } from "../commerce/validation.js";
import type { DatabaseClient } from "../db/client.js";
import { RATE_LIMITS, type RateLimiter } from "../commerce/rate-limit.js";

export function registerCheckoutRoute(
  app: FastifyInstance,
  options: {
    auth: AuthService;
    database: DatabaseClient;
    sellerCommerceEnabled: boolean;
    rateLimiter: RateLimiter;
  },
): void {
  app.post("/api/v1/checkout/quote", async (request) => {
    const owner = await requireActiveUser(options.auth, options.database, request.headers);
    await options.rateLimiter.consume({
      scope: "checkout-quote",
      key: owner.id,
      ...RATE_LIMITS.quote,
    });
    const input = CartSchema.parse(request.body);
    return {
      quote: serializePricedCart(
        await priceCart(options.database.db, input, {
          sellerCommerceEnabled: options.sellerCommerceEnabled,
        }),
      ),
    };
  });
}
