import type { FastifyInstance } from "fastify";
import { MANUAL_TILL_DISABLED, type ManualTillConfig } from "../config/env.js";

/**
 * Informational manual-payment details, served separately from `/api/v1/payments/config`.
 *
 * The STK config response deliberately exposes no merchant identifier, and an integration test
 * pins that. Manual payment needs the opposite: the buyer cannot pay without seeing the number.
 * Keeping the two responses apart preserves that invariant instead of widening it, and leaves this
 * route available even when Daraja is not configured at all — which is exactly the situation
 * manual payment exists to cover.
 *
 * This route is read-only and creates no order, payment attempt, or status change.
 */
export function registerManualTillRoute(
  app: FastifyInstance,
  options: { config?: ManualTillConfig } = {},
): void {
  const config = options.config ?? MANUAL_TILL_DISABLED;
  app.get("/api/v1/payments/manual-till", () => ({ manualTill: config }));
}
