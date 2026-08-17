import { createFileRoute, Link } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TILL_LABEL, TILL_NUMBER, dual } from "@/lib/hiloxs";
import { useHiloxs } from "@/lib/hiloxs-store";

export const Route = createFileRoute("/my-orders")({
  head: () => ({
    meta: [
      { title: "My Orders — HILOXS" },
      {
        name: "description",
        content:
          "Track your HILOXS electronics orders, payment method and delivery status in one place.",
      },
      { property: "og:title", content: "My HILOXS Orders" },
      { property: "og:description", content: "Order history and delivery status for HILOXS buyers." },
    ],
  }),
  component: MyOrdersPage,
});

function MyOrdersPage() {
  const { state, hydrated } = useHiloxs();
  const orders = hydrated ? state.orders : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold sm:text-4xl">My Orders</h1>
      <p className="mt-2 text-muted-foreground">
        Every checkout you make in the HILOXS shop lands here with its payment method and status.
      </p>

      {orders.length === 0 ? (
        <div className="panel mt-8 grid place-items-center gap-4 p-12 text-center">
          <Package className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">You have not placed an order yet.</p>
          <Button asChild variant="hero">
            <Link to="/shop">Browse the shop</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {orders.map((o) => (
            <li key={o.id} className="panel p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-display text-lg font-bold">{o.id}</span>
                <Badge variant="secondary">{o.status}</Badge>
                <Badge variant="outline">
                  {o.method === "till"
                    ? "M-Pesa Till"
                    : o.method === "paybill"
                      ? "M-Pesa Paybill"
                      : o.method === "paypal"
                        ? "PayPal"
                        : "MiniPay"}
                </Badge>
                <span className="ml-auto font-semibold text-primary">{dual(o.totalKes)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Placed {new Date(o.at).toLocaleString()}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {o.items.map((i) => (
                  <li key={i.productId}>
                    {i.qty} × {i.name} — {dual(i.priceKes * i.qty)}
                  </li>
                ))}
              </ul>
              {o.method === "till" && (
                <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Pay to {TILL_LABEL}:{" "}
                  {TILL_NUMBER ?? "____________ (Buy Goods till pending activation)"}
                </p>
              )}
              {o.method === "paybill" && (
                <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Pay to {PAYBILL_LABEL}:{" "}
                  {PAYBILL_NUMBER ?? "____________ (paybill pending activation)"}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}