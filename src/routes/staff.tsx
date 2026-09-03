import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { StaffMediaActivation } from "@/components/hiloxs/StaffMediaActivation";
import { StaffCommerceControls } from "@/components/hiloxs/StaffCommerceControls";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import { pageSeo } from "@/lib/seo";
import {
  getStaffProfile,
  getStaffSellerApplication,
  getStaffSellerApplications,
  getStaffSellerProduct,
  getStaffSellerProducts,
  reviewStaffItem,
  getOrderSupportItems,
  StaffApiError,
  type StaffProfile,
  type StaffSellerApplication,
  type StaffSellerProduct,
  type OrderSupportItem,
} from "@/lib/staff-api";

export const Route = createFileRoute("/staff")({
  head: () =>
    pageSeo({
      title: "Staff Console | HILOXS",
      description: "Restricted HILOXS review operations.",
      path: "/staff",
      noindex: true,
    }),
  component: StaffPage,
});

const STATUSES = ["ALL", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;

function StaffPage() {
  const auth = useAuth();
  const [profile, setProfile] = useState<StaffProfile | null>();

  useEffect(() => {
    if (auth.isLoading || !auth.isAuthenticated) {
      if (!auth.isLoading) setProfile(null);
      return;
    }
    let active = true;
    void getStaffProfile()
      .then((result) => {
        if (active) setProfile(result);
      })
      .catch(() => {
        if (active) setProfile(null);
      });
    return () => {
      active = false;
    };
  }, [auth.isAuthenticated, auth.isLoading]);

  if (auth.isLoading || profile === undefined)
    return <PageStatus text="Checking staff access..." />;
  if (!auth.isAuthenticated) {
    return (
      <AccessMessage
        title="Staff sign-in required"
        detail="Use your verified account and authenticator code to continue."
      />
    );
  }
  if (!profile) {
    return (
      <AccessMessage
        title="Staff access unavailable"
        detail="This account does not have access to staff review operations."
      />
    );
  }

  const defaultTab = profile.permissions.includes("SELLER_REVIEW")
    ? "applications"
    : profile.permissions.includes("PRODUCT_REVIEW")
      ? "products"
      : profile.permissions.includes("ORDER_SUPPORT")
        ? "order-support"
        : "products";

  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold">Staff Console</h1>
          <p className="mt-1 text-sm text-muted-foreground">Authenticated review queues</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{profile.role}</Badge>
          <Badge variant={profile.reviewEnabled ? "default" : "secondary"}>
            {profile.reviewEnabled ? "Actions enabled" : "Actions disabled"}
          </Badge>
        </div>
      </div>
      {!profile.reviewEnabled && (
        <p className="mt-5 rounded-md border border-border bg-secondary p-3 text-sm" role="status">
          Review actions are currently disabled.
        </p>
      )}
      <Tabs defaultValue={defaultTab} className="mt-6">
        <TabsList>
          {profile.permissions.includes("SELLER_REVIEW") && (
            <TabsTrigger value="applications">Seller Applications</TabsTrigger>
          )}
          {profile.permissions.includes("PRODUCT_REVIEW") && (
            <TabsTrigger value="products">Seller Products</TabsTrigger>
          )}
          {profile.permissions.includes("ORDER_SUPPORT") && (
            <TabsTrigger value="order-support">Order Support</TabsTrigger>
          )}
        </TabsList>
        {profile.permissions.includes("SELLER_REVIEW") && (
          <TabsContent value="applications">
            <ApplicationQueue reviewEnabled={profile.reviewEnabled} />
          </TabsContent>
        )}
        {profile.permissions.includes("PRODUCT_REVIEW") && (
          <TabsContent value="products">
            <ProductQueue
              reviewEnabled={profile.reviewEnabled}
              canActivate={profile.permissions.includes("CATALOG_ACTIVATE")}
              canCommerce={profile.permissions.includes("SELLER_COMMERCE_ACTIVATE")}
            />
          </TabsContent>
        )}
        {profile.permissions.includes("ORDER_SUPPORT") && (
          <TabsContent value="order-support">
            <OrderSupportQueue />
          </TabsContent>
        )}
      </Tabs>
    </section>
  );
}

function ApplicationQueue({ reviewEnabled }: { reviewEnabled: boolean }) {
  const [items, setItems] = useState<StaffSellerApplication[]>([]);
  const [selected, setSelected] = useState<StaffSellerApplication | null>(null);
  const [status, setStatus] = useState("SUBMITTED");
  const [state, setState] = useState({ loading: true, error: "" });

  const load = useCallback(async () => {
    setState({ loading: true, error: "" });
    try {
      const result = await getStaffSellerApplications(status === "ALL" ? undefined : status);
      setItems(result.items);
      setSelected(null);
      setState({ loading: false, error: "" });
    } catch {
      setState({ loading: false, error: "The application queue could not be loaded." });
    }
  }, [status]);

  useEffect(() => void load(), [load]);
  return (
    <ReviewLayout
      status={status}
      setStatus={setStatus}
      loading={state.loading}
      error={state.error}
      onRefresh={load}
      list={items.map((item) => ({
        id: item.id,
        title: item.tradingName || item.legalName,
        status: item.status,
      }))}
      selectedId={selected?.id}
      onSelect={async (id) => {
        setState((current) => ({ ...current, error: "" }));
        try {
          setSelected(await getStaffSellerApplication(id));
        } catch {
          setState((current) => ({
            ...current,
            error: "The application detail could not be loaded.",
          }));
        }
      }}
    >
      {selected && (
        <ReviewDetail
          kind="seller-applications"
          item={selected}
          reviewEnabled={reviewEnabled}
          onChanged={load}
        >
          <DetailRow label="Legal name" value={selected.legalName} />
          <DetailRow label="Trading name" value={selected.tradingName ?? "Not provided"} />
          <DetailRow label="Seller type" value={selected.sellerType.replaceAll("_", " ")} />
          <DetailRow label="Registration" value={selected.registrationNumber ?? "Not applicable"} />
          <DetailRow label="KRA PIN" value={selected.kraPin ?? "Not provided"} />
        </ReviewDetail>
      )}
    </ReviewLayout>
  );
}

function ProductQueue({
  reviewEnabled,
  canActivate,
  canCommerce,
}: {
  reviewEnabled: boolean;
  canActivate: boolean;
  canCommerce: boolean;
}) {
  const [items, setItems] = useState<StaffSellerProduct[]>([]);
  const [selected, setSelected] = useState<StaffSellerProduct | null>(null);
  const [status, setStatus] = useState("SUBMITTED");
  const [state, setState] = useState({ loading: true, error: "" });

  const load = useCallback(async () => {
    setState({ loading: true, error: "" });
    try {
      const result = await getStaffSellerProducts(status === "ALL" ? undefined : status);
      setItems(result.items);
      setSelected(null);
      setState({ loading: false, error: "" });
    } catch {
      setState({ loading: false, error: "The product queue could not be loaded." });
    }
  }, [status]);

  useEffect(() => void load(), [load]);
  return (
    <ReviewLayout
      status={status}
      setStatus={setStatus}
      loading={state.loading}
      error={state.error}
      onRefresh={load}
      list={items.map((item) => ({ id: item.id, title: item.name, status: item.status }))}
      selectedId={selected?.id}
      onSelect={async (id) => {
        setState((current) => ({ ...current, error: "" }));
        try {
          setSelected(await getStaffSellerProduct(id));
        } catch {
          setState((current) => ({ ...current, error: "The product detail could not be loaded." }));
        }
      }}
    >
      {selected && (
        <>
          <ReviewDetail
            kind="seller-products"
            item={selected}
            reviewEnabled={reviewEnabled}
            onChanged={load}
          >
            <DetailRow label="Product" value={selected.name} />
            <DetailRow label="Category" value={selected.category} />
            <DetailRow label="Description" value={selected.description ?? ""} />
            <DetailRow
              label="Price"
              value={`${selected.currency} ${(Number(selected.priceMinor) / 100).toFixed(2)}`}
            />
            <DetailRow
              label="Seller"
              value={selected.seller?.tradingName || selected.seller?.legalName || ""}
            />
          </ReviewDetail>
          {selected.status === "APPROVED" && (
            <>
              <StaffMediaActivation
                submissionId={selected.id}
                reviewEnabled={reviewEnabled}
                canActivate={canActivate}
              />
              {canCommerce && <StaffCommerceControls submissionId={selected.id} />}
            </>
          )}
        </>
      )}
    </ReviewLayout>
  );
}

function OrderSupportQueue() {
  const [type, setType] = useState<"PAYMENT_REVIEW_REQUIRED" | "FULFILLMENT_ISSUE">(
    "PAYMENT_REVIEW_REQUIRED",
  );
  const [items, setItems] = useState<OrderSupportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await getOrderSupportItems(type));
    } catch {
      setError("The order support queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [type]);
  useEffect(() => void load(), [load]);
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <Select value={type} onValueChange={(value: typeof type) => setType(value)}>
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PAYMENT_REVIEW_REQUIRED">Payment review</SelectItem>
            <SelectItem value="FULFILLMENT_ISSUE">Fulfillment issues</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="outline"
          aria-label="Refresh order support"
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>
      {loading && <p className="mt-5 text-sm text-muted-foreground">Loading support queue...</p>}
      {error && <p className="mt-5 text-sm text-destructive">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="mt-5 text-sm text-muted-foreground">No orders require this review.</p>
      )}
      <div className="mt-4 divide-y divide-border border-y border-border">
        {items.map((item) => (
          <div
            key={`${item.orderId}:${item.fulfillmentId ?? "order"}`}
            className="flex flex-wrap items-center justify-between gap-3 py-4"
          >
            <div>
              <p className="text-sm font-medium">{item.orderNumber}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(item.updatedAt).toLocaleString("en-KE")}
              </p>
            </div>
            <Badge variant="outline">
              {(item.fulfillmentStatus ?? item.orderStatus).replaceAll("_", " ")}
            </Badge>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        This queue is read-only. Financial and inventory changes are not available here.
      </p>
    </div>
  );
}

function ReviewLayout({
  status,
  setStatus,
  loading,
  error,
  onRefresh,
  list,
  selectedId,
  onSelect,
  children,
}: {
  status: string;
  setStatus: (status: string) => void;
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  list: { id: string; title: string; status: string }[];
  selectedId: string | undefined;
  onSelect: (id: string) => Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh queue"
            onClick={() => void onRefresh()}
          >
            <RefreshCw aria-hidden />
          </Button>
        </div>
        {loading && <p className="mt-6 text-sm text-muted-foreground">Loading review queue...</p>}
        {error && (
          <p className="mt-6 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && list.length === 0 && (
          <p className="mt-6 text-sm text-muted-foreground">No records in this queue.</p>
        )}
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {list.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-3 px-3 py-4 text-left hover:bg-secondary ${selectedId === item.id ? "bg-secondary" : ""}`}
                onClick={() => void onSelect(item.id)}
              >
                <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
                <Badge variant="outline">{item.status.replaceAll("_", " ")}</Badge>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <aside className="border-l-0 border-border lg:border-l lg:pl-6">
        {children || <p className="text-sm text-muted-foreground">Select a record to review.</p>}
      </aside>
    </div>
  );
}

function ReviewDetail({
  kind,
  item,
  reviewEnabled,
  onChanged,
  children,
}: {
  kind: "seller-applications" | "seller-products";
  item: StaffSellerApplication | StaffSellerProduct;
  reviewEnabled: boolean;
  onChanged: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const act = async (action: "start-review" | "approve" | "reject") => {
    setBusy(true);
    setNotice("");
    try {
      await reviewStaffItem(kind, item.id, action, reason);
      setReason("");
      await onChanged();
    } catch (error) {
      setNotice(
        error instanceof StaffApiError && error.code === "STAFF_RECENT_AUTH_REQUIRED"
          ? "Please sign in again before performing review actions."
          : "The review action could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Review detail</h2>
        <Badge>{item.status.replaceAll("_", " ")}</Badge>
      </div>
      <dl className="mt-5 space-y-4">{children}</dl>
      {reviewEnabled && item.status === "SUBMITTED" && (
        <Button className="mt-6" disabled={busy} onClick={() => void act("start-review")}>
          Start Review
        </Button>
      )}
      {reviewEnabled && item.status === "UNDER_REVIEW" && (
        <div className="mt-6 space-y-3 border-t border-border pt-5">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Applicant-safe rejection reason"
            maxLength={500}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void act("approve")}>
              <Check aria-hidden /> Approve
            </Button>
            <Button
              variant="destructive"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void act("reject")}
            >
              <X aria-hidden /> Reject
            </Button>
          </div>
        </div>
      )}
      {busy && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Saving review...
        </p>
      )}
      {notice && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {notice}
        </p>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm">{value}</dd>
    </div>
  );
}

function PageStatus({ text }: { text: string }) {
  return (
    <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {text}
    </div>
  );
}

function AccessMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="mx-auto max-w-xl px-4 py-20 text-center">
      <ShieldAlert className="mx-auto size-10 text-muted-foreground" aria-hidden />
      <h1 className="mt-4 text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
      <Button asChild className="mt-6">
        <Link to="/login" search={{ returnTo: "/staff" }}>
          Log in
        </Link>
      </Button>
    </section>
  );
}
