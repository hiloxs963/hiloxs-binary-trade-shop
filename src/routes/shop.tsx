import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  Search,
  SearchX,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { CatalogProductMedia } from "@/components/hiloxs/CatalogProductMedia";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { catalogPriceKes, getPublicCatalog, type PublicCatalogProduct } from "@/lib/catalog-api";
import {
  CATEGORIES,
  CATEGORY_EMOJI,
  PRODUCTS,
  SHOP_CATEGORIES,
  SUPPORT,
  dual,
  kes,
  type Product,
} from "@/lib/hiloxs";
import { useHiloxs } from "@/lib/hiloxs-context";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/shop")({
  head: () =>
    pageSeo({
      title: "Shop Electronics, Home, Fashion and More | HILOXS",
      description:
        "Browse the HILOXS catalog by category, compare listed prices and add products to your cart before account-based checkout.",
      path: "/shop",
    }),
  component: ShopPage,
});

type CatalogViewProduct = {
  product: PublicCatalogProduct;
  legacy?: Product;
  priceKes: number;
};

function ShopPage() {
  const { state, hydrated, addToCart, setCartQty, clearCart } = useHiloxs();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<PublicCatalogProduct[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    void getPublicCatalog()
      .then((products) => {
        if (!active) return;
        setCatalog(products);
        setCatalogState("ready");
      })
      .catch(() => {
        if (active) setCatalogState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const viewProducts = useMemo(
    () =>
      catalog.map((product) => {
        const legacy = PRODUCTS.find((candidate) => candidate.id === product.id);
        return {
          product,
          ...(legacy ? { legacy } : {}),
          priceKes: catalogPriceKes(product),
        };
      }),
    [catalog],
  );
  const products = useMemo(
    () =>
      viewProducts.filter(
        ({ product }) =>
          (category === "All" || product.category === category) &&
          product.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [viewProducts, category, query],
  );
  /**
   * Cart ids are catalog keys from the API - "lp-01" for platform products and
   * "seller-<uuid>" for activated seller products. Only the live catalog holds
   * both, so every cart line resolves against it, never the static list.
   */
  const catalogById = useMemo(
    () => new Map(viewProducts.map((item) => [item.product.id, item])),
    [viewProducts],
  );
  const cartStored = hydrated ? Object.keys(state.cart).length : 0;
  const cartReady = hydrated && catalogState === "ready";
  const cartLines = useMemo(
    () =>
      cartReady
        ? Object.entries(state.cart).flatMap(([id, qty]) => {
            const item = catalogById.get(id);
            return item ? [{ item, qty }] : [];
          })
        : [],
    [cartReady, catalogById, state.cart],
  );
  const unresolvedCartCount = cartReady
    ? Object.keys(state.cart).filter((id) => !catalogById.has(id)).length
    : 0;
  const total = cartLines.reduce((sum, line) => sum + line.item.priceKes * line.qty, 0);
  const handleAddToCart = useCallback(
    (product: PublicCatalogProduct) => {
      if (!catalogById.has(product.id)) {
        toast.error(`${product.name} could not be added to the cart. Please reload and try again.`);
        return;
      }
      addToCart(product.id);
      toast.success(`${product.name} added to cart`);
    },
    [addToCart, catalogById],
  );

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
          {SHOP_CATEGORIES.map((item) => (
            <button
              key={item}
              onClick={() => setCategory(item)}
              aria-pressed={category === item}
              className={`panel flex flex-col items-center gap-2 p-5 transition-colors hover:border-primary ${category === item ? "border-primary" : ""}`}
            >
              <span className="text-3xl" aria-hidden>
                {CATEGORY_EMOJI[item]}
              </span>
              <span className="text-center text-sm font-medium">{item}</span>
            </button>
          ))}
        </div>
      </section>

      <h2 className="mt-12 text-2xl font-bold">Trending on HILOXS</h2>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search laptops, phones, cookware, uniforms…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={item === category ? "default" : "outline"}
              onClick={() => setCategory(item)}
              aria-pressed={item === category}
            >
              {item}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {catalogState === "loading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading current catalog...
            </p>
          )}
          {catalogState === "error" && (
            <div
              className="panel flex items-start gap-3 p-5 sm:col-span-2 xl:col-span-3"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-5 text-destructive" aria-hidden />
              <div>
                <p className="text-sm font-semibold">The current catalog could not be loaded.</p>
                <p className="mt-1 text-xs text-muted-foreground">Please try again shortly.</p>
              </div>
            </div>
          )}
          {catalogState === "ready" &&
            products.map((item) => (
              <ProductCard
                key={item.product.id}
                item={item}
                onAdd={() => handleAddToCart(item.product)}
              />
            ))}
          {catalogState === "ready" && products.length === 0 && (
            <div className="panel grid place-items-center gap-3 p-8 text-center sm:col-span-2 xl:col-span-3">
              <SearchX className="size-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">No products match this search.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setCategory("All");
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>

        <aside id="cart" className="panel h-fit p-5 lg:sticky lg:top-20">
          <h2 className="text-lg font-semibold">Your cart</h2>
          {unresolvedCartCount > 0 && (
            <p className="mt-3 text-xs text-destructive" role="alert">
              {unresolvedCartCount} saved item{unresolvedCartCount === 1 ? " is" : "s are"} no
              longer in the catalog and {unresolvedCartCount === 1 ? "is" : "are"} not shown below.
            </p>
          )}
          {cartStored > 0 && catalogState === "loading" ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading your cart...
            </p>
          ) : cartStored > 0 && catalogState === "error" ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              Your cart could not be loaded because the catalog is unavailable. Your saved items are
              safe - please try again shortly.
            </p>
          ) : cartLines.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing here yet. Add a laptop, screen or woofer to get started.
            </p>
          ) : (
            <>
              <ul className="mt-4 space-y-3">
                {cartLines.map(({ item, qty }) => (
                  <li key={item.product.id} className="flex items-start gap-3 text-sm">
                    <CatalogProductMedia
                      product={item.product}
                      {...(item.legacy ? { fallbackProduct: item.legacy } : {})}
                      className="size-12 shrink-0 rounded-md"
                      imageClassName="object-contain p-1"
                      compact
                    />
                    <div className="flex-1">
                      <p className="font-medium leading-tight">{item.product.name}</p>
                      <p className="text-xs text-muted-foreground">{kes(item.priceKes)} each</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Decrease quantity of ${item.product.name}`}
                          onClick={() => setCartQty(item.product.id, qty - 1)}
                        >
                          -
                        </Button>
                        <span className="w-6 text-center">{qty}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Increase quantity of ${item.product.name}`}
                          onClick={() => setCartQty(item.product.id, qty + 1)}
                        >
                          +
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${item.product.name} from cart`}
                          onClick={() => setCartQty(item.product.id, 0)}
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
                  <span className="text-muted-foreground">Catalog estimate</span>
                  <span className="font-semibold">{dual(total)}</span>
                </p>
                <div className="mt-4 space-y-2">
                  <Button asChild variant="hero" className="w-full">
                    <Link to="/checkout">
                      Checkout <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Account access will be required at checkout. Your cart stays available while you
                    sign in or register.
                  </p>
                  <Button variant="ghost" className="w-full" onClick={clearCart}>
                    Clear cart
                  </Button>
                </div>
              </div>
            </>
          )}
          <div className="mt-5 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Payments are not currently accepted</p>
            <p className="mt-1">
              Payment instructions will be provided after secure checkout services are connected.
            </p>
          </div>
          <div className="mt-4 rounded-lg border border-border p-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Support</p>
            <p className="mt-1">{SUPPORT.hours}</p>
            <p>{SUPPORT.email}</p>
            <p>{SUPPORT.phone}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ProductCard({ item, onAdd }: { item: CatalogViewProduct; onAdd: () => void }) {
  const { product, legacy, priceKes } = item;
  return (
    <article className="panel flex flex-col overflow-hidden">
      <div className="relative">
        <CatalogProductMedia
          product={product}
          {...(legacy ? { fallbackProduct: legacy } : {})}
          className="aspect-[4/3]"
          imageClassName="object-contain p-3"
        />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <Badge variant="secondary" className="w-fit">
          {product.category}
        </Badge>
        <Link
          to="/shop/$slug"
          params={{ slug: product.slug }}
          className="mt-2 block rounded-sm text-sm font-semibold leading-snug hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {product.name}
        </Link>
        <p className="mt-1 flex-1 text-xs text-muted-foreground">{product.description}</p>
        <div className="mt-2">
          <p className="text-base font-bold text-primary">{kes(priceKes)}</p>
          <p className="text-xs text-muted-foreground">{dual(priceKes).split(" (")[0]}</p>
        </div>
        {product.isPurchasable ? (
          <Button className="mt-3" variant="hero" size="sm" onClick={onAdd}>
            <ShoppingCart /> Add to cart
          </Button>
        ) : (
          <p className="mt-3 rounded-md border border-border bg-secondary px-3 py-2 text-center text-sm font-medium">
            Currently unavailable
          </p>
        )}
        <Button asChild className="mt-2" variant="ghost" size="sm">
          <Link to="/shop/$slug" params={{ slug: product.slug }}>
            View details
          </Link>
        </Button>
      </div>
    </article>
  );
}
