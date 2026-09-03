import { ArrowDown, ArrowUp, ImagePlus, Loader2, RefreshCw, Save, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  abandonSellerProductMedia,
  arrangeSellerProductMedia,
  getSellerProductInventory,
  getSellerProductMedia,
  sellerMediaPreviewUrl,
  setSellerProductInventory,
  uploadSellerProductMedia,
  type SellerInventoryState,
  type SellerMediaState,
} from "@/lib/seller-product-api";

const MEDIA_RIGHTS = [
  "I created this image or have permission or a license to use it.",
  "It accurately represents the product and does not knowingly infringe third-party rights.",
  "It contains no prohibited or illegal content, and HILOXS may reject or remove it.",
];

export function SellerMediaInventory({ submissionId }: { submissionId: string }) {
  const [mediaState, setMediaState] = useState<SellerMediaState | null>(null);
  const [inventoryState, setInventoryState] = useState<SellerInventoryState | null>(null);
  const [quantity, setQuantity] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

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
      if (active) setNotice("Media and inventory could not be loaded.");
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

  const upload = async () => {
    if (!file || !rightsAccepted || activated) return;
    setBusy("upload");
    setNotice("");
    try {
      await uploadSellerProductMedia(submissionId, file);
      setFile(null);
      setRightsAccepted(false);
      await load();
      setNotice("Upload received. Processing status will update after the media worker runs.");
    } catch {
      setNotice("The image could not be uploaded safely.");
    } finally {
      setBusy("");
    }
  };

  const saveInventory = async () => {
    const value = Number(quantity);
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000 || activated) {
      setNotice("Inventory must be a whole number from 0 to 1,000,000.");
      return;
    }
    setBusy("inventory");
    setNotice("");
    try {
      setInventoryState(await setSellerProductInventory(submissionId, value));
      setNotice("Inventory preparation saved.");
    } catch {
      setNotice("Inventory could not be saved.");
    } finally {
      setBusy("");
    }
  };

  const arrange = async (orderedIds: string[], selectedIds: string[]) => {
    if (activated) return;
    setBusy("arrange");
    setNotice("");
    try {
      setMediaState(await arrangeSellerProductMedia(submissionId, orderedIds, selectedIds));
    } catch {
      setNotice("The approved media selection could not be updated.");
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

      {!activated && (
        <div className="mt-5 border-y border-border py-5">
          <Label htmlFor={`seller-media-${submissionId}`}>Product image</Label>
          <Input
            id={`seller-media-${submissionId}`}
            className="mt-2"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
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
            disabled={!file || !rightsAccepted || Boolean(busy)}
            onClick={() => void upload()}
          >
            {busy === "upload" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <ImagePlus aria-hidden />
            )}
            Upload privately
          </Button>
        </div>
      )}

      {mediaState && mediaState.media.length > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mediaState.media.map((media) => (
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
                <Badge variant={media.status === "REJECTED" ? "destructive" : "secondary"}>
                  {media.status.replaceAll("_", " ")}
                </Badge>
                {media.reviewReason && (
                  <p className="mt-2 text-xs text-destructive">{media.reviewReason}</p>
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
          ))}
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
        <p className="mt-2 text-xs text-muted-foreground">
          Preparation only. Stock is not reserved or sold in Phase 8.
        </p>
      </div>
      {notice && (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
