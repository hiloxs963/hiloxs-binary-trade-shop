import { MessageCircle, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatMoneyMinor,
  manualTillLabel,
  supportWhatsAppLink,
  type ManualTillDetails,
} from "@/lib/commerce-api";
import { SUPPORT } from "@/lib/hiloxs";

/**
 * Shown instead of the M-Pesa prompt while public STK push is unavailable. It is informational:
 * the buyer pays by hand and HILOXS staff confirm it off-platform, so nothing here may suggest the
 * order is already paid.
 */
export function ManualTillPanel({
  details,
  orderNumber,
  totalMinor,
  currency,
}: {
  details: ManualTillDetails;
  orderNumber: string;
  totalMinor: string;
  currency: string;
}) {
  const total = formatMoneyMinor(totalMinor, currency);
  const whatsAppLink = supportWhatsAppLink(
    `Hello HILOXS, I have paid ${total} for order ${orderNumber}. Here is my M-Pesa confirmation:`,
  );

  return (
    <div className="rounded-md border border-border bg-secondary/60 p-4">
      <p className="flex items-center gap-2 font-medium">
        <Smartphone className="size-4 text-primary" aria-hidden /> Pay manually via M-Pesa
      </p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {manualTillLabel(details.kind)}
          </dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-primary">{details.number}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Exact amount to pay
          </dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums">{total}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm text-muted-foreground">{details.instructions}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button asChild size="sm">
          <a href={whatsAppLink} target="_blank" rel="noreferrer noopener">
            <MessageCircle aria-hidden /> Send your confirmation on WhatsApp
          </a>
        </Button>
        <a
          href={`tel:${SUPPORT.phoneHref}`}
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          or call {SUPPORT.phone}
        </a>
      </div>
      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        Quote order {orderNumber}. This order is not paid or confirmed yet — our team confirms every
        manual payment and arranges delivery with you directly ({SUPPORT.hours}).
      </p>
    </div>
  );
}
