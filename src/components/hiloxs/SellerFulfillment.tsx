import { CheckCircle2, Loader2, PackageCheck, RefreshCw, Save, Truck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  acceptFulfillmentTerms,
  actOnSellerOrder,
  getFulfillmentConfig,
  getSellerCatalogProducts,
  getSellerOrder,
  getSellerOrders,
  updateSellerInventory,
  type FulfillmentConfigState,
  type SellerCatalogProduct,
  type SellerFulfillment as SellerFulfillmentRecord,
} from "@/lib/seller-fulfillment-api";

export function SellerFulfillment() {
  const [config, setConfig] = useState<FulfillmentConfigState | null>(null);
  const [products, setProducts] = useState<SellerCatalogProduct[]>([]);
  const [orders, setOrders] = useState<SellerFulfillmentRecord[]>([]);
  const [selected, setSelected] = useState<SellerFulfillmentRecord | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [nextConfig, nextProducts, nextOrders] = await Promise.all([
        getFulfillmentConfig(),
        getSellerCatalogProducts(),
        getSellerOrders(),
      ]);
      setConfig(nextConfig);
      setProducts(nextProducts);
      setOrders(nextOrders);
    } catch {
      setError("Seller commerce details could not be loaded.");
    }
  }, []);

  useEffect(() => void load(), [load]);

  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="seller-fulfillment">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="seller-fulfillment" className="text-xl font-semibold">
            Inventory and fulfillment
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Maintain live stock and act only on orders HILOXS marks ready.
          </p>
        </div>
        <Button
          size="icon"
          variant="outline"
          aria-label="Refresh seller fulfillment"
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>
      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {config && config.config?.termsVersion !== config.termsVersion && (
        <div className="mt-6 border-y border-border py-5">
          <h3 className="font-semibold">Fulfillment terms</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {config.terms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
          <div className="mt-4 flex items-start gap-3">
            <Checkbox
              id="fulfillment-terms"
              checked={accepted}
              onCheckedChange={(value) => setAccepted(value === true)}
            />
            <Label htmlFor="fulfillment-terms" className="leading-5">
              I accept the current seller fulfillment terms.
            </Label>
          </div>
          <Button
            className="mt-4"
            disabled={!accepted || busy === "terms"}
            onClick={async () => {
              setBusy("terms");
              try {
                await acceptFulfillmentTerms();
                await load();
              } catch {
                setError("Fulfillment terms could not be accepted.");
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "terms" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 aria-hidden />
            )}
            Accept terms
          </Button>
        </div>
      )}

      {products.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold">Live inventory</h3>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {products.map((product) => (
              <InventoryRow key={product.id} product={product} onSaved={load} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-7">
        <h3 className="font-semibold">Paid seller orders</h3>
        {orders.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No fulfillment orders are ready.</p>
        ) : (
          <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)]">
            <div className="divide-y divide-border border-y border-border">
              {orders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-2 py-4 text-left"
                  onClick={async () => {
                    setBusy(order.id);
                    try {
                      setSelected(await getSellerOrder(order.id));
                    } catch {
                      setError("Order detail could not be loaded.");
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  <span>
                    <span className="block text-sm font-medium">{order.orderNumber}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(order.createdAt).toLocaleDateString("en-KE")}
                    </span>
                  </span>
                  {busy === order.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Badge variant="outline">{order.status.replaceAll("_", " ")}</Badge>
                  )}
                </button>
              ))}
            </div>
            {selected && (
              <SellerOrderDetail
                fulfillment={selected}
                onChanged={async (next) => {
                  setSelected(next);
                  await load();
                }}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function InventoryRow({
  product,
  onSaved,
}: {
  product: SellerCatalogProduct;
  onSaved: () => Promise<void>;
}) {
  const [quantity, setQuantity] = useState(String(product.quantityOnHand));
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-4">
      <div>
        <p className="text-sm font-medium">{product.name}</p>
        <p className="text-xs text-muted-foreground">
          Available {product.quantityAvailable} | Reserved {product.quantityReserved}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          className="w-28"
          aria-label={`On-hand inventory for ${product.name}`}
          type="number"
          min={product.quantityReserved}
          max={1_000_000}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <Button
          size="icon"
          variant="outline"
          aria-label={`Save inventory for ${product.name}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await updateSellerInventory(product.id, Number(quantity));
              await onSaved();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
        </Button>
      </div>
    </div>
  );
}

function SellerOrderDetail({
  fulfillment,
  onChanged,
}: {
  fulfillment: SellerFulfillmentRecord;
  onChanged: (next: SellerFulfillmentRecord) => Promise<void>;
}) {
  const [carrier, setCarrier] = useState("");
  const [trackingReference, setTrackingReference] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (
    action: "accept" | "prepare" | "dispatch" | "issue",
    body: Record<string, string> = {},
  ) => {
    setBusy(true);
    try {
      await onChanged(await actOnSellerOrder(fulfillment.id, action, body));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-l-0 border-border lg:border-l lg:pl-5">
      <div className="flex items-center gap-2">
        <PackageCheck className="size-5 text-primary" aria-hidden />
        <h4 className="font-semibold">{fulfillment.orderNumber}</h4>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {fulfillment.items?.map((item) => (
          <li key={item.productName}>
            {item.quantity} x {item.productName}
          </li>
        ))}
      </ul>
      {fulfillment.deliveryAddress && (
        <address className="mt-4 whitespace-pre-line text-sm not-italic text-muted-foreground">
          {fulfillment.deliveryAddress.recipientName}
          {"\n"}
          {fulfillment.deliveryAddress.phone}
          {"\n"}
          {fulfillment.deliveryAddress.addressLine}, {fulfillment.deliveryAddress.town}
          {"\n"}
          {fulfillment.deliveryAddress.county}
        </address>
      )}
      {fulfillment.status === "READY_FOR_SELLER" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void act("accept")}>
            Accept order
          </Button>
          <IssueButton busy={busy} onIssue={() => act("issue", { reason: "OTHER" })} />
        </div>
      )}
      {fulfillment.status === "ACCEPTED" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void act("prepare")}>
            Prepare order
          </Button>
          <IssueButton busy={busy} onIssue={() => act("issue", { reason: "OTHER" })} />
        </div>
      )}
      {fulfillment.status === "PREPARING" && (
        <div className="mt-4 space-y-3">
          <Input
            value={carrier}
            maxLength={80}
            placeholder="Carrier"
            onChange={(event) => setCarrier(event.target.value)}
          />
          <Input
            value={trackingReference}
            maxLength={120}
            placeholder="Tracking reference (optional)"
            onChange={(event) => setTrackingReference(event.target.value)}
          />
          <Button
            disabled={busy || carrier.trim().length < 2}
            onClick={() =>
              void act("dispatch", { carrier, ...(trackingReference ? { trackingReference } : {}) })
            }
          >
            <Truck aria-hidden /> Mark dispatched
          </Button>
          <IssueButton busy={busy} onIssue={() => act("issue", { reason: "CANNOT_DISPATCH" })} />
        </div>
      )}
    </div>
  );
}

function IssueButton({ busy, onIssue }: { busy: boolean; onIssue: () => Promise<void> }) {
  return (
    <Button variant="outline" disabled={busy} onClick={() => void onIssue()}>
      Report fulfillment issue
    </Button>
  );
}
