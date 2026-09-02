export type SellerType = "COMPANY" | "REGISTERED_BUSINESS" | "SOLE_PROPRIETOR";

export type SellerApplicationStatus =
  "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export type SellerDraftInput = {
  sellerType: SellerType;
  legalName: string;
  tradingName?: string;
  registrationNumber?: string;
  kraPin?: string;
};

export type SellerApplication = {
  id: string;
  sellerType: SellerType;
  legalName: string;
  tradingName: string | null;
  registrationNumber: string | null;
  kraPin: string | null;
  status: SellerApplicationStatus;
  reviewReason: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SellerApplicationState = {
  application: SellerApplication | null;
  termsVersion: string;
};

type ApiErrorBody = {
  error?: { code?: string; message?: string };
};

const configuredApiOrigin = import.meta.env["VITE_API_URL"]?.trim().replace(/\/$/, "");
const API_ORIGIN = configuredApiOrigin || (import.meta.env.DEV ? "" : "https://api.hiloxs.co.ke");

export class SellerApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "SELLER_REQUEST_FAILED") {
    super(message);
    this.name = "SellerApiError";
    this.status = status;
    this.code = code;
  }
}

export async function getSellerApplication(): Promise<SellerApplicationState> {
  return send("/api/v1/seller/application", { method: "GET" }, "Unable to load the application");
}

export async function createSellerApplication(
  input: SellerDraftInput,
): Promise<SellerApplicationState> {
  return send(
    "/api/v1/seller/application",
    { method: "POST", body: JSON.stringify(input) },
    "Unable to create the application",
  );
}

export async function updateSellerApplication(
  input: SellerDraftInput,
): Promise<SellerApplicationState> {
  return send(
    "/api/v1/seller/application/edit",
    { method: "POST", body: JSON.stringify(input) },
    "Unable to save the application",
  );
}

export async function submitSellerApplication(
  termsVersion: string,
): Promise<SellerApplicationState> {
  return send(
    "/api/v1/seller/application/submit",
    { method: "POST", body: JSON.stringify({ termsAccepted: true, termsVersion }) },
    "Unable to submit the application",
  );
}

export async function withdrawSellerApplication(): Promise<SellerApplicationState> {
  return send(
    "/api/v1/seller/application/withdraw",
    { method: "POST", body: JSON.stringify({}) },
    "Unable to withdraw the application",
  );
}

async function send(
  path: string,
  init: RequestInit,
  fallback: string,
): Promise<SellerApplicationState> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...init.headers,
    },
  });
  if (!response.ok) throw await toSellerError(response, fallback);
  return (await response.json()) as SellerApplicationState;
}

async function toSellerError(response: Response, fallback: string): Promise<SellerApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Do not expose malformed upstream details to the applicant.
  }
  return new SellerApiError(body.error?.message || fallback, response.status, body.error?.code);
}
