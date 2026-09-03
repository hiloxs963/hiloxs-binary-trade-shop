import { Check, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  activateStaffSellerProduct,
  deactivateStaffSellerProduct,
  getActivationReadiness,
  getStaffSellerMedia,
  reviewStaffSellerMedia,
  staffMediaPreviewUrl,
  type ActivationReadiness,
  type StaffSellerMedia,
} from "@/lib/staff-api";

export function StaffMediaActivation({
  submissionId,
  reviewEnabled,
  canActivate,
}: {
  submissionId: string;
  reviewEnabled: boolean;
  canActivate: boolean;
}) {
  const [media, setMedia] = useState<StaffSellerMedia[]>([]);
  const [readiness, setReadiness] = useState<ActivationReadiness | null>(null);
  const [activationEnabled, setActivationEnabled] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const mediaResult = await getStaffSellerMedia(submissionId);
    setMedia(mediaResult.media);
    if (canActivate) {
      const activation = await getActivationReadiness(submissionId);
      setReadiness(activation.readiness);
      setActivationEnabled(activation.activationEnabled);
    }
  }, [canActivate, submissionId]);

  useEffect(() => {
    void load().catch(() => setNotice("Media readiness could not be loaded."));
  }, [load]);

  const review = async (mediaId: string, action: "approve" | "reject") => {
    setBusy(mediaId);
    setNotice("");
    try {
      await reviewStaffSellerMedia(mediaId, action, reason);
      setReason("");
      await load();
    } catch {
      setNotice("The media review action could not be completed.");
    } finally {
      setBusy("");
    }
  };

  const catalogAction = async (action: "activate" | "deactivate") => {
    setBusy(action);
    setNotice("");
    try {
      if (action === "activate") await activateStaffSellerProduct(submissionId);
      else await deactivateStaffSellerProduct(submissionId);
      await load();
    } catch {
      setNotice("The catalog action could not be completed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="mt-6 border-t border-border pt-5" aria-label="Seller product media review">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Sanitized media</h3>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh media readiness"
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>
      {media.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No sanitized media submitted.</p>
      ) : (
        <div className="mt-4 space-y-5">
          {media.map((item) => (
            <article key={item.id} className="border-b border-border pb-5 last:border-b-0">
              {["READY_FOR_REVIEW", "APPROVED", "REJECTED"].includes(item.status) && (
                <img
                  src={staffMediaPreviewUrl(submissionId, item.id, "MEDIUM")}
                  alt="Sanitized product media for staff review"
                  className="aspect-square w-full rounded-md border border-border bg-secondary object-contain"
                />
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant={item.status === "REJECTED" ? "destructive" : "secondary"}>
                  {item.status.replaceAll("_", " ")}
                </Badge>
                {item.selectedForActivation && <Badge variant="outline">Selected</Badge>}
              </div>
              {reviewEnabled && item.status === "READY_FOR_REVIEW" && (
                <div className="mt-3 space-y-2">
                  <Textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Applicant-safe rejection reason"
                    maxLength={500}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={Boolean(busy)}
                      onClick={() => void review(item.id, "approve")}
                    >
                      <Check aria-hidden /> Approve media
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={Boolean(busy) || reason.trim().length < 3}
                      onClick={() => void review(item.id, "reject")}
                    >
                      <X aria-hidden /> Reject
                    </Button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {canActivate && readiness && (
        <div className="mt-5 border-t border-border pt-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-semibold">Catalog activation</h3>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {Object.entries(readiness.checks).map(([name, passed]) => (
              <li key={name}>
                {passed ? "Ready" : "Required"}: {readinessLabel(name)}
              </li>
            ))}
          </ul>
          {!activationEnabled && (
            <p className="mt-3 text-sm text-muted-foreground">
              Catalog activation is currently disabled.
            </p>
          )}
          {readiness.activation ? (
            <div className="mt-4">
              <Badge>{readiness.activation.active ? "LISTED" : "DEACTIVATED"}</Badge>
              {readiness.activation.active && (
                <Button
                  className="mt-3 w-full"
                  variant="destructive"
                  disabled={!activationEnabled || Boolean(busy)}
                  onClick={() => void catalogAction("deactivate")}
                >
                  {busy === "deactivate" && <Loader2 className="animate-spin" aria-hidden />}{" "}
                  Deactivate seller listing
                </Button>
              )}
            </div>
          ) : (
            <Button
              className="mt-4 w-full"
              disabled={!readiness.ready || !activationEnabled || Boolean(busy)}
              onClick={() => void catalogAction("activate")}
            >
              {busy === "activate" && <Loader2 className="animate-spin" aria-hidden />} Activate
              catalog listing
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {notice}
        </p>
      )}
    </section>
  );
}

function readinessLabel(value: string): string {
  return value.replace(/([A-Z])/g, " $1").toLowerCase();
}
