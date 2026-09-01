import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShoppingCart,
  Smartphone,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import {
  createOrder,
  formatMoneyMinor,
  getCheckoutQuote,
  getOrderPaymentStatus,
  initiateMpesaPayment,
  refreshMpesaPayment,
  type CommerceOrder,
  type CheckoutQuote,
  type OrderPaymentStatus,
} from "@/lib/commerce-api";
import { PRODUCTS } from "@/lib/hiloxs";
import { useHiloxs } from "@/lib/hiloxs-context";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/checkout")({
  head: () =>
    pageSeo({
      title: "Checkout | HILOXS",
      description: "Secure account-based checkout for HILOXS customers.",
      path: "/checkout",
      noindex: true,
    }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const auth = useAuth();
  const navigate = Route.useNavigate();
  const { state, hydrated, clearCart } = useHiloxs();
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createdOrder, setCreatedOrder] = useState<CommerceOrder | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const items = useMemo(
    () => Object.entries(state.cart).map(([productId, quantity]) => ({ productId, quantity })),
    [state.cart],
  );

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      void navigate({ to: "/login", search: { returnTo: "/checkout" }, replace: true });
    }
  }, [auth.isAuthenticated, auth.isLoading, navigate]);

  useEffect(() => {
    idempotencyKey.current = null;
  }, [items]);

  useEffect(() => {
    if (!hydrated || auth.isLoading || !auth.isAuthenticated || items.length === 0) return;
    let active = true;
    setQuoteLoading(true);
    setQuoteError("");
    void getCheckoutQuote(items)
      .then((nextQuote) => {
        if (active) setQuote(nextQuote);
      })
      .catch(() => {
        if (active) {
          setQuote(null);
          setQuoteError("Current prices could not be confirmed. Review the cart and try again.");
        }
      })
      .finally(() => {
        if (active) setQuoteLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.isAuthenticated, auth.isLoading, hydrated, items]);

  if (auth.isLoading || !hydrated) {
    return <PageStatus>Checking account and cart...</PageStatus>;
  }
  if (!auth.isAuthenticated) {
    return <PageStatus>Redirecting to login. Your cart will remain available.</PageStatus>;
  }
  if (createdOrder) {
    return (
      <CreatedOrderPayment order={createdOrder} initialPhone={auth.currentUser?.phone ?? ""} />
    );
  }
  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-xl px-4 py-16 text-center">
        <ShoppingCart className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-3xl font-bold">Your cart is empty</h1>
        <Button asChild variant="hero" className="mt-6">
          <Link to="/shop">Browse products</Link>
        </Button>
      </section>
    );
  }

  const changedPrices = quote?.items.filter((item) => {
    const local = PRODUCTS.find((product) => product.id === item.productId);
    return local ? BigInt(item.unitPriceMinor) !== BigInt(local.priceKes) * 100n : false;
  });

  return (
    <section className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold sm:text-4xl">Checkout</h1>
      <p className="mt-2 text-muted-foreground">
        Prices below are confirmed by the HILOXS server before an M-Pesa prompt can be sent.
      </p>

      <div className="panel mt-8 p-5 sm:p-6">
        {quoteLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Confirming current prices...
          </div>
        )}
        {quoteError && (
          <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {quoteError}
          </div>
        )}
        {quote && (
          <>
            {changedPrices && changedPrices.length > 0 && (
              <div className="mb-5 rounded-md border border-border bg-secondary/60 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4 text-primary" aria-hidden /> Price updated
                </p>
                <p className="mt-1 text-muted-foreground">
                  The server price differs from the catalog display for {changedPrices.length} item
                  {changedPrices.length === 1 ? "" : "s"}. The confirmed total is shown below.
                </p>
              </div>
            )}
            <ul className="divide-y divide-border">
              {quote.items.map((item) => (
                <li key={item.productId} className="flex gap-4 py-4 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.name}</p>
                    <p className="mt-1 text-muted-foreground">
                      {formatMoneyMinor(item.unitPriceMinor, quote.currency)} × {item.quantity}
                    </p>
                  </div>
                  <p className="font-semibold">
                    {formatMoneyMinor(item.lineTotalMinor, quote.currency)}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center justify-between border-t border-border pt-5">
              <span className="font-medium">Server-confirmed total</span>
              <span className="text-xl font-bold text-primary">
                {formatMoneyMinor(quote.totalMinor, quote.currency)}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" aria-hidden />
              Currency and line totals were calculated from active PostgreSQL products.
            </div>
          </>
        )}
      </div>

      {createError && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {createError}
        </p>
      )}
      <Button
        variant="hero"
        size="lg"
        className="mt-5 w-full"
        disabled={!quote || quoteLoading || creating}
        onClick={async () => {
          if (!quote) return;
          setCreating(true);
          setCreateError("");
          idempotencyKey.current ??= crypto.randomUUID();
          try {
            const order = await createOrder(items, idempotencyKey.current);
            clearCart();
            setCreatedOrder(order);
          } catch {
            setCreateError("The pending order could not be created. No payment was taken.");
          } finally {
            setCreating(false);
          }
        }}
      >
        {creating ? <Loader2 className="animate-spin" aria-hidden /> : <ShoppingCart aria-hidden />}
        {creating ? "Creating order..." : "Create pending order"}
      </Button>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Creating the order does not charge you. You choose whether to send the M-Pesa prompt next.
      </p>
    </section>
  );
}

function CreatedOrderPayment({
  order,
  initialPhone,
}: {
  order: CommerceOrder;
  initialPhone: string;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const [payment, setPayment] = useState<OrderPaymentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const paymentKey = useRef<string | null>(null);

  useEffect(() => {
    if (!payment || !isPollingStatus(payment.paymentStatus)) return;
    const timer = window.setInterval(() => {
      void getOrderPaymentStatus(order.id)
        .then(setPayment)
        .catch(() => undefined);
    }, 7_000);
    return () => window.clearInterval(timer);
  }, [order.id, payment]);

  const canInitiate =
    !payment || payment.paymentStatus === null || payment.paymentStatus === "FAILED";
  return (
    <section className="mx-auto max-w-2xl px-4 py-10">
      <CheckCircle2 className="size-9 text-success" aria-hidden />
      <h1 className="mt-3 text-3xl font-bold">Order {order.orderNumber} created</h1>
      <p className="mt-2 text-muted-foreground">
        Pending total: {formatMoneyMinor(order.totalMinor, order.currency)}. No payment has been
        confirmed yet.
      </p>

      <div className="panel mt-8 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Smartphone className="size-5 text-primary" aria-hidden />
          <h2 className="font-semibold">Pay with M-Pesa</h2>
        </div>
        {canInitiate ? (
          <div className="mt-4 space-y-3">
            <Input
              aria-label="M-Pesa phone number"
              inputMode="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                paymentKey.current = null;
              }}
              placeholder="0712 345 678"
            />
            <Button
              variant="hero"
              disabled={busy || !phone.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                paymentKey.current ??= crypto.randomUUID();
                try {
                  setPayment(await initiateMpesaPayment(order.id, phone, paymentKey.current));
                } catch {
                  setError(
                    "The M-Pesa prompt could not be confirmed. Check the order status before retrying.",
                  );
                  try {
                    setPayment(await getOrderPaymentStatus(order.id));
                  } catch {
                    // Preserve the same idempotency key when the outcome cannot be checked.
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Smartphone aria-hidden />}
              {busy ? "Sending prompt..." : "Send M-Pesa prompt"}
            </Button>
          </div>
        ) : (
          <PaymentMessage payment={payment} />
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        {payment && isRefreshableStatus(payment.paymentStatus) && (
          <Button
            className="mt-4"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setPayment(await refreshMpesaPayment(order.id));
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
      </div>
      <Button asChild variant="outline" className="mt-5">
        <Link to="/my-orders">View my orders</Link>
      </Button>
    </section>
  );
}

function PaymentMessage({ payment }: { payment: OrderPaymentStatus }) {
  if (payment.paymentStatus === "SUCCEEDED") {
    return (
      <p className="mt-4 text-sm font-medium text-success">
        Paid{payment.receiptNumber ? ` · Receipt ${payment.receiptNumber}` : ""}
      </p>
    );
  }
  if (payment.paymentStatus === "UNKNOWN") {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        The prompt outcome is unresolved. Do not send another payment; check the status below.
      </p>
    );
  }
  if (payment.paymentStatus === "REVIEW_REQUIRED") {
    return (
      <p className="mt-4 text-sm text-destructive">Payment confirmation requires support review.</p>
    );
  }
  return (
    <p className="mt-4 text-sm text-muted-foreground">
      Check your phone and enter your M-Pesa PIN. Your order will be marked paid only after payment
      is confirmed.
    </p>
  );
}

function isPollingStatus(status: OrderPaymentStatus["paymentStatus"]): boolean {
  return status === "INITIATING" || status === "PENDING" || status === "CONFIRMING";
}

function isRefreshableStatus(status: OrderPaymentStatus["paymentStatus"]): boolean {
  return isPollingStatus(status) || status === "UNKNOWN";
}

function PageStatus({ children }: { children: string }) {
  return (
    <p className="mx-auto max-w-xl px-4 py-16 text-center text-muted-foreground" role="status">
      {children}
    </p>
  );
}
