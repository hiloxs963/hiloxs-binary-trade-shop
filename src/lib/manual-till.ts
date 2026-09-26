import { SUPPORT } from "./hiloxs";

/**
 * Informational manual-payment details served by the API while public STK push is gated off.
 * Seeing these does not mean an order is paid: HILOXS staff confirm each payment by hand.
 */
export type ManualTillConfig = {
  enabled: boolean;
  kind: "TILL" | "PAYBILL" | null;
  number: string | null;
  instructions: string;
};

export type ManualTillDetails = {
  kind: "TILL" | "PAYBILL";
  number: string;
  instructions: string;
};

/** Narrows the served config to displayable details, or null when manual payment is off. */
export function manualTillDetails(
  config: ManualTillConfig | null | undefined,
): ManualTillDetails | null {
  if (!config?.enabled || !config.kind || !config.number) return null;
  return { kind: config.kind, number: config.number, instructions: config.instructions };
}

export function manualTillLabel(kind: ManualTillDetails["kind"]): string {
  return kind === "PAYBILL" ? "M-Pesa paybill number" : "M-Pesa till number";
}

/**
 * wa.me expects the international number without the leading plus or any separators.
 */
export function supportWhatsAppLink(message: string): string {
  const digits = SUPPORT.phoneHref.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
