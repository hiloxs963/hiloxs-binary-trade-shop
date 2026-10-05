import { describe, expect, it } from "vitest";
import {
  NETWORK_ERROR,
  UPLOAD_PUT_FAILED,
  describeUploadFailure,
} from "../../../src/lib/media-upload-errors.js";
import { sellerMediaStatusView } from "../../../src/lib/media-status.js";

describe("describeUploadFailure", () => {
  it("words a network failure by the step it happened in", () => {
    const intent = describeUploadFailure({ status: 0, code: NETWORK_ERROR, stage: "intent" });
    const put = describeUploadFailure({ status: 0, code: NETWORK_ERROR, stage: "put" });
    const finalize = describeUploadFailure({ status: 0, code: NETWORK_ERROR, stage: "finalize" });
    expect(intent.message).toMatch(/start the upload/);
    expect(put.message).toMatch(/did not reach storage/);
    expect(finalize.message).toMatch(/could not be confirmed/);
    for (const failure of [intent, put, finalize]) expect(failure.retryable).toBe(true);
  });

  it("treats a network failure with no stage as an intent failure", () => {
    expect(describeUploadFailure({ status: 0, code: NETWORK_ERROR }).message).toMatch(
      /start the upload/,
    );
  });

  it("explains ORIGIN_NOT_ALLOWED and does not offer a retry", () => {
    const failure = describeUploadFailure({
      status: 403,
      code: "ORIGIN_NOT_ALLOWED",
      stage: "intent",
    });
    expect(failure.message).toMatch(/not accepted/);
    expect(failure.hint).toMatch(/Reload/);
    expect(failure.retryable).toBe(false);
  });

  it("distinguishes storage 403 (expired link) from other storage errors", () => {
    const forbidden = describeUploadFailure({ status: 403, code: UPLOAD_PUT_FAILED, stage: "put" });
    const other = describeUploadFailure({ status: 500, code: UPLOAD_PUT_FAILED, stage: "put" });
    expect(forbidden.message).toBe("Storage rejected the upload.");
    expect(other.message).toContain("status 500");
    expect(forbidden.retryable && other.retryable).toBe(true);
  });

  it("maps server validation and operational codes", () => {
    expect(describeUploadFailure({ status: 400, code: "VALIDATION_ERROR" }).retryable).toBe(false);
    expect(describeUploadFailure({ status: 503, code: "MEDIA_UPLOAD_DISABLED" }).message).toMatch(
      /paused/,
    );
    expect(
      describeUploadFailure({ status: 503, code: "MEDIA_STORAGE_UNAVAILABLE" }).retryable,
    ).toBe(true);
    expect(describeUploadFailure({ status: 429, code: "RATE_LIMITED" }).retryable).toBe(true);
    expect(describeUploadFailure({ status: 401, code: "UNAUTHENTICATED" }).message).toMatch(
      /signed out/,
    );
  });

  it("treats a conflict at finalize as expired (retryable) but elsewhere as a limit (not retryable)", () => {
    const finalize = describeUploadFailure({ status: 409, code: "CONFLICT", stage: "finalize" });
    expect(finalize.retryable).toBe(true);
    expect(finalize.message).toMatch(/expired/);
    expect(describeUploadFailure({ status: 409, code: "CONFLICT", stage: "intent" })).toMatchObject(
      {
        retryable: false,
      },
    );
  });

  it("falls back to a retryable generic message for unknown codes, 5xx and non-objects", () => {
    expect(describeUploadFailure({ status: 500, code: "INTERNAL_ERROR" }).retryable).toBe(true);
    expect(describeUploadFailure({ status: 418, code: "SOMETHING_NEW" }).message).toBe(
      "The upload could not be completed.",
    );
    expect(describeUploadFailure(undefined).retryable).toBe(true);
    expect(describeUploadFailure("boom").retryable).toBe(true);
  });
});

describe("sellerMediaStatusView", () => {
  it.each([
    ["PENDING_UPLOAD", "Uploading"],
    ["UPLOADED", "Processing"],
    ["PROCESSING", "Processing"],
    ["READY_FOR_REVIEW", "In review"],
    ["APPROVED", "Approved"],
    ["REJECTED", "Rejected"],
    ["PROCESSING_FAILED", "Processing failed"],
    ["ABANDONED", "Upload cancelled"],
  ])("labels %s as %s", (status, label) => {
    expect(sellerMediaStatusView(status).label).toBe(label);
  });

  it("shows the rejection reason and the processing failure reason", () => {
    expect(sellerMediaStatusView("REJECTED", { reviewReason: "Blurry" })).toMatchObject({
      tone: "error",
      detail: "Blurry",
    });
    expect(
      sellerMediaStatusView("PROCESSING_FAILED", {
        processingError: "Image must be at least 600×600 pixels.",
      }),
    ).toMatchObject({ tone: "error", detail: "Image must be at least 600×600 pixels." });
  });

  it("falls back when a reason is missing and never exposes the raw enum", () => {
    expect(sellerMediaStatusView("REJECTED").detail).toBe("This image was not accepted.");
    expect(sellerMediaStatusView("PROCESSING_FAILED").detail).toBe(
      "Processing could not be completed.",
    );
    expect(sellerMediaStatusView("SOMETHING_ELSE").label).toBe("Unknown");
  });
});
