import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Package, RefreshCw, Smartphone, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthRequired } from "@/components/hiloxs/AuthRequired";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import {
  cancelOrder,
  formatMoneyMinor,
  getOrderPaymentStatus,
  getOrders,
  getPaymentConfig,
  initiateMpesaPayment,
  mpesaAvailabilityForOrder,
  refreshMpesaPayment,
  type CommerceOrder,
  type OrderPaymentStatus,
  type PaymentConfig,
} from "@/lib/commerce-api";
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
  const [paymentBlocking, setPaymentBlocking] = useState<Record<string, boolean>>({});
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>();

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

  useEffect(() => {
    if (auth.isLoading || !auth.isAuthenticated) return;
    let active = true;
    void getPaymentConfig()
      .then((config) => {
        if (active) setPaymentConfig(config);
      })
      .catch(() => {
        if (active) setPaymentConfig(null);
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
                      disabled={cancelling === order.id || paymentBlocking[order.id]}
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
              {(order.status === "PENDING_PAYMENT" || order.status === "PAID") && (
                <OrderPaymentControls
                  order={order}
                  initialPhone={auth.currentUser?.phone ?? ""}
                  paymentConfig={paymentConfig}
                  onPayment={(payment) => {
                    setPaymentBlocking((current) => ({
                      ...current,
                      [order.id]: isBlockingPayment(payment.paymentStatus),
                    }));
                    if (payment.orderStatus !== order.status) {
                      setOrders((current) =>
                        current.map((item) =>
                          item.id === order.id ? { ...item, status: payment.orderStatus } : item,
                        ),
                      );
                    }
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OrderPaymentControls({
  order,
  initialPhone,
  paymentConfig,
  onPayment,
}: {
  order: CommerceOrder;
  initialPhone: string;
  paymentConfig: PaymentConfig | null | undefined;
  onPayment: (payment: OrderPaymentStatus) => void;
}) {
  const [payment, setPayment] = useState<OrderPaymentStatus | null>(null);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef<string | null>(null);

  const applyPayment = (next: OrderPaymentStatus) => {
    setPayment(next);
    onPayment(next);
  };

  useEffect(() => {
    let active = true;
    void getOrderPaymentStatus(order.id)
      .then((next) => {
        if (active) applyPayment(next);
      })
      .catch(() => {
        if (active) setError("M-Pesa status is currently unavailable.");
      });
    return () => {
      active = false;
    };
    // Loading is keyed to the immutable server order identifier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  useEffect(() => {
    if (!payment || !isPollingPayment(payment.paymentStatus)) return;
    let active = true;
    const timer = window.setInterval(() => {
      void getOrderPaymentStatus(order.id)
        .then((next) => {
          if (active) applyPayment(next);
        })
        .catch(() => undefined);
    }, 7_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // Polling follows the current server status and stops on terminal states.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, payment?.paymentStatus]);

  const paymentStateAllowsInitiation =
    order.status === "PENDING_PAYMENT" &&
    (!payment || payment.paymentStatus === null || payment.paymentStatus === "FAILED");
  const availability = mpesaAvailabilityForOrder(paymentConfig, order.orderNumber);

  return (
    <div className="mt-5 border-t border-border pt-4">
      {paymentStateAllowsInitiation && availability.canInitiate && (
        <div className="space-y-3">
          {availability.sandboxTest && (
            <p className="text-sm text-muted-foreground">
              Controlled sandbox testing only. This is not a live customer payment.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              aria-label={`M-Pesa phone for order ${order.orderNumber}`}
              inputMode="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                key.current = null;
              }}
              placeholder="0712 345 678"
            />
            <Button
              disabled={busy || !phone.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                if (payment?.paymentStatus === "FAILED") key.current = null;
                key.current ??= crypto.randomUUID();
                try {
                  applyPayment(await initiateMpesaPayment(order.id, phone, key.current));
                } catch {
                  setError(
                    "The M-Pesa prompt could not be confirmed. Check status before retrying.",
                  );
                  try {
                    applyPayment(await getOrderPaymentStatus(order.id));
                  } catch {
                    // Reuse the key while the initiation outcome is unknown.
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Smartphone aria-hidden />}
              {availability.sandboxTest ? "Run sandbox M-Pesa test" : "Pay with M-Pesa"}
            </Button>
          </div>
        </div>
      )}

      {paymentStateAllowsInitiation && !availability.canInitiate && (
        <p className="text-sm text-muted-foreground">
          {paymentConfig === undefined
            ? "Checking M-Pesa availability..."
            : "M-Pesa payments are not currently available."}
        </p>
      )}

      {payment?.paymentStatus === "SUCCEEDED" && (
        <p className="text-sm font-medium text-success">
          Paid{payment.receiptNumber ? ` · M-Pesa receipt ${payment.receiptNumber}` : ""}
        </p>
      )}
      {payment && isPollingPayment(payment.paymentStatus) && (
        <p className="text-sm text-muted-foreground">
          Waiting for M-Pesa confirmation. Check your phone and enter your M-Pesa PIN.
        </p>
      )}
      {payment?.paymentStatus === "UNKNOWN" && (
        <p className="text-sm text-muted-foreground">
          Confirmation is unresolved. Do not send a duplicate payment.
        </p>
      )}
      {payment?.paymentStatus === "REVIEW_REQUIRED" && (
        <p className="text-sm text-destructive">Payment confirmation requires support review.</p>
      )}
      {payment && isRefreshablePayment(payment.paymentStatus) && (
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              applyPayment(await refreshMpesaPayment(order.id));
            } catch {
              setError("Payment confirmation is still unavailable. Please check again later.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw aria-hidden /> Check payment status
        </Button>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function isPollingPayment(status: OrderPaymentStatus["paymentStatus"]): boolean {
  return status === "INITIATING" || status === "PENDING" || status === "CONFIRMING";
}

function isRefreshablePayment(status: OrderPaymentStatus["paymentStatus"]): boolean {
  return isPollingPayment(status) || status === "UNKNOWN";
}

function isBlockingPayment(status: OrderPaymentStatus["paymentStatus"]): boolean {
  return isRefreshablePayment(status) || status === "REVIEW_REQUIRED";
}

function PageStatus({ children }: { children: string }) {
  return (
    <p className="mx-auto max-w-xl px-4 py-16 text-center text-muted-foreground" role="status">
      {children}
    </p>
  );
}
