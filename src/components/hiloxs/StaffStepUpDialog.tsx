import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setStaffStepUpPrompt, StaffApiError, verifyStaffStepUp } from "@/lib/staff-api";
import { createStepUpCoordinator, describeStepUpError } from "@/lib/step-up";

type Method = "totp" | "backup-code";

/**
 * Inline re-verification for the staff console. It is a modal over the current page, so nothing
 * navigates away and form input stays exactly as typed. While mounted it registers itself as the
 * prompt used by every staff request that needs a step-up.
 */
export function StaffStepUpDialog() {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const settle = useRef<((verified: boolean) => void) | null>(null);

  useEffect(() => {
    const prompt = createStepUpCoordinator(
      () =>
        new Promise<boolean>((resolve) => {
          settle.current = resolve;
          setCode("");
          setError("");
          setMethod("totp");
          setOpen(true);
        }),
    );
    setStaffStepUpPrompt(prompt);
    return () => {
      setStaffStepUpPrompt(null);
      settle.current?.(false);
      settle.current = null;
    };
  }, []);

  const finish = (verified: boolean) => {
    setOpen(false);
    settle.current?.(verified);
    settle.current = null;
  };

  const valid = method === "totp" ? /^\d{6}$/.test(code) : code.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) finish(false);
      }}
    >
      <DialogContent>
        <form
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid) return;
            setBusy(true);
            setError("");
            try {
              await verifyStaffStepUp(method, method === "totp" ? code : code.trim());
              setBusy(false);
              finish(true);
            } catch (caught) {
              setBusy(false);
              const failure =
                caught instanceof StaffApiError
                  ? describeStepUpError(caught)
                  : { message: "The code could not be verified.", sessionEnded: false };
              setError(failure.message);
              setCode("");
              if (failure.sessionEnded) finish(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" aria-hidden /> Confirm it's you
            </DialogTitle>
            <DialogDescription>
              Enter a code to continue. Your page and anything you have typed stay as they are.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="staff-step-up-code">
              {method === "totp" ? "Authenticator code" : "Backup code"}
            </Label>
            <Input
              id="staff-step-up-code"
              value={code}
              onChange={(event) =>
                setCode(
                  method === "totp"
                    ? event.target.value.replace(/\D/g, "").slice(0, 6)
                    : event.target.value.slice(0, 128),
                )
              }
              inputMode={method === "totp" ? "numeric" : "text"}
              autoComplete={method === "totp" ? "one-time-code" : "off"}
              spellCheck={false}
              autoFocus
            />
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
          <button
            type="button"
            className="mt-3 text-sm text-primary hover:underline"
            onClick={() => {
              setMethod(method === "totp" ? "backup-code" : "totp");
              setCode("");
              setError("");
            }}
          >
            {method === "totp" ? "Use a backup code instead" : "Use my authenticator app instead"}
          </button>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" disabled={busy} onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Verify
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
