import { ValidationError } from "../lib/errors.js";

export function minorKesToWholeKes(
  amountMinor: bigint,
  currency: string,
  maximumKes: bigint,
): bigint {
  if (currency !== "KES" || amountMinor <= 0n || amountMinor % 100n !== 0n) {
    throw new ValidationError("This order total cannot be paid through M-Pesa");
  }
  const amountKes = amountMinor / 100n;
  if (amountKes > maximumKes) {
    throw new ValidationError("This order total exceeds the configured M-Pesa payment limit");
  }
  return amountKes;
}
