import { createHash } from "node:crypto";

export const MPESA_TRANSACTION_DESCRIPTION = "HILOXS ORDER";

export function accountReferenceForOrder(orderId: string): string {
  const normalized = orderId.toLowerCase();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(normalized)) {
    throw new TypeError("M-Pesa account reference requires a valid order UUID");
  }
  const identityHash = createHash("sha256").update(normalized).digest("hex");
  return `HX${identityHash.slice(0, 10).toUpperCase()}`;
}

export type MpesaInitiationInput = {
  amountKes: bigint;
  phoneE164: string;
  callbackURL: string;
  accountReference: string;
  transactionDescription: string;
};

export type MpesaInitiationResult = {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
};

export type MpesaQueryResult = {
  merchantRequestId?: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDescription: string;
};

export interface MpesaProvider {
  initiate(input: MpesaInitiationInput): Promise<MpesaInitiationResult>;
  query(checkoutRequestId: string): Promise<MpesaQueryResult>;
}

export class MpesaProviderError extends Error {
  readonly ambiguous: boolean;
  readonly providerCode?: string;

  constructor(
    message: string,
    options: { ambiguous: boolean; providerCode?: string; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MpesaProviderError";
    this.ambiguous = options.ambiguous;
    if (options.providerCode !== undefined) this.providerCode = options.providerCode;
  }
}
