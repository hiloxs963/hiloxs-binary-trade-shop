export type SellerCatalogProduct = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  commerceEnabled: boolean;
  effectivePurchasable: boolean;
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number;
  version: number;
};

export type SellerFulfillment = {
  id: string;
  orderNumber: string;
  status: string;
  orderStatus: string;
  currency: string;
  carrier?: string | null;
  trackingReference?: string | null;
  issueReason?: string | null;
  issueMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: Array<{
    productName: string;
    quantity: number;
    unitPriceMinor: string;
    lineTotalMinor: string;
  }>;
  deliveryAddress?: {
    recipientName: string;
    phone: string;
    county: string;
    town: string;
    addressLine: string;
    landmark: string | null;
  };
};

export type FulfillmentConfigState = {
  termsVersion: string;
  terms: readonly string[];
  config: { termsVersion: string; termsAcceptedAt: string } | null;
};

const configuredApiOrigin = import.meta.env["VITE_API_URL"]?.trim().replace(/\/$/, "");
const API_ORIGIN = configuredApiOrigin || (import.meta.env.DEV ? "" : "https://api.hiloxs.co.ke");

export async function getFulfillmentConfig(): Promise<FulfillmentConfigState> {
  return sellerRequest("/api/v1/seller/fulfillment-config", { method: "GET" });
}

export async function acceptFulfillmentTerms(): Promise<void> {
  await sellerRequest("/api/v1/seller/fulfillment-config", {
    method: "PUT",
    body: JSON.stringify({ termsAccepted: true }),
  });
}

export async function getSellerCatalogProducts(): Promise<SellerCatalogProduct[]> {
  const result = await sellerRequest<{ products: SellerCatalogProduct[] }>(
    "/api/v1/seller/catalog-products",
    { method: "GET" },
  );
  return result.products;
}

export async function updateSellerInventory(productId: string, quantityOnHand: number) {
  return sellerRequest<{ inventory: SellerCatalogProduct }>(
    `/api/v1/seller/catalog-products/${encodeURIComponent(productId)}/inventory`,
    { method: "POST", body: JSON.stringify({ quantityOnHand }) },
  );
}

export async function getSellerOrders(): Promise<SellerFulfillment[]> {
  const result = await sellerRequest<{ items: SellerFulfillment[] }>(
    "/api/v1/seller/orders?limit=25",
    { method: "GET" },
  );
  return result.items;
}

export async function getSellerOrder(id: string): Promise<SellerFulfillment> {
  const result = await sellerRequest<{ fulfillment: SellerFulfillment }>(
    `/api/v1/seller/orders/${encodeURIComponent(id)}`,
    { method: "GET" },
  );
  return result.fulfillment;
}

export async function actOnSellerOrder(
  id: string,
  action: "accept" | "prepare" | "dispatch" | "issue",
  body: Record<string, string> = {},
): Promise<SellerFulfillment> {
  const result = await sellerRequest<{ fulfillment: SellerFulfillment }>(
    `/api/v1/seller/orders/${encodeURIComponent(id)}/${action}`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return result.fulfillment;
}

async function sellerRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
  });
  if (!response.ok) throw new Error("The seller operation could not be completed");
  return (await response.json()) as T;
}
