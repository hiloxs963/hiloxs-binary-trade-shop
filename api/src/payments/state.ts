export const PAYMENT_ATTEMPT_STATUSES = [
  "INITIATING",
  "PENDING",
  "CONFIRMING",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
  "REVIEW_REQUIRED",
] as const;

export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

export const ACTIVE_PAYMENT_STATUSES = [
  "INITIATING",
  "PENDING",
  "CONFIRMING",
  "UNKNOWN",
  "REVIEW_REQUIRED",
] as const satisfies readonly PaymentAttemptStatus[];

const TRANSITIONS: Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]> = {
  INITIATING: ["PENDING", "FAILED", "UNKNOWN", "CONFIRMING", "REVIEW_REQUIRED"],
  PENDING: ["CONFIRMING", "FAILED", "UNKNOWN", "SUCCEEDED", "REVIEW_REQUIRED"],
  CONFIRMING: ["FAILED", "UNKNOWN", "SUCCEEDED", "REVIEW_REQUIRED"],
  SUCCEEDED: ["REVIEW_REQUIRED"],
  FAILED: ["CONFIRMING", "REVIEW_REQUIRED"],
  UNKNOWN: ["PENDING", "CONFIRMING", "FAILED", "SUCCEEDED", "REVIEW_REQUIRED"],
  REVIEW_REQUIRED: [],
};

export function canTransitionPayment(
  current: PaymentAttemptStatus,
  next: PaymentAttemptStatus,
): boolean {
  return current === next || TRANSITIONS[current].includes(next);
}

export function isActivePaymentStatus(status: PaymentAttemptStatus): boolean {
  return (ACTIVE_PAYMENT_STATUSES as readonly PaymentAttemptStatus[]).includes(status);
}
