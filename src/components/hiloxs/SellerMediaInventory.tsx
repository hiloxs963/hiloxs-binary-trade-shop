import { ArrowDown, ArrowUp, ImagePlus, Loader2, RefreshCw, Save, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sellerMediaStatusView } from "@/lib/media-status";
import { describeUploadFailure, type UploadFailure } from "@/lib/media-upload-errors";
import { validateImageFile } from "@/lib/media-validation";
import { browserImageDecoder } from "@/lib/media-validation-browser";
import type { AllowedMediaMime } from "@/lib/media-limits";
import {
  abandonSellerProductMedia,
  arrangeSellerProductMedia,
  getSellerProductInventory,
  getSellerProductMedia,
  sellerMediaPreviewUrl,
  setSellerProductInventory,
  uploadSellerProductMedia,
  SellerProductApiError,
  type SellerInventoryState,
  type SellerMediaState,
} from "@/lib/seller-product-api";

const MEDIA_RIGHTS = [
  "I created this image or have permission or a license to use it.",
  "It accurately represents the product and does not knowingly infringe third-party rights.",
  "It contains no prohibited or illegal content, and HILOXS may reject or remove it.",
];

type FileCheck =
  | { state: "empty" }
  | { state: "checking" }
  | { state: "valid"; mime: AllowedMediaMime; width: number; height: number }
  | { state: "invalid"; message: string; hint: string };

type Feedback = { tone: "error" | "info"; text: string } | null;

// Always mounted so screen readers announce a message when it appears. Errors use the destructive
// colour and role="alert"; confirmations stay muted.
function FeedbackLine({ id, feedback }: { id: string; feedback: Feedback }) {
  return (
    <div id={id} aria-live="polite" aria-atomic="true" className="mt-2 text-sm">
      {feedback && (
        <p
          className={feedback.tone === "error" ? "text-destructive" : "text-muted-foreground"}
          role={feedback.tone === "error" ? "alert" : undefined}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}

const BADGE_VARIANT = {
  neutral: "outline",
  progress: "secondary",
  success: "default",
  error: "destructive",
} as const;

export function SellerMediaInventory({ submissionId }: { submissionId: string }) {
  const [mediaState, setMediaState] = useState<SellerMediaState | null>(null);
  const [inventoryState, setInventoryState] = useState<SellerInventoryState | null>(null);
  const [quantity, setQuantity] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [fileCheck, setFileCheck] = useState<FileCheck>({ state: "empty" });
  const [uploadError, setUploadError] = useState<UploadFailure | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const checkToken = useRef(0);
  const [busy, setBusy] = useState("");
  const [loadFeedback, setLoadFeedback] = useState<Feedback>(null);
  const [uploadNotice, setUploadNotice] = useState<Feedback>(null);
  const [inventoryFeedback, setInventoryFeedback] = useState<Feedback>(null);
  const [arrangeFeedback, setArrangeFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    const [nextMedia, nextInventory] = await Promise.all([
      getSellerProductMedia(submissionId),
      getSellerProductInventory(submissionId),
    ]);
    setMediaState(nextMedia);
    setInventoryState(nextInventory);
    setQuantity(String(nextInventory.inventory?.quantityAvailable ?? 0));
  }, [submissionId]);

  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) {
        setLoadFeedback({ tone: "error", text: "Media and inventory could not be loaded." });
      }
    });
    return () => {
      active = false;
    };
  }, [load]);

  const approved = useMemo(
    () => mediaState?.media.filter((media) => media.status === "APPROVED") ?? [],
    [mediaState],
  );
  const activated = Boolean(mediaState?.activated || inventoryState?.activated);

  // Checks run on selection so a bad file is explained before the seller reaches Upload. The token
  // drops the result of a check that a newer selection has already superseded.
  const chooseFile = async (next: File | null) => {
    const token = ++checkToken.current;
    setFile(next);
    setUploadError(null);
    setUploadNotice(null);
    if (!next) {
      setFileCheck({ state: "empty" });
      return;
    }
    setFileCheck({ state: "checking" });
    const result = await validateImageFile(next, browserImageDecoder);
    if (token !== checkToken.current) return;
    setFileCheck(
      result.ok
        ? { state: "valid", mime: result.mime, width: result.width, height: result.height }
        : { state: "invalid", message: result.message, hint: result.hint },
    );
  };

  const upload = async () => {
    if (busy || activated) return;
    if (!file || fileCheck.state !== "valid") {
      setUploadError(
        fileCheck.state === "invalid"
          ? { message: fileCheck.message, hint: fileCheck.hint, retryable: false }
          : {
              message: "Choose an image to upload.",
              hint: "JPEG, PNG or WebP, up to 8 MB.",
              retryable: false,
            },
      );
      return;
    }
    if (!rightsAccepted) {
      setUploadError({
        message: "Confirm the declaration before uploading.",
        hint: "Tick the box above the Upload button.",
        retryable: false,
      });
      return;
    }
    setBusy("upload");
    setUploadNotice(null);
    setUploadError(null);
    try {
      await uploadSellerProductMedia(submissionId, file, fileCheck.mime);
      checkToken.current += 1;
      setFile(null);
      setFileCheck({ state: "empty" });
      setInputKey((key) => key + 1);
      setRightsAccepted(false);
      await load();
      setUploadNotice({
        tone: "info",
        text: "Upload received. Processing status will update after the media worker runs.",
      });
    } catch (error) {
      setUploadError(describeUploadFailure(error));
      // The failed attempt abandoned its row; refresh so the list matches.
      void load().catch(() => undefined);
    } finally {
      setBusy("");
    }
  };

  const uploadBlocker =
    fileCheck.state === "checking"
      ? "Checking the image…"
      : fileCheck.state === "invalid"
        ? "Fix the image problem above to continue."
        : fileCheck.state !== "valid"
          ? "Choose an image to continue."
          : !rightsAccepted
            ? "Confirm the declaration to continue."
            : "";
  const errorId = `seller-media-error-${submissionId}`;

  const saveInventory = async () => {
    const value = Number(quantity);
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000 || activated) {
      setInventoryFeedback({
        tone: "error",
        text: "Inventory must be a whole number from 0 to 1,000,000.",
      });
      return;
    }
    setBusy("inventory");
    setInventoryFeedback(null);
    try {
      setInventoryState(await setSellerProductInventory(submissionId, value));
      setInventoryFeedback({ tone: "info", text: "Inventory preparation saved." });
    } catch {
      setInventoryFeedback({
        tone: "error",
        text: "Inventory could not be saved. Check your connection and try again.",
      });
    } finally {
      setBusy("");
    }
  };

  const arrange = async (orderedIds: string[], selectedIds: string[]) => {
    if (activated) return;
    setBusy("arrange");
    setArrangeFeedback(null);
    try {
      setMediaState(await arrangeSellerProductMedia(submissionId, orderedIds, selectedIds));
    } catch {
      setArrangeFeedback({
        tone: "error",
        text: "The approved media selection could not be updated. Try again.",
      });
    } finally {
      setBusy("");
    }
  };

  return (
    <section
      className="mt-6 border-t border-border pt-5"
      aria-label="Media and inventory preparation"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold">Media &amp; Inventory</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            {activated
              ? "Listed in catalog. Purchasing is not enabled yet."
              : "Prepare reviewed product images and inventory for staff-controlled activation."}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh media status"
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>

      <FeedbackLine id={`seller-media-load-${submissionId}`} feedback={loadFeedback} />

      {!activated && (
        <div className="mt-5 border-y border-border py-5">
          <Label htmlFor={`seller-media-${submissionId}`}>Product image</Label>
          <Input
            key={inputKey}
            id={`seller-media-${submissionId}`}
            className="mt-2"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-invalid={fileCheck.state === "invalid" || Boolean(uploadError)}
            aria-describedby={errorId}
            onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
          />
          <div id={errorId} aria-live="polite" aria-atomic="true" className="mt-2 text-sm">
            {fileCheck.state === "checking" && (
              <p className="text-muted-foreground">Checking the image…</p>
            )}
            {fileCheck.state === "valid" && !uploadError && (
              <p className="text-muted-foreground">
                Ready: {fileCheck.width}×{fileCheck.height} pixels.
              </p>
            )}
            {(fileCheck.state === "invalid" || uploadError) && (
              <div className="text-destructive" role="alert">
                <p className="font-medium">
                  {uploadError?.message ?? (fileCheck.state === "invalid" ? fileCheck.message : "")}
                </p>
                <p className="mt-1">
                  {uploadError?.hint ?? (fileCheck.state === "invalid" ? fileCheck.hint : "")}
                </p>
                {uploadError?.retryable && (
                  <Button
                    className="mt-2"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => void upload()}
                  >
                    <RefreshCw aria-hidden /> Retry upload
                  </Button>
                )}
              </div>
            )}
          </div>
          <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
            {MEDIA_RIGHTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="mt-4 flex items-start gap-3">
            <Checkbox
              id={`seller-media-rights-${submissionId}`}
              checked={rightsAccepted}
              onCheckedChange={(value) => setRightsAccepted(value === true)}
            />
            <Label htmlFor={`seller-media-rights-${submissionId}`} className="leading-5">
              I confirm this declaration for the selected image.
            </Label>
          </div>
          <Button
            className="mt-4"
            variant="outline"
            disabled={fileCheck.state !== "valid" || !rightsAccepted || Boolean(busy)}
            onClick={() => void upload()}
          >
            {busy === "upload" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <ImagePlus aria-hidden />
            )}
            {busy === "upload" ? "Uploading…" : "Upload privately"}
          </Button>
          {uploadBlocker && !busy && (
            <p className="mt-2 text-xs text-muted-foreground">{uploadBlocker}</p>
          )}
          <FeedbackLine id={`seller-media-notice-${submissionId}`} feedback={uploadNotice} />
        </div>
      )}

      {mediaState && (mediaState.media.length > 0 || busy === "upload") && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {busy === "upload" && (
            <article className="overflow-hidden rounded-md border border-border">
              <div className="grid aspect-square place-items-center bg-secondary px-3 text-center text-xs text-muted-foreground">
                <Loader2 className="animate-spin" aria-hidden />
              </div>
              <div className="p-3">
                <Badge variant="secondary">Uploading</Badge>
                <p className="mt-2 text-xs text-muted-foreground">Sending the image securely…</p>
              </div>
            </article>
          )}
          {mediaState.media.map((media) => {
            const view = sellerMediaStatusView(media.status, {
              reviewReason: media.reviewReason,
              processingError: media.processingError,
            });
            return (
              <article key={media.id} className="overflow-hidden rounded-md border border-border">
                {["READY_FOR_REVIEW", "APPROVED", "REJECTED"].includes(media.status) ? (
                  <img
                    src={sellerMediaPreviewUrl(submissionId, media.id, "THUMBNAIL")}
                    alt="Sanitized seller product preview"
                    className="aspect-square w-full object-contain bg-secondary"
                  />
                ) : (
                  <div className="grid aspect-square place-items-center bg-secondary px-3 text-center text-xs text-muted-foreground">
                    Sanitized preview pending
                  </div>
                )}
                <div className="p-3">
                  <Badge variant={BADGE_VARIANT[view.tone]}>{view.label}</Badge>
                  {view.detail && (
                    <p
                      className={`mt-2 text-xs ${view.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {view.detail}
                    </p>
                  )}
                  {!activated && media.status === "PENDING_UPLOAD" && (
                    <Button
                      className="mt-2"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void abandonSellerProductMedia(submissionId, media.id).then(load)
                      }
                    >
                      <XCircle aria-hidden /> Abandon
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {approved.length > 0 && !activated && (
        <div className="mt-5 border-t border-border pt-5">
          <h5 className="text-sm font-medium">Approved activation media</h5>
          <div className="mt-3 space-y-2">
            {approved.map((media, index) => (
              <div key={media.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={media.selectedForActivation}
                  onCheckedChange={(checked) =>
                    void arrange(
                      approved.map((item) => item.id),
                      approved
                        .filter((item) => item.id !== media.id && item.selectedForActivation)
                        .map((item) => item.id)
                        .concat(checked === true ? media.id : []),
                    )
                  }
                  aria-label="Select approved image for catalog activation"
                />
                <span className="min-w-0 flex-1 truncate">Approved image {index + 1}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={index === 0 || Boolean(busy)}
                  aria-label="Move image earlier"
                  onClick={() => {
                    const ids = approved.map((item) => item.id);
                    [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
                    void arrange(
                      ids,
                      approved.filter((item) => item.selectedForActivation).map((item) => item.id),
                    );
                  }}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={index === approved.length - 1 || Boolean(busy)}
                  aria-label="Move image later"
                  onClick={() => {
                    const ids = approved.map((item) => item.id);
                    [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
                    void arrange(
                      ids,
                      approved.filter((item) => item.selectedForActivation).map((item) => item.id),
                    );
                  }}
                >
                  <ArrowDown aria-hidden />
                </Button>
              </div>
            ))}
          </div>
          <FeedbackLine id={`seller-media-arrange-${submissionId}`} feedback={arrangeFeedback} />
        </div>
      )}

      <div className="mt-5 border-t border-border pt-5">
        <Label htmlFor={`seller-inventory-${submissionId}`}>Quantity available</Label>
        <div className="mt-2 flex max-w-sm gap-2">
          <Input
            id={`seller-inventory-${submissionId}`}
            type="number"
            min={0}
            max={1_000_000}
            step={1}
            value={quantity}
            disabled={activated}
            aria-invalid={inventoryFeedback?.tone === "error"}
            aria-describedby={`seller-inventory-feedback-${submissionId}`}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={activated || Boolean(busy)}
            onClick={() => void saveInventory()}
          >
            {busy === "inventory" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            Save
          </Button>
        </div>
        <FeedbackLine
          id={`seller-inventory-feedback-${submissionId}`}
          feedback={inventoryFeedback}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Preparation only. Stock is not reserved or sold in Phase 8.
        </p>
      </div>
    </section>
  );
}
