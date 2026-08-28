import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, ShieldCheck, ShoppingCart, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHiloxs } from "@/lib/hiloxs-store";
import logoIcon from "@/assets/hiloxs-icon.png";
import { SUPPORT } from "@/lib/hiloxs";
import { ADMIN_KEY, setAdminMode, useAdminMode } from "@/lib/admin";


const NAV = [
  { to: "/", label: "Home" },
  { to: "/shop", label: "Shop" },
  { to: "/training", label: "Training" },
  { to: "/binary-plan", label: "Binary Plan" },
  { to: "/trading", label: "Trading" },
  { to: "/sell-with-us", label: "Sell With Us" },
  { to: "/my-orders", label: "My Orders" },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { state, hydrated } = useHiloxs();
  const cartCount = hydrated
    ? Object.values(state.cart).reduce((s, q) => s + q, 0)
    : 0;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Link to="/" className="flex items-center gap-2">
          <img
            src={logoIcon}
            alt=""
            width={256}
            height={256}
            className="h-9 w-auto object-contain"
          />
          <span className="font-display text-lg font-bold tracking-tight">
            HILO<span className="text-gradient-brand">XS</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{ className: "bg-secondary text-foreground" }}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-2">
          <Button asChild variant="outline" size="icon" aria-label="Cart">
            <Link to="/shop" hash="cart" className="relative">
              <ShoppingCart />
              {cartCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {cartCount}
                </span>
              )}
            </Link>
          </Button>
          <Button asChild variant="hero" size="sm" className="hidden sm:inline-flex">
            <Link to="/binary-plan">Join HILOXS</Link>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden"
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-border bg-background px-4 pb-4 pt-2 lg:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{ className: "text-primary" }}
              className="block rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border bg-surface/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <img
              src={logoIcon}
              alt=""
              width={256}
              height={256}
              className="h-7 w-auto object-contain"
            />
            <span className="font-display text-lg font-bold tracking-tight">
              HILO<span className="text-gradient-brand">XS</span>
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Electronics marketplace, binary network marketing and a demo trading desk — one
            platform, one community.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold">Platform</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link to="/shop" className="hover:text-foreground">Shop electronics</Link></li>
            <li><Link to="/binary-plan" className="hover:text-foreground">Binary plan</Link></li>
            <li><Link to="/trading" className="hover:text-foreground">Demo trading desk</Link></li>
            <li><Link to="/training" className="hover:text-foreground">Training library</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold">Business</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link to="/sell-with-us" className="hover:text-foreground">Sell with us</Link></li>
            <li><Link to="/my-orders" className="hover:text-foreground">My orders</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold">Support</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>{SUPPORT.hours}</li>
            <li>
              <a href={`mailto:${SUPPORT.email}`} className="hover:text-foreground">
                {SUPPORT.email}
              </a>
            </li>
            <li>
              <a href={`tel:${SUPPORT.phoneHref}`} className="hover:text-foreground">
                {SUPPORT.phone}
              </a>
            </li>
            <li className="pt-1">PayPal · MiniPay · M-Pesa payouts</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border px-4 py-5">
        <AdminKeyBox />
        <p className="mt-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} HILOXS. Trading carries risk of loss.
        </p>
      </div>
    </footer>
  );
}

/** Discreet admin key box — regular shoppers can ignore it. */
function AdminKeyBox() {
  const [key, setKey] = useState("");
  const admin = useAdminMode();

  if (admin) {
    return (
      <div className="mx-auto flex max-w-sm items-center justify-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 text-primary">
          <ShieldCheck className="size-3.5" /> Admin mode on
        </span>
        <Button size="sm" variant="ghost" onClick={() => setAdminMode(false)}>
          Exit admin
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mx-auto flex max-w-sm items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim() === ADMIN_KEY) {
          setAdminMode(true);
          setKey("");
          toast.success("Admin mode unlocked");
        } else toast.error("Wrong admin key");
      }}
    >
      <Input
        value={key}
        type="password"
        aria-label="Admin key"
        placeholder="Admin key"
        onChange={(e) => setKey(e.target.value)}
        className="h-9 text-sm"
      />
      <Button type="submit" size="sm" variant="outline">
        <ShieldCheck /> Enter
      </Button>
    </form>
  );
}
