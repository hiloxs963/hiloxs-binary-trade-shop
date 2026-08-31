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
