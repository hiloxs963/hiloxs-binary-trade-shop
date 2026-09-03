export type StaffPermission = "SELLER_REVIEW" | "PRODUCT_REVIEW" | "CATALOG_ACTIVATE";
export type StaffProfile = {
  role: "STAFF" | "ADMIN";
  permissions: StaffPermission[];
  reviewEnabled: boolean;
  catalogActivationEnabled: boolean;
  mfaEnabled: true;
};

export type StaffSellerMedia = {
  id: string;
  status: string;
  detectedMime: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  selectedForActivation: boolean;
  processedAt: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
};

export type ActivationReadiness = {
  ready: boolean;
  activation: { productId: string; slug: string; active: boolean } | null;
  checks: Record<string, boolean>;
};

export type StaffSellerApplication = {
  id: string;
  sellerType: string;
  legalName: string;
  tradingName: string | null;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  registrationNumber?: string | null;
  kraPin?: string | null;
  reviewReason?: string | null;
};

export type StaffSellerProduct = {
  id: string;
  sellerApplicationId: string;
  name: string;
  category: string;
  description?: string;
  priceMinor: string;
  currency: string;
  status: string;
  submittedAt: string | null;
  reviewStartedAt?: string | null;
  reviewedAt: string | null;
  seller?: {
    sellerType: string;
    legalName: string;
    tradingName: string | null;
    status: string;
  };
};

export class StaffApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "StaffApiError";
  }
}

const configuredApiOrigin = import.meta.env["VITE_API_URL"]?.trim().replace(/\/$/, "");
const API_ORIGIN = configuredApiOrigin || (import.meta.env.DEV ? "" : "https://api.hiloxs.co.ke");

export async function getStaffProfile(): Promise<StaffProfile | null> {
  const response = await request("/api/v1/staff/me", { method: "GET" });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw await toError(response);
  return ((await response.json()) as { staff: StaffProfile }).staff;
}

export async function getStaffSellerApplications(status?: string) {
  const response = await request(queueUrl("/api/v1/staff/seller-applications", status), {
    method: "GET",
  });
  if (!response.ok) throw await toError(response);
  return (await response.json()) as { items: StaffSellerApplication[]; hasMore: boolean };
}

export async function getStaffSellerApplication(id: string) {
  const response = await request(`/api/v1/staff/seller-applications/${id}`, { method: "GET" });
  if (!response.ok) throw await toError(response);
  return ((await response.json()) as { application: StaffSellerApplication }).application;
}

export async function getStaffSellerProducts(status?: string) {
  const response = await request(queueUrl("/api/v1/staff/seller-products", status), {
    method: "GET",
  });
  if (!response.ok) throw await toError(response);
  return (await response.json()) as { items: StaffSellerProduct[]; hasMore: boolean };
}

export async function getStaffSellerProduct(id: string) {
  const response = await request(`/api/v1/staff/seller-products/${id}`, { method: "GET" });
  if (!response.ok) throw await toError(response);
  return ((await response.json()) as { submission: StaffSellerProduct }).submission;
}

export async function reviewStaffItem(
  kind: "seller-applications" | "seller-products",
  id: string,
  action: "start-review" | "approve" | "reject",
  reason?: string,
): Promise<void> {
  const response = await request(`/api/v1/staff/${kind}/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify(action === "reject" ? { reason } : {}),
  });
  if (!response.ok) throw await toError(response);
}

export async function getStaffSellerMedia(submissionId: string) {
  const response = await request(`/api/v1/staff/seller-products/${submissionId}/media`, {
    method: "GET",
  });
  if (!response.ok) throw await toError(response);
  return (await response.json()) as { media: StaffSellerMedia[]; reviewEnabled: boolean };
}

export async function reviewStaffSellerMedia(
  mediaId: string,
  action: "approve" | "reject",
  reason?: string,
): Promise<void> {
  const response = await request(`/api/v1/staff/seller-product-media/${mediaId}/${action}`, {
    method: "POST",
    body: JSON.stringify(action === "reject" ? { reason } : {}),
  });
  if (!response.ok) throw await toError(response);
}

export async function getActivationReadiness(submissionId: string) {
  const response = await request(
    `/api/v1/staff/seller-products/${submissionId}/activation-readiness`,
    { method: "GET" },
  );
  if (!response.ok) throw await toError(response);
  return (await response.json()) as {
    readiness: ActivationReadiness;
    activationEnabled: boolean;
  };
}

export async function activateStaffSellerProduct(submissionId: string): Promise<void> {
  const response = await request(`/api/v1/staff/seller-products/${submissionId}/activate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!response.ok) throw await toError(response);
}

export async function deactivateStaffSellerProduct(submissionId: string): Promise<void> {
  const response = await request(`/api/v1/staff/seller-products/${submissionId}/deactivate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!response.ok) throw await toError(response);
}

export function staffMediaPreviewUrl(
  submissionId: string,
  mediaId: string,
  variant: "THUMBNAIL" | "MEDIUM" | "LARGE" = "MEDIUM",
): string {
  return `${API_ORIGIN}/api/v1/staff/seller-products/${encodeURIComponent(submissionId)}/media/${encodeURIComponent(mediaId)}/preview/${variant}`;
}

function queueUrl(path: string, status?: string): string {
  const query = new URLSearchParams({ limit: "25", ...(status ? { status } : {}) });
  return `${path}?${query.toString()}`;
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

async function toError(response: Response): Promise<StaffApiError> {
  let body: { error?: { code?: string; message?: string } } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Keep malformed upstream details out of the interface.
  }
  return new StaffApiError(
    body.error?.message ?? "The staff request could not be completed",
    response.status,
    body.error?.code ?? "STAFF_REQUEST_FAILED",
  );
}
