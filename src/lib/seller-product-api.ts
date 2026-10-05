import type { ShopCategory } from "@/lib/hiloxs";
import type { AllowedMediaMime } from "@/lib/media-limits";
import { NETWORK_ERROR, UPLOAD_PUT_FAILED, type UploadStage } from "@/lib/media-upload-errors";

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
  /** Upload step that failed, set by uploadSellerProductMedia so the UI can word the message. */
  stage?: UploadStage;

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

/**
 * Uploads one image: presign, PUT to private storage, finalize. `mime` is the format detected from
 * the file's bytes by validateImageFile, not file.type, which is empty on some mobile browsers.
 * The caller must have validated the file; the server and worker remain authoritative.
 */
export async function uploadSellerProductMedia(
  submissionId: string,
  file: File,
  mime: AllowedMediaMime,
): Promise<void> {
  const intent = await atStage("intent", () =>
    send<{
      media: SellerProductMedia;
      upload: { method: "POST" | "PUT"; url: string; fields?: Record<string, string> };
    }>(
      `/api/v1/seller/products/${encodeURIComponent(submissionId)}/media/upload-intents`,
      {
        method: "POST",
        body: JSON.stringify({
          declaredMime: mime,
          declaredSize: file.size,
          rightsAccepted: true,
        }),
      },
      "Unable to prepare the media upload",
    ),
  );
  // The intent has created a media row in PENDING_UPLOAD. Everything from here to finalize must
  // clean that row up on failure, or it lingers on the seller's dashboard looking like a second
  // upload and consumes one of their six active slots until the worker's 24-hour sweep.
  try {
    await atStage("put", async () => {
      let uploaded: Response;
      try {
        if (intent.upload.method === "PUT") {
          // Content-Length is a forbidden header in the Fetch API — browsers set it
          // automatically from the File body, which matches the signed value (file.size).
          uploaded = await fetch(intent.upload.url, {
            method: "PUT",
            headers: {
              "Content-Type": mime,
              "x-amz-meta-hiloxs-media-id": intent.media.id,
            },
            body: file,
          });
        } else {
          const form = new FormData();
          for (const [key, value] of Object.entries(intent.upload.fields ?? {}))
            form.append(key, value);
          form.append("file", file);
          uploaded = await fetch(intent.upload.url, { method: "POST", body: form });
        }
      } catch (cause) {
        // A dropped connection and a CORS/network-filter block both surface as a bare TypeError.
        console.error("Seller media storage request failed", cause);
        throw new SellerProductApiError("The image did not reach storage.", 0, NETWORK_ERROR);
      }
      if (!uploaded.ok) {
        throw new SellerProductApiError(
          `The private media upload failed (status ${uploaded.status}).`,
          uploaded.status,
          UPLOAD_PUT_FAILED,
        );
      }
    });
    await atStage("finalize", () =>
      send(
        `/api/v1/seller/products/${encodeURIComponent(submissionId)}/media/${encodeURIComponent(intent.media.id)}/finalize`,
        { method: "POST", body: JSON.stringify({}) },
        "Unable to finalize the media upload",
      ),
    );
  } catch (error) {
    // Mobile browsers surface almost nothing for a blocked or dropped upload, so leave a trace for
    // anyone attaching a remote debugger.
    console.error("Seller media upload failed", error);
    try {
      await abandonSellerProductMedia(submissionId, intent.media.id);
    } catch {
      // Best effort. If abandoning fails the row is still swept server-side after the quarantine
      // retention window, and reporting a cleanup failure would bury the error that actually matters.
    }
    throw error;
  }
}

async function atStage<T>(stage: UploadStage, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SellerProductApiError && !error.stage) error.stage = stage;
    throw error;
  }
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
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...init.headers,
      },
    });
  } catch {
    throw new SellerProductApiError(
      "Network error. Check your connection and try again.",
      0,
      NETWORK_ERROR,
    );
  }
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
