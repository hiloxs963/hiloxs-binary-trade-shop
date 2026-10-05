export type MediaStatusView = {
  /** Short label for the status chip. */
  label: string;
  tone: "neutral" | "progress" | "success" | "error";
  /** Extra line under the chip, when the status needs one. */
  detail?: string;
};

// Seller-facing wording for each stored media status. The raw enum never reaches the UI.
export function sellerMediaStatusView(
  status: string,
  context: { reviewReason?: string | null; processingError?: string | null } = {},
): MediaStatusView {
  switch (status) {
    case "PENDING_UPLOAD":
      return {
        label: "Uploading",
        tone: "progress",
        detail: "Waiting for the file to finish uploading.",
      };
    case "UPLOADED":
    case "PROCESSING":
      return { label: "Processing", tone: "progress", detail: "Checking and preparing the image." };
    case "READY_FOR_REVIEW":
      return {
        label: "In review",
        tone: "progress",
        detail: "Waiting for HILOXS staff to review.",
      };
    case "APPROVED":
      return { label: "Approved", tone: "success" };
    case "REJECTED":
      return {
        label: "Rejected",
        tone: "error",
        detail: context.reviewReason ?? "This image was not accepted.",
      };
    case "PROCESSING_FAILED":
      return {
        label: "Processing failed",
        tone: "error",
        detail: context.processingError ?? "Processing could not be completed.",
      };
    case "ABANDONED":
      return { label: "Upload cancelled", tone: "neutral" };
    default:
      return { label: "Unknown", tone: "neutral" };
  }
}
