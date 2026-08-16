import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, ShoppingCart, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CATEGORIES,
  CATEGORY_EMOJI,
  PRODUCTS,
  SHOP_CATEGORIES,
  SUPPORT,
  TILL_NUMBER,
  TILL_LABEL,
  discountPct,
  dual,
  kes,
  type Product,
} from "@/lib/hiloxs";
import { useHiloxs } from "@/lib/hiloxs-store";
import { toast } from "sonner";

export const Route = createFileRoute("/shop")({
  head: () => ({
    meta: [
      { title: "Shop Electronics, Fashion, Kitchen & More — HILOXS" },
      {
        name: "description",
        content:
          "Buy laptops, phones, kitchen utensils, clothes, school products, groceries and more on HILOXS with till, PayPal or MiniPay checkout.",
      },
      { property: "og:title", content: "Shop Everything on HILOXS" },
      {
        property: "og:description",
        content: "Electronics, fashion, home & kitchen, school and groceries priced in KSh and USD.",
      },
    ],
  }),
  component: ShopPage,
});

function ShopPage() {
  const { state, hydrated, addToCart, setCartQty, clearCart, checkout } = useHiloxs();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [query, setQuery] = useState("");

  const products = useMemo(
    () =>
      PRODUCTS.filter(
        (p) =>
          (category === "All" || p.category === category) &&
          p.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [category, query],
  );

  const flashDeals = useMemo(
    () =>
      PRODUCTS.filter((p) => p.oldPriceKes)
        .sort((a, b) => discountPct(b) - discountPct(a))
        .slice(0, 4),
    [],
  );

  const cartLines = hydrated
    ? Object.entries(state.cart).map(([id, qty]) => ({
        product: PRODUCTS.find((p) => p.id === id)!,
        qty,
      }))
    : [];
  const total = cartLines.reduce((s, l) => s + l.product.priceKes * l.qty, 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-bold sm:text-4xl">HILOXS Shop</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Everything you need in one place — electronics, phones, home &amp; kitchen, fashion, beauty,
        school products, groceries and sports gear. Every price is shown in shillings and dollars.
      </p>

      <section className="mt-8">
        <h2 className="text-2xl font-bold">Shop by category</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {SHOP_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`panel flex flex-col items-center gap-2 p-5 transition-colors hover:border-primary ${
                category === c ? "border-primary" : ""
              }`}
            >
              <span className="text-3xl" aria-hidden>{CATEGORY_EMOJI[c]}</span>
              <span className="text-center text-sm font-medium">{c}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold">Flash deals</h2>
            <p className="text-sm text-muted-foreground">Biggest markdowns right now</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCategory("All")}>See all</Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {flashDeals.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onAdd={() => {
                addToCart(p.id);
                toast.success(`${p.name} added to cart`);
              }}
            />
          ))}
        </div>
      </section>

      <h2 className="mt-12 text-2xl font-bold">Trending on HILOXS</h2>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search laptops, phones, cookware, uniforms…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={c === category ? "default" : "outline"}
              onClick={() => setCategory(c)}
            >
              {c}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onAdd={() => {
                addToCart(p.id);
                toast.success(`${p.name} added to cart`);
              }}
            />
          ))}
          {products.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing matches that search yet.</p>
          )}
        </div>

        <aside id="cart" className="panel h-fit p-5 lg:sticky lg:top-20">
          <h2 className="text-lg font-semibold">Your cart</h2>
          {cartLines.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing here yet. Add a laptop, screen or woofer to get started.
            </p>
          ) : (
            <>
              <ul className="mt-4 space-y-3">
                {cartLines.map(({ product, qty }) => (
                  <li key={product.id} className="flex items-start gap-3 text-sm">
                    <span className="text-xl" aria-hidden>{product.emoji}</span>
                    <div className="flex-1">
                      <p className="font-medium leading-tight">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{kes(product.priceKes)} each</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setCartQty(product.id, qty - 1)}>-</Button>
                        <span className="w-6 text-center">{qty}</span>
                        <Button size="sm" variant="outline" onClick={() => setCartQty(product.id, qty + 1)}>+</Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remove"
                          onClick={() => setCartQty(product.id, 0)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4 border-t border-border pt-4">
                <p className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-semibold">{dual(total)}</span>
                </p>
                <div className="mt-4 space-y-2">
                  <Button
                    variant="hero"
                    className="w-full"
                    onClick={() => {
                      const order = checkout("till");
                      if (order) toast.success(`Order ${order.id} placed — pay to the HILOXS till`);
                    }}
                  >
                    Pay with M-Pesa Till
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      const order = checkout("paypal");
                      if (order) toast.success(`Order ${order.id} placed via PayPal`);
                    }}
                  >
                    Pay with PayPal
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      const order = checkout("minipay");
                      if (order) toast.success(`Order ${order.id} placed via MiniPay`);
                    }}
                  >
                    Pay with MiniPay
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={clearCart}>
                    Clear cart
                  </Button>
                </div>
              </div>
            </>
          )}

          <div className="mt-5 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">{TILL_LABEL}</p>
            <p className="mt-1">
              {TILL_NUMBER
                ? `Buy Goods Till: ${TILL_NUMBER}`
                : "Till number: ____________ (reserved — Buy Goods only, no paybill)"}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
function ProductCard({ product: p, onAdd }: { product: Product; onAdd: () => void }) {
  const off = discountPct(p);
  return (
    <article className="panel flex flex-col overflow-hidden">
      <div className="relative grid h-36 place-items-center bg-[image:var(--gradient-night)] text-5xl">
        <span aria-hidden>{p.emoji}</span>
        {p.badge && (
          <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
            {p.badge}
          </span>
        )}
        {off > 0 && (
          <span className="absolute right-2 top-2 rounded-md bg-background/85 px-2 py-1 text-[11px] font-semibold">
            -{off}%
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <Badge variant="secondary" className="w-fit">{p.category}</Badge>
        <h3 className="mt-2 text-sm font-semibold leading-snug">{p.name}</h3>
        <p className="mt-1 flex-1 text-xs text-muted-foreground">{p.blurb}</p>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Star className="size-3.5 fill-primary text-primary" />
          {p.rating} · {p.sold.toLocaleString()} reviews
        </div>
        <div className="mt-2">
          <p className="text-base font-bold text-primary">
            {kes(p.priceKes)}{" "}
            {p.oldPriceKes && (
              <span className="text-xs font-normal text-muted-foreground line-through">
                {kes(p.oldPriceKes)}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">{dual(p.priceKes).split(" (")[0]}</p>
        </div>
        <Button className="mt-3" variant="hero" size="sm" onClick={onAdd}>
          <ShoppingCart /> Add to cart
        </Button>
      </div>
    </article>
  );
}
