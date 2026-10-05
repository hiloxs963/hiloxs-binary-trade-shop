// Maps an upload failure to seller-facing text. Kept free of DOM and API-client imports so it runs
// under Node tests; it reads only the structural fields of SellerProductApiError.
export type UploadStage = "intent" | "put" | "finalize";

export type UploadFailure = {
  /** Plain-language explanation shown beneath the file input. */
  message: string;
  /** What the seller can do about it. */
  hint: string;
  /** Whether re-running the same upload is worth offering. */
  retryable: boolean;
};

export type UploadErrorLike = { status?: number; code?: string; stage?: UploadStage };

export const NETWORK_ERROR = "NETWORK_ERROR";
export const UPLOAD_PUT_FAILED = "UPLOAD_PUT_FAILED";

const GENERIC: UploadFailure = {
  message: "The upload could not be completed.",
  hint: "Check your connection and try again.",
  retryable: true,
};

const BY_CODE: Record<string, UploadFailure> = {
  ORIGIN_NOT_ALLOWED: {
    message: "Your browser session is not accepted for uploads from this page.",
    hint: "Reload hiloxs.co.ke, sign in again and retry. If it keeps happening, contact support.",
    retryable: false,
  },
  UNAUTHENTICATED: {
    message: "You have been signed out.",
    hint: "Sign in again, then choose the image again.",
    retryable: false,
  },
  SELLER_NOT_APPROVED: {
    message: "Your seller account is not approved for uploads.",
    hint: "Contact support if you believe this is a mistake.",
    retryable: false,
  },
  MEDIA_UPLOAD_DISABLED: {
    message: "Image uploads are paused right now.",
    hint: "Please try again later.",
    retryable: false,
  },
  MEDIA_STORAGE_UNAVAILABLE: {
    message: "Image storage is temporarily unavailable.",
    hint: "Wait a moment and try again.",
    retryable: true,
  },
  RATE_LIMITED: {
    message: "Too many upload attempts in a short time.",
    hint: "Wait a minute, then try again.",
    retryable: true,
  },
  PAYLOAD_TOO_LARGE: {
    message: "The server rejected this file as too large.",
    hint: "The maximum is 8 MB. Export a smaller JPEG or WebP.",
    retryable: false,
  },
  VALIDATION_ERROR: {
    message: "The server rejected this image.",
    hint: "Use a JPEG, PNG or WebP photo up to 8 MB and at least 600×600 pixels.",
    retryable: false,
  },
  NOT_FOUND: {
    message: "This product is no longer available for uploads.",
    hint: "Refresh the page and check the product status.",
    retryable: false,
  },
  CONFLICT: {
    message: "This product cannot take another image right now.",
    hint: "It may already have six images, be listed in the catalog, or the upload expired. Refresh and check.",
    retryable: false,
  },
};

const BY_STAGE_NETWORK: Record<UploadStage, UploadFailure> = {
  intent: {
    message: "Could not reach HILOXS to start the upload.",
    hint: "Check your connection and try again.",
    retryable: true,
  },
  put: {
    message: "The image did not reach storage.",
    hint: "Your connection may have dropped, or a network filter blocked it. Try again, ideally on Wi-Fi or a different network.",
    retryable: true,
  },
  finalize: {
    message: "The image was sent but could not be confirmed.",
    hint: "Check your connection and try again.",
    retryable: true,
  },
};

export function describeUploadFailure(error: unknown): UploadFailure {
  if (!error || typeof error !== "object") return GENERIC;
  const { status, code, stage } = error as UploadErrorLike;

  if (code === NETWORK_ERROR) return BY_STAGE_NETWORK[stage ?? "intent"];
  if (code === UPLOAD_PUT_FAILED) {
    if (status === 403) {
      return {
        message: "Storage rejected the upload.",
        hint: "The upload link may have expired or the file changed. Try again to get a fresh link.",
        retryable: true,
      };
    }
    return {
      message: `Storage returned an error (status ${status ?? "unknown"}).`,
      hint: "Please try again.",
      retryable: true,
    };
  }
  if (code && BY_CODE[code]) {
    const mapped = BY_CODE[code];
    // A finalize conflict means the intent was spent or expired; a new attempt starts a fresh one.
    if (code === "CONFLICT" && stage === "finalize") {
      return {
        message: "The upload expired or no longer matches what was sent.",
        hint: "Try again to start a fresh upload.",
        retryable: true,
      };
    }
    return mapped;
  }
  if (typeof status === "number" && status >= 500) {
    return {
      message: "HILOXS had a temporary problem.",
      hint: "Wait a moment and try again.",
      retryable: true,
    };
  }
  return GENERIC;
}
