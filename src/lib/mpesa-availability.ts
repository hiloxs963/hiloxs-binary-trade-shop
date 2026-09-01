export type PaymentConfig = {
  mpesa: {
    available: boolean;
    mode: "sandbox" | "production";
  };
};

export type MpesaOrderAvailability = {
  canInitiate: boolean;
  sandboxTest: boolean;
};

export function mpesaAvailabilityForOrder(
  config: PaymentConfig | null | undefined,
  orderNumber: string,
): MpesaOrderAvailability {
  const sandboxTest = config?.mpesa.mode === "sandbox" && orderNumber.startsWith("HX-SBX-");
  const publicProductionPayment = config?.mpesa.mode === "production" && config.mpesa.available;
  return {
    canInitiate: publicProductionPayment || sandboxTest,
    sandboxTest,
  };
}
