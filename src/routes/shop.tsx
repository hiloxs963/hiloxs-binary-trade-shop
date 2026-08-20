import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ImagePlus, Lock, Search, ShoppingCart, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CATEGORIES,
  CATEGORY_EMOJI,
  SHOP_CATEGORIES,
  SUPPORT,
  TILL_NUMBER,
  MERCHANT_NAME,
  discountPct,
  dual,
  kes,
  type Product,
  type ShopCategory,
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
  const {
    state,
    hydrated,
    addToCart,
    setCartQty,
    clearCart,
    checkout,
    allProducts,
    addProduct,
    removeProduct,
    setAdmin,
  } = useHiloxs();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [query, setQuery] = useState("");

  const products = useMemo(
    () =>
      allProducts.filter(
        (p) =>
          (category === "All" || p.category === category) &&
          p.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [allProducts, category, query],
  );

  const flashDeals = useMemo(
    () =>
      allProducts
        .filter((p) => p.oldPriceKes)
        .sort((a, b) => discountPct(b) - discountPct(a))
        .slice(0, 4),
    [allProducts],
  );

  const cartLines = hydrated
    ? Object.entries(state.cart).map(([id, qty]) => ({
        product: allProducts.find((p) => p.id === id)!,
        qty,
      }))
        .filter((l) => Boolean(l.product))
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

      <AdminUploader
        unlocked={state.admin.unlocked}
        onUnlock={() => setAdmin({ unlocked: true })}
        onAdd={addProduct}
        customProducts={hydrated ? state.customProducts : []}
        onRemove={removeProduct}
      />

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
                      if (order)
                        toast.success(`Order ${order.id} placed — pay ${MERCHANT_NAME} on till ${TILL_NUMBER}`);
                    }}
                  >
                    Pay {MERCHANT_NAME} — M-Pesa Till {TILL_NUMBER}
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
            <p className="font-semibold text-foreground">{MERCHANT_NAME}</p>
            <p className="mt-1">Buy Goods Till: {TILL_NUMBER}</p>
            <p className="mt-1">
              Payments in and out of shop, binary and trading all run through this one till, and
              show as {MERCHANT_NAME} on the M-Pesa prompt.
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
function ProductCard({ product: p, onAdd }: { product: Product; onAdd: () => void }) {
  const off = discountPct(p);
  const image = (p as Product & { image?: string }).image;
  return (
    <article className="panel flex flex-col overflow-hidden">
      <div className="relative grid h-36 place-items-center bg-[image:var(--gradient-night)] text-5xl">
        {image ? (
          <img src={image} alt={p.name} className="size-full object-cover" loading="lazy" />
        ) : (
          <span aria-hidden>{p.emoji}</span>
        )}
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

type NewProduct = {
  name: string;
  category: ShopCategory;
  priceKes: number;
  oldPriceKes?: number;
  reviews: number;
  blurb: string;
  image?: string;
  badge?: Product["badge"];
};

const BADGES = ["FLASH SALE", "BEST SELLER", "HOT DEAL", "TOP RATED"] as const;

function AdminUploader({
  unlocked,
  onUnlock,
  onAdd,
  customProducts,
  onRemove,
}: {
  unlocked: boolean;
  onUnlock: () => void;
  onAdd: (input: NewProduct) => string | null;
  customProducts: (Product & { image?: string })[];
  onRemove: (id: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ShopCategory>("Laptops");
  const [price, setPrice] = useState("");
  const [oldPrice, setOldPrice] = useState("");
  const [reviews, setReviews] = useState("");
  const [blurb, setBlurb] = useState("");
  const [badge, setBadge] = useState<Product["badge"] | "">("");
  const [image, setImage] = useState<string | undefined>(undefined);

  const readFile = (file: File) => {
    if (file.size > 1_500_000) {
      toast.error("Please use a photo under 1.5 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <section className="panel mt-10 p-5">
      <div className="flex items-center gap-2">
        <ImagePlus className="size-5 text-primary" />
        <h2 className="text-xl font-bold">Admin — upload a new product</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Only the HILOXS admin can post products here. Add a photo, price, discount and review count —
        shoppers can then add it to cart and pay through the HILOXS paybill.
      </p>

      {!unlocked ? (
        <form
          className="mt-4 flex max-w-sm gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pin.trim() === "HILOXS-ADMIN") {
              onUnlock();
              setPin("");
              toast.success("Admin upload unlocked");
            } else toast.error("Wrong admin key");
          }}
        >
          <Input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Admin key"
            type="password"
          />
          <Button type="submit" variant="outline">
            <Lock /> Unlock
          </Button>
        </form>
      ) : (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const error = onAdd({
              name,
              category,
              priceKes: Number(price),
              ...(oldPrice ? { oldPriceKes: Number(oldPrice) } : {}),
              reviews: Number(reviews) || 0,
              blurb,
              ...(image ? { image } : {}),
              ...(badge ? { badge } : {}),
            });
            if (error) {
              toast.error(error);
              return;
            }
            toast.success(`${name} is live in the shop`);
            setName("");
            setPrice("");
            setOldPrice("");
            setReviews("");
            setBlurb("");
            setBadge("");
            setImage(undefined);
          }}
        >
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Product photo</label>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) readFile(file);
                }}
                className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-secondary-foreground"
              />
              {image && (
                <img src={image} alt="Preview" className="size-14 rounded-md object-cover" />
              )}
            </div>
          </div>

          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ShopCategory)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {SHOP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price (KSh)"
            inputMode="numeric"
          />
          <Input
            value={oldPrice}
            onChange={(e) => setOldPrice(e.target.value)}
            placeholder="Old price (KSh) — for the discount"
            inputMode="numeric"
          />
          <Input
            value={reviews}
            onChange={(e) => setReviews(e.target.value)}
            placeholder="Number of reviews"
            inputMode="numeric"
          />
          <select
            value={badge}
            onChange={(e) => setBadge(e.target.value as Product["badge"] | "")}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">No badge</option>
            {BADGES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <Input
            className="sm:col-span-2"
            value={blurb}
            onChange={(e) => setBlurb(e.target.value)}
            placeholder="Short description"
          />
          <Button type="submit" variant="hero" className="sm:col-span-2">
            <ImagePlus /> Publish to shop
          </Button>
        </form>
      )}

      {customProducts.length > 0 && (
        <div className="mt-5 space-y-2">
          <p className="text-sm font-semibold">Your uploaded products</p>
          {customProducts.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-border p-2 text-sm"
            >
              {p.image ? (
                <img src={p.image} alt={p.name} className="size-10 rounded object-cover" />
              ) : (
                <span className="text-xl" aria-hidden>
                  {p.emoji}
                </span>
              )}
              <span className="flex-1">
                {p.name} · {kes(p.priceKes)} · {p.sold.toLocaleString()} reviews
              </span>
              {unlocked && (
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => onRemove(p.id)}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
