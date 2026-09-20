import type { ShopCategory } from "@/lib/hiloxs";

export type SellerProductStatus =
  "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export type SellerProductDraftInput = {
  name: string;
  category: ShopCategory;
  description: string;
  priceMinor: string;
};

export type SellerProductSubmission = {
  id: string;
  name: string;
  category: ShopCategory;
  description: string;
  priceMinor: string;
  currency: "KES";
  status: SellerProductStatus;
  reviewReason: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  submittedAt: string | null;
  reviewStartedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SellerProductListState = {
  submissions: SellerProductSubmission[];
  termsVersion: string;
};

export type SellerProductState = {
  submission: SellerProductSubmission;
  termsVersion: string;
};

export type SellerProductMediaStatus =
  | "PENDING_UPLOAD"
  | "UPLOADED"
  | "PROCESSING"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "PROCESSING_FAILED"
  | "ABANDONED";

export type SellerProductMedia = {
  id: string;
  status: SellerProductMediaStatus;
  declaredMime: string;
  declaredSize: number;
  detectedMime: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  selectedForActivation: boolean;
  rightsTermsVersion: string;
  rightsAcceptedAt: string;
  uploadExpiresAt: string;
  processedAt: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  processingError: string | null;
};

export type SellerMediaState = {
  media: SellerProductMedia[];
  rightsTermsVersion: string;
  activated: boolean;
};

export type SellerInventoryState = {
  inventory: {
    quantityAvailable: number;
    version: number;
    configuredAt: string;
    updatedAt: string;
  } | null;
  activated: boolean;
};

type ApiErrorBody = { error?: { code?: string; message?: string } };

const configuredApiOrigin = import.meta.env["VITE_API_URL"]?.trim().replace(/\/$/, "");
const API_ORIGIN = configuredApiOrigin || (import.meta.env.DEV ? "" : "https://api.hiloxs.co.ke");

export class SellerProductApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "SELLER_PRODUCT_REQUEST_FAILED") {
    super(message);
    this.name = "SellerProductApiError";
    this.status = status;
    this.code = code;
  }
}

export async function listSellerProducts(): Promise<SellerProductListState> {
  return send("/api/v1/seller/products", { method: "GET" }, "Unable to load product submissions");
}

export async function getSellerProduct(submissionId: string): Promise<SellerProductState> {
  return send(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}`,
    { method: "GET" },
    "Unable to load the product submission",
  );
}

export async function createSellerProduct(
  input: SellerProductDraftInput,
): Promise<SellerProductState> {
  return send(
    "/api/v1/seller/products",
    { method: "POST", body: JSON.stringify(input) },
    "Unable to create the product draft",
  );
}

export async function updateSellerProduct(
  submissionId: string,
  input: SellerProductDraftInput,
): Promise<SellerProductState> {
  return send(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}/edit`,
    { method: "POST", body: JSON.stringify(input) },
    "Unable to update the product draft",
  );
}

export async function submitSellerProduct(
  submissionId: string,
  termsVersion: string,
): Promise<SellerProductState> {
  return send(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}/submit`,
    {
      method: "POST",
      body: JSON.stringify({ termsAccepted: true, termsVersion }),
    },
    "Unable to submit the product",
  );
}

export async function withdrawSellerProduct(submissionId: string): Promise<SellerProductState> {
  return send(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}/withdraw`,
    { method: "POST", body: JSON.stringify({}) },
    "Unable to withdraw the product submission",
  );
}

export async function getSellerProductMedia(submissionId: string): Promise<SellerMediaState> {
  return send(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}/media`,
    { method: "GET" },
    "Unable to load product media",
  );
}

// Mirrors MIN_MEDIA_WIDTH / MIN_MEDIA_HEIGHT in api/src/media/model.ts. Checking here avoids
// spending a presigned upload, a finalize call, and a worker cycle on an image that can never
// pass processing. The server and worker remain authoritative.
const MIN_MEDIA_DIMENSION = 600;

export const MEDIA_DIMENSIONS_TOO_SMALL = "MEDIA_DIMENSIONS_TOO_SMALL";

async function assertMinimumDimensions(file: File): Promise<void> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Undecodable here, or createImageBitmap is unavailable. Let the server and the worker
    // make the authoritative call rather than blocking an upload on a client-side limitation.
    return;
  }
  const { width, height } = bitmap;
  bitmap.close();
  if (width < MIN_MEDIA_DIMENSION || height < MIN_MEDIA_DIMENSION) {
    throw new SellerProductApiError(
      `Image must be at least ${MIN_MEDIA_DIMENSION}×${MIN_MEDIA_DIMENSION} pixels. Yours is ${width}×${height}.`,
      400,
      MEDIA_DIMENSIONS_TOO_SMALL,
    );
  }
}

export async function uploadSellerProductMedia(submissionId: string, file: File): Promise<void> {
  await assertMinimumDimensions(file);
  const intent = await send<{
    media: SellerProductMedia;
    upload: { method: "POST" | "PUT"; url: string; fields?: Record<string, string> };
  }>(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}/media/upload-intents`,
    {
      method: "POST",
      body: JSON.stringify({
        declaredMime: file.type,
        declaredSize: file.size,
        rightsAccepted: true,
      }),
    },
    "Unable to prepare the media upload",
  );
  let uploaded: Response;
  if (intent.upload.method === "PUT") {
    // Content-Length is a forbidden header in the Fetch API — browsers set it
    // automatically from the File body, which matches the signed value (file.size).
    uploaded = await fetch(intent.upload.url, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
        "x-amz-meta-hiloxs-media-id": intent.media.id,
      },
      body: file,
    });
  } else {
    const form = new FormData();
    for (const [key, value] of Object.entries(intent.upload.fields ?? {})) form.append(key, value);
    form.append("file", file);
    uploaded = await fetch(intent.upload.url, { method: "POST", body: form });
  }
  if (!uploaded.ok) {
    throw new SellerProductApiError(
      uploaded.status === 403
        ? "The upload was rejected — the file may be too large, the wrong type, or the grant has expired"
        : "The private media upload failed",
      uploaded.status,
    );
  }
  await send(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}/media/${encodeURIComponent(intent.media.id)}/finalize`,
    { method: "POST", body: JSON.stringify({}) },
    "Unable to finalize the media upload",
  );
}

export async function arrangeSellerProductMedia(
  submissionId: string,
  orderedMediaIds: string[],
  selectedMediaIds: string[],
): Promise<SellerMediaState> {
  return send(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}/media/arrange`,
    { method: "POST", body: JSON.stringify({ orderedMediaIds, selectedMediaIds }) },
    "Unable to update the media selection",
  );
}

export async function abandonSellerProductMedia(
  submissionId: string,
  mediaId: string,
): Promise<void> {
  await send(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}/media/${encodeURIComponent(mediaId)}/abandon`,
    { method: "POST", body: JSON.stringify({}) },
    "Unable to abandon the upload",
  );
}

export async function getSellerProductInventory(
  submissionId: string,
): Promise<SellerInventoryState> {
  return send(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}/inventory`,
    { method: "GET" },
    "Unable to load product inventory",
  );
}

export async function setSellerProductInventory(
  submissionId: string,
  quantityAvailable: number,
): Promise<SellerInventoryState> {
  return send(
    `/api/v1/seller/products/${encodeURIComponent(submissionId)}/inventory`,
    { method: "PUT", body: JSON.stringify({ quantityAvailable }) },
    "Unable to save product inventory",
  );
}

export function sellerMediaPreviewUrl(
  submissionId: string,
  mediaId: string,
  variant: "THUMBNAIL" | "MEDIUM" | "LARGE" = "MEDIUM",
): string {
  return `${API_ORIGIN}/api/v1/seller/products/${encodeURIComponent(submissionId)}/media/${encodeURIComponent(mediaId)}/preview/${variant}`;
}

async function send<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...init.headers,
    },
  });
  if (!response.ok) throw await toApiError(response, fallback);
  return (await response.json()) as T;
}

async function toApiError(response: Response, fallback: string): Promise<SellerProductApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Keep malformed upstream details out of the seller interface.
  }
  const detail = body.error;
  return new SellerProductApiError(
    detail?.message || fallback,
    response.status,
    detail?.code ?? "SELLER_PRODUCT_REQUEST_FAILED",
  );
}
