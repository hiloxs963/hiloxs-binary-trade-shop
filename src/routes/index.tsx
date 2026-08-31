import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  GraduationCap,
  Laptop,
  Network,
  ShieldCheck,
  ShoppingBag,
  Store,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import heroImage from "@/assets/hiloxs-brand-hero.jpg";
import { PLAN, PRODUCTS, dual, kes, productSlug } from "@/lib/hiloxs";
import { absoluteUrl, pageSeo, SITE_NAME, SITE_URL } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () =>
    pageSeo({
      title: "HILOXS | Shop, Learn and Explore the Binary Plan",
      description:
        "Explore the HILOXS product catalog, training library, binary-plan prototype and clearly labelled practice trading simulation.",
      path: "/",
      structuredData: [
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: SITE_NAME,
          url: SITE_URL,
          logo: absoluteUrl("/favicon.png"),
        },
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE_NAME,
          url: SITE_URL,
        },
      ],
    }),
  component: Index,
});

const PILLARS = [
  {
    icon: ShoppingBag,
    title: "Shop",
    to: "/shop" as const,
    body: "Browse product details, compare listed prices and keep items in your cart.",
  },
  {
    icon: GraduationCap,
    title: "Training",
    to: "/training" as const,
    body: "Review the topics planned for the future HILOXS training library.",
  },
  {
    icon: Network,
    title: "Binary Plan",
    to: "/binary-plan" as const,
    body: "Explore a browser-only prototype of referral and pairing calculations.",
  },
  {
    icon: Activity,
    title: "Trading",
    to: "/trading" as const,
    body: "A practice desk with simulated candles, virtual balance and selectable expiry timers.",
  },
  {
    icon: Store,
    title: "Sell With Us",
    to: "/sell-with-us" as const,
    body: "Review the information future sellers will need before submitting an application.",
  },
  {
    icon: Laptop,
    title: "My Orders",
    to: "/my-orders" as const,
    body: "Order history will be available after secure account and checkout services launch.",
  },
];

function Index() {
  const featured = PRODUCTS.slice(0, 4);

  return (
    <div>
      <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 lg:grid-cols-2 lg:py-20">
        <div>
          <Badge variant="secondary" className="gap-1">
            <ShieldCheck className="size-3.5" /> Electronics only · No PMAs
          </Badge>
          <h1 className="mt-4 font-display text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
            Shop electronics. <span className="text-gradient-brand">Build your team.</span> Learn to
            trade.
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            HILOXS is one platform with four engines: a marketplace for laptops, screens and
            woofers; a browser-only binary-plan prototype; a demo trading desk using virtual funds;
            and a training library that is being prepared.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild variant="hero" size="lg">
              <Link to="/binary-plan">Explore the binary prototype</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/shop">Browse the shop</Link>
            </Button>
          </div>
          <dl className="mt-8 grid max-w-md grid-cols-3 gap-4">
            <HeroStat
              label="Prototype referral"
              value={dual(PLAN.directReferralKes).split(" (")[0]!}
            />
            <HeroStat label="Prototype pair" value={dual(PLAN.pairMatchingKes).split(" (")[0]!} />
            <HeroStat label="Proposed package" value={dual(PLAN.entryPackageKes).split(" (")[0]!} />
          </dl>
        </div>
        <div className="panel overflow-hidden">
          <img
            src={heroImage}
            alt="HILOXS brand mark with the tagline Luxury. Quality. Lifestyle."
            width={1254}
            height={1254}
            className="h-full w-full object-cover"
            fetchPriority="high"
            decoding="async"
          />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6">
        <h2 className="text-2xl font-bold sm:text-3xl">What is inside HILOXS</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Six focused sections covering the catalog, learning resources and current prototypes.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <Link
              key={p.title}
              to={p.to}
              className="panel block p-6 transition-colors hover:border-primary"
            >
              <p.icon className="size-6 text-primary" />
              <h3 className="mt-3 text-lg font-semibold">{p.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14">
        <div className="panel grid gap-8 p-8 lg:grid-cols-2">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <Wallet className="size-5" />
              <span className="text-xs font-semibold uppercase tracking-widest">
                Prototype assumptions
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-bold sm:text-3xl">
              The proposed binary plan in plain words
            </h2>
            <ol className="mt-5 space-y-4 text-sm text-muted-foreground">
              <li>
                <span className="font-semibold text-foreground">1. Proposed package.</span> The
                model uses {dual(PLAN.entryPackageKes)}, with {kes(PLAN.registrationFeeKes)}{" "}
                assigned as an illustrative registration fee.
              </li>
              <li>
                <span className="font-semibold text-foreground">2. Demo referrals.</span> The
                prototype assigns {dual(PLAN.directReferralKes)} to each simulated direct referral.
              </li>
              <li>
                <span className="font-semibold text-foreground">3. Demo pairs.</span> One simulated
                left referral plus one simulated right referral adds {dual(PLAN.pairMatchingKes)} to
                the browser-only prototype ledger.
              </li>
              <li>
                <span className="font-semibold text-foreground">4. No withdrawals.</span> Prototype
                balances have no cash value. PayPal, MiniPay and M-Pesa payouts are not currently
                available.
              </li>
            </ol>
            <Button asChild variant="hero" className="mt-6">
              <Link to="/binary-plan">Open the prototype dashboard</Link>
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {featured.map((p) => (
              <Link
                key={p.id}
                to="/shop/$slug"
                params={{ slug: productSlug(p) }}
                className="rounded-xl border border-border bg-background/40 p-4 transition-colors hover:border-primary"
                aria-label={`View ${p.name}`}
              >
                <span className="text-3xl" aria-hidden>
                  {p.emoji}
                </span>
                <p className="mt-2 text-sm font-semibold leading-tight">{p.name}</p>
                <p className="mt-1 text-sm font-bold text-primary">{kes(p.priceKes)}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/70 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-lg font-bold text-primary">{value}</dd>
    </div>
  );
}
