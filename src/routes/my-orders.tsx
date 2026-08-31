import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Package, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthRequired } from "@/components/hiloxs/AuthRequired";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { cancelOrder, formatMoneyMinor, getOrders, type CommerceOrder } from "@/lib/commerce-api";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/my-orders")({
  validateSearch: (search: Record<string, unknown>) => {
    const result: { created?: string } = {};
    if (typeof search["created"] === "string" && search["created"].length <= 40) {
      result.created = search["created"];
    }
    return result;
  },
  head: () =>
    pageSeo({
      title: "My Orders | HILOXS",
      description: "Private order history for authenticated HILOXS customers.",
      path: "/my-orders",
      noindex: true,
    }),
  component: MyOrdersPage,
});

function MyOrdersPage() {
  const auth = useAuth();
  const search = Route.useSearch();
  const [orders, setOrders] = useState<CommerceOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState("");

  useEffect(() => {
    if (auth.isLoading || !auth.isAuthenticated) return;
    let active = true;
    setLoading(true);
    setError("");
    void getOrders()
      .then((nextOrders) => {
        if (active) setOrders(nextOrders);
      })
      .catch(() => {
        if (active) setError("Your orders could not be loaded. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.isAuthenticated, auth.isLoading]);

  if (auth.isLoading) {
    return <PageStatus>Checking account access...</PageStatus>;
  }
  if (!auth.isAuthenticated) {
    return (
      <AuthRequired
        title="Log in to view your orders"
        description="Order history is private and loaded from your verified HILOXS account."
        returnTo="/my-orders"
      />
    );
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold sm:text-4xl">My Orders</h1>
      <p className="mt-2 text-muted-foreground">
        Server records for your authenticated HILOXS account.
      </p>

      {search.created && (
        <div
          className="mt-6 rounded-md border border-border bg-secondary/60 p-4 text-sm"
          role="status"
        >
          Order <span className="font-semibold">{search.created}</span> was created with pending
          payment status. No payment was taken.
        </div>
      )}
      {loading && (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading orders...
        </div>
      )}
      {error && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && orders.length === 0 && (
        <div className="panel mt-8 grid place-items-center gap-4 p-12 text-center">
          <Package className="size-10 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">No server orders have been created yet.</p>
        </div>
      )}
      {orders.length > 0 && (
        <ul className="mt-8 space-y-4">
          {orders.map((order) => (
            <li key={order.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{order.orderNumber}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("en-KE", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(order.createdAt))}
                  </p>
                </div>
                <Badge variant={order.status === "CANCELLED" ? "secondary" : "outline"}>
                  {order.status.replaceAll("_", " ")}
                </Badge>
              </div>
              <div className="mt-5 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Items</p>
                  <p className="font-medium">{order.itemCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="font-medium">
                    {formatMoneyMinor(order.totalMinor, order.currency)}
                  </p>
                </div>
                <div className="sm:text-right">
                  {order.status === "PENDING_PAYMENT" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cancelling === order.id}
                      onClick={async () => {
                        setCancelling(order.id);
                        setError("");
                        try {
                          const cancelled = await cancelOrder(order.id);
                          setOrders((current) =>
                            current.map((item) => (item.id === cancelled.id ? cancelled : item)),
                          );
                        } catch {
                          setError("The pending order could not be cancelled.");
                        } finally {
                          setCancelling("");
                        }
                      }}
                    >
                      {cancelling === order.id ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <XCircle aria-hidden />
                      )}
                      Cancel order
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PageStatus({ children }: { children: string }) {
  return (
    <p className="mx-auto max-w-xl px-4 py-16 text-center text-muted-foreground" role="status">
      {children}
    </p>
  );
}
