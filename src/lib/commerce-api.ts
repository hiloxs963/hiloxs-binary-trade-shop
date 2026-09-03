import type { PaymentConfig } from "./mpesa-availability";

export { mpesaAvailabilityForOrder } from "./mpesa-availability";
export type { MpesaOrderAvailability, PaymentConfig } from "./mpesa-availability";

export type CartRequestItem = {
  productId: string;
  quantity: number;
};

export type QuoteItem = {
  productId: string;
  name: string;
  slug: string;
  unitPriceMinor: string;
  quantity: number;
  lineTotalMinor: string;
};

export type CheckoutQuote = {
  currency: "KES";
  subtotalMinor: string;
  totalMinor: string;
  items: QuoteItem[];
  deliveryRequired?: boolean;
};

export type DeliveryAddress = {
  recipientName: string;
  phone: string;
  county: string;
  town: string;
  addressLine: string;
  landmark?: string;
};

export type OrderFulfillment = {
  id: string;
  status:
    | "AWAITING_PAYMENT"
    | "READY_FOR_SELLER"
    | "ACCEPTED"
    | "PREPARING"
    | "DISPATCHED"
    | "DELIVERED"
    | "FULFILLMENT_ISSUE"
    | "CANCELLED";
  carrier: string | null;
  trackingReference: string | null;
  issueReason: string | null;
  issueMessage: string | null;
  deliveredAt: string | null;
  items: CommerceOrder["items"];
};

export type CommerceOrder = {
  id: string;
  orderNumber: string;
  status:
    | "PENDING_PAYMENT"
    | "PAYMENT_REVIEW_REQUIRED"
    | "PAID"
    | "PROCESSING"
    | "COMPLETED"
    | "CANCELLED"
    | "REFUNDED";
  currency: "KES";
  subtotalMinor: string;
  totalMinor: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    productId: string;
    productName: string;
    productSlug: string;
    unitPriceMinor: string;
    quantity: number;
    lineTotalMinor: string;
  }>;
  shippingMinor?: string;
  reservationExpiresAt?: string | null;
  deliveryAddress?: DeliveryAddress | null;
  fulfillments?: OrderFulfillment[];
};

export type PaymentAttemptStatus =
  "INITIATING" | "PENDING" | "CONFIRMING" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "REVIEW_REQUIRED";

export type OrderPaymentStatus = {
  orderId: string;
  orderStatus: CommerceOrder["status"];
  paymentAttemptId: string | null;
  paymentStatus: PaymentAttemptStatus | null;
  amountMinor?: string;
  currency?: "KES";
  updatedAt?: string;
  receiptNumber?: string;
};

type ApiErrorBody = {
  error?: { code?: string; message?: string };
};

const configuredApiOrigin = import.meta.env["VITE_API_URL"]?.trim().replace(/\/$/, "");
const API_ORIGIN = configuredApiOrigin || (import.meta.env.DEV ? "" : "https://api.hiloxs.co.ke");

export class CommerceApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "COMMERCE_REQUEST_FAILED") {
    super(message);
    this.name = "CommerceApiError";
    this.status = status;
    this.code = code;
  }
}

export async function getCheckoutQuote(items: CartRequestItem[]): Promise<CheckoutQuote> {
  const response = await request("/api/v1/checkout/quote", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
  if (!response.ok) throw await toCommerceError(response, "Unable to confirm current prices");
  return ((await response.json()) as { quote: CheckoutQuote }).quote;
}

export async function createOrder(
  items: CartRequestItem[],
  idempotencyKey: string,
  deliveryAddress?: DeliveryAddress,
): Promise<CommerceOrder> {
  const response = await request("/api/v1/orders", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ items, ...(deliveryAddress ? { deliveryAddress } : {}) }),
  });
  if (!response.ok) throw await toCommerceError(response, "Unable to create the order");
  return ((await response.json()) as { order: CommerceOrder }).order;
}

export async function confirmOrderDelivery(orderId: string, fulfillmentId: string): Promise<void> {
  const response = await request(
    `/api/v1/orders/${encodeURIComponent(orderId)}/fulfillments/${encodeURIComponent(fulfillmentId)}/confirm-delivery`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (!response.ok) throw await toCommerceError(response, "Unable to confirm delivery");
}

export async function getOrders(): Promise<CommerceOrder[]> {
  const response = await request("/api/v1/orders", { method: "GET" });
  if (!response.ok) throw await toCommerceError(response, "Unable to load orders");
  return ((await response.json()) as { orders: CommerceOrder[] }).orders;
}

export async function getPaymentConfig(): Promise<PaymentConfig> {
  const response = await request("/api/v1/payments/config", { method: "GET" });
  if (!response.ok) throw await toCommerceError(response, "Unable to load payment availability");
  return (await response.json()) as PaymentConfig;
}

export async function cancelOrder(orderId: string): Promise<CommerceOrder> {
  const response = await request(`/api/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!response.ok) throw await toCommerceError(response, "Unable to cancel the order");
  return ((await response.json()) as { order: CommerceOrder }).order;
}

export async function initiateMpesaPayment(
  orderId: string,
  phone: string,
  idempotencyKey: string,
): Promise<OrderPaymentStatus> {
  const response = await request(`/api/v1/orders/${encodeURIComponent(orderId)}/payments/mpesa`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ phone }),
  });
  if (!response.ok) throw await toCommerceError(response, "Unable to send the M-Pesa prompt");
  return ((await response.json()) as { payment: OrderPaymentStatus }).payment;
}

export async function getOrderPaymentStatus(orderId: string): Promise<OrderPaymentStatus> {
  const response = await request(`/api/v1/orders/${encodeURIComponent(orderId)}/payment`, {
    method: "GET",
  });
  if (!response.ok) throw await toCommerceError(response, "Unable to load payment status");
  return ((await response.json()) as { payment: OrderPaymentStatus }).payment;
}

export async function refreshMpesaPayment(orderId: string): Promise<OrderPaymentStatus> {
  const response = await request(
    `/api/v1/orders/${encodeURIComponent(orderId)}/payments/mpesa/refresh`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (!response.ok) throw await toCommerceError(response, "Unable to check the M-Pesa status");
  return ((await response.json()) as { payment: OrderPaymentStatus }).payment;
}

export function formatMoneyMinor(value: string, currency: string): string {
  const minor = BigInt(value);
  const major = minor / 100n;
  const fraction = (minor % 100n).toString().padStart(2, "0");
  const whole = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(major);
  return `${currency === "KES" ? "KSh" : currency} ${whole}.${fraction}`;
}

function request(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...init.headers,
    },
  });
}

async function toCommerceError(response: Response, fallback: string): Promise<CommerceApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Keep malformed upstream details out of the customer interface.
  }
  return new CommerceApiError(body.error?.message || fallback, response.status, body.error?.code);
}
