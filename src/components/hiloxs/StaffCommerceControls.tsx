import { Loader2, PauseCircle, PlayCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getActivationReadiness,
  getCommerceReadiness,
  setStaffSellerCommerce,
} from "@/lib/staff-api";

export function StaffCommerceControls({ submissionId }: { submissionId: string }) {
  const [state, setState] = useState<{
    productId: string;
    ready: boolean;
    commerceEnabled: boolean;
    checks: Record<string, boolean>;
    purchasable: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const activation = await getActivationReadiness(submissionId);
      const productId = activation.readiness.activation?.productId;
      if (!productId) {
        setState(null);
        return;
      }
      const result = await getCommerceReadiness(productId);
      setState({
        productId,
        ...result.readiness,
        purchasable: !result.readiness.checks["notAlreadyEnabled"],
      });
    } catch {
      setError("Commerce readiness could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [submissionId]);
  useEffect(() => void load(), [load]);
  if (loading)
    return (
      <p className="mt-5 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden />
        Checking commerce readiness...
      </p>
    );
  if (error) return <p className="mt-5 text-sm text-destructive">{error}</p>;
  if (!state)
    return (
      <p className="mt-5 text-sm text-muted-foreground">
        Activate the approved catalog product before commerce review.
      </p>
    );
  return (
    <div className="mt-6 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Commerce readiness</h3>
        <Badge variant={state.ready ? "default" : "secondary"}>
          {state.ready ? "Ready" : "Not ready"}
        </Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {Object.entries(state.checks).map(([check, passed]) => (
          <div key={check} className="flex items-center justify-between gap-2">
            <dt>{check.replaceAll(/([A-Z])/g, " $1")}</dt>
            <dd>{passed ? "Yes" : "No"}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex gap-2">
        {!state.purchasable && (
          <Button
            disabled={!state.ready}
            onClick={async () => {
              await setStaffSellerCommerce(state.productId, true);
              await load();
            }}
          >
            <PlayCircle aria-hidden />
            Enable commerce
          </Button>
        )}
        {state.purchasable && (
          <Button
            variant="outline"
            onClick={async () => {
              await setStaffSellerCommerce(state.productId, false);
              await load();
            }}
          >
            <PauseCircle aria-hidden />
            Pause commerce
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh commerce readiness"
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>
      {!state.commerceEnabled && (
        <p className="mt-3 text-xs text-muted-foreground">
          New seller commerce is globally paused. Product pause remains available.
        </p>
      )}
    </div>
  );
}
