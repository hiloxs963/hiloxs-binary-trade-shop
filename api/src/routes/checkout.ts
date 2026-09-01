import type { FastifyInstance } from "fastify";
import { requireActiveUser } from "../auth/active-user.js";
import type { AuthService } from "../auth/auth.js";
import { priceCart, serializePricedCart } from "../commerce/pricing.js";
import { CartSchema } from "../commerce/validation.js";
import type { DatabaseClient } from "../db/client.js";

export function registerCheckoutRoute(
  app: FastifyInstance,
  options: { auth: AuthService; database: DatabaseClient },
): void {
  app.post("/api/v1/checkout/quote", async (request) => {
    await requireActiveUser(options.auth, options.database, request.headers);
    const input = CartSchema.parse(request.body);
    return { quote: serializePricedCart(await priceCart(options.database.db, input)) };
  });
}
